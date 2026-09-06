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
 */

/** How a gen-3 unit says a slot has nothing in it. */
const EMPTY_MARKER = /^\s*<\s*empty\s*>/i

/** Whether this is a unit saying "nothing here", rather than a name. */
export const isEmptySlotName = (name) => typeof name === 'string' && EMPTY_MARKER.test(name)

/**
 * The name to keep, or an empty string when there is none.
 *
 * An empty gen-3 slot reports `<EMPTY>` written over the front of whatever name
 * was there before, so the tail of the old preset's name hangs off the end —
 * `<EMPTY>k Album Chug`, seven characters of truth and twelve of somebody
 * else's preset. The marker means the slot is empty; everything after it is
 * rubble and is dropped rather than shown.
 */
export const cleanPresetName = (name) =>
  typeof name !== 'string' ? '' : isEmptySlotName(name) ? '' : name.trim()

/**
 * What to print where a preset's name goes.
 *
 * "Empty" rather than "Untitled": an untitled preset is one somebody made and
 * did not name, and this is a slot with nothing in it at all. On this screen
 * that word is read from arm's length to know where you are, so the difference
 * is worth the two extra letters.
 */
export function presetLabel(preset) {
  if (!preset) return 'Untitled'
  if (preset.empty || isEmptySlotName(preset.name)) return 'Empty'
  return (typeof preset.name === 'string' ? preset.name.trim() : '') || 'Untitled'
}

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
 * How many stored slots this unit actually has, or null when it has not said.
 *
 * Null rather than a guess. The web app used to answer `?? 512` — the gen-3
 * number, and a guess about somebody else's hardware — which had a phone
 * stepping toward slot 500 on a unit that holds 104, being refused every time.
 * Kept in step with slotCount in src/lib/slots.js.
 */
export function slotCount(capabilities) {
  const count = capabilities?.presets?.count
  return Number.isInteger(count) && count > 0 ? count : null
}

/**
 * The next slot in a direction, or null when there isn't one.
 *
 * Clamped rather than wrapped: on stage, stepping off the end of the list and
 * landing back at slot 0 is worse than the button doing nothing. A unit that
 * never reported a count is given the benefit of the doubt, the same way
 * slotOutside does — refusing every step would turn a rare wrong slot into a
 * feature that never works.
 */
export function stepSlot(number, by, capabilities) {
  if (!Number.isInteger(number)) return null
  const next = number + by
  if (next < 0) return null
  const count = slotCount(capabilities)
  if (count !== null && next >= count) return null
  return next
}
