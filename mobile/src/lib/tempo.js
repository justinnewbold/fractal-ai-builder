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
