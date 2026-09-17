/**
 * Setlists and stars, already told where the bytes live.
 *
 * The shared modules take their storage as a last argument so the browser can
 * hand them localStorage and the phone can hand them something else. That is
 * the right shape for the modules and the wrong one for a screen: every call
 * site would end in `, sync`, and the one that forgot would not fail — it would
 * quietly read the browser's storage, which on a phone is nothing at all. An
 * empty setlist and a setlist nobody looked up are the same picture.
 *
 * So the binding happens once, here, and screens import from this file.
 *
 * WHAT IS NOT WRAPPED is anything pure. `orderFor`, `stepTarget`, `positionIn`,
 * `sourceLabel`, `addTo`, `removeFrom` and `moveIn` are handed what they need
 * and touch no storage, so they pass straight through and are re-exported as
 * they are.
 */
import { sync } from './store'
import {
  ALL,
  STARRED,
  createList as createListIn,
  deleteList as deleteListIn,
  listsFor as listsForIn,
  setSource as setSourceIn,
  sourceFor as sourceForIn,
  updateList as updateListIn
} from './setlists'
import {
  marksFor as marksForIn,
  remember as rememberIn,
  toggleFavourite as toggleFavouriteIn
} from './presetMarks'

export { ALL, STARRED } from './setlists'
export { addTo, moveIn, orderFor, positionIn, removeFrom, sourceLabel, stepTarget } from './setlists'
export { deviceSlug } from './device-slug'

/** Every setlist this unit has, in the order they were made. */
export const listsFor = (device) => listsForIn(device, sync)

/** What Previous and Next step through: 'all', 'starred', or a setlist's id. */
export const sourceFor = (device) => sourceForIn(device, sync)

/** Change it. Returns what it now is, which is not always what was asked for. */
export const setSource = (device, source) => setSourceIn(device, source, sync)

/** A new, empty setlist, named for you. */
export const createList = (device, name) => createListIn(device, name, sync)

/** Rename one, or replace the songs in it. */
export const updateList = (device, id, patch) => updateListIn(device, id, patch, sync)

/** Remove one, leaving the mark that stops the Mac's copy coming back. */
export const deleteList = (device, id) => deleteListIn(device, id, sync)

/** What is starred on this unit, and what was played recently. */
export const marksFor = (device) => marksForIn(device, sync)

/** Star or unstar a slot. Returns the stars as they now stand. */
export const toggleFavourite = (device, n) => toggleFavouriteIn(device, n, sync)

/** Note that a slot was loaded, for the recents list. */
export const remember = (device, n) => rememberIn(device, n, sync)
