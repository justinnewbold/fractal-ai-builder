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
  /* What counts as a tempo somebody typed. The unit's range, once, for both boxes. */
  { source: '../shared/tempo.mjs', target: '../mobile/src/lib/tempo.js' },
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
  { source: '../src/lib/encoding.js', target: '../mobile/src/lib/encoding.js' },
  /*
   * What colour a thing is, on both screens.
   *
   * These read as decoration and are not. The whole argument in blockColors is
   * recognition on a dark stage — the drive is found by its red long before
   * three letters resolve — and sceneColors makes the same case for scenes. A
   * phone that picked its own colours would break exactly the thing the colours
   * are for: the browser and the handset would disagree about which tile is the
   * delay, and a player switching between them would have to read both.
   *
   * Pure data with no imports, so they cross unchanged.
   */
  { source: '../src/lib/blockColors.js', target: '../mobile/src/lib/blockColors.js' },
  { source: '../src/lib/sceneColors.js', target: '../mobile/src/lib/sceneColors.js' },
  /*
   * And what a block is called when there is no room for its name. Shared for
   * the same reason as the colours: "DLY 2" has to mean the same block on both
   * screens, and the rule that keeps the instance number only when it is not 1
   * is not one anybody would reinvent identically.
   */
  { source: '../src/lib/shortName.js', target: '../mobile/src/lib/shortName.js' },
  /*
   * What Previous and Next step through, and which presets are starred.
   *
   * Shared rather than rewritten because the DECIDING is identical and the
   * cost of disagreeing is a set played in the wrong order. Both modules take
   * their storage as an argument — the browser hands them localStorage, the
   * phone hands them lib/store.js, which is the same shape over AsyncStorage —
   * so the only thing that differs between the two apps is where the bytes
   * live, which is the one thing that should differ.
   *
   * They also carry the merge these two copies meet in: a setlist built at the
   * Mac has to arrive on the phone as the same list, by the same rules, or the
   * sync is just two apps overwriting each other.
   */
  { source: '../src/lib/setlists.js', target: '../mobile/src/lib/setlists.js' },
  { source: '../src/lib/presetMarks.js', target: '../mobile/src/lib/presetMarks.js' },
  { source: '../src/lib/presetName.js', target: '../mobile/src/lib/presetName.js' },
  /*
   * And the key those two file everything under.
   *
   * Setlists are kept per unit, so the string naming the unit IS the join
   * between the Mac's copy and the phone's. Two apps deriving it differently
   * would not argue — they would each keep a full, correct set of setlists in
   * a bucket the other never looks in, which reads as a sync that quietly
   * carries nothing.
   */
  { source: '../shared/device-slug.mjs', target: '../mobile/src/lib/device-slug.js' },
  /*
   * How a slot is written down. The AM4 numbers its 104 presets in lettered
   * banks and says so on its own front panel; gen-3 units simply number theirs.
   * A setlist row reading "045 A02" on the Mac and "45" on the phone is the
   * same song described two ways to somebody checking the running order in the
   * dark, and slotCount is here too so neither app invents slots the unit does
   * not have.
   */
  { source: '../src/lib/slots.js', target: '../mobile/src/lib/slots.js' },
  /*
   * And how two copies of a stage become one.
   *
   * This is the file that can lose somebody's work: a running order built at
   * the Mac on Tuesday and a star tapped on the phone on Wednesday have to both
   * survive meeting each other. Two apps merging by their own rules would not
   * argue — they would take turns overwriting, and the setlist that went
   * missing would look like a setlist nobody saved.
   *
   * The network is NOT in here. Each app keeps its own twenty lines of
   * Supabase and hands them to syncStage, because the two reach Supabase
   * through different modules and that difference is harmless.
   */
  { source: '../src/lib/setlistMerge.js', target: '../mobile/src/lib/setlistMerge.js' }
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
