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
