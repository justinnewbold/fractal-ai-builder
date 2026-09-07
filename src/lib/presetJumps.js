/**
 * Where the quick-jump buttons land, for the unit that is actually plugged in.
 *
 * A gen-3 unit holds 512 presets and wants hundreds; an AM4 holds 104 and
 * wants twenties. That is one rule, not two: about five stops, each on a round
 * number a player can read at a glance in the dark.
 *
 * So the step is the largest round number that still fits five of them —
 * 512/5 is 102.4, and the largest round step at or under that is 100; 104/5 is
 * 20.8, and the answer is 20. Nothing here is device-specific, which is the
 * point: an Axe-Fx II's 384 slots get fifties and a unit nobody has plugged in
 * yet gets whatever its own count deserves.
 *
 * The ladder bottoms out at 10, so a list shorter than fifty gets no buttons
 * at all. That is deliberate rather than a floor bolted on: a VP4's handful of
 * slots is already one thumb-flick from top to bottom, and a row of jumps over
 * it would be furniture.
 */
const STEPS = [10, 20, 25, 50, 100, 200, 250, 500]

/** The step for a unit of this many slots, or 0 when it is too short to bother. */
export const jumpStep = (total) => {
  if (!Number.isFinite(total) || total <= 0) return 0
  const ideal = total / 5
  for (let i = STEPS.length - 1; i >= 0; i -= 1) if (STEPS[i] <= ideal) return STEPS[i]
  return 0
}

/**
 * The stops themselves, in order.
 *
 * Never the last slot: a button that carries you to the very bottom of a list
 * you are already at the bottom of has nothing to do.
 */
export const jumpsFor = (total) => {
  const step = jumpStep(total)
  if (!step) return []
  const out = []
  for (let n = step; n < total; n += step) out.push(n)
  return out
}
