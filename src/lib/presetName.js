/**
 * The name of a preset, as opposed to what came off the wire.
 *
 * "Empty scene is still showing previous preset name" — slot 495, and the app
 * called it `<EMPTY>k Album Chug`.
 *
 * That string is not a name. An empty gen-3 slot reports `<EMPTY>` in a name
 * field that is a fixed run of characters, and the marker is written over the
 * front of whatever was there before rather than clearing it — so a short
 * marker on top of a longer old name leaves the old name's tail hanging off the
 * end. Load an empty slot after "…k Album Chug" and that is exactly what you
 * get: seven characters of truth and twelve of somebody else's preset.
 *
 * The app cannot fix the buffer. What it can do is stop repeating it. A name
 * that begins with the marker means one thing — this slot is empty — and
 * everything after the marker is rubble, so it is dropped rather than shown,
 * cached, offered as a name to save under, or sent to the model as context.
 *
 * Matched at the front only, and deliberately: a preset someone has genuinely
 * called "Empty Room Verb" is theirs to name, and a marker in the middle of a
 * name is not this failure.
 */

/** How a gen-3 unit says a slot has nothing in it. */
const MARKER = /^\s*<\s*empty\s*>/i

/** Whether this is a unit saying "nothing here", rather than a name. */
export function isEmptySlotName(name) {
  return typeof name === 'string' && MARKER.test(name)
}

/**
 * The name to keep, or an empty string when there is none.
 *
 * Empty rather than the marker, because every caller already knows what to do
 * with a preset that has no name and none of them knew what to do with this.
 */
export function cleanPresetName(name) {
  if (typeof name !== 'string') return ''
  return isEmptySlotName(name) ? '' : name.trim()
}

/**
 * What to print where a preset's name goes.
 *
 * "Empty" rather than "Untitled": an untitled preset is one somebody made and
 * did not name, and this is a slot with nothing in it at all. On the Play
 * screen that word is read from arm's length to know where you are, so the
 * difference is worth the two extra letters.
 */
export function presetLabel(preset) {
  if (!preset) return 'Untitled'
  // Takes the preset rather than the name, so it works either side of the
  // cleaning: the raw marker, or the flag currentPreset leaves in its place.
  if (preset.empty || isEmptySlotName(preset.name)) return 'Empty'
  return (typeof preset.name === 'string' ? preset.name.trim() : '') || 'Untitled'
}
