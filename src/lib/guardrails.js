/**
 * Parameters that can silence a preset.
 *
 * A block's output Level reads like a tone control by name — "Amp1 Level" sits
 * in the same list as Bass, Mid and Treble — so a generator will happily set it
 * to -60 dB while every other value is musically correct. The result is a preset
 * that looks right and makes no sound. Nothing downstream can catch that,
 * because -60 dB is inside the parameter's legal range.
 *
 * So these are never offered to the generator and never written. Gain staging
 * is the player's, not the model's.
 */

/** Block output level and routing. Not tone. */
const SILENCING = [
  /^.*\bLevel$/i, // "Amp1 Level", "Level", "Out Level"
  /^Balance$/i,
  /^Pan\b/i,
  /^Output\s/i,
  /^Bypass\b/i,
  /^Mute\b/i
]

/** Exceptions: these carry "Level" in the name but drive gain, not output. */
const ALLOWED = [/Boost Level/i, /Input Level/i]

export function isSilencingParam(name) {
  if (typeof name !== 'string') return false
  if (ALLOWED.some((re) => re.test(name))) return false
  return SILENCING.some((re) => re.test(name))
}

/**
 * Blocks kept out of generation entirely.
 *
 * input/output carry the preset's gain structure. looper has no tone role.
 * gate is here because a noise gate set too aggressively mutes quiet playing
 * completely, and its safe threshold depends on the player's pickups and room —
 * not something to infer from a text description. Worth reintroducing later
 * with its own handling.
 */
export const EXCLUDED_BLOCKS = ['input', 'output', 'looper', 'gate']

/** Strip silencing parameters from a block schema before it's sent out. */
export function safeParams(params) {
  return (params || []).filter((p) => !isSilencingParam(p.name))
}
