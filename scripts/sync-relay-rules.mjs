/**
 * Copy the rules the two apps must agree on into the phone app.
 *
 * The web app imports these directly, so it cannot drift by construction. The
 * phone app cannot: Metro would have to be pointed outside its own directory,
 * and an EAS build that uploads only `mobile/` would then fail at bundle time —
 * on a build machine, minutes in, for a reason that looks nothing like "a file
 * moved". Reaching outside is the kind of thing that works on the laptop it was
 * written on.
 *
 * So the phone gets a copy, and the copy is generated rather than edited. Run
 * this after touching a source; `npm test` regenerates every one of them in
 * memory and fails if what is on disk differs, so a stale copy cannot be
 * merged.
 *
 * WHAT BELONGS HERE is anything where the two apps disagreeing is a fault
 * rather than a difference. The relay allowlist was the first: allowing
 * something the host refuses turns a friendly sentence into a bare status code
 * mid-song. The generation rules are the rest of it — a phone that validates a
 * tone by looser rules than the Mac is a phone that writes something the Mac
 * would have refused, into a rig somebody is about to play.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Every file the phone carries a copy of, and where it came from.
 *
 * Order matters only for reading: `validate` imports `guardrails` by relative
 * path, and both land in the same directory on the phone, so that import
 * resolves there exactly as it does here.
 */
export const FILES = [
  { source: '../shared/relay-rules.mjs', target: '../mobile/src/lib/relay-rules.js' },
  /*
   * How a pairing code becomes the account both ends sign in as. A phone that
   * derived it differently from the Mac would look, to the person holding it,
   * exactly like a Mac that is off.
   */
  { source: '../shared/pairing.mjs', target: '../mobile/src/lib/pairing.js' },
  { source: '../shared/tone-steps.mjs', target: '../mobile/src/lib/tone-steps.js' },
  { source: '../shared/play-mode.mjs', target: '../mobile/src/lib/play-mode.js' },
  { source: '../src/lib/guardrails.js', target: '../mobile/src/lib/guardrails.js' },
  { source: '../src/lib/validate.js', target: '../mobile/src/lib/validate.js' },
  /*
   * How a value reaches the wire. Both of these read as plumbing and are not:
   * scale.js turns a number into the 0-1 the unit takes, and encoding.js holds
   * which of ForgeFX's two write paths actually works — including that starting
   * on the discrete path slams every AM4 knob to its minimum before the
   * verified retry corrects it. A phone that guessed differently would be
   * audibly wrong on hardware nobody here can test against.
   */
  { source: '../src/lib/scale.js', target: '../mobile/src/lib/scale.js' },
  { source: '../src/lib/encoding.js', target: '../mobile/src/lib/encoding.js' }
]

/** Where a copy says it came from, so nobody edits the copy by mistake. */
export const banner = (source) =>
  `/* Generated from ${source.replace('../', '')} by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run \`npm run sync:rules\`; the test suite
 * fails on any difference between the two. */

`

/** What a copy should contain, given what its source contains. */
export const generate = (source, sourcePath) => banner(sourcePath) + source

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/**
 * Source text, copy text, and what the copy ought to be — for each file.
 *
 * The TEXT is kept under its own name rather than replacing `source`, which is
 * the path. Spreading the text over the path is a mistake that types fine and
 * reads fine and then prints a whole module where a filename should be.
 */
export const state = () =>
  FILES.map((file) => {
    const sourceText = read(file.source)
    let copyText = null
    try {
      copyText = read(file.target)
    } catch {
      // A copy that does not exist yet is stale, not a crash.
    }
    return { ...file, sourceText, copyText, expected: generate(sourceText, file.source) }
  })

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of state()) {
    writeFileSync(fileURLToPath(new URL(file.target, import.meta.url)), file.expected)
    console.log(`${file.target.replace('../', '')} is up to date with ${file.source.replace('../', '')}`)
  }
}
