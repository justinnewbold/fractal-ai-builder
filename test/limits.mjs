/**
 * What the Mac app is made of, and what it is allowed to claim.
 *
 * Packaging is the part of this project with no way to check itself at
 * runtime. A missing entitlement, a certificate that is present but empty, a
 * file the bundle references and does not ship, a device server pinned to a
 * commit that moved — every one of them builds cleanly and fails on somebody
 * else's machine, usually as "it won't open" with nothing to read.
 *
 * So these read the build config rather than the app: electron-builder.yml,
 * the entitlements, the workflow that signs it, and the lock file that says
 * which ForgeFX is inside.
 *
 * THIS FILE USED TO OPEN ON A DIFFERENT SUBJECT — the two clocks around a
 * generation, the serverless function's ceiling in vercel.json against the
 * browser's own cap in lib/stream.js, which disagreed badly enough that a
 * function killed at 60 seconds looked like the model going quiet. Both files
 * went with the AI, and so did the tests that held them together.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/** Every .js/.jsx under a directory, so a new file cannot quietly opt out. */
/*
 * Forward slashes, on every platform.
 *
 * `fileURLToPath` gives back the platform's own separators, and on Windows
 * that is a backslash — so `file.endsWith('/screens/Connect.js')` silently
 * stopped matching and `f.split('/mobile/')[1]` became undefined. Both are
 * real uses below, and both failed as something else: a screen that was meant
 * to be skipped got scanned, and a path came out as `mobile/undefined`.
 *
 * Node reads a forward-slash path perfectly well on Windows, so normalising
 * here costs nothing and means no caller has to think about it.
 */
function* walk(dir) {
  for (const entry of readdirSync(fileURLToPath(dir))) {
    const path = fileURLToPath(new URL(entry, dir))
    if (statSync(path).isDirectory()) yield* walk(new URL(`${entry}/`, dir))
    else if (/\.(js|jsx)$/.test(entry)) yield path.replaceAll('\\', '/')
  }
}

export function run(test) {
  
  
  
  
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

  test('the Windows app is built, and ships both halves of a release', async () => {
    /*
     * "Build a Windows desktop app matching the existing framework."
     *
     * Same Electron shell, same ForgeFX, same host.mjs — the differences are
     * all in packaging, and packaging is the part with no way to check itself
     * at runtime. Each of the things below builds cleanly when it is wrong and
     * fails on a PC that is not this one.
     */
    const yml = read('desktop/electron-builder.yml')
    const win = yml.slice(yml.indexOf('\nwin:'))
    assert.ok(yml.includes('\nwin:'), 'there is no Windows target at all')

    /*
     * TWO ARTEFACTS, AND BOTH ARE REQUIRED. The .exe is what a person
     * downloads; the .zip is what electron-updater downloads, exactly as on
     * macOS. Ship only the installer and the app finds an update it can never
     * install and says so every time it starts.
     */
    assert.match(win, /nsis/, 'no installer is produced')
    assert.match(win, /zip/, 'no zip is produced, so the app can never update itself')

    /* Not an administrator install. A PC at a venue is not always one somebody
       has the password for, and perMachine would ask for it. */
    assert.match(yml, /\nnsis:/, 'the installer has no settings of its own')
    assert.match(yml, /perMachine: false/, 'the installer asks for an administrator it does not need')

    /*
     * AND THE TRAY ICON IS THE ONE PLACE THE TWO PLATFORMS DIFFER ON PURPOSE.
     * macOS wants a template image — a silhouette it recolours for the menu
     * bar — and that same file on a Windows taskbar is a black square on a
     * black background. Two files, and the bundle has to carry the second.
     */
    assert.match(yml, /trayWin\.png/, 'the Windows build does not carry its own tray icon')
    const trayWin = readFileSync(new URL('../desktop/trayWin.png', import.meta.url))
    assert.deepEqual(
      [...trayWin.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'the Windows tray icon is not a PNG'
    )
    const main = read('desktop/main.js')
    assert.match(main, /process\.platform === 'darwin'/, 'the tray icon is chosen without asking which platform this is')
    assert.match(main, /trayWin\.png/, 'the app never reaches for the Windows tray icon')
    assert.match(main, /setTemplateImage\(true\)/, 'the Mac tray icon is no longer a template, so it will not recolour')
    /* And drawn at tray size rather than downscaled from 1024, which is how a
       menu-bar icon ends up a grey smudge. */
    assert.match(read('scripts/icon.mjs'), /TRAY_WIN/, 'nothing generates the Windows tray icon, so it cannot be regenerated from the artwork')

    const wf = read('.github/workflows/desktop.yml')
    /*
     * Bounded at the next job, not at the end of the file.
     *
     * This read from `windows:` to EOF, which was right while windows was
     * last and silently wrong the moment a linux job was added after it: the
     * slice swallowed linux's own `Package` step and the publish-flag check
     * below failed against a step that was never meant to match. A slice that
     * depends on being last is a slice that breaks when somebody appends.
     */
    const jobBody = (name) => {
      const at = wf.indexOf(`\n  ${name}:\n`)
      assert.notEqual(at, -1, `the ${name} job is gone`)
      const next = wf.slice(at + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
      return next === -1 ? wf.slice(at) : wf.slice(at, at + 1 + next)
    }
    const job = jobBody('windows')
    assert.match(job, /runs-on: windows-latest/, 'the Windows app is being built somewhere that is not Windows')
    /* bash for every step in that job: the heredoc, the loops over release/,
       and the publish flag below. */
    assert.match(job, /defaults:\n\s+run:\n\s+shell: bash/, 'the Windows job is not pinned to bash')

    /*
     * AND NO SHELL SYNTAX INSIDE THE DIST SCRIPT, which is a different rule
     * from that one and the reason this test exists.
     *
     * `--publish ${PUBLISH:-never}` lived in dist:win, and `shell: bash` did
     * not save it: that governs the STEP's command and nothing further, and
     * npm runs a script's body through its own shell — cmd.exe on Windows,
     * whatever the workflow asked for. electron-builder was handed the six
     * characters `${PUBL…` and failed with
     *   Argument: publish, Given: "${PUBLISH:-never}"
     * which names the right argument and never mentions a shell.
     *
     * The expansion belongs in the step, where bash is real. The Mac script
     * keeps its own copy and is fine — npm runs that one through sh.
     */
    const scripts = JSON.parse(read('desktop/package.json')).scripts
    assert.ok(
      !/[$][{]/.test(scripts['dist:win']),
      'dist:win carries shell syntax again, and npm will run it through cmd.exe on Windows'
    )
    for (const step of job.split('- name: ').filter((s) => s.startsWith('Package'))) {
      assert.match(
        step,
        /npm run dist:win -- --publish "\$\{PUBLISH:-never\}"/,
        'a Windows Package step no longer passes the publish flag, so it falls back to electron-builder\'s own default'
      )
    }

    /* The same question the Mac job asks: modules built against the runner's
       Node, loaded under Electron's. The symptom of getting it wrong is an app
       that opens perfectly and never sees the unit. */
    assert.match(job, /ELECTRON_RUN_AS_NODE=1/, 'nothing checks the native modules load under Electron on Windows')
    /* And that both halves of a release exist before one is published. */
    assert.match(job, /no zip was produced/, 'a release can go out with no way for the app to update itself')

    /*
     * AND THE UNSIGNED WINDOWS BUILD PUBLISHES, which is the one place this
     * job deliberately differs from the Mac one.
     *
     * An unsigned macOS app is not worth releasing — Gatekeeper refuses it and
     * a normal person has no way through. Windows is not like that: SmartScreen
     * shows a blue box with "More info → Run anyway" under it and the installer
     * then works exactly as a signed one would. Gating the Windows release on a
     * certificate would mean no Windows app at all, over a warning the connect
     * screen already tells people to expect.
     */
    const unsigned = job.slice(job.indexOf('- name: Package\n'), job.indexOf('- name: Package, signed'))
    assert.ok(unsigned.includes('PUBLISH:'), 'the unsigned Windows build cannot publish, so there is no Windows download until a certificate is bought')
    assert.ok(
      !/CSC_LINK/.test(unsigned),
      'the unsigned step names CSC_LINK — GitHub turns a missing secret into an empty string, which is not null, so electron-builder tries to sign with nothing'
    )
    /* And it still only ever publishes deliberately, from the default branch. */
    assert.match(unsigned, /github\.event_name != 'pull_request'/, 'a pull request could publish a release')
    assert.match(unsigned, /github\.ref == 'refs\/heads\/main'/, "a build from any branch could publish under main's name")
  })

  test('the Linux app builds both formats, and the .deb has the fields Debian demands', async () => {
    /*
     * "Do the Linux app."
     *
     * WHAT THIS TEST IS ACTUALLY FOR. The first Linux build failed, on both
     * architectures, at the very last step — the AppImage was already made,
     * the native modules had already been proved to load — because the .deb
     * target refused to assemble without a Homepage field and a maintainer
     * address. Neither is a thing anybody notices missing: the Mac and Windows
     * installers have never wanted them, and the config reads as complete.
     *
     * A whole CI cycle to be told a package needs an email address in it. That
     * is the kind of failure that is cheap to catch here and expensive to
     * catch there, so it is caught here.
     */
    const yml = read('desktop/electron-builder.yml')
    assert.ok(yml.includes('\nlinux:'), 'there is no Linux target at all')
    const linux = yml.slice(yml.indexOf('\nlinux:'))

    /*
     * BOTH FORMATS, AND THEY ARE NOT INTERCHANGEABLE. AppImage is the one that
     * runs anywhere without an install step, and it is the ONLY Linux format
     * electron-updater knows how to update — a .deb can never replace itself.
     * The .deb is for the box in a rack that stays on, where `apt install
     * ./file.deb` is a thing somebody already knows. Drop either and a real
     * person loses something.
     */
    assert.match(linux, /AppImage/, 'no AppImage, so there is no Linux download that updates itself')
    assert.match(linux, /deb/, 'no .deb, so the rack machine has no package it recognises')

    /*
     * THE TWO FIELDS THE BUILD DIED ON, AND THEY LIVE IN DIFFERENT FILES.
     *
     * electron-builder reports them in one breath — "specify project homepage"
     * and "specify author email" — which makes it read as one missing block.
     * It is not. `maintainer` is a deb option and belongs in the yml;
     * `homepage` is package.json METADATA and is not a configuration key at
     * all. Putting it in the yml, which is the obvious response to the error,
     * fails the whole config on `unknown property 'homepage'` before anything
     * is packaged — a worse failure than the one being fixed, and the second
     * red CI run this test exists to have prevented.
     */
    const pkg = JSON.parse(read('desktop/package.json'))
    assert.match(
      String(pkg.homepage),
      /^https:\/\//,
      'desktop/package.json has no homepage, and the .deb build stops rather than defaulting'
    )
    assert.ok(
      !/^homepage:/m.test(yml),
      "homepage is in electron-builder.yml, where it is not a real option — electron-builder rejects the whole config"
    )
    const deb = yml.slice(yml.indexOf('\ndeb:'))
    assert.match(
      deb,
      /maintainer: .+ <[^@\s]+@[^>\s]+>/,
      'the .deb names no maintainer with a working address, and the build refuses to guess one'
    )

    /*
     * AND NO INVENTED KEYS ANYWHERE AT THE TOP LEVEL, which is the general
     * form of the mistake above.
     *
     * electron-builder validates its whole config against a schema before it
     * does any work, so one misremembered key name costs a full CI cycle and
     * produces nothing. This is that schema's top-level property list, copied
     * from electron-builder 25's own rejection message. It only needs revising
     * when the pinned electron-builder major moves.
     */
    const VALID_TOP_LEVEL = new Set(
      `afterAllArtifactBuild afterExtract afterPack afterSign apk appId appImage appx
       appxManifestCreated artifactBuildCompleted artifactBuildStarted artifactName asar
       asarUnpack beforeBuild beforePack buildDependenciesFromSource buildNumber buildVersion
       compression copyright cscKeyPassword cscLink deb defaultArch detectUpdateChannel
       directories disableDefaultIgnoredFiles disableSanityCheckAsar dmg downloadAlternateFFmpeg
       electronBranding electronCompile electronDist electronDownload electronLanguages
       electronUpdaterCompatibility electronVersion executableName extends extraFiles
       extraMetadata extraResources fileAssociations files flatpak forceCodeSigning framework
       freebsd generateUpdatesFilesForAllChannels icon includePdb includeSubNodeModules
       launchUiVersion linux mac mas masDev msi msiProjectCreated msiWrapped nativeRebuilder
       nodeGypRebuild nodeVersion npmArgs npmRebuild nsis nsisWeb onNodeModuleFile p5p pacman
       pkg portable productName protocols publish releaseInfo removePackageKeywords
       removePackageScripts rpm snap squirrelWindows target win $schema`.split(/\s+/)
    )
    const topLevel = yml.split('\n').flatMap((line) => {
      const m = /^([A-Za-z$][A-Za-z0-9$]*):/.exec(line)
      return m ? [m[1]] : []
    })
    for (const key of topLevel) {
      assert.ok(
        VALID_TOP_LEVEL.has(key),
        `electron-builder has no top-level option "${key}" — it rejects the entire config and builds nothing`
      )
    }

    /*
     * AND NO ARCHITECTURE LIST, which is the one thing here that is a decision
     * rather than a requirement. serialport and @julusian/midi are compiled
     * for whatever machine ran `npm ci`, so an x64 runner asked to emit an
     * arm64 package produces an installer that opens and never finds the unit.
     * Two jobs, each building only for itself, is what makes the Raspberry Pi
     * download real. A list here would quietly undo that.
     */
    const target = linux.slice(linux.indexOf('target:'))
    assert.ok(
      !/arch:/.test(target.slice(0, target.indexOf('\ndeb:') === -1 ? undefined : target.indexOf('\ndeb:'))),
      'the Linux target names architectures, so one runner will cross-build a package whose device layer cannot load'
    )

    /* No shell syntax in the script, for the same reason dist:win has none. */
    const scripts = JSON.parse(read('desktop/package.json')).scripts
    assert.ok(!/[$][{]/.test(scripts['dist:linux']), 'dist:linux carries shell syntax, which npm runs through its own shell')

    /*
     * AND THE ARM BUILD HAS A PACKAGER IT CAN ACTUALLY RUN.
     *
     * electron-builder shells out to fpm to make a .deb, and the copy it
     * downloads is published for linux-x86 only — there is no arm64 build of
     * it. On the arm runner the AppImage finishes, the .deb starts, and a
     * 32-bit x86 Ruby meets an arm64 kernel: "cannot execute binary file".
     * fpm is a gem, so installing it and pointing app-builder at PATH fixes
     * it; that is what the arm-only step does.
     *
     * THE FLAG HAS TO BE EXPORTED FROM THAT STEP, not set on Package with a
     * conditional value, and this is the part worth holding. app-builder
     * checks whether USE_SYSTEM_FPM is PRESENT and never reads its value, so
     * the natural `${{ ... || '' }}` spelling gives x64 an empty string that
     * still means yes — and x64 then hunts for an fpm nobody installed. The
     * variable must not exist there at all.
     */
    const wfL = read('.github/workflows/desktop.yml')
    const linuxJob = (() => {
      const at = wfL.indexOf('\n  linux:\n')
      assert.notEqual(at, -1, 'the linux job is gone')
      const next = wfL.slice(at + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
      return next === -1 ? wfL.slice(at) : wfL.slice(at, at + 1 + next)
    })()
    assert.match(linuxJob, /gem install --no-document fpm/, 'nothing installs fpm, so the arm .deb cannot be built at all')
    assert.match(
      linuxJob,
      /echo "USE_SYSTEM_FPM=true" >> "\$GITHUB_ENV"/,
      'the system-fpm switch is not exported from the step that installs it, so the two can disagree'
    )
    /* Real YAML lines only — the paragraph above spells the bad form out in
       prose, and a naive search finds its own explanation. */
    const setsAsEnv = linuxJob
      .split('\n')
      .map((line) => line.trim())
      .some((line) => !line.startsWith('#') && line.startsWith('USE_SYSTEM_FPM:'))
    assert.ok(
      !setsAsEnv,
      'USE_SYSTEM_FPM is set as a step env — an empty value there still reads as ON, and x64 would look for an fpm it never installed'
    )
    /* And the install is arm-only: x64's bundled fpm works and needs no gem. */
    const fpmStep = linuxJob.slice(linuxJob.indexOf('- name: A packager that runs on this machine'))
    assert.match(
      fpmStep.slice(0, fpmStep.indexOf('- name: Package')),
      /if: matrix\.arch == 'arm64'/,
      'the fpm install is not limited to arm64, so the x64 build grew a dependency it does not need'
    )
  })

  test('every gear photograph says why we may use it, and names who took it', async () => {
    /*
     * "All the amp/cabs/drive photos have been uploaded to GitHub so you can
     * get those wired up."
     *
     * THE FIRST BATCH OF TWO HUNDRED WAS THROWN AWAY, and this is what it was
     * thrown away over. 123 of those records were a photograph of some OTHER
     * piece of gear standing in — a Bandmaster filed as a Bassman, a Vox AC15
     * filed as an AC20 — and roughly 71 came from retailers under a claimed
     * "fair use editorial", which does not survive a paid app.
     *
     * So two rules, both held here rather than remembered:
     *
     *   A photograph without a rights_url does not ship. Every one of these is
     *   Creative Commons, and CC BY and CC BY-SA both require the photographer
     *   be named wherever the picture appears — so a row that cannot say who
     *   took it is a row we cannot legally show.
     *
     *   A slug must name gear this app actually has. That is the check that
     *   catches the wrong-gear failure from the other end: a photograph filed
     *   under a name no model carries is one nobody thought about, and six of
     *   the second batch were exactly that.
     */
    const csv = read('public/gear/sources.csv').trim().split(/\r?\n/)
    const cols = csv[0].split(',')
    for (const want of ['slug', 'source_url', 'rights_url', 'copyright_holder', 'licence']) {
      assert.ok(cols.includes(want), `sources.csv no longer records ${want}`)
    }
    const rows = csv.slice(1).filter(Boolean).map((line) => {
      const v = line.split(',')
      return Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? '').trim()]))
    })
    assert.ok(rows.length > 0, 'there are no gear photographs at all')

    for (const r of rows) {
      assert.ok(r.rights_url, `${r.slug}: no rights_url, so nothing says why we may use it`)
      assert.ok(r.copyright_holder, `${r.slug}: nobody is named as the photographer`)
      /*
       * Retailers, forums and image searches are never a source. This is the
       * substance of the cull rather than a list of hostnames for its own
       * sake: those photographs belong to somebody who has not licensed them
       * to anybody, whatever the page they sit on implies.
       */
      const src = `${r.source_url} ${r.rights_url}`.toLowerCase()
      for (const never of ['thomann', 'andertons', 'sweetwater', 'guitarcenter', 'reverb.com', 'ebay.', 'google.com/imgres', 'pinterest']) {
        assert.ok(!src.includes(never), `${r.slug}: sourced from ${never}, which has not licensed it to us`)
      }
    }

    /* Every slug reaches real gear, by the same family rule the app matches
       with — a photograph filed under a name nothing carries is invisible, and
       invisible is how a wrong one survives review. */
    const slugify = (n) =>
      String(n)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    const names = []
    for (const f of ['src/data/amp-types.json', 'src/data/cab-types.json', 'src/data/drive-types.json']) {
      for (const m of JSON.parse(read(f))) names.push(slugify(m.name))
    }
    for (const r of rows) {
      assert.ok(
        names.some((n) => n === r.slug || n.startsWith(`${r.slug}-`)),
        `${r.slug}: names no model in the catalog, so this photograph can never appear`
      )
    }

    /* And the generated copy the app imports agrees with the record. A photo
       list that drifts from the licence list is one showing pictures whose
       terms nobody checked. */
    const photos = JSON.parse(read('src/data/gear-photos.json'))
    assert.deepEqual(
      Object.keys(photos).sort(),
      rows.map((r) => r.slug).sort(),
      'src/data/gear-photos.json is stale — run `npm run gear:photos`'
    )
    for (const [slug, p] of Object.entries(photos)) {
      assert.ok(p.holder && p.rights, `${slug}: the generated entry lost its attribution`)
      assert.ok(existsSync(new URL(`../public/gear/${p.file}`, import.meta.url)), `${slug}: names a file that is not there`)
    }

    /*
     * AND THE CREDIT CANNOT BE RENDERED WITHOUT THE PICTURE OR THE OTHER WAY
     * ROUND. photoFor hands back both in one object precisely so there is no
     * shape of this that draws an image with no attribution; this holds the
     * screen to using it that way.
     */
    const { photoFor } = await import('../src/lib/gearPhotos.js')
    const one = photoFor('1959SLP Treble')
    assert.ok(one?.src && one?.credit && one?.rights, 'photoFor no longer returns the credit with the picture')
    assert.equal(photoFor('Recto2 Orange Vintage'), null, 'a model with no photograph is being given one')
    assert.equal(photoFor(''), null)
    assert.equal(photoFor(), null, 'photoFor throws rather than answering for a missing name')

    const console_ = read('src/components/Console.jsx')
    assert.match(console_, /chosenPhoto\.src/, 'the screen never shows a photograph')
    assert.match(console_, /chosenPhoto\.credit/, 'the screen shows a photograph without naming the photographer')
  })

  test('the one-paste installers are gone, and stay gone', async () => {
    /*
     * "I think that we should just drop the helpers completely. Nobody wants
     * to deal with that kind of stuff in order for it to work."
     *
     * WHAT THIS GUARDS IS A GOOD IDEA THAT WAS NEVER A ROUTE. Two scripts in
     * `public/` let somebody paste one line into a shell and have the device
     * server built from source — which reads like the expert's shortcut, and
     * was in fact the opposite. They fetched three private repositories, so
     * the first `git fetch` failed for everybody on earth without a token,
     * and the printed steps had to say "ask Justin for one" out loud.
     *
     * A route whose opening instruction is to email the author costs a reader
     * their time before it admits it cannot help them. The three apps carry
     * the same server inside them, vendored at build time, and cover every
     * computer this runs on — so the download IS the tokenless version, and
     * there is nothing here to go back and finish.
     *
     * The files, the routes and the commands go together. Leaving any one of
     * them is how a dead end gets rebuilt by somebody reading the leftovers
     * as a plan.
     */
    for (const gone of ['public/mac.sh', 'public/windows.ps1']) {
      assert.ok(!existsSync(new URL(`../${gone}`, import.meta.url)), `${gone} is back`)
    }

    const src = read('shared/ways-in.mjs').replace(/\/\*[\s\S]*?\*\//g, ' ')
    for (const word of ['HELPER_SH', 'HELPER_PS1', 'mac.sh', 'windows.ps1']) {
      assert.ok(!src.includes(word), `ways-in.mjs still names ${word}`)
    }

    /*
     * AND NOTHING ASKS A STRANGER FOR A TOKEN. This is the substance of it
     * rather than the filenames: whatever routes exist, none may open by
     * requiring a credential only the author can hand out.
     *
     * Read off the routes rather than out of the file, because the paragraph
     * above explains the token in order to say why it is gone — and a search
     * of the source finds that explanation and calls it the crime. The same
     * trap comments have sprung here before; this reads the data instead.
     */
    const { WAYS } = await import('../shared/ways-in.mjs')
    const words = WAYS.flatMap((w) => [w.title, w.note, ...(w.steps || [])]).join(' ')
    assert.ok(
      !/FORGEFX_TOKEN|ask Justin|GitHub token/i.test(words),
      'a connect route asks for a token again, which is a wall rather than a route'
    )
  })


  test('a JS change can reach a phone without spending a build', () => {
    /*
     * THERE WAS NO WAY TO DO THIS AT ALL, which is the gap this closes.
     * mobile.yml could build and submit and nothing else, so every JavaScript
     * change since the last build — the debug log, the feedback forms, the
     * connect screen, the fixes guide — sat in main with no route onto a
     * handset short of spending one of a handful of iOS build slots.
     *
     * `eas update` costs nothing and is safe in a way a build is not, because
     * app.json pins runtimeVersion to the `fingerprint` policy: Expo hashes
     * everything native and an update only reaches a build whose hash matches.
     * A native change moves the hash and older builds never see the update
     * rather than downloading something they cannot run.
     */
    const wf = read('.github/workflows/mobile.yml')
    assert.match(wf, /\n {2}update:\n/, 'there is no way to publish an update')

    /* The fingerprint policy is what makes the above true. If it ever became
       appVersion or a literal, an update could land on a build whose native
       side does not match it. */
    const appJson = JSON.parse(read('mobile/app.json')).expo
    assert.equal(
      appJson.runtimeVersion?.policy,
      'fingerprint',
      'the runtime version is no longer a fingerprint, so an update could reach a build it does not fit'
    )

    /*
     * AND TICKING "UPDATE" MUST NOT ALSO START A BUILD. The two jobs run off
     * the same dispatch, and a workflow that quietly did both would spend the
     * thing this exists to avoid spending — on a repository where iOS build
     * slots are counted in single figures per month.
     */
    const jobIf = (name) => {
      const at = wf.indexOf(`\n  ${name}:\n`)
      assert.notEqual(at, -1, `the ${name} job is gone`)
      const line = wf.slice(at).match(/\n {4}if: (.+)/)
      return line ? line[1] : ''
    }
    assert.match(jobIf('build'), /!inputs\.update/, 'ticking update would also start a build')
    assert.match(jobIf('update'), /inputs\.update/, 'the update job is not gated on the update input')

    /*
     * And it proves the generated copies are current before publishing.
     * mobile/src/lib is generated from shared/ at the repository root, and an
     * update carrying a stale copy is exactly the drift sync:rules exists to
     * prevent — published straight onto a phone, where it is hardest to see.
     */
    const job = wf.slice(wf.indexOf('\n  update:\n'))
    assert.match(job, /npm run sync:rules/, 'the update job does not regenerate the shared copies')
    assert.match(job, /git diff --exit-code/, 'the update job would publish a stale generated copy')

    /* Both channels by default: which one an installed app listens to depends
       on the profile it was built with, and nobody should have to remember. */
    assert.match(wf, /default: both/, 'the update no longer goes to both channels by default')
    for (const channel of ['production', 'preview']) {
      assert.ok(job.includes(channel), `the update job never mentions the ${channel} channel`)
    }

    /*
     * AND IT HAPPENS BY ITSELF, which is the half that was missing. The job
     * existed and was gated on somebody opening this workflow and ticking a
     * box. Nobody ever did, so a handset sat on the version it was installed
     * at while thirty changes went past it — "The android app is still on
     * 3.171. It's supposed to be doing updates, right?"
     */
    assert.match(job, /github\.event_name == 'push'/, 'an update is published only when somebody remembers to ask')
    assert.match(wf, /\n {2}push:\n {4}branches: \[main\]/, 'nothing lands on main to publish from')
    assert.match(job, /needs: check/, 'a bundle that does not build could be published to a phone')

    /*
     * AND A PUSH CAN NEVER START A BUILD. This is the one that costs money if
     * it is ever wrong: main is pushed several times a day, iOS build slots
     * are counted in single figures a month, and the whole reason this
     * workflow was dispatch-only was to keep those two facts apart. The
     * update job now fires on a push, so the gate on the build job is no
     * longer a formality — it is the only thing standing between a merge and
     * a spent slot.
     */
    assert.match(
      jobIf('build'),
      /github\.event_name == 'workflow_dispatch'/,
      'a push to main can now start an iOS build, which is a build slot per merge'
    )
  })

  test('the Mac app is published when main moves, and never from a pull request', () => {
    /*
     * "When you make an update on phone versions, they need to make it on the
     * web version and Mac app as well, which I think that those are running
     * the same web app versions anyways."
     *
     * SAME CODE, NOT THE SAME COPY. The browser gets the new bundle from
     * Vercel the moment main moves. The Mac app serves `dist/` from INSIDE
     * the packaged app — `process.resourcesPath/dist` in desktop/main.js — so
     * it carries whatever web app it was built with, and nothing reaches that
     * machine until a new one is published.
     *
     * Nobody had published one. This built on pull requests and on a
     * `desktop-v*` tag, and published only from a tag or a ticked box, so the
     * last release went out at 7.372.0 while the browser and the phone moved
     * on without it. electron-updater was working the whole time and had
     * nothing to find.
     */
    const wf = read('.github/workflows/desktop.yml')
    assert.match(wf, /\n {2}push:\n {4}branches: \[main\]/, 'the desktop app is no longer built when something lands on main')
    assert.match(wf, /tags: \['desktop-v\*'\]/, 'the release tag no longer builds anything')

    /*
     * EVERY PUBLISH GATE AGREES. There are four — the Mac's signed package,
     * Windows signed and unsigned, and Linux — and a release is assembled from
     * all of them. One left behind does not publish a smaller release; it
     * publishes one missing the platform somebody is on.
     */
    const gates = [...wf.matchAll(/PUBLISH: >-\n([\s\S]*?)\n\s+(?:GH_TOKEN|run:)/g)].map((m) =>
      m[1].replace(/\s+/g, ' ').trim()
    )
    assert.equal(gates.length, 4, `expected four publish gates, found ${gates.length}`)
    for (const gate of gates) {
      assert.ok(
        gate.includes("github.event_name == 'push'") && gate.includes("github.ref == 'refs/heads/main'"),
        `a publish gate does not fire when main moves: ${gate}`
      )
    }

    /*
     * AND NONE OF THEM CAN FIRE FROM A PULL REQUEST. This is the one that
     * costs something if it is ever wrong: `createRelease` does not send a
     * commit to tag, so GitHub tags the default branch's head — a release
     * published from a branch would carry main's name and somebody else's
     * code, and electron-updater would hand it to every Mac on launch.
     *
     * The guard is allowed to be on the step or inside the expression; what
     * is held is that one of them is there.
     */
    const steps = wf.split(/\n      - name: /).slice(1)
    let checked = 0
    for (const step of steps) {
      if (!step.includes('PUBLISH: >-')) continue
      checked++
      const body = step.replace(/\s+/g, ' ')
      assert.ok(
        body.includes("github.event_name != 'pull_request'"),
        `a step publishes without ruling out a pull request: ${body.slice(0, 60)}`
      )
    }
    assert.equal(checked, 4, `expected four publishing steps, checked ${checked}`)
  })

  test('an APK is built able to take the updates that are published', () => {
    /*
     * "The android app is still on 3.171. It's supposed to be doing updates,
     * right? For small changes without having to do any build?"
     *
     * It was, and it could not, and nothing anywhere said so. The app asked
     * Expo for an update every launch and was never going to be handed one,
     * because `expo prebuild` writes the updates URL and stops — the rest is
     * normally EAS Build's job, and this APK is built by gradle on an
     * ordinary runner precisely so it costs nothing.
     *
     * TWO PIECES WERE MISSING FROM EVERY APK THIS HAS EVER PRODUCED.
     *
     *   The runtime version. `runtimeVersion.policy` is `fingerprint`, which
     *   prebuild renders as the literal `file:fingerprint` — a sentinel
     *   telling expo-updates to read the real hash out of an asset called
     *   `fingerprint`. Nothing in a bare gradle build writes that asset, the
     *   read threw, and the whole updates configuration was invalid.
     *
     *   The channel. An update is published to a branch and an app says which
     *   branch it wants with an `expo-channel-name` header. EAS injects it
     *   from eas.json. A sideloaded APK had none, so even a correct
     *   fingerprint would have asked a question with no answer.
     *
     * Neither belongs in app.json: that file is hashed into the fingerprint,
     * so putting them there would move the number and cut off every installed
     * copy in order to fix the thing that stops installed copies being cut
     * off.
     */
    const apk = read('.github/workflows/apk.yml')
    const at = apk.indexOf('Make it able to take updates')
    assert.notEqual(at, -1, 'the APK is built unable to take an update again')
    const step = apk.slice(at, apk.indexOf('\n      - name:', at + 1))

    assert.match(step, /fingerprint\.json/, 'the runtime version is not the one updates are published under')
    assert.match(
      step,
      /printf '%s' "\$hash" > android\/app\/src\/main\/assets\/fingerprint/,
      'the fingerprint asset is written with a trailing newline, which is a different string from the one published'
    )
    assert.match(step, /expo-channel-name/, 'the APK asks for an update without saying which branch')
    assert.match(step, /preview/, 'the channel is not the one a directly-installed build is on')

    /* Written after prebuild, or prebuild overwrites both of them. */
    assert.ok(
      apk.indexOf('expo prebuild') < at,
      'the updates config is written before prebuild, which then overwrites it'
    )
  })

  test('the unit is asked what firmware it is running, at both ends', async () => {
    /*
     * "I have another app I'm building called axiom... it definitely pulls the
     * firmware version so I'm not sure why you can't do it. It's basically the
     * same app."
     *
     * It was right, and what this app had written down was wrong. There was no
     * firmware anywhere on any screen, and the reason given was that nothing
     * this talks to carries one — an assumption that had never been checked,
     * stated as a fact about the protocol.
     *
     * The host carries it. This end was asking `/device/detect`, which answers
     * with the capabilities rather than the whole unit, and stopping there.
     * The other app asks `/device` as well and merges the two, which is all
     * that was ever between this app and a firmware version.
     *
     * BEST-EFFORT ON PURPOSE. The capabilities decide what every screen is
     * allowed to draw and are already in hand by then; the firmware is one
     * line on a Setup page. A host too old to answer the second question must
     * cost that line and never the connection, so the failure is swallowed and
     * the unit still detects.
     */
    for (const [where, file] of [
      ['the browser', 'src/lib/forgefx.js'],
      ['the phone', 'mobile/src/lib/device.js']
    ]) {
      const code = read(file).replace(/\s+/g, ' ')
      assert.match(code, /\/device\/detect/, `${where} no longer detects the unit at all`)
      /* The browser calls it `request` and the phone `remoteRequest`, so the
         match is on the path with a call bracket in front of it rather than on
         either name. */
      assert.match(code, /equest\('\/device'\)/, `${where} asks only for the capabilities, so it can never see a firmware version`)
      assert.match(code, /firmwareOf\(/, `${where} reads the firmware field raw rather than through the shared reader`)
      assert.match(code, /\} catch \{ return res \}/, `${where} would fail to detect a unit because the firmware read failed`)
    }

    /*
     * And the detect payload wins on anything both endpoints answer. `/device`
     * is the looser of the two and a second opinion about the grid is the kind
     * of drift that shows up as a chain drawn one row short.
     */
    const web = read('src/lib/forgefx.js').replace(/\s+/g, ' ')
    assert.match(web, /\{ \.\.\.whole, \.\.\.res, firmware:/, 'the looser payload now overrides the capabilities every screen is built from')

    /*
     * NOTHING IS INVENTED FOR A UNIT THAT DID NOT SAY. A simulated unit has no
     * firmware, a host too old to report one has nothing to report, and a host
     * that answers with a dash is saying it does not know. All three are the
     * same answer and all three draw nothing — a version number under a
     * simulated FM3 would be the confident wrong fact this project refuses
     * everywhere else.
     */
    const { firmwareOf } = await import('../shared/firmware.mjs')
    assert.equal(firmwareOf({ firmware: '27.01' }), '27.01')
    assert.equal(firmwareOf({ firmware: { version: '27.01' } }), '27.01', 'an object-shaped version is not read')
    assert.equal(firmwareOf({ fw: '8.02' }), '8.02', 'the short spelling is not read')
    for (const nothing of [{}, null, undefined, { firmware: '' }, { firmware: '—' }, { firmware: 'unknown' }]) {
      assert.equal(firmwareOf(nothing), null, `${JSON.stringify(nothing)} is being drawn as a firmware version`)
    }

    /* The demo says nothing, because a simulation has no firmware to report.
       Asked of the mock rather than grepped out of its source: the file
       mentions the word in a comment about stored preset names, and a test
       that reads comments is a test that fails on prose. */
    const { createMockDevice } = await import('../src/lib/mockDevice.js')
    for (const unit of ['fm3', 'am4', 'vp4']) {
      assert.equal(
        firmwareOf(createMockDevice(unit).detect()),
        null,
        `the demo invents a firmware version for a simulated ${unit}`
      )
    }

    /* And both screens draw it only when there is one. */
    /* Either bracket: the browser's fits on one line and opens a tag, the
       phone's wraps and opens a paren. What is held is the guard. */
    assert.match(read('src/components/DeviceDetail.jsx'), /\{firmware \? [(<]/, 'the browser draws a firmware line for a unit that never reported one')
    assert.match(read('mobile/src/screens/Settings.js'), /\{firmware \? [(<]/, 'the phone draws a firmware line for a unit that never reported one')
  })

  test('the phone icon is one Apple will accept, and the others keep their alpha', () => {
    /*
     * "The app icon can't contain alpha channels or transparencies" is an
     * automated rejection: it happens before a human opens the build, and it
     * costs a submission round trip to learn.
     *
     * The artwork is a rounded square filled #0d0f12, so only its four corners
     * were clear — enough to fail. It is rendered opaque for iOS now, which is
     * right because iOS applies its own corner mask to a full square anyway.
     *
     * THE OTHER THREE MUST KEEP THEIR TRANSPARENCY, which is why this is not
     * simply "no alpha anywhere". Android's adaptive icon is a foreground
     * layer the system masks itself, so filling its corners would put a dark
     * square inside Android's circle. The splash mark sits on the splash
     * colour. macOS does not mask app icons at all and wants the rounded
     * shape.
     */
    const png = (p) => readFileSync(new URL(`../${p}`, import.meta.url))
    const head = (b) => ({
      width: b.readUInt32BE(16),
      height: b.readUInt32BE(20),
      /* IHDR colour type: 4 and 6 carry an alpha channel, 0/2/3 do not. */
      alpha: b[25] === 4 || b[25] === 6
    })

    const ios = head(png('mobile/assets/icon.png'))
    assert.equal(ios.width, 1024, 'the iOS icon is not 1024 wide')
    assert.equal(ios.height, 1024, 'the iOS icon is not 1024 tall')
    assert.equal(ios.alpha, false, 'the iOS app icon has an alpha channel, which Apple rejects outright')

    for (const rel of ['mobile/assets/adaptive-icon.png', 'mobile/assets/splash-icon.png']) {
      assert.equal(head(png(rel)).alpha, true, `${rel} lost its transparency, which it needs`)
    }

    /* And the generator says which is which, so a regeneration cannot quietly
       put the alpha back. */
    const gen = read('scripts/icon.mjs')
    assert.match(gen, /opaque: true/, 'the icon script no longer renders any output opaque')
    assert.match(gen, /omitBackground: !out\.opaque/, 'the icon script ignores its own opaque flag')
  })

  test('a store has somewhere to send people, and the app can be reviewed without hardware', () => {
    /*
     * Two things App Store Connect will not proceed without, and one that
     * decides whether the review succeeds.
     *
     * A support URL is required. And the reviewer will have no Fractal unit
     * and no computer running the device server — they open the app, see "no
     * computer", and reject it as non-functional. The demo is one tap away on
     * the first screen, but only if the review notes say so.
     */
    const support = read('public/support.html')
    assert.match(support, /justinnewbold@gmail\.com/, 'the support page offers no way to reach anybody')
    assert.match(support, /Feedback/, 'the support page never points at the in-app report')
    assert.match(support, /privacy\.html/, 'the support page does not link the privacy policy')

    /* Linked both ways, so somebody landing on either finds the other. */
    assert.match(read('public/privacy.html'), /notices\.txt/, 'the privacy page does not link the licences')

    const store = read('docs/app-store.md')
    assert.match(store, /support\.html/, 'the store notes give no support URL')
    assert.match(store, /privacy\.html/, 'the store notes give no privacy URL')

    /*
     * THE REVIEW NOTE, checked against the actual button. If somebody renames
     * that button, the instruction handed to Apple becomes wrong and this
     * fails rather than the submission.
     */
    const signIn = read('mobile/src/screens/SignIn.js')
    const label = signIn.match(/label="(Just looking\?[^"]*)"/)
    assert.ok(label, 'the demo button on the sign-in screen has been renamed or removed')
    assert.ok(
      store.includes(label[1]),
      `the review notes tell Apple to tap "…" but the button now says "${label[1]}"`
    )
    assert.match(store, /Review notes/, 'there are no review notes at all')
  })

  test('the app says whose it is not, everywhere somebody would look', async () => {
    /*
     * "Leave the name, but add a disclaimer that we are in no way affiliated
     * or endorsed by Fractal Audio Systems."
     *
     * Keeping "Fractal" in the name of a paid app makes this the sentence that
     * matters, and the version of it that matters is whichever one somebody's
     * lawyer happens to read. So there is one string and four places show it,
     * rather than four hand-typed copies that drift — a disclaimer saying three
     * different things in three places reads as carelessness about exactly the
     * point it is making.
     *
     * It is also inherited rather than invented: the preset codec is
     * Apache-2.0 and its NOTICE carries the same statement about its own
     * author, which section 4(d) requires we pass on.
     */
    const { AFFILIATION, NOT_AFFILIATED, TRADEMARKS } = await import('../shared/affiliation.mjs')

    /* The words themselves have to do the job. "Independent" alone is a
       positioning word; the disclaimer is the part about endorsement. */
    assert.match(NOT_AFFILIATED, /in no way affiliated with, endorsed by, or sponsored by/)
    assert.match(NOT_AFFILIATED, /Fractal Audio Systems/)
    assert.match(TRADEMARKS, /trademarks of Fractal Audio Systems/)
    assert.ok(AFFILIATION.includes(NOT_AFFILIATED) && AFFILIATION.includes(TRADEMARKS))

    /* Both apps show it, from the shared string rather than a copy. */
    for (const [where, file] of [
      ['the browser', 'src/App.jsx'],
      ['the phone', 'mobile/src/screens/Settings.js']
    ]) {
      const src = read(file)
      assert.match(src, /import \{ AFFILIATION \}/, `${where} does not import the shared disclaimer`)
      assert.match(src, /\{AFFILIATION\}/, `${where} imports the disclaimer and never shows it`)
    }

    /* The generated notices take it from the same place. */
    assert.match(read('scripts/notices.mjs'), /NOT_AFFILIATED, TRADEMARKS/, 'the notices generator keeps its own copy')
    assert.ok(read('NOTICES.md').includes(NOT_AFFILIATED), 'the notices file does not carry the disclaimer')

    /*
     * And the privacy page, which is static HTML and cannot import — so it
     * carries the words and this holds the two to each other. Compared with
     * the typographic quotes normalised, because the page writes them as
     * entities and the module writes them as characters.
     */
    const plain = (s) =>
      s
        .replace(/&ldquo;|&rdquo;/g, '“')
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
    const page = plain(read('public/privacy.html'))
    assert.ok(page.includes(plain(NOT_AFFILIATED)), 'the privacy page no longer matches the shared disclaimer')
    assert.ok(page.includes(plain(TRADEMARKS)), 'the privacy page no longer matches the shared trademark line')
  })

  test('the privacy policy describes what the app actually does', () => {
    /*
     * A store will not take a paid app without a privacy policy at a URL, and
     * a policy that is wrong is worse than the missing one it replaced —
     * it is a published claim nobody checked.
     *
     * SO THIS IS TIED TO THE CODE RATHER THAN TO A MEMO. The set of tables the
     * apps write to is read out of the source here; if a new one appears, this
     * fails until somebody has decided what the policy says about it. That is
     * the whole mechanism — it does not know what is private, it refuses to
     * let the question go unasked.
     *
     * It was written by reading that set rather than from memory, which is how
     * `rig_lookups` turned out to be a table the app had stopped writing to
     * when the tone builder came out: dead code whose test still passed.
     */
    const policy = read('public/privacy.html')

    const sources = [...walk(new URL('../src/', import.meta.url))]
      .concat([...walk(new URL('../mobile/src/', import.meta.url))])
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')

    /* `.from('x')` and `.from(TABLE)` with a const above it: both are used. */
    const tables = new Set()
    for (const m of sources.matchAll(/\.from\('([a-z_]+)'\)/g)) tables.add(m[1])
    for (const m of sources.matchAll(/const TABLE = '([a-z_]+)'/g)) tables.add(m[1])

    assert.deepEqual(
      [...tables].sort(),
      ['feedback', 'stage_lists'],
      'the apps write to a table the privacy policy has never been checked against'
    )

    /* And each of those is described, in the words a person would search for
       rather than the table's name. */
    assert.match(policy, /setlist/i, 'nothing is said about the setlists that sync')
    assert.match(policy, /[Bb]ug reports? and suggestions|Something is broken/, 'nothing is said about reports')
    assert.match(policy, /email address/i, 'nothing is said about the account')

    /*
     * THE LEAD, because it is the true and reassuring thing and it is what most
     * people do: on your own wifi, nothing leaves the room.
     */
    assert.match(policy, /sends nothing anywhere|nothing leaves the room/i, 'the policy buries the local-mode answer')

    /* No analytics, said plainly — and true, which is checked rather than
       claimed. A tracking SDK arriving later fails this. */
    assert.match(policy, /[Nn]o analytics and no tracking/, 'the policy does not say there is no tracking')
    for (const sdk of ['@sentry', 'mixpanel', 'amplitude', 'posthog', 'segment', 'react-ga']) {
      for (const manifest of ['package.json', 'mobile/package.json']) {
        assert.ok(
          !JSON.stringify(JSON.parse(read(manifest)).dependencies || {}).includes(sdk),
          `${manifest} installs ${sdk}, and the privacy policy claims there is no analytics`
        )
      }
    }

    /* The two things a regulator and a store both look for. */
    assert.match(policy, /justinnewbold@gmail\.com/, 'there is no way to ask for deletion')
    assert.match(policy, /children|under 13/i, 'nothing is said about children')

    /* And the debug log, which is the one thing here somebody might be
       surprised by — so the policy has to be straight about when it goes and
       that a suggestion never carries one. */
    assert.match(policy, /debug log/i, 'the log is not mentioned at all')
    assert.match(policy, /never/, 'the policy does not say a suggestion never carries the log')

    /*
     * Reachable from inside both apps. A policy at a URL nobody can find from
     * the thing it describes satisfies a form and nobody else.
     */
    assert.match(read('src/App.jsx'), /privacy\.html/, 'the browser never links its privacy policy')
    assert.match(read('mobile/src/screens/Settings.js'), /privacy\.html/, 'the phone never links its privacy policy')
    for (const [where, src] of [
      ['the browser', read('src/App.jsx')],
      ['the phone', read('mobile/src/screens/Settings.js')]
    ]) {
      assert.match(src, /notices\.txt/, `${where} never links the licences it ships under`)
    }
  })

  test('the licences of what we ship travel with it', () => {
    /*
     * THIS IS THE ONE THAT BECOMES A PROBLEM ONLY ONCE MONEY IS INVOLVED, which
     * is why it was missing: the app has been free and private, and neither
     * licence has ever been shipped anywhere.
     *
     * The desktop apps bundle two separate projects and they are not under the
     * same terms. ForgeFX is MIT — its copyright notice "shall be included in
     * all copies or substantial portions" — and we put a copy inside a signed
     * installer. forgefx-midi is Apache-2.0, which asks for three things: the
     * licence, the contents of its NOTICE file (section 4(d)), and prominent
     * notices stating that we changed the files (section 4(b)). We changed
     * both, heavily.
     *
     * So this checks that the texts are present and that the generated file
     * carries them, rather than that somebody remembered.
     */
    for (const [file, mustSay] of [
      ['licences/forgefx-MIT.txt', /MIT License/],
      ['licences/forgefx-midi-APACHE-2.0.txt', /Apache License/],
      ['licences/forgefx-midi-NOTICE.txt', /Apache License, Version 2\.0/]
    ]) {
      const text = read(file)
      assert.ok(text.trim().length > 200, `${file} is empty or a stub`)
      assert.match(text, mustSay, `${file} is not the licence it claims to be`)
      /* A licence with its copyright line stripped is the one failure mode
         that looks fine and satisfies nothing. */
      assert.match(text, /Copyright/i, `${file} has lost its copyright line`)
    }

    /* Section 4(b): say what we changed. The lock file records every change
       with the symptom that caused it; this is the notice that points at it. */
    const mods = read('licences/MODIFICATIONS.md')
    assert.match(mods, /forgefx-midi/, 'the modifications notice does not mention the codec')
    assert.match(mods, /Apache-2\.0 requires it|section 4\(b\)|Section 4\(b\)/, 'nothing says why the notice exists')
    for (const branch of ['claude/address-one-host', 'claude/huffman-guard']) {
      assert.ok(
        read('desktop/forgefx.lock.json').includes(branch),
        `the lock no longer pins ${branch}, so MODIFICATIONS.md describes something we do not ship`
      )
    }

    /*
     * And the generated file carries all of it. Checked by content rather than
     * by regenerating: the walk reads node_modules, which differs between a
     * machine that has vendored the device server and one that has not, so a
     * byte-for-byte staleness check would fail for a reason that is not a
     * fault.
     */
    const notices = read('NOTICES.md')
    assert.match(notices, /MIT License/, 'the notices file carries no MIT licence')
    assert.match(notices, /Apache License/, 'the notices file carries no Apache licence')
    assert.match(notices, /Stephen Staker/, "the codec's copyright holder is not named")
    assert.match(notices, /sKuhLight/, "the server's copyright holder is not named")

    /*
     * The trademark line, which is the upstream author's own and now ours. An
     * app sold under a name that includes somebody else's mark says plainly
     * that it is not theirs.
     */
    /* The wording itself is held by `the app says whose it is not` below,
       against shared/affiliation.mjs. Here it is only that the notices file
       carries a disclaimer at all — matched on the part of the sentence that
       is doing the work rather than on its opening words, which have already
       changed once. */
    assert.match(
      notices,
      /affiliated with, endorsed by, or sponsored by/i,
      'nothing disclaims affiliation with Fractal Audio Systems'
    )

    /*
     * EVERY PLACE THAT INSTALLS SOMETHING A USER RECEIVES, and the desktop
     * shell is the one that was missed: `desktop/package.json` brings
     * bonjour-service and electron-updater into the signed installer and
     * neither appeared in the first generated file. Electron itself is a
     * devDependency that ships anyway.
     */
    const gen = read('scripts/notices.mjs')
    for (const manifest of ['package.json', 'desktop/package.json', 'mobile/package.json']) {
      assert.ok(gen.includes(`'${manifest}'`), `the notices generator never walks ${manifest}`)
    }
    assert.match(notices, /### Electron/, 'Electron ships inside the apps and is not named')
    assert.match(notices, /serialport/, 'the compiled USB addon is not named')

    /* And it is reachable as a plain URL, which is what a store listing and an
       About screen can both be given. `public/` is served at the site root. */
    assert.ok(read('public/notices.txt').length > 1000, 'there is no plain-text copy to link to')
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
