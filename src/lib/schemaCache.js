// The schema cache, kept apart from the client so it can be tested without
// pulling in the transport and the simulator's captured rosters.

/**
 * What a block offers, kept between requests.
 *
 * Reading the schema walks every block one at a time down a single serial port,
 * which is the slowest thing this app does. Doing it before every sentence made
 * conversation feel like batch work.
 *
 * The three pieces age differently, so they're cached differently:
 *
 *   rosters and help    never change while a unit is attached
 *   parameter values    change constantly, but usually because we changed them
 *   parameter ranges    change when a model is swapped
 *
 * So values are patched in place after a verified write rather than re-read, and
 * the whole parameter cache is dropped on anything structural. Anything that
 * might have moved under us — a knob turned on the unit itself — is handled by
 * `force`, which the manual refresh uses.
 */
export const rosterCache = new Map()
export const helpTextCache = new Map()
export const paramCache = new Map()

/** Drop cached parameters. Ranges are only trustworthy until something moves. */
export function invalidateSchema(eid) {
  if (eid === undefined) paramCache.clear()
  else paramCache.delete(eid)
}

/**
 * Record a value we just wrote and confirmed.
 *
 * The write path already read this back off the device with its cache cleared,
 * so this is not optimism — it's the verified number, and re-reading the block
 * to learn it again would cost a serial round trip per parameter.
 */
export function patchSchemaValue(eid, paramId, value) {
  const params = paramCache.get(eid)
  if (!params) return
  const hit = params.find((p) => p.id === paramId)
  if (hit) hit.value = value
}

/** Everything the device told us, cleared when a different preset loads. */
export function resetSchemaCache() {
  rosterCache.clear()
  helpTextCache.clear()
  paramCache.clear()
}


/** Test seam: put a block's parameters in the cache directly. */
export function seedSchemaCache(eid, params) {
  paramCache.set(eid, params)
}

/** Test seam: what is cached for a block, if anything. */
export function cachedSchema(eid) {
  return paramCache.get(eid)
}
