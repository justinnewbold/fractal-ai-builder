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
import { readdirSync, readFileSync, statSync } from 'node:fs'
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

  test('the two one-paste installers are real files, and say the same things', async () => {
    /*
     * "Create terminal helper scripts — a shell script for Mac and a
     * PowerShell one for Windows — that print connection status and the local
     * URL."
     *
     * ONE OF THE TWO ALREADY EXISTED, which is worth writing down because it
     * was nearly missed. `public/windows.ps1` had been written, is referenced
     * by MISSING_FORGEFX in host.mjs, and does more than the brief asked: it
     * fetches the app as well as the server and finishes by running
     * `npm run serve`, so the page and the device API are the same origin and
     * a phone scans a QR instead of signing in. A second Windows script was
     * written beside it and thrown away; what shipped was the Mac counterpart
     * that had been the actual gap.
     *
     * So what this holds is the pair. Two files, two platforms, the same
     * decisions — because the way they FAIL is where they would drift, and a
     * person meeting a missing token on one platform should read what the
     * other would have said.
     */
    const ways = await import('../shared/ways-in.mjs')
    const commands = ways.WAYS.filter((w) => w.command)
    assert.equal(commands.length, 2, 'there are not two one-paste installers')

    const scripts = []
    for (const way of commands) {
      /* The command is in the steps too, in reading order, and the screens
         tell it apart from the prose by matching this exact string. */
      assert.ok(way.steps.includes(way.command), `${way.id} names a command it never shows`)

      /*
       * THE RULE THIS HOLDS is that the app never prints a command that does
       * not work. The URL is taken apart and the file it points at has to
       * exist in this repository — `public/` is copied to the root of the
       * deployed site, so a file there is reachable at that address.
       */
      const url = way.command.match(/https:\/\/\S+/)
      assert.ok(url, `${way.id}'s command fetches nothing`)
      const path = url[0].replace('https://fractal.newbold.cloud/', 'public/')
      assert.notEqual(path, url[0], `${way.id} fetches from somewhere that is not this site`)
      /* Throws, loudly and by filename, if the app prints a URL for a file
         nobody wrote. */
      const script = read(path)

      /* And the file says the same line at the top of itself, so the two
         cannot drift and leave a working script nobody can find. */
      assert.ok(
        script.includes(way.command),
        `${path} does not begin with the command the app tells people to paste`
      )
      scripts.push([path, script])
    }

    for (const [path, script] of scripts) {
      /*
       * A TOKEN, AND SAYING SO BEFORE ANYTHING IS DOWNLOADED. The three
       * repositories are private; there is no tokenless version of this route.
       * Both scripts stop on a missing token with the same sentence rather
       * than letting git fail with "could not read Username for
       * 'https://github.com'", which sends people to look at everything except
       * the token.
       */
      assert.match(script, /FORGEFX_TOKEN/, `${path} never mentions the token it cannot work without`)
      assert.match(script, /A GitHub token is needed/, `${path} does not stop on a missing token with the shared wording`)
      assert.match(
        script,
        /credential\.helper/,
        `${path} no longer passes the token through a credential helper, so it can end up in .git/config and in git's error messages`
      )
      assert.ok(
        !/https:\/\/[^\s'"]*\$\{?(FORGEFX_)?[Tt]oken/.test(script),
        `${path} puts the token in a URL, where git writes it into .git/config`
      )

      /* Node 20 exactly, because the device server carries compiled USB and
         MIDI code built against it. Both scripts check before cloning
         anything — an evening spent on a clone that cannot build is the
         failure this prevents. */
      assert.match(script, /Node 20/, `${path} never says which Node it needs`)

      /* Siblings, not nested: the server depends on the codec by relative
         path, and flattening the layout makes that link dangle. */
      assert.match(script, /forgefx-midi/, `${path} never fetches the codec the server needs`)
      /* Pinned by commit, read from the lock file the Mac build also reads. */
      assert.match(script, /forgefx\.lock\.json/, `${path} picks its own versions instead of the pinned ones`)
      assert.match(script, /FETCH_HEAD/, `${path} no longer checks out the commit it asked for`)

      /* And it ends by serving, which is what makes this local mode rather
         than a bare server somebody still has to sign in to reach. */
      assert.match(script, /run.{0,3} serve/, `${path} sets everything up and never starts it`)

      /* The two things that are silent when wrong: the firewall prompt, and
         something else already holding the USB port. */
      assert.match(script, /firewall|incoming connections/i, `${path} never warns about the firewall prompt`)
      assert.match(script, /Axe-Edit/, `${path} never says to quit the editor that holds the port`)
    }

    /* And the connect screen says the token part before somebody pastes a
       line and watches it stop. */
    for (const way of commands) {
      assert.match(
        way.steps.join(' '),
        /token/i,
        `${way.id} sends somebody at a command that will stop on a token it never mentioned`
      )
    }

    /*
     * The shell one is served, not run from a checkout, so it carries no
     * shebang and needs no executable bit — `curl … | bash` names the shell.
     * What it does need is to be safe when the download is cut off: piping
     * into bash feeds the shell as it arrives, so a dropped connection would
     * otherwise run the first half of a setup script. Everything lives in a
     * function and the call is the last line, so a truncated file does
     * nothing at all.
     */
    const mac = read('public/mac.sh')
    assert.match(mac, /^fractal_remote_setup\(\) \{/m, 'mac.sh is not wrapped in a function')
    assert.match(mac.trimEnd(), /fractal_remote_setup$/, 'mac.sh does not call itself on its last line, so a truncated download would run half of it')
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
    assert.match(support, /Tell us/, 'the support page never points at the in-app report')
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
