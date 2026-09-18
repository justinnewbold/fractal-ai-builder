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
  /*
   * When a garbled preset dump is asked for again rather than shown.
   *
   * The browser has had this since the day the message first appeared. The
   * phone did not, and so the phone showed
   * "PRESET_DUMP_HEADER: expected func 0x77 at offset 0, got 0x78" on a stage
   * — a sentence in the codec's own words about a read that arrived while the
   * unit was still loading, and which a second attempt four hundred
   * milliseconds later would have answered. The rule about which requests may
   * be asked twice is the same rule on both ends; it is not one worth writing
   * out twice.
   */
  { source: '../src/lib/retry.js', target: '../mobile/src/lib/retry.js' },
  /*
   * The word at the top of both screens. "Make sure the iOS app shows this
   * exact header." Four states, one set of words, one place they are decided —
   * a phone saying DISCONNECTED beside a Mac saying CONNECTED about the same
   * link is a difference nobody can debug from a photograph.
   */
  { source: '../shared/link-word.mjs', target: '../mobile/src/lib/link-word.js' },
  /*
   * Which end is behind. Both apps carry the same version by construction, so
   * the comparison has to mean the same thing at both ends of it.
   */
  { source: '../shared/versions.mjs', target: '../mobile/src/lib/versions.js' },
  /*
   * The troubleshooting guide, so a fix reads the same wherever somebody
   * standing in front of a dead rig happens to look it up.
   *
   * Rendered rather than copied, for one character. Node needs an explicit
   * extension on a relative import, so the shared file says `./versions.mjs`;
   * the phone's copy of that module is `versions.js`, because that is what the
   * sync has always called it and what Settings.js imports. So the extension
   * is rewritten on the way across and the banner is put back by hand — a
   * plain copy would ship an import that resolves to nothing and take demo
   * mode's Metro bundle down with it.
   */
  /* How to get a computer on the other end, so the browser and the phone
     offer the same four routes with the same honest status on each. */
  { source: '../shared/ways-in.mjs', target: '../mobile/src/lib/ways-in.js' },
  /*
   * What a report carries, and what it must never carry.
   *
   * Belongs here more than most: the phone is where the bad evenings happen
   * and the browser is where they get read, and a phone that trimmed the log
   * differently — or attached one to a feature suggestion — would be sending
   * something a reader cannot compare with anything else.
   */
  { source: '../shared/report-rules.mjs', target: '../mobile/src/lib/report-rules.js' },
  {
    source: '../shared/troubleshooting.mjs',
    target: '../mobile/src/lib/troubleshooting.js',
    render: (text) =>
      banner('../shared/troubleshooting.mjs') + text.replace("from './versions.mjs'", "from './versions.js'")
  },


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
  { source: '../src/lib/setlistMerge.js', target: '../mobile/src/lib/setlistMerge.js' },
  /*
   * What each model is modelled on.
   *
   * "Search for the real life names that each AMP and all other effects are
   * based off of and list them next to the name." Scrolling two hundred model
   * names looking for a Rectifier, every one of them is a code word — so the
   * list says the amp beside the name, on both screens, or the phone's picker
   * is the code words on their own.
   *
   * The unit is the better authority on its own models and anything it supplies
   * wins; this only fills in the nulls, which on an AM4 is all of them. Both
   * apps have to fill them in the same way or the same amp is two amps.
   *
   * The four data files ride along `raw` — a JSON file with a JavaScript
   * comment on the front of it is not JSON.
   */
  { source: '../src/lib/lineage.js', target: '../mobile/src/lib/lineage.js' },
  { source: '../src/data/amp-types.json', target: '../mobile/src/data/amp-types.json', raw: true },
  { source: '../src/data/drive-types.json', target: '../mobile/src/data/drive-types.json', raw: true },
  { source: '../src/data/amp-lineage.json', target: '../mobile/src/data/amp-lineage.json', raw: true },
  { source: '../src/data/effect-lineage.json', target: '../mobile/src/data/effect-lineage.json', raw: true },
  /*
   * THE SIMULATED FM3, so the phone has something to be without a rig.
   *
   * "Yes I want the demo mode on the phone as well. It helps me make sure the
   * lag isn't just the app, also." That second reason is the better one and it
   * decides how this is wired: the demo answers from memory with no relay, no
   * serial port and no unit in it, so a screen that is still slow in the demo
   * is slow because of this app and nothing else. It is the only way to tell
   * those two apart, and this project has now guessed wrong about which is
   * which more than once.
   *
   * Copied rather than rewritten, because a demo that behaves differently from
   * the browser's is a demo that teaches the wrong thing — and this one carries
   * the write semantics that cost an evening to find: normalised in, real units
   * out, and an out-of-range write that clamps and reports success.
   *
   * It reaches for localStorage in two places, which a phone does not have.
   * Both are already inside a try, so the phone simply forgets renamed scenes
   * between launches — the one thing lost, and not worth a second copy of the
   * file to keep.
   */
  { source: '../src/lib/mockDevice.js', target: '../mobile/src/lib/mockDevice.js' },
  { source: '../src/lib/sceneState.js', target: '../mobile/src/lib/sceneState.js' },
  { source: '../src/lib/demoMemory.js', target: '../mobile/src/lib/demoMemory.js' },
  { source: '../src/lib/tunerStream.js', target: '../mobile/src/lib/tunerStream.js' },
  { source: '../src/data/cab-types.json', target: '../mobile/src/data/cab-types.json', raw: true },
  { source: '../src/data/amp-params.json', target: '../mobile/src/data/amp-params.json', raw: true },
  /* The demo's twelve presets. The mock imports it on both ends, so a phone
     without this file is a phone whose demo mode will not bundle. */
  { source: '../src/data/demo-presets.json', target: '../mobile/src/data/demo-presets.json', raw: true },

  /*
   * Where a block sits, and how that becomes something the unit will accept.
   *
   * INDEXING IS THE TRAP AND IT HAS ALREADY SPRUNG. Reads report a column
   * counting from zero; the write routes take it counting from one. The old
   * panel added one of its own for a linear unit and the wire added another,
   * so slot 1 on an AM4 was written to column 2.
   *
   * This is worse to get wrong than a knob. A value written to the wrong place
   * sounds wrong and is one drag from right; a block placed in the wrong cell
   * is a preset somebody has to rebuild. And the two apps would not argue about
   * it — one of them would simply put things one column along.
   *
   * It also carries the rule that `ok:false` is not a failure on this hardware,
   * which the browser learned by rolling back moves that had worked.
   */
  { source: '../shared/grid-plan.mjs', target: '../mobile/src/lib/grid-plan.js' },
  /* Dragging a block up or down a lane, as grid cells: one copy of the maths, so the
     browser's chain editor and the phone's move the same block to the same column. */
  { source: '../shared/lane-order.mjs', target: '../mobile/src/lib/laneOrder.js' },
  /*
   * The volume slider: which control it drives, how it reads, and how a drag
   * becomes writes a serial port can keep up with.
   *
   * THE LAST PART MATTERS MORE ON THE PHONE THAN IN THE BROWSER. A slider
   * reports every pixel of a drag — sixty values a second — and the unit takes
   * one request at a time down a serial port. The browser pays a local socket
   * for each; the phone pays a round trip to a Mac in the wings. Sent as they
   * come, a two-second drag would queue a hundred writes the unit works through
   * for the next ten seconds, landing on the value you let go of long after you
   * let go of it, and blocking the scene you pressed next behind them.
   *
   * `latestWriter` is the answer and it is not one anybody would reinvent
   * identically: one write on the wire, the newest value replacing whatever was
   * queued behind it. Shared, so the two ends cannot disagree about it.
   */
  { source: '../src/lib/volume.js', target: '../mobile/src/lib/volume.js' },
  /*
   * What every model on the unit really is.
   *
   * "Add an info page like this to settings listing the real life equivalents
   * of each amp and effects pedals." Fractal cannot print "Marshall JCM800" on
   * a menu, so the unit says "Brit 800 2204 High". Everybody who has played one
   * for a year knows the translation and nobody who unboxed one on Saturday
   * does — and the phone is the thing in your hand when you are standing in
   * front of the unit wondering.
   *
   * Shared rather than rewritten for the plainest reason: it is a reference,
   * and a reference that says two different things on two screens is not one.
   */
  { source: '../src/lib/gearCatalog.js', target: '../mobile/src/lib/gearCatalog.js' },
  /*
   * How big the stage tiles are.
   *
   * The five steps are the browser's, and they are the same five here because
   * they are about a thumb rather than about a window: "Smallest" is the
   * setting for somebody who wants the whole rig on one screen and "Largest"
   * for somebody playing in the dark. Both apps also keep the choice under the
   * same key, so a phone and a laptop signed into one account do not argue
   * about it.
   */
  { source: '../src/lib/gigSize.js', target: '../mobile/src/lib/gigSize.js' },
  /*
   * One log for everything, in the order it happened.
   *
   * "Make a unified debug log with a copy log button to send back to you for
   * debugging." The phone needs it MORE than the browser does and had none at
   * all: a browser has a console somebody can open, and a phone on a stage has
   * nowhere for a failure to go. Every bad evening was unreconstructable.
   *
   * Shared so the two logs read the same, because the whole point of the copy
   * button is that what gets pasted back is a format somebody already knows how
   * to read. No imports at all in it — the crash capture is guarded on
   * `addEventListener` and simply does nothing where there is no window.
   */
  { source: '../src/lib/debugLog.js', target: '../mobile/src/lib/debugLog.js' },
  /*
   * What this build of the phone app is.
   *
   * Not a copy but a rendering: the repository's version, made into a module the
   * About page can import. Typed by hand it would be the version somebody last
   * remembered to type, which is worse than none — a wrong one sends people
   * hunting for a bug in a build they are not running. Every change here needs a
   * new version number anyway, so this moves on its own.
   */
  {
    source: '../package.json',
    target: '../mobile/src/lib/version.js',
    render: (text) => `/**
 * What this build of the phone app is.
 *
 * Generated from the repository's package.json by \`npm run sync:rules\`, for the
 * plainest reason there is: the version on the About page has to be the version
 * that was built. Typed by hand it is the version somebody last remembered to
 * type, which is worse than no version at all — a wrong one sends people
 * hunting for a bug in a build they are not running.
 */
export const APP_VERSION = '${JSON.parse(text).version}'
`
  },
  /*
   * And what the STORES call this build.
   *
   * "What build number should the iOS version be on? It says version 1.0.0
   * with an 11 in parentheses." TestFlight and Play show app.json's version,
   * which was typed once as 1.0.0 and never moved, so every build of the
   * phone app has been "1.0.0" there and the only way to tell them apart was
   * a build counter nobody can map to a change. The rest of app.json is kept
   * as it is; only `expo.version` is held to package.json. The build counters
   * are Expo's to increment and are left alone.
   */
  {
    source: '../package.json',
    target: '../mobile/app.json',
    render: (text, current) => {
      const app = JSON.parse(current || '{"expo":{}}')
      app.expo = { ...app.expo, version: JSON.parse(text).version }
      return `${JSON.stringify(app, null, 2)}\n`
    }
  }
]

/** Where a copy says it came from, so nobody edits the copy by mistake. */
export const banner = (source) =>
  `/* Generated from ${source.replace('../', '')} by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run \`npm run sync:rules\`; the test suite
 * fails on any difference between the two. */

`

/**
 * What a copy should contain, given what its source contains.
 *
 * `raw` is for the files that cannot carry the banner: a JSON file with a
 * JavaScript comment on the front of it is not JSON, and Metro refuses it. They
 * are still copied and still held to being identical — only the note saying so
 * has nowhere to live, which is why nothing but data is allowed to be raw.
 */
export const generate = (source, sourcePath, raw = false, render = null, current = null) => {
  /* A rendered file is neither a copy nor raw: its content is DERIVED from the
     source, so the banner would be lying about what to edit. The doc comment
     the renderer writes says where it came from instead. A renderer is also
     handed what the copy holds now, for the one file that is edited in place
     rather than replaced. */
  if (render) return render(source, current)
  return raw ? source : banner(sourcePath) + source
}

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
    return { ...file, sourceText, copyText, expected: generate(sourceText, file.source, file.raw, file.render, copyText) }
  })

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of state()) {
    writeFileSync(fileURLToPath(new URL(file.target, import.meta.url)), file.expected)
    console.log(`${file.target.replace('../', '')} is up to date with ${file.source.replace('../', '')}`)
  }
}
