/**
 * Parameters that can silence a preset.
 *
 * A block's output Level reads like a tone control by name — "Amp1 Level" sits
 * in the same list as Bass, Mid and Treble — so a generator will happily set it
 * to -60 dB while every other value is musically correct. The result is a preset
 * that looks right and makes no sound. Nothing downstream can catch that,
 * because -60 dB is inside the parameter's legal range.
 *
 * The first answer was to withhold every one of them. That cost more than it
 * saved: "I told the AI the amp should be louder when it's on than when it's
 * off and it told me I was wrong." The one control that does that was invisible
 * to it, so instead of saying it could not, it disputed the premise.
 *
 * So the rule is split. Balance, Pan, Output and the rest are routing and stay
 * the player's alone. A block's own Level moves, but only within a window
 * around where it already sits, and never into the bottom of its range — a
 * nudge, not a reset. That makes "louder for the lead" reachable while the
 * silent preset stays impossible.
 */

/** Routing and balance. Never the model's, at any value. */
const FORBIDDEN = [/^Balance$/i, /^Pan\b/i, /^Output\s/i, /^Bypass\b/i, /^Mute\b/i]

/** A block's own output level: allowed, but only a nudge. See levelLimits. */
const LEVEL = /^.*\bLevel$/i // "Amp1 Level", "Level", "Out Level"

/** Exceptions: these carry "Level" in the name but drive gain, not output. */
const ALLOWED = [/Boost Level/i, /Input Level/i]

export function isForbiddenParam(name) {
  if (typeof name !== 'string') return false
  return FORBIDDEN.some((re) => re.test(name))
}

export function isLevelParam(name) {
  if (typeof name !== 'string') return false
  if (ALLOWED.some((re) => re.test(name))) return false
  return LEVEL.test(name)
}

/** How far a level may move in one write, as a fraction of its full range. */
export const LEVEL_MOVE = 0.15

/** The bottom of the range no write may reach, as a fraction of it. */
export const LEVEL_FLOOR = 0.2

/**
 * The window a level may be written into, or null if this is not a level.
 *
 * Two ends, two jobs. The ceiling keeps a change to a nudge, so a generation
 * cannot quietly restructure the gain. The floor is the one that matters: it is
 * what makes the silent preset unreachable however the request is worded.
 *
 * Measured from where the control sits now rather than from the middle of its
 * range, because "a bit louder" means a bit louder than this, and a level that
 * has been set low on purpose should not be dragged back to the centre.
 */
export function levelLimits(param) {
  if (!param || !isLevelParam(param.name)) return null
  const min = Number(param.min)
  const max = Number(param.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  const span = max - min
  const now = Number.isFinite(Number(param.value)) ? Number(param.value) : min + span / 2
  return {
    floor: Math.max(min + span * LEVEL_FLOOR, now - span * LEVEL_MOVE),
    ceiling: Math.min(max, now + span * LEVEL_MOVE)
  }
}

/**
 * Controls kept out of the quick knob list.
 *
 * Both kinds, because neither belongs under a thumb mid-set: routing is not a
 * tone control, and a level dragged by a finger on a phone is the same silent
 * preset by another route.
 */
export function isSilencingParam(name) {
  return isForbiddenParam(name) || isLevelParam(name)
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

/**
 * Strip the parameters the model may never set from a block schema.
 *
 * Levels stay in: it cannot answer "louder for the lead" with a control it
 * cannot see, and what it may do with one is bounded where the write happens.
 */
export function safeParams(params) {
  return (params || []).filter((p) => !isForbiddenParam(p.name))
}

/**
 * Which parameter a generated change is actually for.
 *
 * The id is an address and the name is the intent, and when the two disagree it
 * is the name that came out right. A run against a real FM3 rejected "Amp 1 /
 * Low Cut Frequency: 5.5 is outside 10–1000" — a Bass of 5.5, sent to whatever
 * id the model believed Bass was, landing on the parameter that id really is.
 * Half a page of rejections were legible requests thrown away on a technicality
 * with the device's own list right there to settle them.
 *
 * This loosens nothing. What comes back is always a parameter the device
 * reported, and the caller still checks the value against that parameter's own
 * range and its own silencing rule. It says why it moved, so a correction can
 * be shown rather than being a quiet change of meaning.
 */
const plain = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function matchParam(params, { id, name }) {
  const list = params || []
  const byId = list.find((p) => p.id === id) || null
  const wanted = plain(name)
  if (!wanted || (byId && plain(byId.name) === wanted)) return { param: byId, note: null }

  const byName = list.find((p) => plain(p.name) === wanted)
  if (!byName || byName === byId) return { param: byId, note: null }

  return {
    param: byName,
    note: byId ? `id ${id} is ${byId.name} on this unit` : `there is no parameter ${id} here`
  }
}
