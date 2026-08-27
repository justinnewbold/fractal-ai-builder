// Write-encoding choice and parameter-id disambiguation.
//
// Kept apart from forgefx.js so the test runner can import these directly: the
// client pulls in the mock device, which imports JSON, which plain node will
// not load without an import attribute.

/**
 * Which write encoding actually works, learned at runtime.
 *
 * ForgeFX exposes two paths. `continuous: false` builds a discrete frame;
 * `true` builds a continuous one. Both take a normalised 0-1 value, and the
 * docs don't say which suits which control. On a real FM3, linear controls
 * land correctly on the discrete path while frequency controls silently do
 * not — they keep the value they were reset to.
 *
 * Rather than pick one and hope, writes get verified and retry on the other
 * path when a value didn't stick. What worked is remembered per parameter so a
 * preset full of frequency controls doesn't pay the retry cost every time.
 *
 * The first attempt is the CONTINUOUS path. Every parameter this app writes
 * comes from a block's `named` list, which is ForgeFX's own split: `named`
 * holds the continuous knobs and `enums` holds the discrete selectors. So a
 * parameter we can reach is a continuous one by construction, and guessing
 * discrete first was guessing against the source.
 *
 * On an AM4 that guess is audible rather than merely wasteful. The AM4 driver
 * emits no per-parameter `continuous` flag at all, so nothing overrode the
 * default, and its discrete path writes the value as a raw ordinal. Handing it
 * a 0-1 normalised float floored the control to its minimum on every first
 * attempt — every knob slammed to zero, then jumped back when the verified
 * retry corrected it. Starting continuous removes the glitch and halves the
 * writes.
 */
const encodingByParam = new Map()

export const preferredEncoding = (eid, paramId) =>
  encodingByParam.get(`${eid}:${paramId}`) ?? true

export const rememberEncoding = (eid, paramId, continuous) =>
  encodingByParam.set(`${eid}:${paramId}`, continuous)

export const getEncodingMap = () =>
  [...encodingByParam.entries()].map(([k, v]) => ({ key: k, continuous: v }))

/**
 * A parameter id above 0xffff is a composite address, not a plain id: ForgeFX
 * mints `(pidLow << 16) | pidHigh` for a parameter that lives on a different
 * sub-block but surfaces on this block's page. An AM4 amp page carries its
 * integrated cab this way, which is how one block ends up reporting both a
 * "High Cut Frequency" (its own, 400-40000 Hz) and a "High Cut" (the cab's,
 * 200-20000 Hz).
 *
 * Two controls with near-identical names and different ranges is a trap for the
 * generator, which picks parameters by name and would have no way to tell which
 * one a description meant. So names that collide get their owner and range
 * attached, and the sub-block id is kept for anything that needs to address it.
 */
export function disambiguate(named) {
  const counts = new Map()
  for (const p of named) counts.set(p.name, (counts.get(p.name) || 0) + 1)

  return named.map((p) => {
    const sub = p.id > 0xffff ? p.id >>> 16 : null
    const clash = (counts.get(p.name) || 0) > 1
    return {
      id: p.id,
      name: clash
        ? `${p.name} (${sub ? `sub-block ${sub}, ` : ''}${p.min}-${p.max}${p.unit || ''})`
        : p.name,
      subBlockId: sub,
      value: p.value,
      min: p.min,
      max: p.max,
      log: !!p.log,
      unit: p.unit || ''
    }
  })
}
