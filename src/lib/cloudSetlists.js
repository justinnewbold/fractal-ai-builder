/**
 * Setlists and stars, following the account rather than the browser.
 *
 * "This says that setlists stay in this browser. Can we set that up to save to
 * the database across the cloud if user is signed in?"
 *
 * They were browser storage for the same reason the stars were: a convenience
 * nobody would grieve. That was true when a setlist was a handful of taps. It
 * stopped being true the moment one was a night's running order — built at the
 * bench on the Mac, and then not on the phone that is actually on the stand.
 *
 * ## What travels, and what does not
 *
 * The setlists, the stars, and which of them Previous and Next are stepping
 * through. NOT the recent list: which presets this phone played tonight is
 * about this phone, and two devices overwriting each other's history all
 * evening would be noise with no reader.
 *
 * Everything is kept per unit, exactly as it is locally — slot 4 on an FM3 and
 * slot 4 on an AM4 are different sounds, and a setlist of one must never play
 * as the other.
 *
 * ## Which copy wins
 *
 * Not "the newest device", which would throw away a setlist built on the other
 * one an hour earlier. Per THING:
 *
 *   a setlist   the later edit of that list, by id
 *   a delete    beats any copy of that list older than the delete
 *   the stars   the later tap, whole — a set of stars is a toggle, not a
 *               document, so half of each is not a thing anybody meant
 *   the source  the later choice
 *
 * Which needs times on things, and those are stamped by the two local modules
 * as they write. Anything from before that existed carries no time and reads
 * as the beginning — so a first sync unions rather than deletes, which is the
 * safe direction to be wrong in.
 *
 * The merge is pure and exported on its own. It is the part that can lose
 * somebody's work, so it is the part that is tested without a network.
 */
import { supabaseClient } from './remote.js'
import {
  ALL,
  cleanGoneList,
  devicesWithLists,
  putUnit,
  unitFor
} from './setlists.js'
import {
  devicesWithMarks,
  marksFor,
  putFavourites,
  starredAtFor
} from './presetMarks.js'
import { deviceName } from './cloudChat.js'

const TABLE = 'stage_lists'

/** Whether syncing is possible at all right now. Signed out is not an error. */
export const setlistCloudReady = () => !!supabaseClient()

const num = (n) => (Number.isFinite(n) ? n : 0)

/** Slot numbers only, deduped. */
const slots = (list) => {
  const out = []
  for (const n of Array.isArray(list) ? list : []) {
    if (Number.isInteger(n) && n >= 0 && !out.includes(n)) out.push(n)
  }
  return out
}

/**
 * Two copies of one unit's stage state, merged.
 *
 * `mine` wins ties, so a merge that changes nothing leaves the device it ran
 * on exactly as it was rather than rewriting it with an identical copy and
 * setting the other device syncing again.
 */
export function mergeUnit(mine = {}, theirs = {}, now = Date.now()) {
  const removed = cleanGoneList([...(mine.removed || []), ...(theirs.removed || [])], now)
  const goneAt = new Map()
  for (const g of removed) goneAt.set(g.id, Math.max(num(goneAt.get(g.id)), num(g.at)))

  /*
   * Local order first, then whatever the other copy has that this one doesn't.
   * Sorting by time would rearrange a running order every time a list was
   * renamed, and a running order is the one thing here with an order.
   */
  const byId = new Map()
  const order = []
  for (const list of [...(mine.lists || []), ...(theirs.lists || [])]) {
    if (!list || typeof list.id !== 'string') continue
    const prev = byId.get(list.id)
    if (!prev) order.push(list.id)
    if (!prev || num(list.at) > num(prev.at)) byId.set(list.id, { ...list, at: num(list.at) })
  }

  const lists = order
    .map((id) => byId.get(id))
    .filter((list) => {
      const gone = goneAt.get(list.id)
      // A delete only beats a copy that has not been edited since.
      return gone === undefined || num(list.at) > gone
    })
    .map((list) => ({
      id: list.id,
      name: typeof list.name === 'string' && list.name.trim() ? list.name.trim() : 'Setlist',
      presets: slots(list.presets),
      at: num(list.at)
    }))

  /*
   * The stars, whole, from whichever side tapped last — with one exception:
   * before either side has ever stamped a tap there is nothing to compare, and
   * two sets of stars built independently should both survive their first
   * meeting rather than one being chosen by a coin.
   */
  const mineAt = num(mine.starredAt)
  const theirsAt = num(theirs.starredAt)
  const favourites =
    !mineAt && !theirsAt
      ? slots([...(mine.favourites || []), ...(theirs.favourites || [])]).sort((a, b) => a - b)
      : theirsAt > mineAt
        ? slots(theirs.favourites)
        : slots(mine.favourites)

  const at = Math.max(num(mine.at), num(theirs.at))
  const source =
    num(theirs.at) > num(mine.at) ? theirs.source ?? ALL : mine.source ?? theirs.source ?? ALL

  return {
    lists,
    removed,
    favourites,
    starredAt: Math.max(mineAt, theirsAt),
    source: typeof source === 'string' ? source : ALL,
    at
  }
}

/** Every unit named by either copy, merged one at a time. */
export function mergeUnits(mine = {}, theirs = {}, now = Date.now()) {
  const keys = [...new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})])]
  const out = {}
  for (const key of keys) out[key] = mergeUnit(mine?.[key], theirs?.[key], now)
  return out
}

/** Whether two merged copies say the same thing, so an identical write is skipped. */
export const sameUnits = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {})

/** What this browser holds, for every unit it knows about. */
export function localUnits(storage) {
  const keys = [...new Set([...devicesWithLists(storage), ...devicesWithMarks(storage)])]
  const out = {}
  for (const key of keys) {
    const unit = unitFor(key, storage)
    out[key] = {
      ...unit,
      favourites: marksFor(key, storage).favourites,
      starredAt: starredAtFor(key, storage)
    }
  }
  return out
}

/**
 * Put a merged copy back into the two local stores.
 *
 * Both halves land in one pass, and both fire their own change event, so the
 * stage screen and the picker re-read without knowing this happened.
 */
export function applyUnits(units, storage) {
  for (const [key, unit] of Object.entries(units || {})) {
    putUnit(key, unit, storage)
    putFavourites(key, unit.favourites, unit.starredAt, storage)
  }
}

/**
 * What the account is holding, or null.
 *
 * Never throws. A phone opening on a dead network still has its own setlists,
 * and failing over a fetch would take the stage screen down with it.
 */
export async function loadCloudSetlists() {
  const client = supabaseClient()
  if (!client) return null
  try {
    const { data, error } = await client.from(TABLE).select('units,updated_at,device').maybeSingle()
    if (error || !data) return null
    return {
      units: data.units && typeof data.units === 'object' ? data.units : {},
      at: data.updated_at ? Date.parse(data.updated_at) : 0,
      device: data.device || null
    }
  } catch {
    return null
  }
}

/** Write this copy up, replacing whatever was there. Upserted, so no read first. */
export async function saveCloudSetlists(units, device = deviceName()) {
  const client = supabaseClient()
  if (!client) return false
  try {
    const { data } = await client.auth.getUser()
    const userId = data?.user?.id
    if (!userId) return false
    const { error } = await client.from(TABLE).upsert(
      {
        user_id: userId,
        units: units && typeof units === 'object' ? units : {},
        device,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )
    return !error
  } catch {
    // Offline, or signed out between the check and the write. What is on this
    // device is whole; the next change tries again.
    return false
  }
}

/**
 * One round: read the account, merge it with this browser, write both back.
 *
 * Returns what changed here, so the app can say "picked up 2 setlists from
 * your Mac" rather than quietly rearranging a stage screen somebody is
 * standing in front of.
 */
export async function syncSetlists(storage) {
  if (!setlistCloudReady()) return null
  const mine = localUnits(storage)
  const cloud = await loadCloudSetlists()
  const merged = mergeUnits(mine, cloud?.units || {})
  const changedHere = !sameUnits(mine, merged)
  if (changedHere) applyUnits(merged, storage)
  const pushed = sameUnits(cloud?.units || {}, merged) ? false : await saveCloudSetlists(merged)
  return { merged, changedHere, pushed, from: cloud?.device || null, gained: gained(mine, merged) }
}

/** How many setlists and stars arrived that this browser did not have. */
export function gained(mine = {}, merged = {}) {
  let lists = 0
  let stars = 0
  for (const [key, unit] of Object.entries(merged)) {
    const had = mine[key] || {}
    const ids = new Set((had.lists || []).map((l) => l.id))
    lists += (unit.lists || []).filter((l) => !ids.has(l.id)).length
    const stars_ = new Set(had.favourites || [])
    stars += (unit.favourites || []).filter((n) => !stars_.has(n)).length
  }
  return { lists, stars }
}
