/* Generated from src/lib/guardrails.js by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

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
 * The same two numbers for a level measured in decibels, in decibels.
 *
 * A fraction of the range is the wrong unit for a dB control and it is not a
 * near miss — it is off by the whole point of the scale. A block Level on the
 * FM3 runs -80 to +20 dB, so "a fifth of the way up" lands on -60 dB, which is
 * not a quiet floor but silence, and "15% of the range" is a 15 dB step, which
 * is not a nudge but a different arrangement. Both ends were wrong in the same
 * direction and the result was the log Justin sent: an amp parked at the bottom
 * being refused five times for asking to come back to normal.
 */
export const LEVEL_MOVE_DB = 6

/** Below this a block is out of the mix, whatever the range says. */
export const LEVEL_FLOOR_DB = -20

/**
 * Unity: where every one of these controls sits when nothing has touched it.
 *
 * It is the value a designed tone asks for more than any other, and no write
 * that raises a level towards it can make a preset silent — so it is always
 * inside the window, however far below it the control is parked.
 */
export const LEVEL_UNITY_DB = 0

/**
 * Is this level's range measured in decibels?
 *
 * The unit when the schema carries one, and the shape of the range when it does
 * not: a control that runs from far below zero to at or above it is a dB scale,
 * and nothing else on a block named Level is.
 */
function inDecibels(param, min, max) {
  if (/^db$/i.test(String(param.unit || '').trim())) return true
  return min <= -40 && max >= 0
}

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
 *
 * The two ends used to be worked out independently, and on a control already at
 * the very bottom of its range they crossed over: a Drive Level sitting at 0 of
 * 0-10 produced a floor of 2 and a ceiling of 1.5, so nothing at all could be
 * written and the rejection read "5 is outside 2 to 1.5" — a range with no
 * numbers in it. Worse than the nonsense sentence was what it meant: a level at
 * the bottom is exactly the one a preset needs raised, and this was the rule
 * that made it the one value that could never move.
 *
 * So the window always contains where the control already sits, and it always
 * reaches at least far enough to lift a level clear of the bottom in one go.
 * Both ends still only ever bound a raise when a level starts down there; there
 * is no value of anything here that lets a write make a block quieter than the
 * player already had it.
 */
export function levelLimits(param) {
  if (!param || !isLevelParam(param.name)) return null
  const min = Number(param.min)
  const max = Number(param.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  const span = max - min
  const now = Number.isFinite(Number(param.value)) ? Number(param.value) : min + span / 2

  const db = inDecibels(param, min, max)
  const bottom = db ? LEVEL_FLOOR_DB : min + span * LEVEL_FLOOR
  const nudge = db ? LEVEL_MOVE_DB : span * LEVEL_MOVE
  /* On a dB scale the reach is to unity, because that is where a block that was
     parked at the bottom needs to get back to and no raise can silence
     anything. On a plain 0-10 control it is the bottom of the safe range, which
     is the same idea in the only units that control has. */
  const reach = db ? LEVEL_UNITY_DB : bottom

  return {
    /* Never above where the control already is. A level the player has set
       below the bottom is theirs to keep; the window simply stops offering
       anything lower. */
    floor: Math.min(Math.max(bottom, now - nudge), now),
    /* And never below it either — plus enough reach to clear the bottom in one
       write, because climbing out a nudge at a time is four refused requests to
       fix a preset that makes no sound. */
    ceiling: Math.min(max, Math.max(now, now + nudge, reach))
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
