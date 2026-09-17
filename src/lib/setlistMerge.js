/**
 * Two copies of a stage — setlists, stars, and what Previous and Next walk —
 * made into one.
 *
 * SPLIT OUT OF cloudSetlists SO THE PHONE CAN HAVE IT. This is the part that
 * can lose somebody's work: a running order built at the Mac on Tuesday and a
 * star tapped on the phone on Wednesday have to both survive meeting each
 * other. Two apps merging by their own rules would not argue — they would
 * take turns overwriting, and the setlist that disappeared would look like a
 * setlist nobody saved.
 *
 * So it is here, once, and `npm run sync:rules` hands the phone the same copy.
 *
 * WHAT IS NOT HERE is the network. Reading and writing the account's row is
 * Supabase, and the two apps reach Supabase through different modules — so
 * each keeps its own twenty lines of transport and hands them to `syncStage`
 * below. Nothing in this file imports anything that is not already shared.
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
 * as the other. The key is derived by shared/device-slug, on both ends, for
 * the same reason.
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
 */
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
  /*
   * Sorted, because both devices have to arrive at the SAME array or they
   * write to each other forever. Run together the other way round — theirs
   * first — the same deletes come out in a different order, which reads as a
   * change, which is a write, which is a change on the other device.
   */
  const removed = cleanGoneList([...(mine.removed || []), ...(theirs.removed || [])], now).sort(
    (a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
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

/**
 * The same value written the same way, whatever order the keys came in.
 *
 * Arrays keep their order, because a running order is an order. Object keys do
 * not, because nobody typed them.
 */
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k])
    return out
  }
  return v
}

/**
 * Whether two merged copies say the same thing, so an identical write is skipped.
 *
 * COMPARED BY VALUE, NOT BY THE ORDER THE KEYS HAPPEN TO BE IN, and that is
 * not a nicety. The account stores this as Postgres `jsonb`, which does not
 * keep key order — it hands the object back with the keys sorted by length.
 * `mergeUnit` builds them in the order that reads well in this file. So a
 * plain stringify of the two NEVER matched, whatever they contained, and every
 * sync wrote a copy of what was already there. Two devices doing that to each
 * other is a loop with no exit: thousands of reads and writes of the same
 * unchanged setlists, which is how an account with one setlist in it managed
 * to spend a database's entire daily disk allowance.
 */
export const sameUnits = (a, b) =>
  JSON.stringify(canonical(a || {})) === JSON.stringify(canonical(b || {}))

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

/**
 * One round: read the account, merge it with this device, write both back.
 *
 * `io.load` answers with `{ units, device }` or null; `io.save` takes the
 * merged units and answers whether it landed. Neither may throw — a phone
 * opening on a dead network still has its own setlists, and failing over a
 * fetch would take the stage screen down with it.
 *
 * Returns what changed HERE, so the app can say "picked up 2 setlists from
 * your Mac" rather than quietly rearranging a stage screen somebody is
 * standing in front of.
 */
export async function syncStage(io, storage) {
  const mine = localUnits(storage)
  const cloud = await io.load()
  const merged = mergeUnits(mine, cloud?.units || {})
  const changedHere = !sameUnits(mine, merged)
  if (changedHere) applyUnits(merged, storage)
  const pushed = sameUnits(cloud?.units || {}, merged) ? false : await io.save(merged)
  return { merged, changedHere, pushed, from: cloud?.device || null, gained: gained(mine, merged) }
}

