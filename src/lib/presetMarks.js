/**
 * The presets you keep coming back to, and the ones you starred.
 *
 * A 512-slot unit is about forty screens of list. Range jumps get you to a
 * neighbourhood; these get you to a preset — the handful you actually played
 * this evening, and the handful you always play.
 *
 * Kept per device, not per app. Slot 4 on an FM3 and slot 4 on an AM4 are
 * different sounds, and a phone that drives both must not offer one as the
 * other. The key is whatever the caller calls the unit; an unknown device gets
 * its own bucket rather than borrowing somebody else's.
 *
 * This browser only. It is a convenience, not a record: nothing here is worth
 * a round trip to the Mac, and losing it costs somebody eight taps once.
 */

const KEY = 'fractal.presetMarks'

/** Eight, because that is what fits above a list without becoming the list. */
export const MAX_RECENT = 8

const store = (given) => {
  try {
    return given ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  } catch {
    // Blocked site data throws on the property access itself, not just on use.
    return null
  }
}

/** Whole marks file, or an empty one. Anything unreadable is empty, never a throw. */
function readAll(storage) {
  try {
    const raw = store(storage)?.getItem(KEY)
    const all = raw ? JSON.parse(raw) : null
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
  } catch {
    return {}
  }
}

function writeAll(all, storage) {
  try {
    store(storage)?.setItem(KEY, JSON.stringify(all))
    return true
  } catch {
    // A private window, or a full quota. The list on screen is still right for
    // this session; only coming back to it later is lost.
    return false
  }
}

/** Slot numbers only, deduped, in the order given. Anything else is dropped. */
const clean = (list) => {
  if (!Array.isArray(list)) return []
  const out = []
  for (const n of list) {
    if (Number.isInteger(n) && n >= 0 && !out.includes(n)) out.push(n)
  }
  return out
}

/** What is marked for one unit. Always both lists, always arrays. */
export function marksFor(device, storage) {
  const bucket = readAll(storage)[device || 'unknown'] || {}
  return {
    recent: clean(bucket.recent).slice(0, MAX_RECENT),
    favourites: clean(bucket.favourites)
  }
}

/**
 * Most recent first, no repeats, eight at most.
 *
 * Pure, so the ordering rule can be checked without a storage to hand: loading
 * something already in the list moves it to the front rather than adding it
 * twice, which is the difference between a list of eight presets and a list of
 * one preset eight times.
 */
export function pushRecent(list, n, max = MAX_RECENT) {
  if (!Number.isInteger(n) || n < 0) return clean(list).slice(0, max)
  return [n, ...clean(list).filter((x) => x !== n)].slice(0, max)
}

/** In or out. Pure, for the same reason. */
export function toggleIn(list, n) {
  const now = clean(list)
  if (!Number.isInteger(n) || n < 0) return now
  return now.includes(n) ? now.filter((x) => x !== n) : [...now, n].sort((a, b) => a - b)
}

/** Record a preset as just played. Returns the new recent list. */
export function remember(device, n, storage) {
  const all = readAll(storage)
  const key = device || 'unknown'
  const bucket = all[key] || {}
  const recent = pushRecent(bucket.recent, n)
  all[key] = { ...bucket, recent }
  writeAll(all, storage)
  return recent
}

/** Star or unstar. Returns the new favourites list. */
export function toggleFavourite(device, n, storage) {
  const all = readAll(storage)
  const key = device || 'unknown'
  const bucket = all[key] || {}
  const favourites = toggleIn(bucket.favourites, n)
  all[key] = { ...bucket, favourites }
  writeAll(all, storage)
  return favourites
}
