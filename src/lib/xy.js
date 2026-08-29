/**
 * When a drag is allowed to become a write.
 *
 * A finger produces coordinates far faster than a serial port takes them, and
 * over the relay every write is a broadcast round trip — the meter-poll lesson
 * again. So writes are gated on both clocks and movement: enough time since
 * the last one, and enough distance that the value would actually change.
 * Pure so the arithmetic is testable without a pad, a finger, or a device.
 */
export function gateWrite({ now, lastAt, lastFrac, frac, interval, epsilon = 0.004 }) {
  if (lastFrac === null || lastFrac === undefined) return true
  if (Math.abs(frac - lastFrac) < epsilon) return false
  return now - lastAt >= interval
}

/** Pointer position inside a rect → 0..1 per axis, y inverted so up is more. */
export function padFraction(clientX, clientY, rect) {
  const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  const y = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height))
  return { x, y }
}
