/* Generated from shared/tempo.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * A tempo typed by hand, checked before it reaches the unit.
 *
 * Tap gets you close; typing gets you exact. "On the tap button, let's do
 * where they hold the tap button they can manually enter in the beats per
 * minute they want." Both apps offer that box, so both apps have to agree on
 * what counts as a tempo — and the unit's own range is the whole of the rule:
 * 20 to 400 BPM. Anything outside it is refused here, in words, rather than
 * clamped somewhere downstream into a number nobody typed.
 */
export const BPM_MIN = 20
export const BPM_MAX = 400

/**
 * What typed text means as a tempo.
 *
 *   { bpm }    — a whole number the unit will take
 *   { empty }  — nothing typed; the caller leaves the tempo alone
 *   { error }  — a sentence for the person, never a code
 */
export function checkBpm(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { empty: true }
  const n = Math.round(Number(raw.replace(/[^0-9.]/g, '')))
  if (!Number.isFinite(n) || !/^\d+(\.\d+)?$/.test(raw.replace(/\s+/g, ''))) {
    return { error: 'Type a tempo as a number, like 120.' }
  }
  if (n < BPM_MIN || n > BPM_MAX) {
    return { error: `${n} BPM is out of range — the unit takes ${BPM_MIN} to ${BPM_MAX}.` }
  }
  return { bpm: n }
}

/**
 * How long after the last tap to ask the unit what tempo it worked out.
 *
 * THE TAP AND THE READ-BACK MUST NOT BE FOLDED TOGETHER, and that is the whole
 * reason this number exists rather than a plain "tap and read". The unit works
 * the tempo out from the SPACING between taps, so a tap held back by a debounce
 * is not a tap — it is a different rhythm. And the figure can only be read once
 * tapping has stopped, because reading mid-burst answers with the tempo of the
 * taps before this one and puts a stale number on the button still under your
 * thumb.
 *
 * So: every press goes immediately, and the tempo is read once, this long after
 * the last one. Four taps at 60 BPM are three seconds apart — the slowest
 * anybody counts in — and this sits comfortably inside that.
 *
 * Shared because the phone got it wrong by not having it: it tapped, the unit
 * changed, and the number on screen waited on an event the relay does not
 * always carry. The tempo was right everywhere except the screen you were
 * looking at.
 */
export const TAP_REREAD_MS = 900

/**
 * The tempo your taps mean, worked out here instead of waited for.
 *
 * "It must be waiting to hear back from the device to change the number …
 * right now it takes a few seconds after doing the tap, so you can't even tell
 * the tempo you're tapping at."
 *
 * Exactly right, and the delay was designed in. The number on the button only
 * ever came from the unit, and the unit can only be asked once tapping stops —
 * TAP_REREAD_MS above explains why — so the figure lagged the last tap by
 * nearly a second. Which defeats the point: you tap to FIND a tempo, and a
 * tempo you cannot see while tapping is one you cannot aim.
 *
 * The unit is still the authority and still gets asked. This is what to show
 * in the meantime, and the two agree within a BPM or so because they are
 * working from the same taps.
 *
 * HOW MANY TAPS TO AVERAGE. The gaps, not the taps: four presses give three
 * gaps. Averaging the last few smooths an unsteady hand without making the
 * button feel like it is ignoring you — too long a memory and a deliberate
 * change of tempo takes several presses to show up.
 */
export const TAP_AVERAGE = 4

/**
 * A gap longer than this starts a new count rather than joining the old one.
 *
 * At 20 BPM — the slowest the unit takes — beats are three seconds apart, so
 * anything past that is not part of the same rhythm. Without this, tapping
 * four times, stopping to listen, then tapping again averages the pause into
 * the tempo and answers with something nobody played.
 */
export const TAP_GAP_MAX_MS = 3200

/**
 * @param {number[]} taps  when each tap happened, oldest first, in ms
 * @returns {number|null}  whole BPM, or null while there is not yet a rhythm
 */
export function tappedBpm(taps = []) {
  const times = (Array.isArray(taps) ? taps : []).filter((t) => Number.isFinite(t))
  if (times.length < 2) return null

  /* Gaps, newest first, stopping at the first one too long to belong. */
  const gaps = []
  for (let i = times.length - 1; i > 0 && gaps.length < TAP_AVERAGE - 1; i -= 1) {
    const gap = times[i] - times[i - 1]
    if (gap <= 0 || gap > TAP_GAP_MAX_MS) break
    gaps.push(gap)
  }
  if (!gaps.length) return null

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const bpm = Math.round(60000 / mean)
  /* Outside what the unit accepts is not a tempo, it is a mis-tap. Saying
     nothing leaves the last good figure up, which is the honest answer. */
  return bpm >= BPM_MIN && bpm <= BPM_MAX ? bpm : null
}

/**
 * The tap list to keep after a press at `now`.
 *
 * Trimmed here rather than by each caller so both ends forget at the same
 * rate, and a pause drops the old rhythm instead of blending into it.
 */
export function keepTaps(taps = [], now = Date.now()) {
  const times = (Array.isArray(taps) ? taps : []).filter((t) => Number.isFinite(t))
  const last = times[times.length - 1]
  const fresh = last != null && now - last > TAP_GAP_MAX_MS ? [] : times
  return [...fresh, now].slice(-TAP_AVERAGE)
}
