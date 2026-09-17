/**
 * What is true about a unit, said without asking it anything.
 *
 * Split out of device.js so `npm test` can check it: everything here is a rule
 * the browser also holds — how an empty slot reads, which blocks are not stage
 * controls, how many slots a unit has when it has not said — and two apps
 * disagreeing about any of them is two apps.
 *
 * `.mjs` rather than `.js` for the same reason decode.mjs is: plain ESM, no
 * React Native, importable by node. Metro reads either.
 *
 * MOST OF IT IS NOW THE BROWSER'S OWN FILE. `presetName.js` and `slots.js` are
 * copied in by `npm run sync:rules`, and this re-exports the pieces the phone
 * uses rather than keeping a second copy that says the same thing in its own
 * words. The second copy was here first and was faithful; it was still a second
 * copy, and the way those fail is that somebody fixes one of them.
 *
 * What stays written out below is what the phone decides for itself: which
 * blocks are not stage controls, the shape of the scene grid, and how a step
 * lands. See EXCLUDED_BLOCKS — that one is a copy of a copy, and the guardrails
 * file it comes from is synced too.
 */
export { isEmptySlotName, cleanPresetName, presetLabel } from './presetName.js'
export { slotCount, slotLabel, isBanked } from './slots.js'

import { slotCount } from './slots.js'

/**
 * Input, output, looper and gate are not stage controls.
 *
 * The same four the web app hides on its gig screen, for the same reason: a
 * thumb-sized button that mutes the input mid-song is a hazard, and the gate's
 * safe setting depends on pickups and room rather than on anything visible on
 * a phone.
 */
export const EXCLUDED_BLOCKS = ['input', 'output', 'looper', 'gate']

/**
 * How many scenes this unit has, and whether it has any at all.
 *
 * Read rather than assumed. Fractal units don't agree on what a preset is, and
 * drawing eight scene buttons for a unit that reports none would be inventing
 * structure the hardware doesn't have.
 */
export function sceneShape(capabilities) {
  const hasScenes = capabilities?.hasScenes !== false
  const count = Number.isInteger(capabilities?.sceneCount) ? capabilities.sceneCount : 8
  return { hasScenes, count: hasScenes ? count : 0 }
}

/**
 * The next slot in a direction, or null when there isn't one.
 *
 * Clamped rather than wrapped: on stage, stepping off the end of the list and
 * landing back at slot 0 is worse than the button doing nothing. A unit that
 * never reported a count is given the benefit of the doubt, the same way
 * slotOutside does — refusing every step would turn a rare wrong slot into a
 * feature that never works.
 *
 * This is the fallback, not the rule. What Previous and Next actually walk is
 * decided by `setlists.stepTarget`, which wraps within a setlist because a
 * running order does come back round to the first song. Slot by slot has no
 * such order to come back to, so it stops.
 */
export function stepSlot(number, by, capabilities) {
  if (!Number.isInteger(number)) return null
  const next = number + by
  if (next < 0) return null
  const count = slotCount(capabilities)
  if (count !== null && next >= count) return null
  return next
}

/**
 * Which block this is, and whether a given id names it.
 *
 * ONE LINE, AND IT IS HERE BECAUSE GETTING IT WRONG WAS SILENT. The unit calls
 * a block's address `effectId`; the phone spent three releases reading `eid`,
 * which nothing sends. Every read was `undefined`, so the write went to
 * `/preset/blocks/undefined/bypass` — and worse, the optimistic update that
 * matched on it flipped EVERY tile in the chain, because `undefined` equals
 * `undefined`. A chain that lights up all at once and a unit that changed
 * nothing.
 *
 * `sameBlock` refuses a missing id on purpose. That is the half that turns the
 * next version of this mistake from "every block" into "no block", which is a
 * bug somebody notices.
 */
export const idOf = (block) => block?.effectId

export const sameBlock = (block, id) => Number.isInteger(id) && idOf(block) === id
