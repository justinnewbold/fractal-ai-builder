/* Generated from shared/firmware.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * The firmware version the unit is running, out of whatever shape it arrives in.
 *
 * "I have another app I'm building called axiom... it definitely pulls the
 * firmware version so I'm not sure why you can't do it. It's basically the
 * same app."
 *
 * It was right and the earlier answer here was wrong. This app had never shown
 * a firmware version, and the reason given was that nothing it talks to
 * carries one — which was an assumption dressed as a fact. The host does carry
 * it. This app was asking one endpoint where the other app asks two, so the
 * field never arrived to be thrown away, and the absence looked like the
 * protocol's rather than ours.
 *
 * WHY THE SHAPE IS NOT PINNED DOWN. The other app reads a string, an object
 * with a `version` inside it, or a short `fw`, and it reads all three because
 * across host versions it has seen all three. Being generous here costs one
 * function; being strict costs a blank line on somebody's Setup screen with no
 * way to tell whether the unit is silent or the parser is.
 *
 * Null is a real answer and the common one. A simulated unit has no firmware
 * at all — the demo is a simulation and inventing a version number for it is
 * exactly the confident wrong fact this catalog refuses everywhere else — and
 * a host too old to report one is no different. Everything reading this draws
 * nothing rather than a gap where a fact should be.
 */
export function firmwareOf(raw) {
  if (!raw || typeof raw !== 'object') return null
  const found =
    typeof raw.firmware === 'string'
      ? raw.firmware
      : raw.firmware && typeof raw.firmware === 'object'
        ? raw.firmware.version
        : (raw.firmware ?? raw.fw)
  const said = String(found ?? '').trim()
  /*
   * A host with nothing to say writes a dash, and a dash drawn under "Firmware"
   * reads as a version somebody's unit is running. The empty answers are all
   * the same answer.
   */
  if (!said || said === '—' || said === '-' || said.toLowerCase() === 'unknown') return null
  return said
}
