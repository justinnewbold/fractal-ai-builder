/**
 * The two clocks, kept in agreement.
 *
 * A generation is bounded twice: the serverless function has a ceiling set in
 * `vercel.json`, and the browser has its own stall timeout and hard cap in
 * `src/lib/stream.js`. Nothing connects the two files, and for a while they
 * disagreed badly — the function was cut off at 60 seconds while the client
 * sat waiting for 240.
 *
 * What made that expensive is how it presented. The server writes an `error`
 * frame for anything it catches, so a function killed by the platform sends no
 * frame at all: the stream just ends. The client saw partial blocks and then
 * silence, and reported that *the model* had stopped — so every instinct was
 * to go and look at the model, the prompt, the schema. The cause was a number
 * in a config file.
 *
 * The invariant that prevents it: the server must be able to run for at least
 * as long as the client is prepared to wait. Then the client's own cap is
 * always the binding one, it fails with a message it can actually explain, and
 * a truncated stream goes back to meaning something genuinely unusual.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/** Every .js/.jsx under a directory, so a new file cannot quietly opt out. */
function* walk(dir) {
  for (const entry of readdirSync(fileURLToPath(dir))) {
    const path = fileURLToPath(new URL(entry, dir))
    if (statSync(path).isDirectory()) yield* walk(new URL(`${entry}/`, dir))
    else if (/\.(js|jsx)$/.test(entry)) yield path
  }
}

export function run(test) {
  test('the server can run for as long as the browser will wait', () => {
    const { functions } = JSON.parse(read('vercel.json'))
    const seconds = functions?.['api/*.js']?.maxDuration
    assert.ok(Number.isFinite(seconds), 'no maxDuration is set for the API functions')

    const stream = read('src/lib/stream.js')
    const capMs = Number(stream.match(/const HARD_CAP_MS = (\d+)/)?.[1])
    const stallMs = Number(stream.match(/const STALL_MS = (\d+)/)?.[1])
    const firstMs = Number(stream.match(/const FIRST_MS = (\d+)/)?.[1])
    assert.ok(
      Number.isFinite(capMs) && Number.isFinite(stallMs) && Number.isFinite(firstMs),
      'the client caps moved'
    )

    assert.ok(
      seconds * 1000 >= capMs,
      `the function is cut off at ${seconds}s but the browser waits ${capMs / 1000}s — ` +
        'a generation between the two dies with no error frame and blames the model'
    )
    // A stall is meant to catch a silent connection, so it has to be the
    // shorter of the two or it never fires before the cap does.
    assert.ok(stallMs < capMs, 'the stall timeout is not shorter than the hard cap')
    // Same for the model's first word: a budget the cap beats to the punch is
    // not a budget, and the message the person reads would be the wrong one.
    assert.ok(
      firstMs < capMs,
      'the first-answer budget is not shorter than the hard cap, so the cap fires first and blames the wrong thing'
    )
  })

  test('the server says hello before it asks the model anything', () => {
    /*
     * Node holds the response until the first write, so with nothing written up
     * front a browser waiting on `fetch` learns nothing until the first partial
     * — and waiting for the first partial is the entire wait. Every timeout
     * then looks identical from the browser, whether the server was never
     * reached, the model never started, or the answer stopped halfway.
     *
     * The frame has to come before the model call, not merely exist: written
     * after it, it says exactly as little as writing nothing did.
     */
    const api = read('api/generate.js')
    const hello = api.indexOf("{ type: 'open' }")
    const ask = api.indexOf('streamObject(args)')
    assert.notEqual(hello, -1, 'the server no longer opens the stream before it asks the model')
    assert.notEqual(ask, -1, 'the streaming call moved')
    assert.ok(
      hello < ask,
      'the hello is written after the model call, which is the same as not writing it: nothing reaches the browser until the model does'
    )
  })

  test('a verification report is rendered field by field, never as the object', () => {
    /*
     * `verifyChanges` returns objects — {block, param, wanted, got} — and App
     * rendered one bare as a React child. That is error #31, which unmounts
     * the whole tree: the page went blank the first time a written value
     * actually failed to read back.
     *
     * It survived because of what it takes to reach: a real unit, a real
     * write, and a real drift between them. No test and no demo session ever
     * produces all three, so the only thing that can catch it is the shape of
     * the code. Same failure as the cab picker rendering {value,label} pairs.
     */
    const app = read('src/App.jsx')
    const at = app.indexOf('applied.mismatches.map(')
    assert.ok(at !== -1, 'the mismatch list moved — retarget this test')
    const body = app.slice(at, app.indexOf('))}', at))
    const param = body.match(/\.map\(\((\w+)/)?.[1]

    assert.ok(
      new RegExp(`\\b${param}\\.\\w+`).test(body),
      `the mismatch list renders ${param} without reading a field off it`
    )
    assert.ok(
      !new RegExp(`\\{\\s*${param}\\s*\\}`).test(body),
      `the mismatch list renders {${param}} bare — that object is not a valid React child`
    )
  })

  test('picking a save destination cannot load it', () => {
    /*
     * The one way this feature can destroy work.
     *
     * The slot list in the save sheet is the same `PresetList` the preset menu
     * uses, and there `onSelect` LOADS the preset — which is right there and
     * catastrophic here: loading a preset replaces the edit buffer, so
     * choosing where to save would discard the very thing being saved.
     *
     * The two call sites must therefore differ, and they look nearly
     * identical. This asserts the save sheet's handler only sets the slot.
     */
    const sheet = read('src/components/SaveSheet.jsx').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    const at = sheet.indexOf('onSelect=')
    assert.ok(at !== -1, 'the save sheet no longer offers a slot list')
    const handler = sheet.slice(at, at + 160)
    assert.match(handler, /onSlot\(/, 'the save sheet does not set the slot when a row is picked')
    assert.ok(
      !/jumpTo|selectPreset|onLoad/.test(handler),
      'the save sheet loads the preset it was asked to save into'
    )
  })

  test('every AI call goes through the one place that knows where the model lives', () => {
    /*
     * The failure this prevents is invisible where it is written.
     *
     * `fetch('/api/generate')` is correct on the hosted origin and always will
     * be — which is why a new one would be added without a thought. Served by
     * ForgeFX on the local network it is a 404 from a device server that has
     * never heard of the model, and local mode is the whole point of Phase 4.
     *
     * So the rule is that nothing outside src/lib/ai.js names an /api/ path
     * directly. There is exactly one place that decides absolute or relative.
     */
    const offenders = []
    for (const file of walk(new URL('../src/', import.meta.url))) {
      if (file.endsWith('/lib/ai.js')) continue
      const code = readFileSync(file, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
      for (const m of code.matchAll(/fetch\(\s*['"`]\/api\/[^'"`]*/g)) {
        offenders.push(`${file.split('/src/')[1]}: ${m[0].slice(0, 48)}`)
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `AI routes fetched directly — these 404 when the app is served locally:\n  ${offenders.join('\n  ')}`
    )
  })

  test('the generator asks for an output ceiling rather than taking the default', () => {
    /*
     * The provider must send max_tokens on every request, so leaving it unset
     * is not "no limit" — it is the provider's 4096, which a full chain runs
     * past. Truncation there fails schema validation at the very end, after
     * the whole preset has been watched being built.
     */
    const gen = read('api/generate.js').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    const cap = Number(gen.match(/maxOutputTokens:\s*(\d+)/)?.[1])
    assert.ok(Number.isFinite(cap), 'no maxOutputTokens — the request runs on the provider default')
    assert.ok(cap >= 8000, `maxOutputTokens is ${cap}, low enough to truncate a full chain`)
  })
  test('the Mac app spawns Node and keeps one menu-bar icon', () => {
    /*
     * Both of these are Electron-only, so nothing here can run them — but both
     * are visible in the shape of the code, which is the same trade the rest of
     * the structural checks make.
     *
     * The spawn is the one that matters: without the flag the packaged app
     * launches a second copy of itself instead of the device server. The tray
     * is the one that would look like a mystery: buildTray runs twice, once at
     * launch and once when the phone status lands, and constructing the Tray
     * unconditionally leaves two icons in the menu bar.
     */
    const main = read('desktop/main.js')
    assert.match(
      main,
      /serverEnv\(\{ port, dist: distPath\(\), asNode: true \}\)/,
      'the device server is spawned without ELECTRON_RUN_AS_NODE, so a packaged app starts itself again'
    )
    const tray = main.slice(main.indexOf('function buildTray()'), main.indexOf('app.whenReady'))
    assert.match(tray, /if \(!tray\) \{/, 'buildTray constructs a Tray every time it draws the menu')
  })

  test('an unsigned build is still signed with nothing, so it can run at all', () => {
    /*
     * Apple Silicon will not execute a Mach-O binary with no signature, and
     * packaging invalidates the one Electron ships with — its binary is signed,
     * then renamed, given resources and repacked. Leave it there and macOS says
     * "damaged and can\'t be opened", which reads as a corrupt download and is
     * not one: there is nothing to check.
     *
     * The first person to install a build of this got exactly that, and it has
     * no way past it — unlike "unidentified developer", which does. An ad-hoc
     * signature proves nothing about who built the app, which is the honest
     * state of a test build, and is enough to make it runnable.
     */
    const yml = read('desktop/electron-builder.yml')
    assert.match(yml, /^afterPack: afterPack\.js$/m, 'nothing signs an unsigned build, so it will not open on Apple Silicon')
    const hook = read('desktop/afterPack.js')
    assert.match(hook, /'--sign', '-'/, 'the hook does not ad-hoc sign')
    assert.match(
      hook,
      /if \(process\.env\.CSC_LINK\) return/,
      'the hook would overwrite a real signature with an ad-hoc one, throwing away the thing people trust'
    )
  })

  test('everything the app loads at runtime is actually in the app', () => {
    /*
     * `files` is an allowlist. Anything main.js reaches for that is not named
     * there is simply absent from the packaged app, and the failures are quiet
     * by nature: Electron treats a missing preload as no preload, with no error
     * and nothing in the window.
     *
     * preload.js was missing from it for every release it existed in. So
     * `window.fractalDesktop` was never defined in a packaged build,
     * `desktopBridge()` answered null exactly as designed for a phone or the
     * hosted site, and the whole Updates section — version line, "Check for
     * updates", the ready notice — drew nothing. The feature looked unwritten.
     * It worked in development, where the file sits on disk beside main.js.
     *
     * So this reads what main.js actually asks for rather than checking one
     * name: every `join(__dirname, '<file>')` has to be covered by `files`, or
     * by `extraResources` for the two that are copied in beside the asar.
     */
    const main = read('desktop/main.js')
    const yml = read('desktop/electron-builder.yml')

    const listed = (block) => {
      const at = yml.indexOf(`${block}:`)
      if (at === -1) return []
      const rest = yml.slice(at + block.length + 1)
      const end = rest.search(/\n[a-zA-Z]/)
      return (end === -1 ? rest : rest.slice(0, end))
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- ') || l.startsWith('to: '))
        .map((l) => l.replace(/^-\s*/, '').replace(/^to:\s*/, '').trim())
    }
    const packaged = [...listed('files'), ...listed('extraResources')]
    assert.ok(packaged.includes('main.js'), 'the files list is no longer being read correctly')

    const wanted = [...main.matchAll(/join\(__dirname,\s*'([^']+)'/g)]
      .map((m) => m[1])
      // `..` climbs out of the app to the checkout, which only exists in
      // development — those paths sit behind an `app.isPackaged` ternary whose
      // other half reads process.resourcesPath.
      .filter((name) => name !== '..')
    assert.ok(wanted.length >= 2, 'nothing looks like a runtime path any more — has main.js changed shape?')

    for (const name of wanted) {
      const covered = packaged.some(
        (p) => p === name || p === `${name}/**` || p.startsWith(`${name}/`) ||
               (p.includes('*') && new RegExp(`^${p.replace(/\*+/g, '.*')}$`).test(name))
      )
      assert.ok(
        covered,
        `main.js loads ${name} at runtime and nothing packages it — in a built app it will not be there, ` +
          'and a missing preload or icon fails silently'
      )
    }
  })

  test('the menu offers the way in that works, and names the usual reason one does not', () => {
    /*
     * Two ways to a phone, and the menu only ever mentioned one — the wifi
     * address, with nothing said when macOS was quietly refusing connections
     * from other machines, and no mention of the relay even once it was on.
     */
    const main = read('desktop/main.js')
    assert.match(main, /firewall\.known && firewall\.on && firewall\.blocked !== false/, 'the menu never mentions the firewall, or mentions it when it is not the problem')
    assert.match(main, /phone\?\.on\n?\s*\?/, 'the relay is offered whether or not it works')
    assert.match(main, /fractal\.newbold\.cloud/, 'the other way in is not offered at all')
  })

  test('nothing is shown until there is something to show', () => {
    /*
     * Electron-only, so structural. The window is opened on a URL the server
     * may not be answering yet, and Electron does not retry a page that failed
     * — so the order matters more than anything else here.
     */
    const main = read('desktop/main.js')
    assert.match(main, /return waitForServer\(\{ port \}\)/, 'start() does not wait for the server it spawned')
    /*
     * Read inside the launch itself. A loose search for the call found the
     * first `openWindow()` anywhere in the file, which is now the one that
     * reopens the window after it was closed — a different question, and one
     * that has nothing to wait for.
     */
    const launch = main.slice(main.indexOf('app.whenReady()'))
    assert.ok(launch, 'there is no launch block to read')
    const ready = launch.indexOf('const answering = await start()')
    assert.notEqual(ready, -1, 'the launch no longer waits on start()')
    assert.ok(ready < launch.indexOf('openWindow()'), 'the window is opened before the server is known to answer')
    assert.match(main, /if \(!answering\) \{/, 'a server that never answers leaves a blank window and no explanation')
    assert.match(main, /did-fail-load/, 'a page that fails to load is never retried')
  })

  test('the app asks who has the port before it starts a server on it', () => {
    /*
     * Structural because it is Electron-only. The window is opened on the port
     * the app asked for, so the check has to happen before anything is spawned
     * or the window shows a stranger's answer — which is exactly what the first
     * real run did.
     */
    const main = read('desktop/main.js')
    const at = main.indexOf('await whoHasPort(')
    assert.notEqual(at, -1, 'the app starts a server without asking whether the port is free')
    assert.ok(at < main.indexOf('spawn(process.execPath'), 'the port is checked after the server is started, which is too late')
    assert.match(main, /if \(held\.forgefx\)/, 'a ForgeFX already running is not told apart from anything else on the port')
  })

  test('a build with no certificate does not try to sign with an empty one', () => {
    /*
     * electron-builder decides whether to sign from whether CSC_LINK is
     * *defined*, not whether it is useful: `getCscLink` is commented "allow to
     * specify as empty string" and the gate is `cscLink == null`. GitHub turns
     * a secret that does not exist into an empty string, which is not null — so
     * naming the secret unconditionally means "sign, with this empty
     * certificate", and the build dies with "<dir> not a file".
     *
     * It cost a green pull request and a red manual build to find, because
     * electron-builder refuses to sign PR builds at all: the one trigger that
     * runs on every change is the one trigger that cannot reproduce it.
     *
     * An `env:` block cannot leave a variable unset, so the fix is two steps
     * and the guard is that the signing one is gated.
     */
    const wf = read('.github/workflows/desktop.yml')
    const signing = wf.slice(wf.indexOf('- name: Package, signed'))
    assert.ok(signing.includes('CSC_LINK'), 'the signed build no longer names the certificate — retarget this test')
    assert.match(
      signing.slice(0, signing.indexOf('run:')),
      /if: .*SIGNABLE == 'true'/,
      'the certificate is named by a step that can run without one, which reads as "sign with nothing"'
    )
    const unsigned = wf.slice(wf.indexOf('- name: Package\n'), wf.indexOf('- name: Package, signed'))
    assert.match(
      unsigned,
      /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/,
      'the unsigned build does not say it has nothing to sign with, so it goes looking'
    )
    assert.ok(!/CSC_LINK/.test(unsigned), 'the unsigned build names a certificate')
  })

  test('the device server the app ships is pinned to a commit, and travels with it', () => {
    /*
     * We copy someone else's project into an installer we sign. What goes in
     * therefore has to be a fixed thing, and a tag is not one — whoever owns the
     * repository can move it. The lock file carries both: a tag to read and a
     * commit to verify, and scripts/vendor-forgefx.mjs refuses to build when
     * they disagree.
     */
    const lock = JSON.parse(read('desktop/forgefx.lock.json'))
    for (const name of ['forgefx', 'forgefx-midi']) {
      const spec = lock[name]
      assert.ok(spec, `${name} is not pinned at all`)
      assert.match(spec.repo, /^[\w.-]+\/[\w.-]+$/, `${name}.repo is not owner/name`)
      assert.match(
        spec.commit || '',
        /^[0-9a-f]{40}$/,
        `${name} is pinned by ${spec.tag || 'nothing'} alone — a tag can be moved, so the commit is what is checked`
      )
      assert.ok(spec.tag, `${name} has no tag, so nobody can read what version this is`)

      /*
       * And it is ours. We vendor from private mirrors rather than from
       * upstream, because what goes inside something we sign should not depend
       * on another account's repository still being there, still being public,
       * and still having the history it had last week. `upstream` is what a
       * copy loses first, so it is written down.
       */
      assert.match(
        spec.repo,
        /^justinnewbold\//,
        `${name} is vendored straight from ${spec.repo} — the installer would then depend on an account we do not control`
      )
      assert.match(
        spec.upstream || '',
        /^[\w.-]+\/[\w.-]+$/,
        `${name} does not say where it was mirrored from, which is the thing a copy loses first`
      )
    }

    /*
     * Asked for by commit, not cloned at a tag.
     *
     * The mirrors carry every branch and the whole history but no tags, so
     * there is nothing to clone — and naming the commit is the stricter shape
     * regardless: cloning a tag puts whatever it points at on disk and asks
     * questions afterwards, which is a window this has no reason to have.
     */
    const script = read('scripts/vendor-forgefx.mjs')
    assert.match(
      script,
      /'fetch', '--quiet', '--depth', '1', 'origin', spec\.commit/,
      'the vendor script no longer asks for the pinned commit by name'
    )
    assert.ok(
      !/'--branch', spec\.tag/.test(script),
      'the vendor script clones at the tag again — the mirrors have no tags, and a tag is not the pin'
    )

    /*
     * And the app has to be given it. Vendoring without wiring it up is the
     * state this replaced: a .dmg that says "ForgeFX is not installed" on every
     * machine that is not the one it was built on.
     */
    assert.match(
      read('desktop/main.js'),
      /findForgeFX\(\{ extra: \[vendored\(\)\] \}\)/,
      'the app does not offer findForgeFX the copy it ships with'
    )
    assert.match(
      read('desktop/electron-builder.yml'),
      /- from: vendor\n\s+to: vendor/,
      'the vendored server is not copied into the bundle'
    )
    // Built, not committed: it carries node_modules and a compiled tree.
    assert.match(read('.gitignore'), /^desktop\/vendor$/m, 'the vendored tree is not ignored')
  })

  test('a build that can sign, signs — and then proves it did', () => {
    /*
     * The gate used to be "only on a desktop-v* tag", which read as caution and
     * was actually a guess. The real constraint is narrower and has a reason:
     * electron-builder refuses to sign pull-request builds, because a PR from a
     * fork would otherwise get at the certificate. Every other trigger can sign,
     * and an artefact somebody installs is worth signing whether or not anyone
     * called it a release — the tag rule mostly meant the .dmg people actually
     * downloaded from a hand-started run was the unsigned one.
     */
    const wf = read('.github/workflows/desktop.yml')
    const signed = wf.slice(wf.indexOf('- name: Package, signed and notarised'))
    const gate = signed.slice(0, signed.indexOf('\n', signed.indexOf('if:')))
    assert.match(
      gate,
      /github\.event_name != 'pull_request'/,
      'the signed build is not gated on the one thing that actually forbids signing'
    )
    assert.ok(
      !/refs\/tags\/desktop-v/.test(gate),
      'signing is tied to a release tag again, so a hand-started build produces an unsigned .dmg'
    )

    /*
     * And it is checked. Three questions, and an artefact can pass one while
     * failing another: is the signature intact and complete, would Gatekeeper
     * open it, and did notarisation actually attach a ticket. The last is the
     * one nobody can answer by reading configuration — which is the whole point
     * of asking the build instead of guessing.
     */
    for (const [cmd, why] of [
      ['codesign --verify', 'nothing checks the signature covers what it should'],
      ['spctl --assess', "nothing asks whether Gatekeeper would open it"],
      ['stapler validate', 'nothing proves notarisation happened — a signed but un-notarised .dmg is still quarantined on a stranger\'s Mac']
    ]) {
      assert.ok(wf.includes(cmd), `${cmd} is gone: ${why}`)
    }

    /*
     * And the disk image gets its own ticket.
     *
     * electron-builder notarises the app and stops: `notarizeIfProvided` takes
     * the app path and runs during signing, before a .dmg exists. The first
     * build to reach the check above said so in one line — "does not have a
     * ticket stapled to it" — with the app beside it already "accepted,
     * source=Notarized Developer ID".
     *
     * The image is what macOS assesses first, so without this the download
     * still warns however well signed the app inside it is.
     */
    assert.ok(
      wf.includes('notarytool submit'),
      'the disk image is no longer notarised — electron-builder only ever does the app, and the image is what someone downloads'
    )
    assert.ok(
      wf.includes('stapler staple'),
      'the disk image is notarised but its ticket is never attached, so the check only passes with a network and a stranger offline still sees a warning'
    )
  })

  test('the Mac app has a face, and claims only entitlements it uses', () => {
    /*
     * The first real Mac build reported "default Electron icon is used —
     * application icon is not set", which is what ships if nobody looks: an
     * installer whose icon belongs to the framework it happens to be built on.
     *
     * The icon is a PNG rather than an .icns because electron-builder converts
     * one with its own bundled tool, so it can be generated from public/icon.svg
     * (npm run icon) on any machine instead of being a second hand-made copy of
     * the artwork that drifts from the first.
     */
    const png = readFileSync(new URL('../desktop/build/icon.png', import.meta.url))
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'the Mac icon is not a PNG'
    )
    // IHDR: 8 bytes of signature, a length and a type, then width and height.
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    assert.ok(width >= 512 && height >= 512, `the Mac icon is ${width}x${height}; macOS wants 512 upwards`)
    assert.match(
      read('desktop/electron-builder.yml'),
      /^\s*icon: build\/icon\.png$/m,
      'the icon is committed but the build does not name it, which is the same as not having one'
    )

    /*
     * App Sandbox entitlements are inert without com.apple.security.app-sandbox,
     * and this app is not sandboxed — it opens a serial port and listens on the
     * LAN, neither of which the sandbox permits. It carried device.usb anyway,
     * which does nothing and reads as an oversight. Parsed as keys rather than
     * matched as text, because the file explains the absence in a comment.
     */
    const plist = read('desktop/entitlements.mac.plist')
    const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])
    assert.ok(keys.includes('com.apple.security.network.client'), 'the entitlements moved')
    const sandboxOnly = keys.filter((k) => /^com\.apple\.security\.(device|files|personal-information|assets)\./.test(k))
    if (!keys.includes('com.apple.security.app-sandbox')) {
      assert.deepEqual(sandboxOnly, [], `sandbox-only entitlements in an app with no sandbox: ${sandboxOnly.join(', ')}`)
    }
  })

  test('the Mac app and the app it carries claim the same version', () => {
    /*
     * The desktop package sat at 0.1.0 through six major versions of the thing
     * it packages, and nothing noticed because nothing compares them — until
     * something does. electron-updater decides whether an installed app is out
     * of date by comparing exactly this number against the newest release, and
     * the DMG is named with it. Left frozen, every build claims to be the same
     * version as the last one and no update ever installs; worse, the number a
     * person reads in About is not the number of the app they are running.
     *
     * One version, stamped from the root at build time. This is the check that
     * the stamping happened.
     */
    const root = JSON.parse(read('package.json')).version
    const desktop = JSON.parse(read('desktop/package.json')).version
    assert.equal(
      desktop,
      root,
      `the Mac app says ${desktop} while the app inside it says ${root} — ` +
        'an update compares the first and a person reads the second'
    )
  })

}
