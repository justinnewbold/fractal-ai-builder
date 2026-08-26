/**
 * ForgeFX reads real units and writes normalised 0-1. The asymmetry is not
 * documented anywhere, and it is easy to miss because a write out of range
 * fails silently — it clamps and reports {"ok":true}.
 *
 * Verified on an FM3, Amp 1 Gain (range 0-10):
 *   PUT {"value": 0.5}   -> reads 5,   norm 0.50
 *   PUT {"value": 0.65}  -> reads 6.5, norm 0.65
 *   PUT {"value": 42597} -> reads 0    (clamped; raw encoding is not accepted)
 *
 * So everything the app and the generator work in — real units, because that is
 * how a player thinks and how the device displays — has to be converted here on
 * the way out.
 */

/** Real units -> 0-1, using the parameter's own reported range. */
export function toNormalized(value, param) {
  const { min, max } = param || {}
  if (typeof min !== 'number' || typeof max !== 'number' || max === min) {
    // No usable range. Pass a value already in 0-1 through; otherwise refuse
    // rather than guess, since a wrong guess silently pins the control.
    return value >= 0 && value <= 1 ? value : null
  }

  // Log-scaled controls (frequencies) are spaced logarithmically across the
  // range, so a linear position would put 1 kHz nowhere near where the device
  // shows it.
  if (param.log && min > 0 && max > 0) {
    const pos = (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
    return clamp01(pos)
  }

  return clamp01((value - min) / (max - min))
}

/** 0-1 -> real units. The inverse, for showing what a normalised value means. */
export function fromNormalized(norm, param) {
  const { min, max } = param || {}
  if (typeof min !== 'number' || typeof max !== 'number') return norm
  if (param.log && min > 0 && max > 0) {
    return Math.exp(Math.log(min) + clamp01(norm) * (Math.log(max) - Math.log(min)))
  }
  return min + clamp01(norm) * (max - min)
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

