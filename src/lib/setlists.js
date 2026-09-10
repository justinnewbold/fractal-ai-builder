/**
 * Setlists, and what Previous / Next on the stage screen step through.
 *
 * Previous and Next walked the unit's slots one at a time: 44, 45, 46. That is
 * the right order for a unit and the wrong order for a night — the songs in a
 * set are never in the slots next to each other, so getting from the opener
 * to the second song was a trip through the preset list mid-set, on a phone,
 * in the dark.
 *
 * So the two buttons take an ORDER, and the order comes from one of three
 * places:
 *
 *   'all'      the slots, as before — 44, 45, 46.
 *   'starred'  the presets starred in the picker, in slot order.
 *   a setlist  a named, ordered list built for a night: opener first.
 *
 * Starred is a set of presets, not a sequence, so it steps in slot order and
 * is the quick answer for someone who has not built a setlist. A setlist is
 * the sequence itself.
 *
 * Kept per unit, like the stars in presetMarks: slot 4 on an FM3 and slot 4 on
 * an AM4 are different sounds, and a setlist of one must not play as the other.
 *
 * This browser only, for the same reason the stars are. A setlist built at
 * the Mac is not on the phone until it is built there too — the sheet that
 * builds one is the same on both.
 *
 * Everything that decides is pure and takes lists; only the last few functions
 * touch storage, and they take it as an argument so the tests can hand in a
 * Map.
 */

const KEY = 'fractal.setlists'

/** Where Previous / Next go when nothing has been chosen. */
export const ALL = 'all'
export const STARRED = 'starred'

const store = (given) => {
  try {
    return given ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  } catch {
    // Blocked site data throws on the property access itself, not just on use.
    return null
  }
}

/** Slot numbers only, deduped, in the order given. Anything else is dropped. */
export const cleanSlots = (list) => {
  if (!Array.isArray(list)) return []
  const out = []
  for (const n of list) {
    if (Number.isInteger(n) && n >= 0 && !out.includes(n)) out.push(n)
  }
  return out
}

/**
 * A list as stored, or null when it is not one.
 *
 * `at` is when this list was last changed HERE, and it is what lets two
 * devices be merged without asking anyone which copy they meant: the later
 * edit of a list wins, per list, rather than one whole device's setlists
 * winning over the other's. A list from before this existed has no time on it
 * and reads as the beginning of time, which is right — anything with a stamp
 * has been touched since.
 */
const cleanList = (l) => {
  if (!l || typeof l !== 'object') return null
  const id = typeof l.id === 'string' && l.id ? l.id : null
  if (!id) return null
  return {
    id,
    name: typeof l.name === 'string' && l.name.trim() ? l.name.trim() : 'Setlist',
    presets: cleanSlots(l.presets),
    at: Number.isFinite(l.at) ? l.at : 0
  }
}

/** A tombstone, or null. What a delete leaves behind so it can travel. */
const cleanGone = (g) =>
  g && typeof g === 'object' && typeof g.id === 'string' && g.id
    ? { id: g.id, at: Number.isFinite(g.at) ? g.at : 0 }
    : null

/**
 * How long a delete is remembered.
 *
 * Long enough that a phone left in a case for a fortnight does not put a
 * deleted setlist back on the Mac when it wakes up; short enough that the row
 * does not fill with the names of setlists nobody has thought about since
 * last summer.
 */
export const TOMBSTONE_MS = 60 * 24 * 60 * 60 * 1000

/** The deletes worth still remembering. */
export const cleanGoneList = (list, now = Date.now()) =>
  (Array.isArray(list) ? list : [])
    .map(cleanGone)
    .filter((g) => g && now - g.at < TOMBSTONE_MS)

/**
 * The slot Previous or Next lands on, walking `list` from `current`.
 *
 * Wraps. The last song is followed by the first: a set that has finished is a
 * set that starts again, and a button that dies at the end of the list is a
 * button that dies on the encore. (The slots view does not wrap — see
 * stepTarget — because slot 511 followed by slot 0 is nobody's set.)
 *
 * A current preset that is not in the list is treated as being just before
 * it: Next goes to the first song, Previous to the last. That is what happens
 * when a setlist is chosen mid-song on a preset that is not in it, and the
 * first song is the answer somebody choosing a setlist wanted anyway.
 *
 * `null` when there is nowhere to go — an empty list.
 */
export function nextIn(list, current, delta) {
  const now = cleanSlots(list)
  if (!now.length) return null
  const step = delta < 0 ? -1 : 1
  const at = now.indexOf(current)
  if (at === -1) return step > 0 ? now[0] : now[now.length - 1]
  return now[(at + step + now.length) % now.length]
}

/** Where `current` sits in the list, 1-based, or 0 when it is not in it. */
export const positionIn = (list, current) => cleanSlots(list).indexOf(current) + 1

/**
 * The order the stage buttons currently step through, for a source.
 *
 * A setlist that has been deleted, or a source read back from a browser that
 * no longer has it, falls back to the slots rather than to a dead button.
 */
export function orderFor(source, { favourites = [], lists = [] } = {}) {
  if (source === STARRED) return cleanSlots(favourites)
  const list = lists.find((l) => l.id === source)
  if (list) return list.presets
  return null
}

/**
 * The slot Previous (delta < 0) or Next (delta > 0) should load.
 *
 * `null` means the button has nothing to do and should be disabled: below
 * slot 0 in the slots view, or an empty starred list or setlist. The slots
 * view is open-ended upward — the unit refuses a slot it does not have, and
 * it always did.
 */
export function stepTarget({ source, current, delta, favourites, lists }) {
  const order = orderFor(source, { favourites, lists })
  if (order === null) {
    const next = (Number.isInteger(current) ? current : 0) + (delta < 0 ? -1 : 1)
    return next < 0 ? null : next
  }
  return nextIn(order, current, delta)
}

/** What to call the source on the button between Previous and Next. */
export function sourceLabel(source, { favourites = [], lists = [] } = {}) {
  if (source === STARRED) return 'Starred'
  const list = lists.find((l) => l.id === source)
  return list ? list.name : 'All presets'
}

/** Append, unless it is already there. */
export function addTo(presets, n) {
  const now = cleanSlots(presets)
  if (!Number.isInteger(n) || n < 0 || now.includes(n)) return now
  return [...now, n]
}

/** Drop one slot. */
export const removeFrom = (presets, n) => cleanSlots(presets).filter((x) => x !== n)

/** Move the entry at `from` to sit at `to`. Out-of-range moves change nothing. */
export function moveIn(presets, from, to) {
  const now = cleanSlots(presets)
  if (from < 0 || from >= now.length || to < 0 || to >= now.length || from === to) return now
  const [n] = now.splice(from, 1)
  now.splice(to, 0, n)
  return now
}

/** Whole file, or an empty one. Anything unreadable is empty, never a throw. */
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
  } catch {
    // A private window, or a full quota. The list on screen is still right for
    // this session; only coming back to it later is lost.
    return false
  }
  // The stage screen and the picker both draw from this; a write in one has to
  // reach the other without either polling storage.
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED))
  } catch {
    /* no window, nobody listening */
  }
  return true
}

/** Fired on window after every write, so screens can re-read. */
export const CHANGED = 'fractal:setlists'

const bucketOf = (all, device) => {
  const b = all[device || 'unknown']
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {}
}

/** The setlists for one unit, always an array of clean lists. */
export function listsFor(device, storage) {
  const raw = bucketOf(readAll(storage), device).lists
  return Array.isArray(raw) ? raw.map(cleanList).filter(Boolean) : []
}

/** The deletes this unit is still remembering, for the merge. */
export function goneFor(device, storage, now = Date.now()) {
  return cleanGoneList(bucketOf(readAll(storage), device).removed, now)
}

/** Every unit this browser holds setlists for. */
export function devicesWithLists(storage) {
  return Object.keys(readAll(storage))
}

/**
 * One unit's whole setlist state, as the shape that travels.
 *
 * `at` is the last time anything here changed, which is what decides the
 * source — a preference, not a document, so the later choice simply wins.
 */
export function unitFor(device, storage, now = Date.now()) {
  const bucket = bucketOf(readAll(storage), device)
  return {
    lists: listsFor(device, storage),
    source: sourceFor(device, storage),
    removed: cleanGoneList(bucket.removed, now),
    at: Number.isFinite(bucket.at) ? bucket.at : 0
  }
}

/**
 * Write one unit's setlist state back, merged copy and all.
 *
 * Used by the sync rather than by the sheet: the sheet edits one list at a
 * time through the functions below, which stamp their own times.
 */
export function putUnit(device, unit, storage) {
  save(
    device,
    {
      lists: (unit?.lists || []).map(cleanList).filter(Boolean),
      source: unit?.source ?? ALL,
      removed: cleanGoneList(unit?.removed),
      at: Number.isFinite(unit?.at) ? unit.at : Date.now()
    },
    storage,
    { stamp: false }
  )
  return unitFor(device, storage)
}

/**
 * Which order the stage buttons walk for one unit. A setlist that no longer
 * exists reads as ALL — see orderFor for why the buttons never go dead.
 */
export function sourceFor(device, storage) {
  const src = bucketOf(readAll(storage), device).source
  if (src === STARRED) return STARRED
  if (typeof src === 'string' && listsFor(device, storage).some((l) => l.id === src)) return src
  return ALL
}

/**
 * Write a patch into one unit's bucket, stamping when it happened.
 *
 * The stamp is what the merge reads. `stamp: false` is for the merge itself
 * writing a result back — it carries the time it decided on, and stamping it
 * again would make the copy that just arrived look newer than the device it
 * came from and bounce back the other way for ever.
 */
const save = (device, patch, storage, { stamp = true } = {}) => {
  const all = readAll(storage)
  const key = device || 'unknown'
  all[key] = { ...bucketOf(all, device), ...patch, ...(stamp ? { at: Date.now() } : {}) }
  writeAll(all, storage)
}

/** Choose what Previous / Next step through. */
export function setSource(device, source, storage) {
  save(device, { source: source === STARRED || typeof source === 'string' ? source : ALL }, storage)
  return sourceFor(device, storage)
}

/** Overwrite the lists. Returns them as they read back. */
function saveLists(device, lists, storage) {
  save(device, { lists: lists.map(cleanList).filter(Boolean) }, storage)
  return listsFor(device, storage)
}

/** A new, empty setlist. Returns it. */
export function createList(device, name, storage) {
  const lists = listsFor(device, storage)
  const id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const list = {
    id,
    name: (name || '').trim() || `Setlist ${lists.length + 1}`,
    presets: [],
    at: Date.now()
  }
  saveLists(device, [...lists, list], storage)
  return list
}

/** Change one list's name or presets. Returns the lists as they read back. */
export function updateList(device, id, patch, storage) {
  const lists = listsFor(device, storage).map((l) =>
    l.id === id ? { ...l, ...patch, id, at: Date.now() } : l
  )
  return saveLists(device, lists, storage)
}

/** Remove one list. If it was the chosen source, the buttons go back to the slots. */
export function deleteList(device, id, storage) {
  const lists = listsFor(device, storage).filter((l) => l.id !== id)
  const source = sourceFor(device, storage)
  /*
   * A delete leaves a mark. Without one, a setlist deleted on the phone comes
   * straight back from the Mac on the next sync — the Mac still has it, and a
   * merge that only unions cannot tell "not here yet" from "gone on purpose".
   */
  const removed = [
    ...goneFor(device, storage).filter((g) => g.id !== id),
    { id, at: Date.now() }
  ]
  save(device, { lists, removed, ...(source === id ? { source: ALL } : {}) }, storage)
  return listsFor(device, storage)
}
