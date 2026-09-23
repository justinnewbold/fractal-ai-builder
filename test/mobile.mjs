/**
 * The phone apps, and the three ways they can quietly stop agreeing with
 * everything else.
 *
 * None of what is checked here is visible in a screenshot, and all of it is
 * fatal on a stage. A phone that signs into a different project than the Mac
 * never finds it and cannot say why. A phone whose allowlist has drifted from
 * the host's either refuses something that works or promises something that
 * doesn't. And a phone that decodes a gzip frame wrongly reports "your Mac
 * didn't answer" about a Mac that answered perfectly.
 *
 * The mobile app is not importable by node — it is JSX and React Native — so
 * these read the source where they have to, exactly as structure.mjs does for
 * App.jsx, and import the plain modules where they can.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from '@babel/parser'
import babelTraverse from '@babel/traverse'

/* CommonJS interop: @babel/traverse's default export is on `.default` under
   some resolutions and is the module itself under others. */
const traverse = babelTraverse.default || babelTraverse

/**
 * What a phone actually has without importing it.
 *
 * Deliberately a LIST rather than a rule. Every name here was read off the app
 * as it stands and kept because it is real; anything new has to be added on
 * purpose, which is the whole point — the failure this guards against looks
 * exactly like a global nobody has heard of.
 *
 * `window` and `localStorage` are on it because three of the modules the phone
 * carries are copies of the browser's, and each of them reaches for those
 * inside a try. The phone has neither, which is why the try is there.
 */
const PHONE_GLOBALS = new Set([
  'AbortController', 'Array', 'Boolean', 'Date', 'Error', 'Event', 'Infinity', 'JSON', 'Map',
  'Math', 'NaN', 'Number', 'Object', 'Promise', 'RegExp', 'Set', 'String', 'Symbol',
  'TextDecoder', 'TextEncoder', 'Uint8Array', 'WeakMap', 'WeakSet',
  'cancelAnimationFrame', 'clearInterval', 'clearTimeout', 'console', 'decodeURIComponent',
  'encodeURIComponent', 'fetch', 'globalThis', 'isNaN', 'localStorage', 'parseFloat', 'parseInt',
  'requestAnimationFrame', 'setInterval', 'setTimeout', 'undefined', 'window'
])

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/**
 * A file's CODE, without the prose around it.
 *
 * Every rule worth writing down here is a rule some comment in the app
 * explains — and explaining a rule means NAMING the thing it forbids. A
 * file-wide grep for the forbidden thing then matches the sentence that
 * forbids it, and the file fails for documenting itself.
 *
 * The tour is the case in hand: its own header says why a phone must never
 * be told to press Save, and a check for "press Save" matched that sentence.
 */
const withoutComments = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** Every .js under a directory, so a new screen cannot quietly opt out. */
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
    else if (/\.js$/.test(entry)) yield path.replaceAll('\\', '/')
  }
}

export function run(test) {
  /**
   * A unit that answers like an FM3 and never touches a port.
   *
   * Records every call in order, because the ORDER is most of what these tests
   * are about — a tone written in the wrong sequence produces a preset nobody
   * asked for without a single error.
   */
  const fakeUnit = (over = {}) => {
    const calls = []
    const unit = {
      calls,
      presetBlocks: async () => [
        { effectId: 100, name: 'Amp 1', slug: 'amp', bypassed: false, channel: 'A' }
      ],
      blockParams: async (eid) => {
        calls.push(`read:${eid}`)
        return { named: [{ id: 1, name: 'Gain', value: 5, min: 0, max: 10 }] }
      },
      blockTypes: async () => [],
      setChannel: async (eid, ch) => calls.push(`channel:${eid}:${ch}`),
      setType: async (eid, t) => calls.push(`type:${eid}:${t}`),
      setBypass: async (eid, b) => calls.push(`bypass:${eid}:${b}`),
      setParamConfirmed: async (eid, id, to) => {
        calls.push(`param:${eid}:${id}:${to}`)
        return { ok: true }
      },
      getScene: async () => ({ index: 0 }),
      setScene: async (i) => calls.push(`scene:${i}`),
      setSceneName: async (i, n) => calls.push(`sceneName:${i}:${n}`),
      selectPreset: async (n) => calls.push(`select:${n}`)
    }
    return { ...unit, ...over, calls }
  }

  
  test('eas.json puts the Apple team where EAS accepts it, and nowhere else', () => {
    /*
     * A build was told to stop asking for the Apple Team ID, and the team was
     * written into every iOS BUILD profile. EAS does not have that field
     * there, and it does not shrug:
     *
     *   eas.json is not valid.
     *   - "build.preview.ios.appleTeamId" is not allowed
     *   - "build.production.ios.appleTeamId" is not allowed
     *
     * That killed every build of both platforms, because `eas init` validates
     * the whole file before anything else runs — so an iOS-shaped mistake
     * took Android down with it. It reached main, which is the part worth a
     * test: the file parses as JSON perfectly well, so nothing local objected.
     *
     * The team belongs under `submit`, where it already was, and the build
     * gets its team from the credentials instead.
     */
    const eas = JSON.parse(read('mobile/eas.json'))

    for (const [name, profile] of Object.entries(eas.build || {})) {
      for (const platform of ['ios', 'android']) {
        assert.ok(
          !(profile?.[platform] || {}).appleTeamId,
          `build.${name}.${platform}.appleTeamId is not a field EAS allows; the team goes under submit`
        )
      }
    }

    /* And it is still where it belongs, so this cannot be "fixed" by deleting
       the team outright. */
    assert.equal(
      eas.submit?.production?.ios?.appleTeamId,
      '3KA9RC7YE6',
      'the Apple team is missing from the submit profile, so a submission cannot say who it is from'
    )
  })

  
  
  
  
  
  
  
  
  
  test('the phone and the browser share every rule they must agree on, character for character', async () => {
    /*
     * The web app imports these directly; the phone gets a generated copy,
     * because Metro would otherwise have to reach outside mobile/ and an EAS
     * build that uploads only that directory would fail on a build machine
     * minutes in. The copy is only safe while this passes.
     *
     * It is four files now rather than one. The relay allowlist was the first —
     * allowing something the host refuses turns a friendly sentence into a bare
     * status code mid-song. The generation rules joined it when the phone
     * learned to build a tone: a handset validating by looser rules than the
     * Mac is a handset writing something the Mac would have refused, into a rig
     * somebody is about to play.
     */
    const { state } = await import('../scripts/sync-relay-rules.mjs')
    const files = state()
    assert.ok(files.length >= 7, `only ${files.length} files are kept in step; the tone rules are not among them`)
    for (const file of files) {
      const name = file.target.replace('../', '')
      assert.ok(file.copyText !== null, `${name} does not exist — run \`npm run sync:rules\``)
      assert.equal(file.copyText, file.expected, `${name} is stale — run \`npm run sync:rules\``)
    }

    /* And the safety rules are actually among them, by name. A list that
       quietly lost validate.js would still pass the loop above. */
    const targets = files.map((f) => f.target)
    for (const needed of [
      'play-mode.js',
      'guardrails.js',
      'validate.js',
      'tone-steps.js',
      'relay-rules.js',
      'scale.js',
      'encoding.js'
    ]) {
      assert.ok(
        targets.some((t) => t.endsWith(needed)),
        `${needed} is no longer kept in step between the two apps`
      )
    }
  })

  test('the phone signs into the project the computer hosts on', () => {
    const url = (text) => text.match(/url:\s*'([^']+)'/)?.[1]
    const key = (text) => text.match(/anonKey:\s*\n?\s*'([^']+)'/)?.[1]

    const mac = read('desktop/lib/project.mjs')
    const phone = read('mobile/src/lib/project.js')

    assert.ok(url(mac), 'the computer project url moved')
    assert.equal(url(phone), url(mac), 'the phone would sign into a different project than the computer')
    assert.equal(key(phone), key(mac), 'the phone carries a different key than the computer')
  })

  test('never a service-role key on a phone', () => {
    /*
     * The anon key is meant to sit in plain sight; a service role key bypasses
     * every RLS policy on the project, and one shipped inside an app bundle is
     * public the moment the first person installs it.
     */
    for (const file of walk(new URL('../mobile/src/', import.meta.url))) {
      const text = readFileSync(file, 'utf8')
      assert.ok(
        !/service_role/.test(text),
        `${file.split('/mobile/')[1]} mentions a service-role key`
      )
    }
  })

  test('the decoder is tested against the versions the app ships', () => {
    /*
     * The decoder needs two small libraries, and the suite that checks it needs
     * them too — `npm ci` at the root installs only what the root declares, and
     * mobile/node_modules is a different install that CI has no reason to have
     * made. The check below therefore imported packages that were not there,
     * and turned green only on a machine where somebody had run `npm install`
     * inside mobile/. It merged red.
     *
     * So the root carries them as dev dependencies. Which is fine right up
     * until the two sides are bumped apart, at which point this suite is
     * checking a decoder the phone does not ship. They are pinned together
     * here rather than left to good intentions.
     */
    const root = JSON.parse(read('package.json'))
    const phone = JSON.parse(read('mobile/package.json'))

    for (const name of ['base64-js', 'fflate']) {
      const wanted = phone.dependencies?.[name]
      assert.ok(wanted, `the phone no longer depends on ${name}`)
      assert.equal(
        root.devDependencies?.[name],
        wanted,
        `the root tests ${name}@${root.devDependencies?.[name]} while the phone ships ${wanted}`
      )
    }
  })

  test('the phone decodes every framing the host sends', async () => {
    /*
     * Imported through the root's own copies of the two libraries — pinned to
     * the phone's by the check above.
     *
     * Hermes has no atob, no Blob and no DecompressionStream, so the browser's
     * decoder throws on a phone — and it throws inside the request that asked,
     * which surfaces as "your Mac didn't answer" about a Mac that answered.
     * Gzip is not the rare case: the host compresses anything over a couple of
     * KB, which is every block list, grid and roster.
     */
    const { decode } = await import('../mobile/src/lib/decode.mjs')
    const { gzipSync } = await import('node:zlib')

    assert.equal(await decode({ encoding: 'utf8', body: '{"ok":true}' }), '{"ok":true}')

    const bytes = await decode({ encoding: 'base64', body: Buffer.from([1, 2, 3]).toString('base64') })
    assert.deepEqual(Array.from(bytes), [1, 2, 3])

    const big = JSON.stringify({ blocks: Array.from({ length: 200 }, (_, i) => ({ eid: i })) })
    const gz = gzipSync(Buffer.from(big, 'utf8')).toString('base64')
    assert.equal(await decode({ encoding: 'gzip', body: gz }), big)
  })

  test('the preset list reads one slot at a time, and an empty one reads as empty', async () => {
    /*
     * TWO THINGS, and the first is the one that would hurt on stage.
     *
     * Asking what slot 412 is called makes the unit read that preset off its
     * own hardware — relay-rules counts `/presets/{n}` among the SLOW_READS for
     * exactly that reason. The relay is one channel to one Mac holding one
     * serial port, so twenty reads fired at once do not arrive sooner; they sit
     * in a queue that the tuner, the scene change and every other press then
     * wait behind. The screen must ask for the rows in view, one at a time,
     * never in a loop over every slot.
     *
     * This is checked by reading the screen rather than running it, the way
     * structure.mjs reads App.jsx: a `for` over the slot count calling the
     * reader would be the bug, and it is visible in the source.
     *
     * The second is the ordinary one: a slot nobody has saved into has to read
     * the same here as it does in the header, which is what unit.mjs already
     * decides for the loaded preset.
     */
    const screen = read('mobile/src/screens/Presets.js')
    /*
     * The queue moved out of the screen and into lib/presetNames when a second
     * screen needed the names — the setlist sheet shows tonight's running order
     * by name. Two caches would ask the unit for the same slot twice, which is
     * the thing this test exists to stop, so the check follows the queue rather
     * than the screen it used to live in.
     */
    const names = read('mobile/src/lib/presetNames.js')

    assert.match(names, /const queue = \[\]/, 'the preset names are no longer queued')
    assert.match(
      names,
      /while \(queue\.length && interest > 0\)/,
      'the name reader no longer drains one at a time while somebody is looking'
    )
    assert.match(
      names,
      /await presetName\(n\)/,
      'the name reader no longer awaits each read before starting the next'
    )
    assert.ok(
      !/Promise\.all/.test(names),
      'the name reader fires reads together, which queues them behind each other at the computer'
    )
    assert.ok(
      !/for\s*\([^)]*slots[^)]*\)[^{]*\{[^}]*presetName/.test(screen + names),
      'the preset list reads every slot in a loop, which makes the unit dump every preset over serial'
    )
    assert.match(
      screen,
      /onViewableItemsChanged/,
      'the preset list no longer asks only for the rows on screen'
    )
    /*
     * AND IT GIVES BACK WHAT SCROLLED PAST. Asking for every row it ever saw
     * and never taking one back is what made the app unusable and then killed
     * it: a flick from slot 0 to 512 queued five hundred preset dumps at the
     * unit, ten to twenty minutes of solid reading, with the chain, the scene
     * and the tuner all waiting behind them for names nobody was looking at.
     */
    assert.match(
      screen.replace(/\s+/g, ' '),
      /wantOnly\(viewableItems\.map\(\(v\) => v\.item\)/,
      'the preset list queues every row it scrolls past and never takes one back'
    )
    assert.match(names, /for \(const n of queue\.splice\(0\)\) asked\.delete\(n\)/, 'rows that scrolled off are left queued at the unit')

    /* And the device call itself agrees with the header about an empty slot. */
    const device = read('mobile/src/lib/device.js')
    assert.match(
      device,
      /isEmptySlotName\(name\)/,
      'presetName does not mark an empty slot, so the list and the header disagree'
    )
    assert.match(device, /cleanPresetName\(name\)/, 'presetName returns the raw name the unit gave')
  })

  test('the phone reads an empty slot the same way the browser does', async () => {
    /*
     * `<EMPTY>` is written over the front of the previous name rather than
     * clearing it, so the old preset's tail hangs off the end. Two apps showing
     * a slot differently is two apps, and the one being read from a stand is
     * this one.
     */
    const { presetLabel, isEmptySlotName: phoneEmpty } = await import('../mobile/src/lib/unit.mjs')
    const names = await import('../src/lib/presetName.js')

    for (const raw of ['<EMPTY>k Album Chug', '  <empty> ', 'Lead Tone', '', 'Empty Room Verb']) {
      assert.equal(phoneEmpty(raw), names.isEmptySlotName(raw), `disagreed that "${raw}" is empty`)
      assert.equal(
        presetLabel({ name: raw }),
        names.presetLabel({ name: raw }),
        `disagreed about "${raw}"`
      )
    }
  })

  test('a slot the unit does not have is never stepped onto', async () => {
    /*
     * The web app once answered "how many slots?" with `?? 512` — the gen-3
     * number, and a guess about somebody else's hardware. A phone stepped
     * toward slot 500 on a unit holding 104 and was refused every six seconds.
     */
    const { slotCount, stepSlot } = await import('../mobile/src/lib/unit.mjs')
    const slots = await import('../src/lib/slots.js')

    const am4 = { presets: { count: 104 } }
    const unsaid = { presets: {} }

    assert.equal(slotCount(am4), slots.slotCount(am4))
    assert.equal(slotCount(unsaid), slots.slotCount(unsaid), 'a unit that has not said must not be guessed at')

    assert.equal(stepSlot(103, 1, am4), null, 'stepped off the end of the unit')
    assert.equal(stepSlot(0, -1, am4), null, 'stepped below the first slot')
    assert.equal(stepSlot(12, 1, am4), 13)
    // A unit that never reported a count is given the benefit of the doubt,
    // the same way slotOutside does — refusing every step would turn a rare
    // wrong slot into a feature that never works.
    assert.equal(stepSlot(400, 1, unsaid), 401)
    assert.equal(stepSlot(null, 1, am4), null)
  })

  test('the four blocks that are not stage controls are hidden on the phone too', async () => {
    const { EXCLUDED_BLOCKS } = await import('../mobile/src/lib/unit.mjs')
    const guard = await import('../src/lib/guardrails.js')
    assert.deepEqual(EXCLUDED_BLOCKS, guard.EXCLUDED_BLOCKS)
  })

  test('the phone backs off exactly the way the browser does', async () => {
    // link.js imports react-native, so it is read rather than imported.
    const text = read('mobile/src/lib/link.js')
    const web = read('src/lib/link.js')
    const num = (t, name) => Number(t.match(new RegExp(`${name} = (\\d+)`))?.[1])

    for (const name of ['PROBE_FIRST', 'PROBE_CAP', 'KEEPALIVE']) {
      assert.ok(Number.isFinite(num(web, name)), `${name} moved in the web app`)
      assert.equal(
        num(text, name),
        num(web, name),
        `${name} disagrees, so the two apps decide a computer is gone at different moments`
      )
    }
  })

  test('nothing pressable on a stage is smaller than a thumb', () => {
    /*
     * These are pressed in the dark, at arm's length, sometimes mid-song.
     * Apple's 44pt floor is a minimum for a phone held six inches from a face,
     * which is not where this one is.
     */
    const theme = read('mobile/src/lib/theme.js')
    const tap = Number(theme.match(/export const TAP = (\d+)/)?.[1])
    assert.ok(tap >= 56, `TAP is ${tap}; a stage control needs 56 or more`)

    const press = read('mobile/src/components/Press.js')
    assert.match(press, /minHeight: height/, 'the one button component stopped enforcing a height')
    assert.match(press, /height = TAP/, 'the default button height is no longer the stage minimum')
  })

  test('the app says nothing about how it works', () => {
    /*
     * The same rule the web app's link copy is held to. A player does not have
     * a channel, a relay or an account service; they have a Mac and a unit, and
     * a sentence naming any of the first three is a sentence that cannot be
     * acted on.
     */
    const jargon = /supabase|realtime|websocket|\brelay\b|\bchannel\b|anon key|\buid\b|forgefx/i
    /*
     * ONE SCREEN MAY SAY ForgeFX, and only that word, and only there.
     *
     * Connect.js is the page that tells somebody what to install. On the
     * terminal route ForgeFX is not jargon, it is the NAME OF THE THING — the
     * repository they have to go and find. A page that described it without
     * naming it would be a page nobody could follow.
     *
     * Everything else in the list still applies to it, so the screen cannot use
     * the carve-out to start talking about relays and channels, and no other
     * screen gets it at all.
     */
    const installer = /supabase|realtime|websocket|\brelay\b|\bchannel\b|anon key|\buid\b/i
    for (const file of walk(new URL('../mobile/src/screens/', import.meta.url))) {
      const text = readFileSync(file, 'utf8')
      /*
       * Comments and import specifiers are not shown to anyone. The rule is
       * about what a player reads, and `../lib/relay` is a file path.
       */
      const shown = text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
        .replace(/^import[\s\S]*?from\s+'[^']+'/gm, ' ')
      for (const [, line] of shown.matchAll(/'([^'\n]{12,})'/g)) {
        // "Channel A" is the unit's own word for a block channel, and the one
        // a player reads off the hardware.
        if (/^Channel [A-D]$/.test(line) || /channel \$\{/i.test(line)) continue
        const rule = file.endsWith('/screens/Connect.js') ? installer : jargon
        assert.ok(!rule.test(line), `${file.split('/mobile/')[1]}: "${line}"`)
      }
    }
  })

  test('the phone cannot ask for anything the computer refuses', async () => {
    /*
     * Both ends read the same rule, so this is really a check that the phone
     * asks for things inside it — a route that looks reasonable and is refused
     * is a dead button discovered on a stage.
     */
    const rules = await import('../shared/relay-rules.mjs')
    const device = read('mobile/src/lib/device.js')

    const gets = [...device.matchAll(/remoteRequest\('([^']+)'\)/g)].map((m) => m[1])
    const posts = [...device.matchAll(/post\(`?'?([^'`,)]+)'?`?/g)].map((m) => m[1])

    assert.ok(gets.length >= 5 && posts.length >= 5, 'the device layer moved; this check reads it')

    for (const path of gets) {
      assert.equal(rules.forbiddenRemotely('GET', path), null, `GET ${path} is refused remotely`)
    }
    for (const raw of posts) {
      // Template holes stand in for an effect id the unit reported.
      const path = raw.replace(/\$\{eid\}/g, '7')
      assert.equal(rules.forbiddenRemotely('POST', path), null, `POST ${path} is refused remotely`)
    }
  })

  test('a save is still refused, and says so in words', async () => {
    const rules = await import('../shared/relay-rules.mjs')
    assert.equal(rules.forbiddenRemotely('POST', '/preset/store'), 'save to a slot')
    assert.equal(rules.forbiddenRemotely('GET', '/backup/list'), null, 'a backup list is a read the host serves')
    assert.equal(rules.forbiddenRemotely('POST', '/backup'), 'back up the device')
  })

  test('the phone stores nothing it should be asking the computer for', () => {
    /*
     * localStorage was the wrong shape for a fact the Mac learns and the phone
     * needs, and AsyncStorage is the same shape. Only two things are kept in
     * the relay: the account session, which is the account library's own
     * business, and which Mac to drive, which is a choice about this handset.
     *
     * Setlists and stars are the exception and are kept somewhere else on
     * purpose — lib/store, under a `fractal.` prefix. They are not facts about
     * the rig that could go stale; they are a night's running order, and the
     * point of them is that they are the same on the phone and at the Mac,
     * which lib/cloudSetlists sees to through the account.
     */
    const relay = read('mobile/src/lib/relay.js')
    const keys = [...relay.matchAll(/AsyncStorage\.(?:get|set)Item\(([^),]+)/g)].map((m) => m[1].trim())
    assert.deepEqual([...new Set(keys)], ['HOST_KEY'], 'the phone started keeping device state locally')
  })

  test('the phone and the computer file a setlist under the same unit', async () => {
    /*
     * THE FAILURE THIS STOPS IS SILENT, which is why it is worth a test that
     * looks slightly paranoid.
     *
     * Setlists and stars are kept per unit, and "per unit" means per THIS
     * STRING. Two apps that derive it differently do not disagree loudly —
     * each keeps a full, correct set of setlists in a bucket the other never
     * opens. The sync between them has nothing to match on and carries
     * nothing, and the result is a Mac with tonight's running order on it and
     * a phone insisting there isn't one. It survives a reinstall and looks
     * exactly like a sync that is broken.
     *
     * So the rule lives in shared/device-slug.mjs and neither app is allowed
     * its own copy of it.
     */
    const { deviceSlug, DEFAULT_SLUG } = await import('../shared/device-slug.mjs')

    assert.equal(deviceSlug({ short: 'FM3', name: 'Fractal FM3' }), 'fm3', 'the short name wins')
    assert.equal(deviceSlug({ name: 'Axe-Fx III' }), 'axefxiii', 'punctuation is not part of the key')
    assert.equal(deviceSlug('AM4'), 'am4', 'a label already pulled out works too')
    /* A unit that answered without naming itself still has setlists worth
       keeping, so the fallback is a real bucket rather than null. */
    assert.equal(deviceSlug(null), DEFAULT_SLUG)
    assert.equal(deviceSlug({ short: '!!!' }), DEFAULT_SLUG, 'a name with no letters is not an empty key')

    const forgefx = read('src/lib/forgefx.js')
    assert.match(forgefx, /deviceSlug\(label\)/, 'the browser stopped using the shared rule')
    assert.ok(
      !/toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]/.test(forgefx),
      'the browser is deriving the unit key itself again, so the two apps can drift apart'
    )

    const rig = read('mobile/src/lib/rig.js')
    assert.match(rig, /deviceSlug\(caps\)/, 'the phone is not deriving the unit key from the shared rule')
  })

  test('a setlist decides what Previous and Next walk, through a storage that answers at once', async () => {
    /*
     * TWO THINGS AT ONCE, and they are the same thing.
     *
     * The first is the running order: inside a setlist the two buttons follow
     * the list and WRAP, because after the last song a set comes back round to
     * the first. Slot by slot has no such order, so it stops.
     *
     * The second is the reason lib/store exists. Every one of these functions
     * is called while a screen is being drawn — `orderFor` decides what the
     * buttons walk during the stage screen's render — so the storage they are
     * handed has to answer immediately. AsyncStorage does not. This drives the
     * shared module through a storage of exactly the shape lib/store presents,
     * which is the contract that makes the phone's copy work at all.
     */
    const setlists = await import('../mobile/src/lib/setlists.js')

    const m = new Map()
    const store = {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k)
    }

    /* Nothing saved reads as nothing, not as an error — which is also what a
       store that has not finished reading the disk yet answers. */
    assert.deepEqual(setlists.listsFor('fm3', store), [])
    assert.equal(setlists.sourceFor('fm3', store), setlists.ALL)
    assert.equal(setlists.orderFor(setlists.ALL, {}), null, 'slot by slot is not an order')

    const list = setlists.createList('fm3', 'Friday', store)
    setlists.updateList('fm3', list.id, { presets: [10, 20, 30] }, store)
    setlists.setSource('fm3', list.id, store)

    assert.equal(setlists.sourceFor('fm3', store), list.id)
    assert.equal(setlists.sourceLabel(list.id, { lists: setlists.listsFor('fm3', store) }), 'Friday')

    const lists = setlists.listsFor('fm3', store)
    const step = (current, delta) => setlists.stepTarget({ source: list.id, current, delta, lists })
    assert.equal(step(10, 1), 20)
    assert.equal(step(30, 1), 10, 'the last song of a set does not come back round to the first')
    assert.equal(step(10, -1), 30, 'Previous from the first song does not reach the last')
    /* On a preset that is not in the list at all, Next is the first song —
       which is what somebody choosing a setlist mid-song wanted anyway. */
    assert.equal(step(415, 1), 10)
    assert.equal(setlists.positionIn([10, 20, 30], 20), 2)

    /* And an empty list is a button with nothing to do, not a button that
       guesses. */
    setlists.updateList('fm3', list.id, { presets: [] }, store)
    const empty = setlists.listsFor('fm3', store)
    assert.equal(setlists.stepTarget({ source: list.id, current: 10, delta: 1, lists: empty }), null)
  })

  test('no screen on the phone reads a setlist without being told where the bytes are', () => {
    /*
     * The shared modules take their storage as a last argument so the browser
     * can hand them localStorage. A call on the phone that forgets it does not
     * throw — the module falls back to `localStorage`, there isn't one, and it
     * reads as "nothing saved". An empty setlist and a setlist nobody looked up
     * are the same picture, on the one screen where being wrong costs a song.
     *
     * So every screen goes through lib/lists, which binds the storage once.
     */
    const offenders = []
    for (const file of walk(new URL('../mobile/src/screens/', import.meta.url))) {
      const text = readFileSync(file, 'utf8')
      if (/from '\.\.\/lib\/(setlists|presetMarks|setlistMerge)'/.test(text)) {
        offenders.push(file.split('/mobile/').pop())
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'a screen is calling the shared setlist module directly, so it will read an empty storage on a phone'
    )

    const lists = read('mobile/src/lib/lists.js')
    assert.match(lists, /import \{ sync \} from '\.\/store'/, 'lib/lists is not binding the phone storage')
    assert.match(lists, /listsForIn\(device, sync\)/, 'lib/lists is not handing the storage down')
  })

  test('Previous and Next on the phone follow the setlist, and the Setlists button says which', () => {
    /*
     * "Hitting next or previous cycles through songs on the favorites or
     * setlists." The phone's two buttons walked slot numbers, which is the
     * unit's order and never the night's.
     *
     * Both halves matter and the second is the one that goes wrong quietly: a
     * button that STEPS by the setlist but is greyed out by the slot rule
     * refuses the wrap at the end of a set, so the last song of the night has
     * a dead Next.
     */
    const stage = read('mobile/src/screens/Stage.js')

    assert.match(stage, /stepTarget\(\{ source, current: preset\?\.number/, 'the phone still steps slot by slot')
    assert.match(stage, /disabled=\{landing\(-1\) === null\}/, 'Previous is greyed out by a different rule than it steps by')
    assert.match(stage, /disabled=\{landing\(1\) === null\}/, 'Next is greyed out by a different rule than it steps by')
    assert.ok(
      !/disabled=\{stepSlot\(/.test(stage),
      'a step button is still greyed out by the slot rule, so a setlist cannot wrap at the end of the night'
    )

    /* The button between them, and the word above it: a lone "All" reads as a
       caption rather than as the thing that decides what the other two do. */
    assert.match(stage, /caption="Setlists"/, 'nothing on the stage screen says what the buttons walk')
    assert.match(stage, /onPress=\{onOpenSetlists\}/, 'the source button does not open anything')
    assert.match(read('mobile/App.js'), /screen === 'setlists'/, 'there is no setlist screen to open')
  })

  test('finding a control reads the unit once, one block at a time, and never on a whim', () => {
    /*
     * A find box that walks the whole preset is the right feature and the
     * wrong cost if it fires on its own. Reading a block's controls is among
     * the SLOW reads — on an AM4 each one makes the unit dump its preset over
     * serial — and a seven-block preset is seven of them, down one relay to one
     * Mac holding one serial port.
     *
     * So: nothing until two letters are typed, one read at a time, kept
     * afterwards, and a count on screen while it runs. A box that sits silent
     * for ten seconds is a box that looks broken.
     */
    const index = read('mobile/src/lib/paramIndex.js')
    const edit = read('mobile/src/screens/Edit.js')

    assert.match(index, /for \(const block of editable\)[\s\S]{0,200}?await blockParams/, 'the index no longer reads one block at a time')
    assert.ok(!/Promise\.all/.test(index), 'the index fires its reads together, which queues them behind each other at the computer')
    assert.match(index, /if \(cached\?\.key === key\) return cached\.index/, 'the index is rebuilt every time, so every search re-reads the preset')
    assert.match(edit, /if \(text\.trim\(\)\.length < 2 \|\| index\) return/, 'the find box reads the unit before anybody has asked it to')
    assert.match(edit, /Reading block \$\{progress\.done \+ 1\} of \$\{progress\.total\}/, 'the find box says nothing while it reads the whole preset')

    /* And it is thrown away when a different preset is loaded: slot 45's
       Presence is not slot 46's. */
    assert.match(read('mobile/src/lib/rig.js'), /forgetControls\(\)/, 'the control index survives a preset change')

    /* Levels stay off the quick surfaces, the same rule the knob deck holds:
       a level found in a search box and dragged by a finger is the silent
       preset by another route. */
    assert.match(index, /filter\(\(p\) => !isSilencingParam\(p\.name\)\)/)
    assert.match(read('src/lib/paramIndex.js'), /filter\(\(p\) => !isSilencingParam\(p\.name\)\)/)
  })

  test('a preset search says whether it has every name to search', () => {
    /*
     * "Search for Recto preset, but it didn't show it." On a phone that had
     * only read the names it had scrolled past, the search covered those and
     * said "scroll the full list to read more" — which is not how the rest
     * arrive any more: the computer hands them over, and Refresh asks again.
     */
    const flat = read('mobile/src/screens/Presets.js').replace(/\s+/g, ' ')
    assert.match(flat, /knownCount\(\) >= slots \? `Searching all \$\{slots\} names\.`/, 'a complete list still says "read so far"')
    assert.match(flat, /Tap Refresh to get the rest from the computer/, 'an incomplete list does not say how to complete it')
    assert.ok(!/Scroll the full list to read more/.test(flat), 'the search still tells you to scroll for names the computer already has')
    assert.match(flat, /Nothing matches that among the names known so far/, 'a miss on an incomplete list looks the same as a miss on a complete one')
  })

  test('adding a song offers the whole list, a page at a time, and says how much is hidden', () => {
    /*
     * "It stopped at number 41 here, and I couldn't scroll anymore to find
     * more songs." The list was cut at forty rows with nothing on screen to
     * say the rest existed. A cut has to be visible and undoable.
     */
    const flat = read('mobile/src/screens/Setlists.js').replace(/\s+/g, ' ')
    assert.match(flat, /const ADD_PAGE = 40/)
    assert.ok(!/\.slice\(0, 40\)/.test(flat), 'the list is still cut at a bare forty')
    assert.match(flat, /const candidates = offered\.slice\(0, ADD_PAGE \* pages\)/, 'the list does not page')
    assert.match(flat, /const hidden = offered\.length - candidates\.length/)
    assert.match(flat, /label=\{`Show \$\{Math\.min\(ADD_PAGE, hidden\)\} more`\}/, 'there is no way to see the next page')
    assert.match(flat, /sub=\{`\$\{candidates\.length\} of \$\{offered\.length\} shown — or type a name to narrow it`\}/, 'nothing says how many are hidden')
    /* Typing narrows the whole list and starts again from the first page. */
    assert.match(flat, /useEffect\(\(\) => setPages\(1\), \[q, adding\]\)/, 'a new search keeps an old page count')
  })

  test('a tempo the phone just set is not overwritten by a stale re-read', () => {
    /*
     * "After doing tap tempo, if I go to the edit screen and then go back to
     * the main screen, the tap tempo doesn't save." It had saved, on the
     * unit. The main screen re-reads everything when it appears, and the
     * tempo read came back out of the computer's fifteen-second copy of the
     * preset, taken before the taps. A tempo this phone set is held against
     * that for longer than the copy lives.
     */
    const rig = read('mobile/src/lib/rig.js').replace(/\s+/g, ' ')
    assert.match(rig, /export const TEMPO_KEEP_MS = 20 \* 1000/, 'the hold is not longer than the fifteen seconds the copy lives')
    assert.match(rig, /if \(tempoJustSet\(\) && Number\.isFinite\(state\.bpm\) && bpm !== state\.bpm\) return set\(\{ bpm \}\)/, 'a re-read still overwrites a tempo the phone just set')
    /* The read after a burst of taps is the tempo the unit settled on, and
       from then it is held; a typed tempo is held from the moment it is typed. */
    assert.match(rig, /reread = setTimeout\(function settle\(\) \{ if \(!sendTempo\.idle\)/, 'the read after the taps does not start the hold')
    assert.match(rig, /readTappedTempo\(\) \}, TAP_REREAD_MS\)/, 'the read after the taps never happens')
    assert.match(rig, /async function readTappedTempo\(\) \{ tempoSetAt = 0 await refreshTempo\(\) tempoSetAt = Date\.now\(\) \}/, 'the read after the taps is itself blocked by an earlier hold, or does not start one')
    assert.match(rig, /expect\('bpm', bpm\) tempoSetAt = Date\.now\(\)/, 'a typed tempo is not held')
  })

  test('a rename is pending until it is saved, and a preset change drops it', () => {
    /*
     * "I renamed two scenes, then switched to a different preset without
     * saving, and when I went back it still showed those names." The unit
     * had dropped them with its edit buffer; the phone had kept them as if
     * they were the preset's. A rename is pending: a preset change puts the
     * old names back, and only a save that lands sends the new ones to the
     * computer's store.
     */
    const rig = read('mobile/src/lib/rig.js').replace(/\s+/g, ' ')
    assert.match(rig, /unsaved: null,/, 'the store has no idea of an unsaved rename')
    assert.match(rig, /if \(patch\.preset && state\.unsaved && patch\.preset\.number !== state\.unsaved\.number\) \{ patch = \{ \.\.\.patch, unsaved: null \} discardUnsaved\(state\.unsaved\) \}/, 'a preset change keeps an unsaved rename')
    assert.match(rig, /if \(!rememberSceneNames\(device\.nameOwner\(slug\), unsaved\.number, unsaved\.sceneNames\)\) \{ forgetSceneNames\(device\.nameOwner\(slug\), unsaved\.number\) \}/, 'a dropped rename on a slot that had no names leaves the renamed ones on disk')
    assert.match(rig, /if \(typeof unsaved\.presetName === 'string'\) learnName\(unsaved\.number, unsaved\.presetName\)/, 'a dropped preset rename does not put the old name back')
    /* A pending preset name outranks a re-read of the preset, which can come
       out of the computer's copy from before the rename — and the next Save
       carries whatever name the phone holds. */
    assert.match(rig, /if \(fresh && pending && pending\.number === fresh\.number && typeof pending\.presetName === 'string'\) \{ fresh\.name = state\.preset\?\.name \?\? fresh\.name \}/, 'a re-read can put the old preset name back over a pending rename')
    assert.match(rig, /export function savedToSlot\(slot\) \{ const unsaved = state\.unsaved if \(!unsaved \|\| unsaved\.number !== slot\) return const slug = state\.deviceSlug if \(slug\) device\.keepSceneNames\(slug, slot, state\.sceneNames\) set\(\{ unsaved: null \}\) \}/, 'a save does not settle the pending names or send them to the computer')
    assert.ok(!/noteSceneName[\s\S]*?device\.keepSceneNames\(slug, number, names\)/.test(rig.slice(rig.indexOf('export function noteSceneName'), rig.indexOf('function pendingFor'))), 'an unsaved scene name still goes to the computer\'s store')
    /* The save button settles it, and the names section says it is pending. */
    assert.match(read('mobile/src/components/SaveToSlot.js').replace(/\s+/g, ' '), /if \(res\.ok\) savedToSlot\(res\.slot\)/, 'a save that landed does not settle the names')
    const settings = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    assert.match(settings, /const pending = !!unsaved && unsaved\.number === preset\?\.number/)
    assert.match(settings, /Renamed, not saved\. Tap Save to keep the new names\. Changing preset drops them, on the unit and here\./, 'nothing says a rename is not saved yet')
  })

  test('a moved knob counts as unsaved work, the same as a typed name', () => {
    /*
     * "So when I go to edit, the save button is visible and able to be
     * clicked even though there's nothing that I change and nothing to save."
     *
     * The store's unsaved flag only ever knew about NAMES, because a name is
     * the one thing the phone has to remember in order to put it back. A knob
     * needs no remembering — the unit holds it and drops it at the next
     * preset change on its own — so nothing marked the preset as touched when
     * the thing that touched it was a knob, and the Save button had no way to
     * tell an edited preset from an untouched one.
     *
     * One record for both, because a save writes the unit's whole edit buffer:
     * knobs and names are not two kinds of unsaved work, they are one
     * question with one answer.
     */
    const rig = read('mobile/src/lib/rig.js').replace(/\s+/g, ' ')
    assert.match(
      rig,
      /export function noteEdited\(\) \{ const number = state\.preset\?\.number if \(!Number\.isInteger\(number\)\) return const unsaved = pendingFor\(number\)/,
      'there is no way to mark this preset as edited'
    )
    /* The same object back means it is already marked. Setting it again would
       re-render every screen watching it on every knob of a drag. */
    assert.match(rig, /if \(unsaved === state\.unsaved\) return set\(\{ unsaved \}\)/, 'marking an already-marked preset re-renders the screens watching it')

    /*
     * EVERYTHING THAT LANDS IN THE EDIT BUFFER, and nothing that only moves
     * you around the rig. A save that dropped a change somebody just made
     * would be a save that lied, and a Save button that appeared for changing
     * scene would be back to meaning nothing.
     */
    for (const [call, what] of [
      ['export function writeBypass\\(id, bypassed\\) \\{ const was = asWas\\(\\) noteEdited\\(\\)', 'a bypass'],
      ['export function writeChannel\\(id, channel\\) \\{ const was = asWas\\(\\) noteEdited\\(\\)', 'a channel'],
      ['export function beginChainWrite\\(\\) \\{ [^}]*noteEdited\\(\\)', 'a chain move'],
      ['export function writeTempo\\(bpm\\) \\{ const was = state\\.bpm noteEdited\\(\\)', 'a typed tempo']
    ]) {
      assert.match(rig, new RegExp(call), `${what} does not count as unsaved work`)
    }
    /* A tap only counts once it has become a number worth sending. */
    assert.match(rig, /const guess = tappedBpm\(taps\) if \(guess != null\) \{ [^}]*noteEdited\(\)/, 'a tapped tempo does not count as unsaved work')

    /* Moving around the rig is not editing it. */
    const moves = rig.slice(rig.indexOf('export function writeScene(index)'), rig.indexOf('export async function refreshSceneState()'))
    assert.ok(!/noteEdited\(\)/.test(moves), 'changing scene counts as an edit, so Save appears for standing somewhere else')
    const tuner = rig.slice(rig.indexOf('export async function writeTuner(on)'), rig.indexOf('export async function loadPreset(number)'))
    assert.ok(!/noteEdited\(\)/.test(tuner), 'turning the tuner on counts as an edit')

    /* And the screens that write the rest of it. */
    const edit = read('mobile/src/screens/Edit.js').replace(/\s+/g, ' ')
    assert.match(edit, /const res = await setParamConfirmed\(eid, p\.id, next, p\) [^}]*noteEdited\(\)/, 'a knob that landed does not count as unsaved work')
    assert.match(edit, /await setType\(eid, Number\(value\)\) noteEdited\(\)/, 'swapping the model does not count as unsaved work')
    assert.match(edit, /await bindModifier\(Number\(slot\), Number\(eid\), Number\(paramId\), Number\(source\)\) noteEdited\(\)/, 'attaching a modifier does not count as unsaved work')
    assert.match(read('mobile/src/components/Volume.js').replace(/\s+/g, ' '), /const res = await setParamConfirmed\(eid, p\.id, v, p\) [^}]*noteEdited\(\)/, 'the volume does not count as unsaved work')

    /*
     * AND IT ALL GOES AT THE NEXT PRESET CHANGE, which is the honest half of
     * this: the Save button appearing is the only warning that a knob is
     * living in the unit's edit buffer and nowhere else.
     */
    assert.match(rig, /if \(patch\.preset && state\.unsaved && patch\.preset\.number !== state\.unsaved\.number\) \{ patch = \{ \.\.\.patch, unsaved: null \}/, 'an edit survives a preset change, so Save would offer to keep something that is gone')
  })

  test('a chain write is re-read off the unit, and a move the unit did not keep is named', () => {
    /*
     * "When I rearranged the presets with the slider and moved it up, it
     * didn't take, it just put it right back where it was." The re-read
     * after the move came out of the computer's fifteen-second copy of the
     * preset, taken before the move. And if the unit really had not kept
     * it, nothing would have said so.
     */
    const flat = read('mobile/src/screens/Edit.js').replace(/\s+/g, ' ')
    assert.match(flat, /const after = async \(res\) => \{ .*?await dropReadCache\(\) await refreshBlocks\(\{ quiet: true \}\)/, 'the chain is re-read out of the stale copy after a write')
    assert.match(flat, /const astray = moves\.filter\(\(m\) => colOf\(m\) !== m\.to\)/, 'a move is not checked against the unit\'s answer')
    assert.match(flat, /logDebug\('chain', `\$\{m\.block\.name\}: column \$\{m\.from\} → \$\{m\.to\}`/, 'a move leaves nothing in the log')
    assert.match(flat, /The unit did not keep the move: /, 'a move the unit dropped is silent')
    /* Every clear and every placement is logged with the unit's answer, and
       a refusal anywhere in the six is said on screen — a unit that quietly
       ignores a command answers exactly like one that took it. */
    assert.match(flat, /logDebug\('chain', `clear \$\{m\.block\.name\} from column \$\{m\.from \+ 1\}`, said\(r\)\)/, 'a clear is not logged with the unit\'s answer')
    assert.match(flat, /logDebug\('chain', `place \$\{m\.block\.name\} at column \$\{m\.to \+ 1\}`, said\(last\)\)/, 'a placement is not logged with the unit\'s answer')
    assert.match(flat, /The unit answered “refused” to \$\{refused\} of the \$\{answers\.length\} steps\./, 'a refusal in the middle of a move is not said')
    /* Add and Remove check themselves the same way: the unit's own answer,
       off the fresh read, says whether the cell changed. */
    assert.match(flat, /const holds = \(row, col\) => \(getState\(\)\.allBlocks \|\| \[\]\)\.some\(\(b\) => b\.row === row && b\.col === col\)/)
    assert.match(flat, /The unit did not add it: \$\{where\(row, col\)\} is still empty/, 'an add the unit ignored is silent')
    assert.match(flat, /The unit did not remove it: \$\{where\(row, col\)\} still holds a block/, 'a remove the unit ignored is silent')
    /* And a block the unit put somewhere else is named with where it went:
       a wrong row number and a write the unit ignored both leave the asked
       cell empty, and only one of them puts the block in another row. */
    assert.match(flat, /const placeOf = \(eid\) => \(getState\(\)\.allBlocks \|\| \[\]\)\.find\(\(b\) => idOf\(b\) === eid\) \|\| null/, 'nothing looks for a block outside the row it was asked into')
    assert.match(flat, /The unit put it at \$\{where\(put\.row, put\.col\)\} instead\./, 'an add that landed in another row is called ignored')
    assert.match(flat, /if \(put\) return `\$\{m\.block\.name\} is in \$\{where\(put\.row, put\.col\)\}`/, 'a move that landed in another row is called "not in this row"')
    /* And the volume never writes to a block it has not found. */
    const vol = read('mobile/src/components/Volume.js').replace(/\s+/g, ' ')
    /* Both ways in — the drag landing and the − / + nudge — still refuse
       before writing, and both now go through one place that says WHICH of the
       two reasons it is. Counted rather than matched, because one guard
       silently losing its check is the whole failure. */
    assert.equal((vol.match(/if \(!Number\.isInteger\(eid\)\) \{ noOutput\(!!output, onError\) return \}/g) || []).length, 2, 'the volume writes to block "undefined" when the Output block is not known')
  })

  test('a burst of volume presses is confirmed once, and a chain write is not re-read per announcement', () => {
    /*
     * From one log: four presses of + in half a second, each its own
     * write-and-check over the relay, reading back each other's values —
     * "The unit is holding it at +0.8 dB". And a chain move whose six writes
     * each made the unit announce a change, each announcement a 2.7-second
     * dump on the same port, until the screen locked and the pending write
     * came back as "your computer didn't answer".
     */
    const vol = read('mobile/src/components/Volume.js').replace(/\s+/g, ' ')
    assert.match(vol, /writer\.current\.send\(next\) clearTimeout\(settle\.current\.timer\) settle\.current\.timer = setTimeout\(settleNow, NUDGE_SETTLE_MS\)/, 'a press still checks itself on its own')
    assert.match(vol, /if \(settle\.current\.landing\) \{ settle\.current\.again = true return \}/, 'two checks can run at once')
    assert.match(vol, /if \(live\.current\.value !== v\) return if \(!res\.ok\)/, 'a check against a value nobody wants any more can still say didn’t take')
    assert.ok(!/const nudge = async/.test(vol), 'a press waits on its own read-back')

    const rig = read('mobile/src/lib/rig.js').replace(/\s+/g, ' ')
    assert.match(rig, /if \(event\.type === 'scene' \|\| event\.type === 'changed'\) \{ if \(chainWrites\) chainAsked = true else refreshBlocks\(\{ quiet: true \}\) \}/, 'the chain is re-read on every announcement during a chain write')
    assert.match(rig, /export function endChainWrite\(\{ refresh = true \} = \{\}\) \{ if \(!chainWrites\) return chainWrites -= 1 if \(chainWrites\) return const asked = chainAsked chainAsked = false if \(asked && refresh\) refreshBlocks\(\{ quiet: true \}\) \}/, 'announcements held during a write are lost, or read twice')

    const edit = read('mobile/src/screens/Edit.js').replace(/\s+/g, ' ')
    assert.match(edit, /const after = async \(res\) => \{ .*?endChainWrite\(\{ refresh: false \}\) await dropReadCache\(\) await refreshBlocks/, 'the write’s own read does not stand in for the held announcements')
    assert.equal((edit.match(/beginChainWrite\(\)/g) || []).length, 3, 'not every chain write (move, add, remove) is bracketed')
    assert.match(edit, /useKeepAwake\(\)/, 'the Edit screen lets the phone lock mid-write')

    /* A unit mid-switch reports slot -1, and nothing is filed under it. */
    const dev = read('mobile/src/lib/device.js').replace(/\s+/g, ' ')
    assert.match(dev, /export async function storedSceneNames\(slug, number\) \{ .*?number < 0 \|\| demoDevice\(\)\) return null/)
    assert.match(dev, /export function keepSceneNames\(slug, number, names\) \{ if \(!slug \|\| !Number\.isInteger\(number\) \|\| number < 0/)
  })

  test('a failed join closes the socket, the heartbeat is short, and the log says why', () => {
    /*
     * "connected → joining" and then nothing for two and a half minutes, and
     * once for six. A join that failed handed the next attempt the same
     * socket, and a socket that died quietly when the phone changed networks
     * stays dead until a heartbeat finds it out — one every twenty-five
     * seconds by default. Each attempt waited twelve seconds on it and
     * backed off.
     */
    const relay = read('mobile/src/lib/relay.js').replace(/\s+/g, ' ')
    assert.match(relay, /export const HEARTBEAT_MS = 10000/)
    assert.match(relay, /realtime: \{ heartbeatIntervalMs: HEARTBEAT_MS \}/, 'the relay socket keeps the twenty-five second heartbeat')
    assert.match(relay, /await c\.removeChannel\(chan\)\.catch\(\(\) => \{\}\) .*?await c\.realtime\?\.disconnect\?\.\(\)\.catch\?\.\(\(\) => \{\}\) throw err/, 'a failed join hands the next attempt the same dead socket')
    const link = read('mobile/src/lib/link.js').replace(/\s+/g, ' ')
    assert.match(link, /logDebug\('link', `join failed after \$\{Math\.round\(\(Date\.now\(\) - began\) \/ 100\) \/ 10\}s`, err\?\.message \|\| String\(err\)\)/, 'a failed join leaves nothing in the log')
  })

  test('tapping a found control brings the page to the block it opened', () => {
    /*
     * "It'll pull up the parameters but then clicking on it does nothing." It
     * opened the block — under the results and the block tiles, below the
     * keyboard, off the bottom of the screen. So a tap ends the search and
     * scrolls to the block, once the block has laid out and has a position.
     */
    const edit = read('mobile/src/screens/Edit.js')
    const flat = edit.replace(/\s+/g, ' ')

    assert.match(flat, /const pick = \(eid, paramId\) => \{ Keyboard\.dismiss\(\) setQuery\(''\) onPick\(eid, paramId\) \}/, 'a tap on a result leaves the keyboard and the results in the way')
    assert.match(edit, /onPress=\{\(\) => pick\(idOf\(block\), param\.id\)\}/, 'the result rows do not go through pick')
    assert.match(edit, /import \{ Keyboard, /, 'Keyboard is not imported')
    assert.match(edit, /<ScrollView\s+ref=\{page\}/, 'the page has no handle to scroll it by')
    assert.match(flat, /<View onLayout=\{panelLaid\}> <BlockPanel/, 'the block panel does not report where it landed')
    assert.match(flat, /page\.current\?\.scrollTo\(\{ y, animated: true \}\)/, 'nothing scrolls to the opened block')
    /* Only a search tap scrolls: a block opened from its tile is already on screen. */
    assert.match(flat, /if \(focus\?\.nonce\) bringTo\.current = focus\.nonce/)
    assert.match(flat, /if \(!bringTo\.current\) return bringTo\.current = null/)
  })

  test('a unit that cannot attach a modifier is told so in a sentence', async () => {
    /*
     * THE BROWSER GOT THIS WRONG TWICE and both ways are worth pinning.
     *
     * An AM4 serves the modifier list and reports the wire binding
     * unsupported — the data is there, the binding is not. First the guard read
     * a field ForgeFX has never served, so it never fired and the AM4 got
     * exactly the dead Attach button the comment above it said it must not.
     * Then the fix returned nothing at all, which left a heading over blank
     * space: "The modifiers drop down also doesn't show anything."
     *
     * The field is `bindingSupported`, and the answer to a unit that cannot is
     * a sentence.
     */
    const edit = read('mobile/src/screens/Edit.js')

    assert.match(edit, /model\.bindingSupported === false/, 'the phone guards on a field the host does not serve')
    assert.ok(!/\bbindable\b/.test(edit), 'the phone is reading `bindable`, which ForgeFX has never served anywhere')
    assert.match(
      edit,
      /This unit doesn’t let an app attach a modifier/,
      'a unit that cannot bind gets an empty panel rather than a sentence'
    )

    /* `ordinal`, not `value`. A source has never carried a `value`, and reading
       one sent the device a NaN where an ordinal belonged. */
    assert.match(edit, /key: x\.ordinal/, 'the source list is keyed on a field a source does not have')

    /* And both routes are ones the Mac will actually carry out. */
    const rules = await import('../shared/relay-rules.mjs')
    assert.equal(rules.forbiddenRemotely('GET', '/mod/model'), null)
    assert.equal(rules.forbiddenRemotely('POST', '/mod/bind'), null)
  })

  test('both apps count grid columns the same way, and never twice', async () => {
    /*
     * THE TRAP, AND IT HAS ALREADY SPRUNG ONCE. Reads report a block's column
     * counting from zero; the write routes take it counting from one. The old
     * panel added one of its own for a linear unit and then the wire added
     * another, so slot 1 on an AM4 was written to column 2 — and the cells it
     * drew could never line up with the blocks the unit reported.
     *
     * This is worse to get wrong than a knob. A value written to the wrong
     * place sounds wrong and is one drag from right; a block placed in the
     * wrong cell is a preset somebody has to rebuild. And two apps would not
     * argue about it — one of them would simply put things one column along.
     */
    const grid = await import('../mobile/src/lib/grid-plan.js')
    const web = await import('../shared/grid-plan.mjs')

    /* Rows too. The FM3 reports its rows from zero like its columns, and the
       wire takes them from one like FM3-Edit; a chain read on row 1 written
       to row 1 went to the top row, where every clear found an empty cell
       and every placement was quietly declined -- "unit has it at 5" after
       every move on an FM3, with not one step refused. */
    assert.deepEqual(grid.toWireCell(0, 0), { row: 1, col: 1 }, 'the first cell is not row one, column one on the wire')
    assert.deepEqual(grid.toWireCell(1, 5), { row: 2, col: 6 }, 'rows are not shifted with columns')
    assert.deepEqual(grid.toWireCell(1, 0), web.toWireCell(1, 0), 'the two apps disagree about the wire boundary')
    assert.deepEqual(grid.toWireCable(1, 2, 1), { srcRow: 2, srcCol: 3, destRow: 2 }, 'a cable is not shifted like a cell')
    assert.deepEqual(grid.toWireCable(1, 2, 1), web.toWireCable(1, 2, 1), 'the two apps disagree about the cable boundary')
    assert.equal(grid.rowLabel(0), 1, 'the top row is not called row 1')
    const lanes = grid.lanesFor([{ row: 0, col: 3, effectId: 58 }], { grid: { rows: 4, cols: 12 } })
    assert.equal(lanes.length, 4)
    assert.equal(lanes[0].row, 0, 'the top row has no lane')
    assert.equal(lanes[0].blocks.length, 1, 'a block on the top row is drawn nowhere')
    assert.match(read('mobile/src/lib/device.js'), /\.\.\.toWireCable\(srcRow, srcCol, destRow\)/, 'the phone cables with unshifted rows')
    assert.match(read('src/lib/forgefx.js'), /\.\.\.toWireCable\(srcRow, srcCol, destRow\)/, 'the browser cables with unshifted rows')
    assert.match(read('mobile/src/screens/Edit.js'), /Row \$\{rowLabel\(lane\.row\)\}/, 'the phone shows the row as it counts it')
    assert.match(read('src/components/GridEditor.jsx'), /Row \$\{rowLabel\(lane\.row\)\}/, 'the browser shows the row as it counts it')
    assert.match(read('mobile/src/lib/demoWire.js'), /path === '\/preset\/grid\/cell'\) return mock\.placeBlock\(body\?\.row - 1, body\?\.col - 1/, 'the demo does not answer the grid route the phone calls')
    /* And the phone adds it exactly once, at the boundary and nowhere else. */
    const device = read('mobile/src/lib/device.js')
    assert.match(device, /put\('\/preset\/grid\/cell', \{ \.\.\.toWireCell\(row, col\), blockId \}\)/)
    const editor = read('mobile/src/screens/Edit.js')
    assert.ok(
      !/col \+ 1|colLabel\(col\) \+ 1/.test(editor.replace(/\/\*[\s\S]*?\*\//g, ' ')),
      'the chain editor is adding a column of its own on top of the wire boundary'
    )

    /* A linear unit has one row of its own slots; a grid unit has its grid. */
    assert.deepEqual(grid.gridShape({ slotModel: 'linear', slotCount: 4 }), { linear: true, rows: 1, cols: 4 })
    assert.deepEqual(grid.gridShape({ grid: { rows: 4, cols: 14 } }), { linear: false, rows: 4, cols: 14 })

    /* Cables start at the first column and stop at the last one with a next.
       Asking for a cable out of the input was refused on every single build. */
    assert.deepEqual(grid.cableColumns(3), [0, 1, 2, 3])
    assert.equal(grid.cableColumns(99).at(-1), 12)
    assert.ok(!grid.cableColumns(5).includes(-1))
  })

  test('every write is in the log with the unit\'s answer', () => {
    /*
     * "Is the log showing all the edit failures?" It was not: a scene, a
     * bypass, a channel, a model change, a rename, a modifier and a tap of
     * the tempo left no line, so a preset that came out wrong had nothing to
     * point at. Each one is a line now, and a remove, an add, a model change
     * and a save say what the unit shows afterwards, not what it said.
     */
    const writes = read('mobile/src/lib/device.js').replace(/\s+/g, ' ')
    for (const name of ['selectPreset', 'setScene', 'setBypass', 'setChannel', 'setTempo', 'tapTempo', 'setType', 'bindModifier', 'setPresetName', 'setSceneName', 'setCable']) {
      assert.match(writes, new RegExp(`export const ${name} = \\([^)]*\\) => told\\(`), `${name} writes without a line in the log`)
    }
    assert.match(writes, /logDebug\('write', what, r\?\.ok === false \? 'refused' : r\?\.ok === true \? 'ok' : 'no answer'\)/)
    const editor = read('mobile/src/screens/Edit.js')
    assert.match(editor, /after the remove`, holds\(row, col\) \? 'still holds a block' : 'empty now'/, 'a remove does not say whether the cell emptied')
    assert.match(editor, /after the add`, holds\(row, col\) \? 'holds the block' : 'still empty'/, 'an add does not say whether the cell filled')
    assert.match(editor, /`block \$\{eid\} model after the change`/, 'a model change does not say what the unit shows')
    assert.match(read('mobile/src/components/SaveToSlot.js'), /logDebug\('write', `save to slot \$\{preset\?\.number\}`, res\.ok \? 'saved' : `failed — \$\{res\.error\}`\)/, 'a save leaves no line')
    /* And the two notes that were only ever on screen — "Chain — out of
       date" and "No output level to move yet" — are lines as well. */
    assert.match(read('mobile/src/lib/rig.js'), /logDebug\('chain', 'the chain could not be read — buttons kept from the last read', err\.message\)/, 'a failed chain read leaves no line')
    assert.match(
      read('mobile/src/components/Volume.js').replace(/\s+/g, ' '),
      /logDebug\('set', 'volume: no Output block known yet', why\)/,
      'the volume refusing to move leaves no line'
    )
  })

  test('the bench draws the chain in a line you can swipe, not a grid that wraps', () => {
    /*
     * "The chain shows up differently from the web version compared to on the
     * phone. I'd like the web version better, where it shows the chain and you
     * can swipe left to right to view it."
     *
     * It was four across and then a new line. That fits more on a screen and
     * throws away the one thing the row is for: a chain is an ORDER — what the
     * guitar hits first and what it hits last. Wrapped, the fifth block sits
     * under the first and nothing says the rows join up. The unit draws it in a
     * line and so does the browser.
     */
    const edit = read('mobile/src/screens/Edit.js').replace(/\s+/g, ' ')
    assert.ok(!/flexDirection: 'row', flexWrap: 'wrap', gap: space\.sm \} > \{blocks\.map/.test(edit), 'the chain still wraps into a grid')
    assert.match(
      edit,
      /<ScrollView horizontal showsHorizontalScrollIndicator=\{false\}[^>]*> \{blocks\.map/,
      'the chain is not a row you can swipe'
    )
    /* A fixed width, because a row that scrolls has no width to share out and
       tiles sized to their own labels make a ragged strip. */
    assert.match(edit, /style=\{\{ width: 84, opacity: engaged \? 1 : 0\.55 \}\}/, 'the tiles size themselves in a row that cannot size them')

    /* Tapping still OPENS the block rather than toggling it — the difference
       between this screen and the stage, and the half of the request that was
       already right. */
    assert.match(edit, /onPress=\{\(\) => setOpenEid\(open \? null : idOf\(b\)\)\}/, 'a tap on the bench no longer opens the block')
  })

  test('changing preset drops the computer’s copy before reading the new one back', () => {
    /*
     * "I clicked a preset name, in this case it was Drop D Chug, then it went
     * to the preset screen, shows Drop D Chug for a split second, and then goes
     * to Metallica." On an iPhone and an Android, and Refresh put it right on
     * each of them separately.
     *
     * Both halves are the same thing. The split second is the name this app
     * already knew, shown at once so the screen is not blank. What replaced it
     * was the answer to "what preset is loaded" — and the computer holds that
     * answer for fifteen seconds, so a read inside the window describes the
     * preset just LEFT. The stage settled on the old name, the old scene names
     * and the old chain, all agreeing with each other and with nothing on the
     * unit. Two phones asking one computer got one stale answer, which is why
     * refreshing on one did nothing for the other.
     *
     * The preset list stayed right the whole time, because it is drawn from
     * names read off the unit rather than from that copy.
     */
    const rig = read('mobile/src/lib/rig.js')
    /* Where each happens, rather than one regex spanning all three: a comment
       between them should not be able to break this, and the only thing it is
       really saying is the ORDER. */
    const chose = rig.indexOf('await device.selectPreset(number)')
    const dropped = rig.indexOf('await device.dropReadCache()', chose)
    const readBack = rig.indexOf('await refreshPreset()', chose)
    assert.ok(chose > 0, 'nothing selects a preset any more')
    assert.ok(readBack > chose, 'nothing reads the preset back after choosing one')
    assert.ok(dropped > chose && dropped < readBack, 'the preset is read back through a copy taken before it was loaded')

    /*
     * The chain editor has dropped this copy after a write since the day it
     * was written. Changing which preset is loaded is the larger change of the
     * two, and was the one not doing it — so both are held here, together,
     * rather than one of them quietly losing it again.
     */
    assert.match(read('mobile/src/screens/Edit.js').replace(/\s+/g, ' '), /await dropReadCache\(\)/, 'a chain write no longer drops the computer’s copy')
  })

  test('the speaker and the slider ask the same question about the Output block', () => {
    /*
     * "No Output block known yet — the chain has not been read", twice, twenty
     * seconds apart, about a chain that had just been edited block by block and
     * was plainly there.
     *
     * The two ends disagreed. The bar showed its speaker when a block called
     * "output" was in the chain; the slider wrote to that block's id. A unit
     * that reports the block without an id satisfies the first and fails the
     * second, so the button was drawn and every press of it refused — which
     * reads exactly like a broken volume, because it is one.
     *
     * One question, asked in one place. The bar's own note has said since it
     * was written that "a speaker that opens an empty sheet is worse than no
     * speaker", and a speaker that opens a sheet which cannot write is the
     * same thing wearing the sheet.
     */
    const bar = read('mobile/src/components/TopBar.js').replace(/\s+/g, ' ')
    assert.match(
      bar,
      /const hasOutput = connected && Number\.isInteger\(idOf\(\(blocks \|\| \[\]\)\.find\(\(b\) => b\?\.slug === 'output'\)\)\)/,
      'the speaker still appears for an Output block the slider cannot write to'
    )
    assert.match(bar, /import \{ idOf \} from '\.\.\/lib\/device'/, 'the bar reads the id by its own rule rather than the one the slider uses')

    /* And the two reasons are told apart rather than both blamed on a read
       that has already finished — waiting is not the answer to one of them. */
    const vol = read('mobile/src/components/Volume.js').replace(/\s+/g, ' ')
    assert.match(vol, /the unit reported an Output block with no id to write to/, 'a block with no id is still reported as a chain still loading')
    assert.match(vol, /'the chain has not been read'/, 'the genuinely-still-loading case lost its words')
  })

  test('the volume writes to the block it has now, and a scene change does not dump the preset', () => {
    /*
     * Twenty-seven writes to block "undefined" in one log: the volume's
     * writer was made on the first render, before the chain was read, and
     * kept the Output block it had then -- nothing -- for good. And every
     * scene tap re-read the whole preset, a dump that takes seconds and,
     * right after a scene switch, came back headless four times in a row.
     */
    const vol = read('mobile/src/components/Volume.js').replace(/\s+/g, ' ')
    assert.match(vol, /live\.current = \{ param, value, width, eid \}/, 'the block is not on the ref the writer reads')
    assert.match(vol, /const \{ param: p, eid: block \} = live\.current/, 'the writer still closes over the first render\'s block')
    assert.match(vol, /return setParam\(block, p\.id, v, p\)/)
    assert.ok(!/setParam\(eid,/.test(vol), 'a write still goes to the render-time block')
    const rig = read('mobile/src/lib/rig.js').replace(/\s+/g, ' ')
    assert.match(rig, /await device\.setScene\(index\) .*? await refreshSceneState\(\) \}\)/, 'a scene change still dumps the whole preset')
    assert.match(rig, /export async function refreshSceneState\(\)/)
    assert.match(rig, /if \(!states\.length\) return refreshBlocks\(\{ quiet: true \}\)/, 'an older Mac that cannot answer gets no chain at all')
    assert.match(read('mobile/src/lib/device.js'), /remoteRequest\('\/preset\/scene-state'\)/)
    assert.match(read('mobile/src/lib/demoWire.js'), /path === '\/preset\/scene-state'/, 'the demo cannot change scene')
  })

  test('a chain drawn on a phone shows what is there, and the gaps between', async () => {
    /*
     * The browser drew forty-eight cells of which five held anything: on a
     * phone that is three cells visible and a scroll to find the one you want.
     * "The rest you can't really add anything or change anything… let's rethink
     * that whole thing."
     *
     * A lane is the row as a CHAIN — what is in it, in signal order, with the
     * free cells shown as gaps you can tap. Nothing hidden, nothing drawn that
     * isn't there.
     */
    const { lanesShown, laneItems } = await import('../mobile/src/lib/grid-plan.js')
    const caps = { grid: { rows: 4, cols: 4 } }
    const blocks = [
      { row: 1, col: 2, name: 'Amp 1' },
      { row: 1, col: 0, name: 'Drive 1' }
    ]

    const lanes = lanesShown(blocks, caps)
    /* The row that holds something, then the first empty one — so a bare preset
       can be started and a parallel row can be begun. Not all four. The chain
       is drawn first and the spare row after it, whatever their numbers. */
    assert.equal(lanes.length, 2, 'every row of the grid is drawn, empty or not')
    assert.deepEqual(lanes.map((l) => l.row), [1, 0], 'the spare row is drawn above the chain')
    const chain = lanes[0]
    assert.deepEqual(chain.blocks.map((b) => b.name), ['Drive 1', 'Amp 1'], 'a lane is not in signal order')
    assert.deepEqual(chain.gaps, [1, 3], 'the free cells in a lane are wrong')

    const items = laneItems(chain)
    assert.deepEqual(
      items.map((i) => `${i.kind}${i.col}`),
      ['block0', 'gap1', 'block2', 'gap3'],
      'the cards and gaps do not read as one chain in column order'
    )

    /* A preset with nothing in it still offers somewhere to start. */
    assert.equal(lanesShown([], caps).length, 1)
  })

  test('a block past the grid the phone assumed still gets drawn, and a split says so', async () => {
    /*
     * TWO THINGS THE SPLIT-CHAIN LOOK FOUND.
     *
     * (a) Lanes were built from the row count capabilities reported, so a
     * block sitting on a row beyond it was not drawn ANYWHERE — it did not
     * appear in a lane, and the editor showed a chain with a piece of it
     * silently missing. A chain the app cannot place is the one it must not
     * quietly drop: the grid it was told about loses to the blocks actually
     * there.
     *
     * (b) The app reads where blocks sit, and nothing reads the CABLES that
     * join the rows — there is no such read anywhere, only writes. So on a
     * preset running down two rows it can describe half of what is there, and
     * drawing that with no comment reads as an editor that understands the
     * routing. It doesn't, and it says so.
     */
    const { lanesFor, isSplitChain } = await import('../mobile/src/lib/grid-plan.js')
    const caps = { grid: { rows: 4, cols: 12 } }

    /* (a) A block on row 5 of a grid the unit called four rows tall. */
    const far = [
      { row: 0, col: 0, name: 'Drive 1' },
      { row: 5, col: 1, name: 'Delay 1' }
    ]
    const held = lanesFor(far, caps).flatMap((l) => l.blocks.map((b) => b.name))
    assert.deepEqual(held.sort(), ['Delay 1', 'Drive 1'], 'a block past the assumed grid was dropped')

    /* (b) One occupied row is a plain chain; two is a split, and the editor
       has a line for it. */
    assert.equal(isSplitChain([{ row: 0, col: 0 }, { row: 0, col: 2 }], caps), false)
    assert.equal(isSplitChain(far, caps), true)

    const editor = read('mobile/src/screens/Edit.js')
    assert.ok(
      /const splitChain = isSplitChain\(blocks, caps\)/.test(editor),
      'the chain editor never works out whether the preset is split'
    )
    assert.ok(
      /splitChain \? \(/.test(editor) && /can’t see or change how the rows are joined/.test(editor),
      'a split preset is drawn with nothing said about the routing'
    )

    /* Both ends draw the same lanes from the same file, so both ends owe the
       same sentence. The browser is where a split preset is most likely to be
       opened, not least. */
    const web = read('src/components/GridEditor.jsx')
    assert.ok(
      /const splitChain = isSplitChain\(blocks, capabilities\)/.test(web),
      'the browser chain editor never works out whether the preset is split'
    )
    assert.ok(
      /see or change how the rows are joined/.test(web),
      'the browser draws a split preset with nothing said about the routing'
    )
  })

  test('the demo is twelve presets a player would recognise, and the seed cannot lie', async () => {
    /*
     * "The demo currently shows empty presets, empty scenes, and empty chains."
     *
     * Demo mode is the only way to see this app without an FM3 on the desk, and
     * it was showing one preset, one chain and 511 empty slots — so the preset
     * list, the setlists and the scene tiles were all being demonstrated empty.
     *
     * The seed is data, so the things that can go wrong with it are data
     * problems, and every one of them is silent on screen:
     *
     *  - an amp, cab or drive number nobody makes. The demo would name a model
     *    that is not on any unit, which teaches the wrong thing to the one
     *    person who cannot check it against hardware.
     *  - a block slug the mock has no effect id for. The catalogue is built
     *    from LAYOUT, so anything else simply would not appear in the chain.
     *  - four scenes that do not differ. An identical scene list is the same
     *    failure as an empty one, one step later.
     *  - TWO SCENES ON ONE CHANNEL WITH DIFFERENT LEVELS, which is the one that
     *    actually happened while this was being written. A level belongs to a
     *    channel, not to a scene: the hardware lets the second scene's value
     *    overwrite the first and reports success. The seed asked for a sound
     *    the unit cannot hold, and nothing said so.
     */
    const seed = JSON.parse(read('src/data/demo-presets.json'))
    const roster = Object.fromEntries(
      ['amp', 'drive', 'cab'].map((k) => [
        k,
        new Set(JSON.parse(read(`src/data/${k}-types.json`)).map((m) => m.value))
      ])
    )
    const mock = read('src/lib/mockDevice.js')
    const known = new Set([...mock.matchAll(/\{ slug: '([a-z]+)', name: '[^']+', effectId: \d+/g)].map((m) => m[1]))
    assert.ok(known.size >= 8, `only ${known.size} block slugs were read off LAYOUT; this check read nothing`)

    assert.ok(seed.presets.length >= 8 && seed.presets.length <= 12, 'the demo is not eight to twelve presets')
    const numbers = seed.presets.map((p) => p.number)
    assert.equal(new Set(numbers).size, numbers.length, 'two demo presets claim the same slot')

    for (const preset of seed.presets) {
      const where = `${preset.number} ${preset.name}`
      assert.ok(preset.name.trim(), `${preset.number} has no name`)

      for (const kind of ['amp', 'cab', 'drive']) {
        if (!preset.chain.includes(kind)) continue
        assert.ok(
          roster[kind].has(preset.models[kind]),
          `${where} is on a ${kind} model no unit has: ${preset.models[kind]}`
        )
      }
      for (const slug of preset.chain) assert.ok(known.has(slug), `${where} has a block the mock cannot place: ${slug}`)
      for (const slug of ['amp', 'cab']) assert.ok(preset.chain.includes(slug), `${where} has no ${slug}`)

      assert.equal(preset.scenes.length, 4, `${where} does not have four scenes`)
      const names = preset.scenes.map((s) => s.name)
      assert.equal(new Set(names).size, 4, `${where} has two scenes with one name`)

      /* Every scene really is a different sound. */
      const shapes = preset.scenes.map((s) =>
        JSON.stringify([[...s.off].sort(), s.channels || {}, s.levels || {}])
      )
      assert.equal(new Set(shapes).size, 4, `${where} has two scenes that are the same sound`)

      /* And the one that bit: a level is a property of a channel. */
      const byChannel = new Map()
      for (const scene of preset.scenes) {
        for (const [slug, level] of Object.entries(scene.levels || {})) {
          const key = `${slug}:${scene.channels?.[slug] || 'A'}`
          if (byChannel.has(key))
            assert.equal(
              byChannel.get(key),
              level,
              `${where}: two scenes put ${slug} on the same channel and ask for different levels; ` +
                'the unit would keep the last one and say nothing'
            )
          byChannel.set(key, level)
        }
        for (const slug of scene.off) assert.ok(preset.chain.includes(slug), `${where} switches off a block it has not got: ${slug}`)
        for (const slug of Object.keys(scene.levels || {}))
          assert.ok(preset.chain.includes(slug), `${where} sets a level on a block it has not got: ${slug}`)
      }
    }

    /* And the mock actually serves it: a named preset, its own chain, its own
       scene names, and a level that follows the scene. */
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage')
    const saved = globalThis.localStorage
    const store = new Map()
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    }
    try {
      const { createMockDevice } = await import('../src/lib/mockDevice.js')
      const unit = createMockDevice()
      const first = seed.presets[0]

      unit.selectPreset(first.number)
      assert.equal(unit.preset().name, first.name, 'the demo does not load the seeded preset')
      const chain = (await unit.presetBlocks()).map((b) => b.slug)
      assert.deepEqual(chain, first.chain, 'the demo draws a chain the seed did not ask for')
      assert.deepEqual(
        unit.getScene().names.slice(0, 4),
        first.scenes.map((s) => s.name),
        'the seeded scene names are not the ones the demo shows'
      )

      const levels = first.scenes.map((_, i) => {
        unit.setScene(i)
        const amp = unit.presetBlocks().find((b) => b.slug === 'amp')
        return unit.blockParams(amp.effectId).named.find((x) => x.name === 'Amp1 Level')?.value
      })
      assert.deepEqual(
        levels,
        first.scenes.map((s) => s.levels.amp),
        'the amp level does not follow the scene'
      )

      /* A slot nobody has visited still says what it holds, without going
         there — otherwise the list is the thing that looks empty. */
      const summary = unit.presetSummary(seed.presets[1].number)
      assert.equal(summary.name, seed.presets[1].name)
      assert.ok(summary.blocks.length, 'a seeded slot summarises as empty')
      assert.deepEqual(unit.presetSummary(400), { number: 400, name: '', blocks: [] }, 'an unseeded slot is not empty')

      /* An edit stays put when you walk away and come back. */
      unit.selectPreset(first.number)
      const drive = unit.presetBlocks().find((b) => b.slug === 'drive' || b.slug === 'amp')
      unit.setBypass(drive.effectId, true)
      unit.selectPreset(seed.presets[2].number)
      unit.selectPreset(first.number)
      assert.equal(
        unit.presetBlocks().find((b) => b.effectId === drive.effectId).bypassed,
        true,
        'the demo forgot an edit as soon as another preset was visited'
      )
    } finally {
      if (had) globalThis.localStorage = saved
      else delete globalThis.localStorage
    }
  })

  test('there is a guide to what to try, and an error that can name a fix offers it', async () => {
    /*
     * "Link to this section from every error toast in the app."
     *
     * A message that says what went wrong and offers nothing to do next is the
     * whole reason this exists. So the guide is one shared list — the browser
     * and the phone show the same four fixes, because a fix that exists on one
     * end and not the other is a fix somebody cannot find from wherever they
     * happen to be standing — and the error notices link INTO it by id.
     *
     * The three things that can quietly go wrong here:
     *
     *  - a fix with no steps, which is a heading that helps nobody
     *  - fixFor placing a message on the wrong fix, or on any fix at all when
     *    it cannot tell. A wrong fix offered confidently costs more than no fix
     *    offered, so an unplaceable message must return null
     *  - the version check claiming agreement it has not checked. It can
     *    compare the app and the computer; the unit's FIRMWARE is not
     *    something either end can read, and saying nothing about that would
     *    leave a row that looks like a check nobody ran
     */
    const guide = await import('../shared/troubleshooting.mjs')

    assert.ok(guide.FIXES.length >= 4, 'the guide lost most of itself')
    const ids = guide.FIXES.map((f) => f.id)
    assert.equal(new Set(ids).size, ids.length, 'two fixes share an id, so a link lands on either')
    for (const want of ['frozen', 'connect', 'versions', 'preset']) {
      assert.ok(ids.includes(want), `the guide has nothing about "${want}"`)
    }
    for (const fix of guide.FIXES) {
      assert.ok(fix.title && fix.when, `${fix.id} has no title or no "when"`)
      assert.ok(fix.steps.length >= 2, `${fix.id} is a heading with no steps`)
      for (const step of fix.steps)
        assert.ok(step.length > 20 && /[a-z]/.test(step), `a step of ${fix.id} says nothing`)
      assert.equal(guide.fixById(fix.id), fix, `${fix.id} cannot be looked up by id`)
    }
    assert.equal(guide.fixById('nonsense'), null, 'an unknown id resolves to something')

    /* The power cycle is the first thing to try on a unit that stopped
       answering, because it is the thing that usually works and it costs
       nothing. It being anywhere else is a real regression. */
    assert.match(guide.fixById('frozen').steps[0], /turn the unit off/i, 'the power cycle is not the first thing offered')
    /* And a charge-only USB cable is the single most common reason a unit is
       never found at all. */
    assert.ok(
      guide.fixById('connect').steps.some((s) => /charge-only|data cable/i.test(s)),
      'the guide never mentions the cable, which is the most common cause'
    )

    for (const [message, want] of [
      ['Not connected to a unit', 'connect'],
      ['The computer is not answering', 'connect'],
      ['The unit timed out', 'frozen'],
      ['That preset would not load', 'preset'],
      ['The computer app is older than this one', 'versions'],
      ['Something nobody has seen before', null],
      ['', null],
      [null, null],
      [undefined, null]
    ]) {
      assert.equal(guide.fixFor(message), want, `"${message}" was placed on ${guide.fixFor(message)}`)
    }

    const sync = (app, host) => guide.versionsInSync({ app, host })
    assert.equal(sync('7.1.0', '7.1.0').state, 'ok')
    assert.equal(sync('7.2.0', '7.1.0').state, 'behind', 'a computer behind the app is not reported')
    assert.equal(sync('7.1.0', '7.2.0').state, 'ahead', 'an app behind the computer is not reported')
    assert.equal(sync('7.1.0', null).state, 'unknown', 'a computer that said nothing is reported as agreeing')
    assert.equal(sync(null, '7.1.0').state, 'unknown')
    assert.equal(sync('7.1.0', 'banana').state, 'unknown', 'an unreadable version is read as a verdict')
    for (const [app, host] of [['7.2.0', '7.1.0'], ['7.1.0', '7.2.0'], ['7.1.0', null]])
      assert.ok(sync(app, host).says.length > 20, 'a verdict with nothing to read')
    assert.ok(/firmware/i.test(guide.FIRMWARE_NOTE), 'nothing says the firmware is unreadable')

    /* Both ends show it, and both ends link into it. */
    const web = read('src/App.jsx')
    assert.match(web, /fixFor\(error\)/, 'the browser error notice offers no fix')
    assert.match(web, /FIXES\.map/, 'the browser does not draw the guide')
    assert.match(web, /versionsInSync\(\{ app: VERSION, host: link\.macVersion \}\)/, 'the browser runs no version check')

    const stage = read('mobile/src/screens/Stage.js')
    assert.match(stage, /fixFor\(error\)/, 'the phone error note offers no fix')
    const screen = read('mobile/src/screens/Fixes.js')
    assert.match(screen, /FIXES\.map/, 'the phone does not draw the guide')
    assert.match(screen, /versionsInSync/, 'the phone runs no version check')
    /* Reachable with the computer off, which is exactly when it is wanted. */
    const app = read('mobile/App.js')
    assert.match(app, /onOpenFixes=\{/, 'Setup has no way to reach the guide')
    assert.ok(
      !/link\.link === 'connected' \? \(\) => setScreen\('fixes'\)/.test(app),
      'the guide is gated on the computer answering, which is when it is least useful'
    )
  })

  test('a write the unit calls refused is never undone by the phone', () => {
    /*
     * THE BUG THIS PANEL WAS REPORTED FOR, in the browser: "delete works, the
     * rest doesn't." The AM4 answers `ok:false` to writes that actually landed,
     * and the old editor took it at its word — so a move that had worked was
     * rolled straight back.
     *
     * So the answer is SAID and never acted on, and the chain is re-read from
     * the unit so somebody can see which it was.
     *
     * The rollback that remains is for a throw — a real transport failure — and
     * only on the move, whose block would otherwise exist nowhere: it is
     * cleared from its old cell before being placed in the new one, because a
     * block instance exists once and placing it twice is a question this does
     * not want to ask.
     */
    const editor = read('mobile/src/screens/Edit.js')
    /* The move is a drag now (7.285.0); the three rules are the same. */
    const move = editor.slice(editor.indexOf('const reorder = async'), editor.indexOf('const remove = async'))
    assert.ok(move.length > 200, 'the move moved; this check reads it')

    assert.ok(
      !/ok === false/.test(move),
      'a move is being undone because the unit answered ok:false, which means nothing on this hardware'
    )
    assert.match(
      move,
      /catch \(err\) \{\s*\n\s*for \(const m of moves\) await placeBlock\(lane\.row, m\.from, idOf\(m\.block\)\)\.catch/,
      'a move that throws part-way leaves the blocks in no cell at all'
    )
    assert.ok(
      move.indexOf('clearCell') < move.indexOf('placeBlock'),
      'a move places the block before clearing it, which asks the unit to hold one block in two cells'
    )
    assert.match(editor, /doubtfulWrite\(res\)/, 'nothing says what ok:false actually means here')
    assert.match(editor, /await refreshBlocks\(\{ quiet: true \}\)/, 'the chain is not re-read after it is changed')
  })

  test('the volume is a control, and a drag does not queue a hundred writes at the unit', async () => {
    /*
     * "Add volume slider to the play screen to quickly turn volume up or down."
     * The phone could read the level and not move it, which is the one control
     * a soundperson means by "give me a bit less".
     *
     * THE COALESCING IS THE PART THAT MATTERS ON A PHONE. A slider reports one
     * value per frame; the unit takes one request at a time down a serial port
     * with a relay in front of it. Sent as they come, a two-second drag queues
     * a hundred writes the unit works through for the next ten seconds —
     * landing on the value you let go of long after you let go, and holding up
     * the scene you pressed next.
     */
    const { latestWriter, outputLevelParam, volumeNudge, volumeLabel, nudged } = await import(
      '../mobile/src/lib/volume.js'
    )

    const level = { id: 3, name: 'Level', min: -80, max: 20, unit: 'dB', value: 0 }
    assert.equal(outputLevelParam([{ name: 'Bypass' }, level])?.id, 3, 'the slider cannot find the level to drive')
    assert.equal(outputLevelParam([{ name: 'Bypass' }]), null, 'a unit with no level gets a slider that can only disappoint')

    /* A dB at a time on the buttons: "do a plus minus on the sides of the
       volume slider that does 1 dB at a time". */
    assert.equal(volumeNudge(level), 1)
    assert.equal(nudged(-6.5, level, 1), -5.5)
    /* A sign on anything that has one — from arm's length "6.5" and "-6.5" are
       the same number. */
    assert.equal(volumeLabel(-6.5, level), '−6.5 dB')
    assert.equal(volumeLabel(2, level), '+2.0 dB')

    /* Now the real thing: sixty values, one write out at a time, and the unit
       ends on the value the thumb came off. */
    const sent = []
    let release
    const gate = new Promise((r) => { release = r })
    const writer = latestWriter((v) => {
      sent.push(v)
      return sent.length === 1 ? gate : Promise.resolve()
    })
    for (let i = 0; i < 60; i++) writer.send(i)
    assert.deepEqual(sent, [0], 'a drag put more than one write on the wire at once')
    release()
    await writer.settled()
    assert.equal(sent.length, 2, `a 60-value drag sent ${sent.length} writes instead of coalescing them`)
    assert.equal(sent.at(-1), 59, 'the unit ends on a value the thumb has already left')

    /* And mid-drag writes are NOT confirmed — a read-back per frame is the
       same jam by another name — while the one you stop on is. */
    const vol = read('mobile/src/components/Volume.js')
    assert.match(vol, /latestWriter\(\(v\) => \{[\s\S]{0,400}?setParam\(block, p\.id, v, p\)/, 'a drag confirms every value, which doubles the traffic it was written to avoid')
    assert.match(vol, /await setParamConfirmed\(eid, p\.id, v, p\)/, 'the value the thumb stops on is never confirmed')

    /*
     * A speaker in the header, and what it opens is a POP-UP: "just an overlay
     * that pops up on the screen separately… able to be slid without scrolling
     * or moving anything else."
     *
     * That is the fix rather than the styling. A slider inside a scroll view
     * loses its drag to the scroll view's native gesture; in a modal there is
     * no scroll view behind it and nothing to argue with.
     */
    const bar = read('mobile/src/components/TopBar.js')
    assert.match(bar, /accessibilityLabel="Volume"/, 'the volume is not behind a speaker button')
    assert.match(bar, /onPress=\{\(\) => setVolume\(true\)\}/, 'the speaker opens nothing')
    assert.match(bar, /<Volume blocks=\{blocks\} open=\{volume\}/, 'the bar does not carry the volume it opens')
    /* And the stage screen no longer has a second one. Two speakers on one
       screen is the clutter moving it up was meant to end. */
    assert.ok(!/🔊/.test(read('mobile/src/screens/Stage.js')), 'the stage screen kept its own speaker')
    assert.match(vol, /<Modal visible=\{open\}/, 'the volume is back in the page flow, where the scroll view takes its drag')
    assert.match(vol, /from 'expo-blur'/, 'the volume pop-up is not glass like the tuner')
    /* A thumb that slips off the slider must not close the thing it is holding. */
    assert.match(vol, /onPress=\{\(\) => \{\}\}/, 'the panel does not swallow presses, so a slip off the slider closes it')
  })

  test('a setting that says it changed something has changed something', () => {
    /*
     * The rule this project learned from the play-mode switch: a switch that
     * hides something already absent reports success and changes nothing.
     *
     * Tile size is the same shape of trap — it is easy to add the five buttons,
     * save the choice, and never read it back. So this checks the stage screen
     * actually draws from it.
     */
    const stage = read('mobile/src/screens/Stage.js')
    assert.match(stage, /const size = SIZES\[loadSize\(sync\)\]/, 'the stage screen never reads the tile size')
    /* `tileH` is the size setting OR the measured fit — see the fit test
       below for which wins and when. Either way it is read, not ignored. */
    assert.match(stage, /const tileH = fitted \? fitted\.tile : size\.tile/, 'the tile height is no longer the chosen size')
    assert.match(stage, /height=\{tileH\}/, 'the scene tiles ignore the size setting')
    /* The tiles are measured rather than given a percentage now — a percentage
       cannot pay for the gaps, and the last tile of a short row stretched the
       width of the screen. The rule being checked is the same: how many go
       across comes from the setting. */
    assert.match(stage, /width: tileWidth\(row, size\.scenes\)/, 'the scenes are a fixed number across whatever the setting says')
    /* Blocks take their column count from `fxCols`, which is the setting's
       own `fx` until fit is measuring — fit widens the rows rather than let a
       tile drop under a thumb. Either way it comes from the setting. */
    assert.match(stage, /const fxCols = fitted \? fitted\.fxCols : size\.fx/, 'the chain column count is no longer the chosen one')
    assert.match(stage, /width: tileWidth\(row, fxCols\)/, 'the chain is a fixed number across whatever the setting says')
    /*
     * And `row` is not the raw measurement, which is zero on the first frame of
     * every mount. "After going to setlists and going back it shows this screen
     * sized wrong for a split second" — that is what zero looks like: no width
     * to divide, so every tile falls back to the width of the word on it and
     * eight scenes land six across before the layout pass corrects them.
     *
     * The first frame uses the window less this screen's own padding, which is
     * the same answer the measurement gives, and `onLayout` still wins the
     * moment it lands.
     */
    assert.match(
      stage,
      /const row = grid \|\| Math\.max\(0, screen - space\.lg \* 2\)/,
      'the tiles are drawn from a width that is zero until the screen has been measured'
    )
    assert.match(stage, /setGrid\(e\.nativeEvent\.layout\.width\)/, 'nothing measures the row any more, so an unusual screen stays guessed at')
    /* The same two onLayouts now take the HEIGHT as well, which is what fit
       subtracts to find out how much screen is left for tiles. */
    assert.match(stage, /setSceneGrid\(e\.nativeEvent\.layout\.height\)/, 'the scenes grid is not measured, so fit has nothing to subtract')
    assert.match(stage, /setBlockGrid\(e\.nativeEvent\.layout\.height\)/, 'the chain grid is not measured, so fit has nothing to subtract')
    assert.ok(
      !/flexGrow: 1[\s\S]{0,40}flexBasis/.test(stage),
      'a tile can grow into the spare room again, so the last one in a short row fills the screen'
    )

    const settings = read('mobile/src/screens/Settings.js')
    /* A stepper now, not five tabs: one step either side of the answer. */
    assert.match(settings, /const step = \(by\) => saveSize\(clampSize\(now \+ by\), sync\)/, 'the size buttons do not save anything')
  })

  test('the phone can rename a preset and its scenes, and says what that means', () => {
    /*
     * "Would also like to be able to rename presets and scenes in the app
     * directly without having to ask the chat." The routes were wired on the
     * phone and no screen called them.
     *
     * In Setup rather than on the stage screen, which is the browser's choice
     * and the right one: renaming is bench work and the stage screen is the one
     * a thumb crosses between songs.
     */
    const settings = read('mobile/src/screens/Settings.js')
    const stage = read('mobile/src/screens/Stage.js')

    assert.match(settings, /await setPresetName\(wanted\)/, 'the preset cannot be renamed from the phone')
    assert.match(settings, /await setSceneName\(index, wanted\)/, 'a scene cannot be renamed from the phone')
    assert.ok(!/setPresetName|setSceneName/.test(stage), 'renaming reached the stage screen, where a thumb crosses between songs')

    /* And it says the thing that is true about every write this app makes.
       Whitespace-flattened first: JSX wraps a sentence across lines, and a
       check that breaks when a line reflows is a check nobody can edit around. */
    assert.match(
      settings.replace(/\s+/g, ' '),
      /lost on the next preset change unless it is saved/,
      'nothing says a new name is not permanent until the preset is saved'
    )
  })

  test('the phone can say what a model really is, searched from either side', async () => {
    /*
     * "Add an info page like this to settings listing the real life equivalents
     * of each amp and effects pedals."
     *
     * THE SEARCH HAS TO READ BOTH COLUMNS. The word somebody types is "tube
     * screamer" — the real name, which appears nowhere in the unit's own "T808
     * Mod". A search over the unit's names alone answers nothing for every
     * query a person actually has, which is the whole reason the sheet exists.
     */
    const { searchAll, GEAR_TOTAL } = await import('../mobile/src/lib/gearCatalog.js')

    assert.ok(GEAR_TOTAL > 300, `only ${GEAR_TOTAL} models are named; the catalog is not landing`)

    const hits = searchAll('tube screamer').flatMap((g) => g.hits)
    assert.ok(hits.length, 'searching the real name finds nothing, so the sheet answers no real question')
    assert.ok(
      hits.every((h) => !/tube screamer/i.test(h.name)),
      'this only passes because the unit happens to use the real name; it proves nothing'
    )

    /* And searching the unit's own word still works. */
    assert.ok(searchAll('Brit 800').flatMap((g) => g.hits).length, 'the unit’s own names no longer match')

    /* The counts move with the search or the tabs mislead. */
    const groups = searchAll('tube screamer')
    assert.ok(groups.some((g) => g.hits.length === 0), 'every group matches everything; the search is not filtering')
    assert.ok(groups.some((g) => g.hits.length > 0))
  })

  test('the scene tiles say what the scenes are called', async () => {
    /*
     * FOUND BY LOOKING AT THE TWO SCREENS SIDE BY SIDE, which is the only way
     * it could have been found: nothing here fails when a name is missing, the
     * tile just draws its number.
     *
     * The Mac showed DETUNERS, TRI CHORUS, WALL DELAY. The phone showed 1, 2,
     * 4. A gen-3 unit does not hand scene names over with the current scene —
     * they live in the preset, and the host will read them out of it if asked.
     * The browser has always asked. The phone only ever looked at
     * `getScene().names`, which on that unit is empty.
     *
     * It matters more on the phone than on the Mac: the whole reason those
     * tiles are two across instead of four is to leave room for the name.
     * Without it the extra width buys nothing at all.
     */
    const device = read('mobile/src/lib/device.js')
    const rig = read('mobile/src/lib/rig.js')
    const stage = read('mobile/src/screens/Stage.js')

    assert.match(
      device,
      /remoteRequest\(`\/presets\/\$\{number\}\/summary`\)/,
      'the phone never asks the preset what its scenes are called'
    )
    /* And that read is one the Mac will actually carry out. */
    const rules = await import('../shared/relay-rules.mjs')
    assert.equal(rules.forbiddenRemotely('GET', '/presets/99/summary'), null)

    /* Asked for when a preset arrives, both ways in. */
    assert.equal(
      (rig.match(/await refreshSceneNames\(\)/g) || []).length,
      2,
      'scene names are read on one path in and not the other'
    )

    /*
     * And thrown away when the preset changes. Carrying them across would put
     * the last song's names on this song's tiles, which is worse than the
     * numbers — a number is never wrong.
     */
    /* Whitespace-flattened: the call wraps across lines now, and a check that
       breaks when a line reflows is a check nobody can edit around. */
    assert.match(
      rig.replace(/\s+/g, ' '),
      /chain: 'reading', sceneNames: \[\]/,
      'the last preset’s scene names stay on the new preset’s tiles'
    )

    /*
     * The host serves this from whatever the unit last dumped, and a slow unit
     * can answer for the preset before this one.
     */
    assert.match(
      device,
      /summary\.number !== number\) return \[\]/,
      'an answer about a different preset is accepted, so one song’s names land on another'
    )

    /* A unit with no scene names gets numbers, not a broken screen. */
    assert.match(device, /return clean\.some\(\(n\) => n\) \? clean : \[\]/)
    assert.match(stage, /label=\{sceneNames\[i\] \|\| ''\}/, 'the tile stopped drawing the name')
  })

  test('Previous and Next sit where a thumb rests, not where the eye reads', () => {
    /*
     * "Move Previous / Next directly above the bottom tap bar."
     *
     * That was Justin's correction to the browser, and the phone made the same
     * mistake a second time: the two buttons were under the preset name at the
     * top of the screen, and the tuner was off the bottom of it. The screenshot
     * of the two side by side is what showed it.
     *
     * One foot at the bottom: step the preset, then tune and tap.
     */
    const stage = read('mobile/src/screens/Stage.js')

    /* The chevron is a picture now rather than a character in the label —
       Justin's mockup draws it beside the word — so this looks for the word. */
    const nav = stage.indexOf('label="Previous"')
    const scenes = stage.indexOf('<Label>Scenes</Label>')
    const chain = stage.indexOf("chain === 'reading' ?")
    assert.ok(nav > 0 && scenes > 0 && chain > 0, 'the stage screen moved; this check reads it')
    assert.ok(nav > scenes, 'Previous and Next are above the scenes, where you read rather than where your thumb is')
    assert.ok(nav > chain, 'Previous and Next are above the chain')

    /* Tuner and Tap on one row under them, with the tempo on the Tap button
       rather than as its own heading and a forty-point number. */
    const tuner = stage.indexOf("label={tunerOn ? 'Stop tuner' : 'Tuner'}")
    assert.ok(tuner > nav, 'the tuner is not in the foot under the step buttons')
    assert.match(stage, /sub=\{Number\.isFinite\(bpm\) \? String\(Math\.round\(bpm\)\) : undefined\}/, 'the tempo is not on the Tap button')
    assert.ok(!/<Label>Tempo<\/Label>/.test(stage), 'the tempo is a section with a heading again, which costs a third of the screen')

    /* A unit with no tuner is not offered one. */
    assert.match(stage, /caps\?\.tuner !== false \?/, 'a unit that says it has no tuner is still given the button')
  })

  test('the tuner covers the screen instead of hiding under the button that opens it', () => {
    /*
     * "Tuner displays under the tuner button and isn't visible without
     * scrolling."
     *
     * It was drawn in the flow of a screen that scrolls, at the bottom, under
     * the button that turns it on — so switching the tuner on did nothing you
     * could see. Nothing here failed: the needle rendered perfectly, off the
     * bottom of the phone.
     *
     * Tuning is not something you do alongside something else. For as long as
     * it is on it is the only thing on the screen, and it is the size of it.
     */
    const tuner = read('mobile/src/components/Tuner.js')
    const stage = read('mobile/src/screens/Stage.js')

    assert.match(tuner, /<Modal visible=\{on\}/, 'the tuner is drawn in the page flow again, where it scrolls out of sight')
    assert.match(tuner, /from 'expo-blur'/, 'the glass is gone')
    assert.match(tuner, /tint="dark"/, 'the overlay is not tinted, so the rig behind it reads through at full brightness')

    /* Closing it stops the tuner at the unit. An overlay that closes and leaves
       the unit tuning is a rig muted by a screen nobody is looking at. */
    assert.match(stage, /onClose=\{\(\) => writeTuner\(false\)\}/, 'closing the tuner leaves it running on the unit')
    assert.match(tuner, /onPress=\{onClose\}[\s\S]{0,200}?style=\{\{ flex: 1 \}\}/, 'tapping the overlay does not close it')

    /* And it is outside the foot, so the foot does not reserve space for it. */
    assert.ok(
      !/<Tuner on=\{tunerOn\} reading=\{tuning\} \/>/.test(stage),
      'the tuner is still rendered inline without a way to close it'
    )
  })

  test('Setup is a short list of doors, not everything at once', () => {
    /*
     * "Setup screen needs to be fixed. It's showing rename scenes and not set
     * up like the web app."
     *
     * The browser arrived at this the hard way — "I wanna overhaul this whole
     * settings set-up screen" — and the phone had exactly the pile it replaced:
     * one long scroll with eight empty scene-name boxes as the FIRST thing on
     * it. Nobody opens Setup to rename scene 6.
     *
     * A list of rows, each carrying the one fact you would have opened it to
     * learn, each opening its own page. Renaming lives behind its own row —
     * "move the rename presets and scenes button to the settings menu" — and
     * that row is named after the errand rather than after the unit, because
     * the unit's own state belongs with the rest of the chain on Phone &
     * computer.
     */
    const settings = read('mobile/src/screens/Settings.js')

    for (const row of [
      'Phone & computer',
      'Rename presets and scenes',
      /* No 'Play screen'. Stage tiles and Appearance are open at the bottom of
         this list now rather than behind a door. Asserted below. */
      'Troubleshooting',
      'About'
    ]) {
      assert.match(
        settings,
        new RegExp(`title="${row.replace('&', '&')}"`),
        `Setup has no ${row} row`
      )
    }
    assert.match(settings, /const \[page, setPage\] = useState\(null\)/, 'Setup is one scroll again rather than a list of pages')

    /*
     * The renaming boxes are behind their own row, not in front of everything.
     * Checked by position: what is drawn for `page === null` must not contain
     * them.
     */
    const root = settings.slice(settings.indexOf('{page === null ? ('), settings.indexOf("{page === 'unit' ?"))
    assert.ok(root.length > 200, 'the Setup root moved; this check reads it')
    assert.ok(!/UnitBits/.test(root), 'the scene-name boxes are back on the front page of Setup')
    /*
     * AND THE TWO THAT ARE NOT DOORS ARE ON IT, at the bottom.
     *
     * "Move this to the settings screen at the bottom below all the other
     * drop-down menus — we want it quickly available just by clicking
     * settings. Don't have it via a drop-down, have it always visible."
     *
     * This assertion used to say the opposite — that TileSize must NOT be on
     * the front page — because these were behind a row called Play screen.
     * Both are things you change and then LOOK at, and a door meant judging
     * the result with the result off screen.
     */
    assert.match(root, /<TileSize \/>/, 'the tile size buttons are not on the front page of Settings')
    assert.match(root, /<Appearance \/>/, 'the light and dark buttons are not on the front page of Settings')
    /* Below the rows, not above: the rows are what somebody opens Settings
       for, these are what they want in one tap once they are there. */
    assert.ok(
      root.indexOf('<SetupRow') < root.indexOf('<TileSize />'),
      'the tile size buttons sit above the list of rows'
    )

    const unit = settings.slice(settings.indexOf("{page === 'unit' ?"), settings.indexOf("{page === 'trouble' ?"))
    assert.match(unit, /<UnitBits \/>/, 'renaming is not on the rename page')

    /*
     * Fixes, the log and the feedback form are three stages of one errand, so
     * they are behind one door rather than three rows deep in the list.
     */
    const trouble = settings.slice(settings.indexOf("{page === 'trouble' ?"), settings.indexOf("{page === 'link' ?"))
    assert.ok(trouble.length > 200, 'the Troubleshooting page moved; this check reads it')
    for (const [inside, why] of [
      [/onPress=\{onOpenFixes\}/, 'the fixes'],
      [/onPress=\{onOpenLog\}/, 'the log'],
      [/onPress=\{onOpenReport\}/, 'the feedback form']
    ]) {
      assert.match(trouble, inside, `Troubleshooting has no way into ${why}`)
    }

    /* Each row says something true about the state it leads to, which is the
       whole point of the list: it answers most questions without a tap. */
    assert.match(settings, /status=\{\s*demo\s*\?[\s\S]{0,900}?`\$\{deviceName \|\| 'Unit'\} · connected`/)
  })

  test('the version on the About page is the version that was built', async () => {
    /*
     * Typed by hand it is the version somebody last remembered to type, which
     * is worse than none: a wrong one sends people hunting for a bug in a build
     * they are not running. So it is rendered from the repository's own
     * package.json by sync:rules, and held to it by the same staleness check as
     * every other shared file.
     */
    const { APP_VERSION } = await import('../mobile/src/lib/version.js')
    const pkg = JSON.parse(read('package.json'))
    assert.equal(APP_VERSION, pkg.version, 'the phone reports a version the repository is not on')
    assert.match(read('mobile/src/screens/Settings.js'), /v\$\{APP_VERSION\}/, 'Setup does not show the version')
    /* And the stores. "It says version 1.0.0 with an 11 in parentheses" —
       TestFlight shows app.json's version, which was typed once and never
       moved, so no build there could be told from another. */
    const app = JSON.parse(read('mobile/app.json'))
    assert.equal(app.expo.version, pkg.version, 'TestFlight and Play are told a version the repository is not on')
    assert.equal(app.expo.slug, 'fractal-remote', 'the sync rewrote more of app.json than the version')
    assert.equal(app.expo.ios.bundleIdentifier, 'cloud.newbold.fractalremote', 'the sync rewrote more of app.json than the version')
  })

  test('a tap moves the number on the button, not just the unit', async () => {
    /*
     * "Tap tempo isn't changing (or it's extremely slow) on the phone screen,
     * but it does update the unit."
     *
     * The tap worked. The phone then sat waiting to be TOLD the new tempo by a
     * `tempo` event — and over the relay that event is not reliably carried,
     * the same filtering that keeps the tuner's readings at the Mac. So the
     * unit changed and the screen did not, until something else happened to
     * cause a read.
     *
     * THE TAP AND THE READ-BACK MUST NOT BE FOLDED TOGETHER, which is why this
     * is a delay and not an await. The unit works the tempo out from the
     * SPACING between taps, so a tap held back by a debounce is a different
     * rhythm; and reading mid-burst answers with the tempo of the taps before
     * this one, putting a stale number on the button still under your thumb.
     */
    const { TAP_REREAD_MS } = await import('../mobile/src/lib/tempo.js')
    const web = await import('../shared/tempo.mjs')

    assert.equal(TAP_REREAD_MS, web.TAP_REREAD_MS, 'the two apps wait different lengths before reading the tempo back')
    assert.ok(TAP_REREAD_MS >= 600 && TAP_REREAD_MS <= 2000, `${TAP_REREAD_MS}ms is outside a tap burst`)

    const rig = read('mobile/src/lib/rig.js')
    const tap = rig.slice(rig.indexOf('export async function tapTempo'), rig.indexOf('export function writeTempo'))
    assert.ok(tap.length > 100, 'tapTempo moved; this check reads it')

    assert.match(tap, /clearTimeout\(reread\)/, 'each tap does not cancel the read-back the one before it scheduled')
    assert.match(tap, /readTappedTempo\(\)/, 'the tempo is never read back after a tap')
    /* And it waits for the write to land first, or it reads back the number
       from before the last tap and reports that as the answer. */
    assert.match(tap, /if \(!sendTempo\.idle\)/, 'the read-back can overtake the write it is meant to confirm')
    assert.ok(
      !/await refreshTempo\(\)/.test(tap),
      'the read-back is awaited inside the tap, which makes the tap itself late and the rhythm wrong'
    )

    /*
     * AND THE NUMBER MOVES ON THE TAP ITSELF, at both ends.
     *
     * "It should change the tempo based on the tap and change the number
     * immediately and then read the device." The figure used to come only
     * from the unit, which cannot be asked until the burst ends — so it lagged
     * the last press by nearly a second, and you could not see the tempo you
     * were tapping. The arithmetic is shared (shared/tempo.mjs) so the two
     * ends cannot answer differently for the same rhythm.
     */
    assert.match(tap, /tappedBpm\(/, 'the phone no longer works out what the taps mean')
    assert.ok(
      tap.indexOf('set({ bpm: guess })') < tap.indexOf('sendTempo.push(guess)'),
      'the phone shows the number only after the request, so it still lags the tap'
    )
    assert.ok(
      !/await device\./.test(tap),
      'a tap waits on the network before it returns, which makes the next tap late and the rhythm wrong'
    )

    /* Both apps do it the same way. */
    const webGig = read('src/components/Gig.jsx')
    assert.match(webGig, /refreshTempo\(\)/, 'the browser never re-reads the tempo after a tap')
    assert.match(webGig, /TAP_REREAD_MS/, 'the browser no longer shares the delay with the phone')
    assert.match(webGig, /tappedBpm\(/, 'the browser no longer works out what the taps mean')

    const { tappedBpm, keepTaps, TAP_GAP_MAX_MS } = await import('../shared/tempo.mjs')
    assert.equal(tappedBpm([0, 500, 1000, 1500]), 120, 'half-second taps are not 120 BPM')
    assert.equal(tappedBpm([0, 1000, 2000]), 60, 'one-second taps are not 60 BPM')
    assert.equal(tappedBpm([0]), null, 'one tap is being called a tempo')
    assert.equal(tappedBpm([]), null)
    /* A pause is a new count, not a very slow beat. */
    assert.equal(tappedBpm([0, 500, 500 + TAP_GAP_MAX_MS + 1000]), null, 'a pause is being averaged into the tempo')
    assert.equal(keepTaps([0, 500, 1000], 1000 + TAP_GAP_MAX_MS + 1).length, 1, 'a pause does not start a new count')
    /* Outside what the unit takes is a mis-tap, and says nothing rather than
       putting an impossible figure on the button. */
    assert.equal(tappedBpm([0, 10, 20, 30]), null, 'an impossible tempo is being shown')
  })

  test('the phone keeps a log of what went wrong, and can hand it over', async () => {
    /*
     * "I need a debug log with a copy log button so I can paste the log for you
     * to debug."
     *
     * A browser has a console somebody can open. A phone on a dark stage has
     * nowhere at all for a failure to go, so every bad evening was
     * unreconstructable: the screen shows the latest state and nothing about
     * the sequence that produced it. "It kept dropping" cannot be answered from
     * a screen that says "Connected".
     */
    const { logDebug, getDebugLog, clearDebugLog, formatDebugLog } = await import(
      '../mobile/src/lib/debugLog.js'
    )

    clearDebugLog()
    logDebug('wire', 'GET /preset/blocks failed', 'Your computer didn’t answer.')
    logDebug('link', 'connected → no-answer')
    const lines = getDebugLog()
    assert.equal(lines.length, 2, 'the log does not keep what it is told')
    assert.equal(lines[0].message, 'GET /preset/blocks failed', 'the log is newest-first; a story reads in order')

    /* The copy carries a header, because the first three questions about any
       report are which build, which unit and which end of the link — and none
       of them can be read off the lines. */
    const text = formatDebugLog({ app: 'Fractal Remote (phone) v9.9.9', unit: 'FM3', link: 'no-answer' })
    assert.match(text, /app: Fractal Remote \(phone\) v9\.9\.9/)
    assert.match(text, /unit: FM3/)
    assert.match(text, /GET \/preset\/blocks failed/)
    clearDebugLog()

    /* It is written at the choke points every trip passes through, rather than
       sprinkled: one place for the wire, one for the link. */
    const relay = read('mobile/src/lib/relay.js')
    assert.match(relay, /logDebug\('wire', `\$\{method\} \$\{path\} failed`/, 'a failed request is not logged')
    assert.match(relay, /logDebug\('wire', `\$\{method\} \$\{path\} refused here`/, 'a refusal by this app is not logged')
    assert.match(read('mobile/src/lib/link.js'), /logDebug\('link', `\$\{was\} → \$\{next\.link\}`/, 'the link changing its mind is not logged')

    /*
     * And bodies stay out of it. This gets pasted into a chat: a preset dump is
     * neither readable nor anybody else's business.
     */
    assert.ok(!/logDebug\([^)]*options\.body/.test(relay), 'request bodies are being written into a log meant for pasting')

    /* The screen that hands it over. */
    const log = read('mobile/src/screens/Log.js')
    assert.match(log, /Clipboard\.setStringAsync\(text\)/, 'there is no way to get the log off the phone')
    assert.match(log, /label="Copy Logs"/)
    /*
     * A door into the log, asked for as a door rather than as a caption.
     *
     * This matched the words on the row — and the words were wrong: the row
     * that opens the log was called "Help & fixes", which is the name of the
     * row directly above it that opens something else. Renaming it to "Log"
     * failed a test that had no opinion about the log at all. What Setup has
     * to have is a way in, so that is what is checked.
     */
    const setup = read('mobile/src/screens/Settings.js')
    assert.match(setup, /onPress=\{onOpenLog\}/, 'Setup has no way into the log')
    assert.match(setup, /onPress=\{onOpenFixes\}/, 'Setup has no way into the fixes')
    assert.match(setup, /onPress=\{onOpenReport\}/, 'Setup has no way to send a report')
  })

  test('the bench is reachable, and the switch that could take it away still works', async () => {
    /*
     * It was off for twenty minutes on the strength of "just remove edit for
     * now", then: "actually just fix the edit screen I actually like it."
     *
     * What was wrong was never the screen. "The knobs just scroll the screen up
     * and down" is a gesture problem — see the check below — and switching a
     * screen off would have been hiding a two-line fix behind a feature flag.
     *
     * The switch stays, because it is the honest way to take something out if
     * it ever needs taking out again. So this checks both halves: that it is on,
     * and that both doors still read it rather than having been hard-wired open
     * while it was off.
     */
    const { BENCH } = await import('../mobile/src/lib/features.js')
    assert.equal(BENCH, true, 'the bench is switched off; Justin asked for it back')

    const app = read('mobile/App.js')
    assert.match(app, /BENCH && screen === 'edit'/, 'the route no longer reads the switch, so turning it off would leave the screen reachable')
    assert.match(app, /BENCH && link\.link === 'connected'/, 'the Edit button no longer reads the switch')

    /*
     * Absent rather than disabled when there is nowhere to go — and now on the
     * bottom bar rather than up beside the preset name. "On the phone versions
     * move the edit button down to the bottom tab bar exactly like it's set up
     * on the web app": the browser has always had it there, beside the tuner
     * and the tempo, on the strip for what you do BETWEEN songs.
     */
    const stageSrc = read('mobile/src/screens/Stage.js')
    assert.match(stageSrc, /\{onOpenEdit \? \(\s*<Press grow label="Edit" icon=\{editIcon\} height=\{foot\} onPress=\{onOpenEdit\} \/>\s*\) : null\}/, 'the Edit button is drawn whether or not there is anywhere to go')
    /*
     * On the foot row, in the middle: Tuner, Edit, Tap Tempo.
     *
     * "Let's move the edit button to the center and the tap tempo button to
     * the right. so just swap those two." Edit used to be last, on the
     * reasoning that it is the only one of the three that leaves the screen.
     * The right edge is where the thumb sits, though, and Tap Tempo is the
     * one pressed mid-song, so it gets the easy reach.
     */
    assert.ok(
      stageSrc.indexOf('label="Edit"') < stageSrc.indexOf('label="Tap Tempo"'),
      'Tap Tempo is no longer on the right, where the thumb is'
    )
  })

  test('no scrolling screen centres content it is too small to hold', () => {
    /*
     * "What is the button on the bottom that can't be seen and can't be
     * scrolled to??"
     *
     * The sign-in screen's scroll view carried `flexGrow: 1` with
     * `justifyContent: 'center'`. Together those centre the content inside a
     * box the height of the screen, which is exactly right while the content
     * is SHORTER than the screen — and this screen was short once.
     *
     * It grew: a title, a paragraph, two fields, four buttons, a note. Once
     * the content is taller than that box, centring pushes the overflow out
     * through BOTH ends, and a scroll view can only scroll within its content
     * size. So the last thing on the screen was drawn below the bottom edge
     * and no amount of dragging would reach it.
     *
     * The pair is the fault, not either half: flexGrow alone is what makes a
     * short screen fill the space, and centring alone is harmless on a view
     * that does not scroll. So the pair is what is checked, across every
     * screen rather than the one it was found on.
     */
    const bad = []
    for (const file of [
      ...walk(new URL('../mobile/src/screens/', import.meta.url)),
      ...walk(new URL('../mobile/src/components/', import.meta.url))
    ]) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
      /* Every contentContainerStyle in the file, brace-balanced enough for a
         style object one level deep. */
      for (const m of text.matchAll(/contentContainerStyle=\{\{([^{}]*)\}\}/g)) {
        const style = m[1].replace(/\s+/g, ' ')
        if (/flexGrow: 1/.test(style) && /justifyContent: 'center'/.test(style)) {
          bad.push(`${String(file).split('/mobile/')[1]}: ${style.trim()}`)
        }
      }
    }
    assert.deepEqual(bad, [], `a scroll view centres content that can outgrow it:\n${bad.join('\n')}`)

    /* And the screen it was found on starts at the top, with room under the
       last thing on it for the home indicator. */
    const signIn = read('mobile/src/screens/SignIn.js')
    assert.match(signIn, /paddingBottom: space\.xxl/, 'the last thing on the sign-in screen sits under the home indicator')
  })

  test('a knob keeps the finger the scroll view would otherwise take', () => {
    /*
     * "The knobs just scroll the screen up and down when trying to change them."
     *
     * WHY CLAIMING THE RESPONDER IS NOT ENOUGH, which is the thing to know
     * before touching any of this again. A knob turns on a vertical drag and it
     * lives on a screen that scrolls vertically. The JS responder system grants
     * the knob the touch — and then iOS's scroll view, whose pan gesture
     * recogniser is NATIVE, takes it back and terminates the drag. The screen
     * moves and the control does not.
     *
     * The lock goes on in the CAPTURE phase, on touch-down, before anything has
     * been granted and before the scroll view has decided this is a scroll.
     * Doing it on grant is one hop later and one re-render closer to the first
     * move, which is a race this does not need to be in.
     *
     * The volume took the other road and became a modal, where there is no
     * scroll view to argue with at all — so it is not checked here.
     */
    const knob = read('mobile/src/components/Knob.js')
    const edit = read('mobile/src/screens/Edit.js')

    assert.match(
      knob,
      /onStartShouldSetPanResponderCapture: \(\) => \{\s*\n\s*live\.current\.onScrollLock\?\.\(true\)/,
      'the lock is not set in the capture phase, so the scroll view can start scrolling first'
    )
    assert.equal(
      (knob.match(/live\.current\.onScrollLock\?\.\(false\)/g) || []).length,
      2,
      'the knob does not release the screen on both the end and the termination of a drag'
    )
    /* A screen left locked by a drag that never released will not scroll again
       — worse than the bug being fixed. */
    assert.match(knob, /useEffect\(\(\) => \(\) => onScrollLock\?\.\(false\), \[onScrollLock\]\)/, 'a torn-down knob can leave the screen stuck')

    /*
     * "At first it scrolls the whole screen when I try to slide up and down on
     * a knob. It did start working for a minute." The lock is a prop, and a
     * prop reaches the native side a frame after the finger lands; the first
     * movement on a fresh screen got there first. Two more things, both in
     * force before the finger lands: the knob claims the touch in the capture
     * phase, and refuses to hand it back when the scroll view asks.
     *
     * NOT the scroll view's own native rule for that (canCancelContentTouches
     * false). On iOS it covers every child, and this page is buttons from top
     * to bottom, so a finger that landed on any of them could never become a
     * scroll: "On edit screen I can't scroll at all down to edit the
     * parameters." Nothing on this page may set it.
     */
    assert.match(knob, /onPanResponderTerminationRequest: \(\) => false/, 'the knob hands the touch back the moment the scroll view asks')
    assert.ok(!/canCancelContentTouches=\{false\}/.test(edit), 'the Edit page cannot be scrolled from a finger that lands on a button, which is all of it')

    /* And "very laggy": a finger on one knob redrew every mark on every knob
       on the block, sixty times a second. The ring and the pointer are memoised
       so only the knob that moved does any work. */
    assert.match(knob, /const Ring = memo\(function Ring\(\{ size, lit \}\)/, 'the ring is redrawn for every knob on every touch event')
    assert.match(knob, /const Pointer = memo\(function Pointer\(\{ size, angle \}\)/, 'the pointer is redrawn for every knob on every touch event')
    assert.match(knob, /<Ring size=\{size\} lit=\{lit\} \/>/, 'the knob does not draw its ring through the memoised part')

    /* And the screen it lives on honours it. */
    assert.match(edit, /scrollEnabled=\{!held\}/, 'the bench scrolls under its own knobs')
    assert.match(edit, /onScrollLock=\{onScrollLock\}/, 'the knobs are not wired to the lock')
    assert.match(edit, /onScrollLock=\{setHeld\}/, 'the block panel is not wired to the lock')
  })

  test('what pops up comes over the screen, never into it', () => {
    /*
     * "When holding a block to change channel have it be an overlay on the
     * screen instead of inserting itself into the screen like the web version."
     *
     * WHY INSERTING IS WORSE THAN IT SOUNDS, and it is not a matter of taste. A
     * panel that opens inside a scrolling page pushes everything below it down —
     * so the tiles a thumb was aimed at MOVE while the thumb is on its way, on
     * the one screen where that happens mid-song. The browser learned this and
     * made every one of these a sheet.
     *
     * Four things come up over the stage screen now: the tuner, the volume, the
     * channel picker and anything added later. Each is checked the same way,
     * because the failure is silent — an inline panel looks fine in a
     * screenshot taken while nothing is moving.
     */
    const stage = read('mobile/src/screens/Stage.js')

    /* The channel picker is a sheet, and the sheet is a modal. */
    assert.match(stage, /<ChannelSheet/, 'the channel picker is not a sheet')
    assert.match(read('mobile/src/components/Sheet.js'), /<Modal visible=\{!!open\}/, 'the sheet is not a modal, so it takes room in the page')
    assert.ok(
      !/DRV — CHANNEL|— channel<\/Label>|<Label>\s*\{shortBlock\([^)]*\)\} — channel/.test(stage),
      'the channel picker is drawn inline again, which reflows the tiles under a thumb'
    )

    /* Everything that pops up is drawn AFTER the content, outside the scrolling
       part of the screen — an overlay nested in the flow is an overlay that can
       still push things around. */
    const scroll = stage.indexOf('</ScrollView>')
    for (const tag of ['<ChannelSheet', '<Tuner']) {
      const at = stage.indexOf(tag)
      assert.ok(at > 0, `${tag} is gone from the stage screen`)
      assert.ok(at < scroll, `${tag} escaped the screen entirely`)
    }
    /* The volume is no longer one of them: its speaker moved to the bar at the
       top of the app, and the sheet went with the button that opens it. It is
       still a modal, which is the part that mattered — checked above. */

    /* And each one keeps a press that lands on it, so a thumb slipping off a
       control does not dismiss the thing it is holding. */
    for (const file of ['mobile/src/components/Sheet.js', 'mobile/src/components/Volume.js']) {
      assert.match(read(file), /onPress=\{\(\) => \{\}\}/, `${file} closes when a press lands on the panel itself`)
    }
  })

  test('the preset list opens on the preset you are playing', () => {
    /*
     * "I'm on preset 99. When preset button is tapped have it go to the current
     * preset on the list in the middle of the screen and have the current
     * preset highlighted in yellow to show what preset it's on."
     *
     * It opened at slot 0 every time, so the first thing the list did was hide
     * the one row anybody already knew they wanted — five hundred slots away.
     * The current row WAS marked; nobody had ever seen the mark.
     *
     * The arithmetic is the part that can go quietly wrong. Jumping to a row in
     * a five-hundred-row list means telling the list how tall a row is, and a
     * row that grows taller than that number without it moving sends the jump
     * to somewhere NEAR slot 99 — which is worse than not jumping, because it
     * looks like it worked.
     */
    const presets = read('mobile/src/screens/Presets.js')

    assert.match(presets, /const ROW = TAP/, 'the row height is no longer written down, so the jump cannot be computed')
    assert.match(presets, /const STRIDE = ROW \+ GAP/, 'the gap between rows is not counted, so the jump drifts down the list')
    assert.match(
      presets,
      /getItemLayout=\{\(_, i\) => \(\{ length: STRIDE, offset: STRIDE \* i, index: i \}\)\}/,
      'the list cannot be told to go to a row without drawing every row before it'
    )
    assert.match(presets, /initialScrollIndex=/, 'the list renders from the top and scrolls afterwards')
    assert.match(presets, /viewPosition: 0\.5/, 'the current preset lands at the top of the screen rather than the middle of it')

    /*
     * The gap is a margin, not the container's `gap`: getItemLayout cannot see
     * `gap`, so the error would compound down the list — fine at the top and
     * useless at the bottom.
     */
    assert.match(presets, /marginBottom: GAP/, 'the rows are spaced by something the jump cannot account for')
    assert.ok(
      !/contentContainerStyle=\{\{[^}]*gap:/.test(presets),
      'the list is spaced with `gap`, which getItemLayout cannot see'
    )

    /* Once, on opening. Re-centring whenever the preset changed would yank the
       list out from under a thumb that is scrolling it. */
    assert.match(presets, /if \(centred\.current \|\| hunting\) return/, 'the list re-centres itself while somebody is scrolling or searching')

    /* And every row stays two lines, so ROW stays true. */
    assert.match(presets, /sub=\{here \? `\$\{slotLabel\(n, addressing\)\} · Playing`/, 'the current row is not marked in words')
    assert.match(presets, /tone="signal"[\s\S]{0,40}?on=\{here\}/, 'the current row is not marked in the colour this app uses for live')
  })

  test('pressing a preset shows it now, and confirms it behind that', () => {
    /*
     * "When tapping a preset there is about a 2 second delay before it
     * highlights it and goes back to the main screen."
     *
     * It waited for the lot: the select, then the preset, the scene, the scene
     * names and the whole chain — six round trips, two of them among the SLOW
     * reads that make the unit dump a preset over serial. Only then did
     * anything move.
     *
     * A control that waits that long before acknowledging a press reads as a
     * control that did not register it, which is how a preset gets loaded
     * twice. Everything else in rig.js is optimistic for exactly this reason;
     * this was the one write that was not.
     */
    const rig = read('mobile/src/lib/rig.js')
    /* To the end of the file: loadPreset is the last thing in it, and slicing
       to a name that appears EARLIER gives an empty string that quietly passes
       every check below. */
    const load = rig.slice(rig.indexOf('export async function loadPreset'))
    assert.ok(load.length > 200, 'loadPreset moved; this check reads it')

    /* The new slot is on screen before the unit is asked. */
    assert.ok(
      load.indexOf('preset: {') < load.indexOf('await device.selectPreset'),
      'the preset is still shown only after the unit has answered'
    )
    /* And put back if the unit refuses — captured before the change rather
       than rebuilt from a state that has already moved. */
    assert.match(load, /const was = state\.preset/, 'nothing remembers the preset to go back to')
    assert.match(load, /set\(\{ \.\.\.faultFrom\(err\), chain: 'ok', preset: was \}\)/, 'a refused select leaves the wrong preset on screen')

    /* Neither screen waits on it. */
    for (const file of ['mobile/src/screens/Presets.js', 'mobile/src/screens/Stage.js']) {
      assert.ok(
        !/await loadPreset\(/.test(read(file)),
        `${file} waits for the whole read before it does anything, which is the two seconds`
      )
    }
    assert.match(read('mobile/src/screens/Presets.js'), /loadPreset\(n\)\s*\n\s*onBack\?\.\(\)/, 'the picker does not close on the press')

    /*
     * The chain before the scene names. The chain is most of what the stage
     * screen draws and the names are the least urgent thing on it; reading the
     * names first left the tiles saying "reading" for a slow read nobody was
     * waiting on.
     */
    assert.ok(
      load.indexOf('await refreshBlocks()') < load.indexOf('await refreshSceneNames()'),
      'the chain waits behind a slow read of the scene names'
    )

    /*
     * And the gap is not filled with a guess. "Untitled" for the one round trip
     * before the unit says what the preset is called would be wrong more often
     * than right — the slot number is already on screen above it.
     */
    assert.match(load, /pending: typeof known !== 'string'/, 'nothing marks a preset whose name is not known yet')
    assert.match(
      read('mobile/src/screens/Stage.js'),
      /preset\?\.pending && !preset\?\.name \? '…' : presetLabel\(preset\)/,
      'the stage screen shows Untitled while it waits to be told the name'
    )
  })

  test('every name the phone uses is one that exists', () => {
    /*
     * THE HOLE THIS FILLS, dug twice, and the second one reached a stage.
     *
     * First: a screen used <Label> without defining or importing it. Nothing
     * caught it — <Label> compiles to a reference to an identifier, so Metro
     * bundles it happily, `expo export` succeeds, and the app installs. That
     * one was found by reading the file.
     *
     * Then the preset list called `useEffect` and imported `useCallback`,
     * `useRef` and `useState` — the line was one word short. It bundled. It
     * exported. It passed every check here. It went to TestFlight and it
     * crashed the app dead the moment the preset button was pressed:
     *
     *   Exception Type: EXC_CRASH (SIGABRT)
     *   React  RCTFatal + 568 (RCTAssert.m:147)
     *
     * A ReferenceError thrown while rendering is not an error message on a
     * screen. It is the process aborting, mid-set, on the one screen somebody
     * would be opening between two songs.
     *
     * There is no linter in this repository, and CI runs the tests and two
     * bundles. Not one of the three has an opinion about an identifier that is
     * used and never declared — which is the entire class of failure both of
     * these belong to. So this does, and it is no longer only about JSX: Babel
     * resolves every reference in the file against every scope it is nested
     * in, and whatever is left over is a global. Anything not on the list of
     * globals a phone actually has is a name that does not exist.
     *
     * That one pass covers both, which is worth saying because it was checked
     * rather than assumed — an element's name is a reference like any other, so
     * <Ghost /> comes out of the same list `useEffect` does. The hand-written
     * tag walk this replaced is gone, and a mutation for each of the two
     * failures above proves the one that is left still catches both.
     */
    const files = [
      ...walk(new URL('../mobile/src/', import.meta.url)),
      fileURLToPath(new URL('../mobile/App.js', import.meta.url)),
      fileURLToPath(new URL('../mobile/index.js', import.meta.url))
    ]
    assert.ok(files.length >= 30, `only ${files.length} phone files were read; this check found nothing`)

    for (const file of files) {
      const name = file.split('/mobile/')[1] || file
      const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })

      let loose = []
      traverse(ast, {
        Program(path) {
          loose = Object.keys(path.scope.globals)
        }
      })

      for (const word of loose) {
        assert.ok(
          PHONE_GLOBALS.has(word),
          `${name} uses ${word}, which is neither imported, declared, nor a global a phone has — ` +
            'it bundles, it installs, and it crashes the app when that code runs'
        )
      }
    }
  })

  test('the phone addresses a block by the name the unit actually uses', async () => {
    /*
     * THIS ONE SHIPPED, and it is the reason the rule is now a function with a
     * test under it rather than a field name typed at six call sites.
     *
     * The unit calls a block's address `effectId`. The phone read `eid`, which
     * nothing sends. Every read was undefined, so a tap on the drive sent
     * `/preset/blocks/undefined/bypass` — and the optimistic update that
     * matched on it flipped EVERY tile in the chain, because undefined equals
     * undefined. A whole chain lighting up at once, and a unit that changed
     * nothing.
     *
     * Checked against a block the browser's own mock produces, so the two apps
     * cannot disagree about the shape either: the mock answers as ForgeFX does.
     */
    const { idOf, sameBlock } = await import('../mobile/src/lib/unit.mjs')
    const { createMockDevice } = await import('../src/lib/mockDevice.js')

    const blocks = await createMockDevice().presetBlocks()
    const drive = blocks.find((b) => b.slug === 'drive')
    assert.ok(drive, 'the mock stopped reporting a chain; this check reads it')

    assert.equal(idOf(drive), drive.effectId, 'the phone reads a field the unit does not send')
    assert.ok(Number.isInteger(idOf(drive)), 'a block address that is not a number cannot be a URL')
    assert.ok(sameBlock(drive, drive.effectId))
    assert.ok(!sameBlock(drive, blocks.find((b) => b.slug === 'amp').effectId))

    /*
     * And the half that turns the next version of this from "every block" into
     * "no block", which is a bug somebody notices.
     */
    assert.equal(sameBlock(drive, undefined), false, 'a missing id still matches a block')
    assert.equal(sameBlock(drive, null), false)
    assert.equal(sameBlock({}, undefined), false, 'two blocks with no address match each other')

    /*
     * Nothing addresses a block by the field that was never there. Comments are
     * stripped first: the one place `.eid` is still written down is the note in
     * unit.mjs explaining why it must not be, and a check that forbids its own
     * explanation is a check nobody can document around.
     */
    const files = [
      'mobile/src/lib/rig.js',
      ...[...walk(new URL('../mobile/src/screens/', import.meta.url))].map(
        (f) => `mobile/${f.split('/mobile/')[1]}`
      )
    ]
    for (const file of files) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      assert.ok(
        !/\bb(?:lock)?\.eid\b/.test(code),
        `${file} addresses a block by .eid, which the unit does not send`
      )
    }
  })

  test('the stage hides the blocks nobody kicks; the bench shows the whole chain', async () => {
    /*
     * The same list, read by two screens that want different things from it.
     *
     * Nobody kicks an input block between two bars, so the stage screen hides
     * the four. The edit screen shows them — that screen is the chain being
     * LOOKED at, and a diagram that silently drops two of its blocks disagrees
     * with the unit about what the preset is.
     *
     * One read, though. It is a slow read and the relay is one channel, so
     * asking twice to get two lists would cost a second full preset dump.
     */
    const { EXCLUDED_BLOCKS } = await import('../mobile/src/lib/unit.mjs')
    const { createMockDevice } = await import('../src/lib/mockDevice.js')
    const device = read('mobile/src/lib/device.js')

    const all = await createMockDevice().presetBlocks()
    assert.ok(
      all.some((b) => EXCLUDED_BLOCKS.includes(b.slug)),
      'the mock has no input or output block, so this check proves nothing'
    )

    /* device.js imports react-native, so the filter is read rather than run —
       but what it filters is checked against the real list above. */
    assert.match(
      device,
      /export const stageBlocks = \(blocks\) =>\s*\(blocks \|\| \[\]\)\.filter\(\(b\) => !EXCLUDED_BLOCKS\.includes\(b\.slug\)\)/,
      'the stage list is no longer the chain less the four you never kick'
    )
    assert.match(
      device,
      /export async function presetBlocks\(\) \{[\s\S]*?return list\.filter\(\(b\) => b\?\.slug\)\s*\}/,
      'the read itself is filtering again, so the edit screen cannot see the ends of the chain'
    )

    const rig = read('mobile/src/lib/rig.js')
    assert.match(
      rig,
      /set\(\{ allBlocks: all, blocks: device\.stageBlocks\(all\), chain: 'ok' \}\)/,
      'the two lists no longer come from one read'
    )
    assert.match(read('mobile/src/screens/Stage.js'), /const ofBlocks = \(s\) => s\.blocks/)
    assert.match(read('mobile/src/screens/Edit.js'), /const ofBlocks = \(s\) => s\.allBlocks/)
  })

  test('a knob on the phone writes the way the browser does, and costs the unit no more', () => {
    /*
     * THREE RULES, all of them about what a knob does BESIDES move.
     *
     * It goes through the verified write. The unit accepts a write it then
     * ignores and reports success either way, so confirming is the only way to
     * know it landed — and which of the two encodings to try first is recorded
     * rather than guessed, because starting on the wrong one slams every AM4
     * knob to its minimum before the retry corrects it. Audibly.
     *
     * It does not re-read the rig. Every commit in the browser used to end in a
     * full read — the preset, the block list, the scene, its names and the
     * tempo — for a knob that changed none of them. On a phone that is five
     * round trips down one channel per knob, competing with the writes for the
     * same serial port.
     *
     * And it is never a level. A block level set to -60 dB makes a preset that
     * looks right and is silent, and a knob under a thumb is the easiest place
     * to do that by accident. The number is still shown, because gain staging
     * is something you need to read.
     */
    const edit = read('mobile/src/screens/Edit.js')

    assert.match(edit, /setParamConfirmed\(eid, p\.id, next, p\)/, 'a knob writes without confirming it landed')
    /*
     * Scoped to the knob's own commit rather than the whole file. The chain
     * editor DOES re-read after a placement, and it should: that write changes
     * what is in the preset. This is about the knob, which changes none of it
     * and already read its own value back two lines earlier.
     */
    const commit = edit.slice(edit.indexOf('const commit = async'), edit.indexOf('const applyModel'))
    assert.ok(commit.length > 100, 'the knob commit moved; this check reads it')
    assert.ok(
      !/refreshAll\(|refreshBlocks\(/.test(commit),
      'a knob commit re-reads the whole rig, which is four round trips it does not need'
    )
    assert.match(
      edit,
      /params\.filter\(\(p\) => !isSilencingParam\(p\.name\)\)/,
      'the knob deck is no longer keeping levels out'
    )
    assert.match(edit, /read-only/, 'the level is not shown at all now, so gain staging cannot be read')

    /* The same rule the browser holds, from the same file. */
    assert.match(read('src/components/Console.jsx'), /params\.filter\(\(p\) => !isSilencingParam\(p\.name\)\)/)
  })

  test('a model is named after the amp it is modelled on, on both screens', async () => {
    /*
     * "Search for the real life names that each AMP and all other effects are
     * based off of and list them next to the name."
     *
     * Scrolling three hundred model names looking for a Rectifier, every one of
     * them is a code word. The browser answers that from a catalog; the phone
     * asked the unit and got the code words, because an AM4 carries no lineage
     * at all and an FM3 only sometimes does.
     *
     * So the phone fills in the same nulls from the same catalog. Two screens
     * that filled them differently would make one amp into two amps.
     */
    const { withLineage } = await import('../mobile/src/lib/lineage.js')
    const { createMockDevice } = await import('../src/lib/mockDevice.js')
    const web = await import('../src/lib/lineage.js')

    const models = await createMockDevice().blockTypes('amp')
    const named = withLineage('amp', models)
    assert.equal(named.length, models.length, 'putting the catalog on lost or gained a model')

    const known = named.filter((m) => m.basedOn)
    assert.ok(known.length > 20, `only ${known.length} models say what they are; the catalog is not landing`)

    /* Character for character with the browser's answer, model by model. */
    assert.deepEqual(named, web.withLineage('amp', models))

    /* And the unit stays the authority on its own models. */
    const supplied = [{ value: 1, name: '59 Bassguy Bright', basedOn: 'what the unit said' }]
    assert.equal(withLineage('amp', supplied)[0].basedOn, 'what the unit said')

    /* The phone actually asks for it — a catalog nothing calls is a catalog
       that ships 50KB and changes nothing on screen. */
    assert.match(
      read('mobile/src/lib/device.js'),
      /withLineage\(slug, \(await remoteRequest\(`\/blocks\/\$\{slug\}\/types`\)\) \|\| \[\]\)/,
      'the phone reads the model list without the catalog on it'
    )
  })

  test('a knob claims the gesture, because the screen under it scrolls', () => {
    /*
     * A knob lives on a screen that scrolls vertically and turns on a vertical
     * drag. A control that waits to see which way the finger is going has
     * already lost the gesture to the scroll view — which is exactly how the
     * browser's knobs shipped twice not turning at all on an iPhone.
     *
     * So the drag is claimed on touch, not on the first movement. The cost is
     * that a finger landing on a knob cannot then scroll the page, which is the
     * right way round: the knobs are what that screen is for.
     */
    const knob = read('mobile/src/components/Knob.js')

    assert.match(knob, /onStartShouldSetPanResponder: \(\) => true/, 'a knob waits for movement before claiming the drag')
    assert.match(knob, /onPanResponderRelease/, 'a knob never commits what it was turned to')
    assert.ok(
      !/onMoveShouldSetPanResponder: \(_, [a-z]+\) =>[^\n]*Math\.abs/.test(knob),
      'the drag is gated on a movement threshold, which hands the gesture to the scroll view'
    )
    /* Vertical only. Circular tracking sounds right and isn't: the finger
       leaves the knob, and small movements near the centre jump. */
    assert.match(knob, /gesture\.dy/, 'the knob no longer turns on a vertical drag')
    assert.ok(!/gesture\.dx/.test(knob), 'the knob turns on horizontal movement, which no hardware editor does')
  })

  test('which setlist survives a sync is decided in one place, not two', () => {
    /*
     * The merge is the part that can lose somebody's work: a running order
     * built at the Mac on Tuesday and a star tapped on the phone on Wednesday
     * have to both survive meeting each other. Two apps merging by their own
     * rules would not argue — they would take turns overwriting, and the
     * setlist that went missing would look like one nobody saved.
     *
     * So the deciding is shared and only the network is not. The generated copy
     * is checked character for character elsewhere; this checks the phone did
     * not grow its own opinion beside it.
     */
    const phone = read('mobile/src/lib/cloudSetlists.js')
    assert.match(phone, /from '\.\/setlistMerge'/, 'the phone is not using the shared merge')
    assert.ok(
      !/function mergeUnits?\b/.test(phone),
      'the phone has its own merge, so the two apps can disagree about whose setlist survives'
    )
    /* And the recent list stays on the device that played it, both ends. */
    assert.ok(!/\brecent\b\s*[:,]/.test(read('mobile/src/lib/setlistMerge.js')), 'the recent list is being synced between devices')

    const web = read('src/lib/cloudSetlists.js')
    assert.match(web, /from '\.\/setlistMerge\.js'/, 'the browser is not using the shared merge either')
    assert.ok(
      !/function mergeUnits?\b/.test(web),
      'the browser kept a second copy of the merge'
    )
  })

  test('a garbled preset dump is asked for again on the phone, not shown', () => {
    /*
     * "PRESET_DUMP_HEADER: expected func 0x77 at offset 0, got 0x78", on a
     * stage, in a red bar above the preset being played. The browser has never
     * shown that sentence, because forgefx.js has wrapped its requests in the
     * retry since the day the message first appeared. The phone had no retry at
     * all — the same read, the same unit, a different app, and only one of them
     * asked again.
     *
     * Wrapped at remoteRequest rather than in device.js because every read that
     * makes the unit dump a preset passes through there: the block list, the
     * scene names, the volume slider's level.
     */
    const relay = read('mobile/src/lib/relay.js')
    assert.match(relay, /import \{ withRetry \} from '\.\/retry'/, 'the phone does not import the retry')
    assert.match(
      relay.replace(/\s+/g, ' '),
      /export async function remoteRequest\(path, options = \{\}\) \{.*?return withRetry\(\(\) => requestOnce\(path, method, options\), \{ method, path \}\)/,
      'the phone sends requests without going through the retry'
    )
    /* And it is the shared rule, not a second opinion about which requests may
       be asked twice. A phone that retried a write would send it twice. */
    assert.ok(
      !/PRESET_DUMP_HEADER/.test(relay),
      'the phone has its own copy of what a garbled dump looks like'
    )
  })

  test('an error on the phone can be put away', () => {
    /*
     * "See the error banner at top of screen. It also has no way to dismiss
     * it." A fault sat above the preset being played until something else
     * happened to replace it, which on a rig that had recovered could be the
     * rest of the song.
     *
     * The cross is on the Note itself so every caller gets the same one, and
     * only appears when the caller passed something for it to do — the notes
     * describing a live condition have nothing to put away.
     */
    const note = read('mobile/src/components/Note.js')
    assert.match(note, /onDismiss/, 'a Note cannot be dismissed')
    assert.match(note, /accessibilityLabel="Dismiss"/, 'the cross has no name for VoiceOver')
    assert.ok(
      /onDismiss \? \(/.test(note),
      'the cross is drawn whether or not there is anything for it to do'
    )

    const rig = read('mobile/src/lib/rig.js')
    assert.match(rig, /export const clearError = \(\) => set\(\{ error: null, errorLink: false \}\)/, 'the store cannot be told to forget an error')

    const stage = rig && read('mobile/src/screens/Stage.js')
    assert.match(
      stage.replace(/\s+/g, ' '),
      /\{error \? \( <Note tone="fault" onDismiss=\{clearError\}>/,
      'the play screen’s error still cannot be dismissed'
    )
    /* And the volume's, which lives on the bar now that the speaker does. It
       is not a Note — the bar is one line and has to stay one — but it is
       dismissible for the same reason. */
    assert.match(
      read('mobile/src/components/TopBar.js').replace(/\s+/g, ' '),
      /\{failed \? <Reported said=\{failed\} onClear=\{\(\) => setFailed\(null\)\}/,
      'a volume error still cannot be dismissed'
    )
    assert.match(
      read('mobile/src/screens/Edit.js').replace(/\s+/g, ' '),
      /\{error \? \( <Note tone="fault" onDismiss=\{\(\) => setError\(null\)\}>/,
      'the edit screen’s error still cannot be dismissed'
    )
  })

  test('the phone wears the browser\u2019s header', () => {
    /*
     * "Make sure the iOS app shows this exact header." What it had was a
     * sentence — "Connected to MacBook Pro SG 566" — which named the one fact
     * on that bar nobody needs mid-song, and left out the three they do: what
     * the unit is, what version this is, and whether the link is live. The
     * speaker and Setup were down in the slot row, fighting Edit for a corner.
     *
     * Five things, left to right, the same order as the browser: lamp, unit,
     * version, the state in one word, volume, setup.
     */
    const bar = read('mobile/src/components/TopBar.js')
    const flat = bar.replace(/\s+/g, ' ')

    const order = ['<Lamp state=', '{named}', 'v${APP_VERSION}', '{word.toUpperCase()}', 'accessibilityLabel="Volume"', 'accessibilityLabel="Connection and setup"']
    let last = -1
    for (const piece of order) {
      const at = bar.indexOf(piece)
      assert.ok(at > 0, `the header is missing ${piece}`)
      assert.ok(at > last, `${piece} is out of order against the browser's bar`)
      last = at
    }

    /* And the gear can be seen, on both phones, and is the same gear on both.
       "The settings icon is too dark to even see" — on Android, where ⚙ was a
       text character drawn in the text colour, and the text colour was never
       set, so it was black on black. The iPhone swapped that character for a
       picture of its own and hid the bug. It is Justin's own picture now,
       tinted, which settles the colour and the two-different-gears at once —
       so the character must not come back. */
    assert.match(
      flat,
      /<Image source=\{setupIcon\}[^>]*tintColor: color\.silk/,
      'the gear is not his picture, tinted — Android will draw it black on a black bar again'
    )
    assert.ok(!/>⚙</.test(bar), 'the gear character is back, and the two phones draw two different gears')

    /* The unit's own short name, not the Mac's. */
    assert.match(bar, /const ofDeviceName = \(s\) => s\.deviceName/, 'the header does not say what the unit is')
    /* The version, off the build rather than typed. */
    assert.match(bar, /from '\.\.\/lib\/version'/, 'the version on the bar is not the one that was built')
    /* And the word is the shared one, so the two apps cannot drift. */
    assert.match(bar, /from '\.\.\/lib\/link-word'/, 'the phone decides the word for itself')
    assert.match(flat, /linkWord\(tone, 'remote'\)/, 'the phone is not using the shared word')

    /* The old bar is gone rather than stacked above the new one. */
    const app = read('mobile/App.js').replace(/\s+/g, ' ')
    /* Flattened, because the props wrapped onto their own lines the day the
       unit name learned to go two places. The rule is that the bar is drawn
       with the link and a way into Setup, not that it fits on one line. */
    assert.match(app, /<TopBar link=\{link\} onOpenSettings=/, 'the app does not draw the header')
    assert.ok(!/function LinkBar/.test(app), 'the old sentence bar is still there, under the new one')
    assert.ok(!/Connected to \$\{/.test(app), 'the app still writes out which computer it found')

    /* And the stage screen gave up the two buttons the bar now carries. */
    const stage = read('mobile/src/screens/Stage.js')
    assert.ok(!/label="Setup"/.test(stage), 'Setup is on the stage screen as well as the bar')
    assert.ok(!/onOpenSettings/.test(stage), 'the stage screen still takes a way to Setup it no longer draws')
  })

  test('the play screen carries nothing but the rig', () => {
    /*
     * "Get rid of the everything you change here text at the bottom of the
     * screen."
     *
     * A footer explaining that changes land on the unit at the Mac. True, and
     * the kind of sentence you read once and then scroll past for the rest of
     * the app's life — on the one screen whose whole currency is buttons you
     * can hit without looking. The bar at the top already says which unit is
     * being driven and whether the link is up, which is the part that goes on
     * being worth the room.
     */
    const stage = read('mobile/src/screens/Stage.js')
    assert.ok(
      !/Everything you change here/.test(stage),
      'the explanation is back at the bottom of the play screen'
    )
    /* And nothing was left behind holding it up. An unused import is not a
       crash, but a face with nothing wearing it is how the next one starts. */
    assert.ok(!/const face =/.test(stage), 'the play screen still builds a font nothing uses')
    assert.ok(!/\bmono\b/.test(stage), 'the play screen still imports a face it does not draw with')
  })

  test('a chain read on the wire does not get a queue behind it', () => {
    /*
     * "App is very laggy especially on the set list screen." The log said why,
     * and it had nothing to do with setlists:
     *
     *   23:02:50.187 [wire] GET /preset/blocks — 2878ms
     *   23:02:50.748 [wire] GET /preset/blocks — 3123ms
     *   23:03:00.265 [wire] GET /preset/blocks — 3219ms
     *
     * Three of the same slow read, two of them half a second apart. The unit
     * emits an event per change and `handleEvent` asked for the chain on every
     * one — and each ask is a preset dump down a serial port with a relay in
     * front of it, one at a time, in a queue. A preset change that fires six
     * events puts twenty seconds of reading in front of the next thing anybody
     * presses, on any screen. That is what "laggy" was.
     *
     * The rule now: one on the wire, and at most one more owed behind it,
     * however many asks arrive meanwhile. The last read is still the true one.
     */
    const rig = read('mobile/src/lib/rig.js')

    /*
     * Read out of the one function, not out of the file. `handleEvent` also
     * calls refreshBlocks({ quiet: true }), and a pattern allowed to wander
     * across the file finds THAT one and passes while the follow-up here is
     * gone — which is exactly what the first version of this check did.
     */
    const from = rig.indexOf('export async function refreshBlocks')
    const to = rig.indexOf('async function readBlocks')
    assert.ok(from > 0 && to > from, 'refreshBlocks is not where this check expects it; nothing below was read')
    const fold = rig.slice(from, to).replace(/\s+/g, ' ')

    assert.match(fold, /if \(blocksInFlight\) \{ blocksAgain = true return blocksInFlight \}/, 'a second chain read queues behind the first instead of folding into it')
    assert.match(fold, /blocksAgain = false[\s\S]*?refreshBlocks\(\{ quiet: true \}\)/, 'the asks that arrived during a read are dropped, so the chain can be left stale')
    /* And the one that follows is quiet: the chain on screen is a moment old,
       not missing, and 'reading' blanks a row of buttons under a thumb. */
    assert.ok(!/refreshBlocks\(\)/.test(fold), 'the follow-up read blanks the chain somebody is aiming at')
  })

  test('the log says what was pressed, not only what answered', () => {
    /*
     * "Can we add more, like what buttons get tapped and what the app does, how
     * long it takes to activate what the button was suppose to do?"
     *
     * The wire log answered "was the unit slow". It could not answer "I pressed
     * it and nothing happened", because nothing wrote down that anything was
     * pressed — a log of answers with none of the questions.
     *
     * Logged in the two components every button in this app is made of, rather
     * than at the call sites: a log that depends on somebody remembering to add
     * a line has its hole exactly where the interesting thing happened.
     */
    const tapped = read('mobile/src/lib/tapped.js')
    assert.match(tapped, /await run\?\.\(\)/, 'the tap is not awaited, so nothing can say how long it took')
    assert.match(tapped.replace(/\s+/g, ' '), /catch \(err\) \{ done\(err\?\.message \|\| 'threw'\)/, 'a handler that throws leaves no line at all')

    for (const file of ['mobile/src/components/Press.js', 'mobile/src/components/Tile.js']) {
      const src = read(file)
      assert.match(src, /from '\.\.\/lib\/tapped'/, `${file} does not log what is pressed`)
      assert.match(src, /fire\(`press \$\{said\(/, `${file} presses without writing a line`)
      assert.match(src, /fire\(`hold \$\{said\(/, `${file} holds without writing a line`)
    }

    /* The first line goes down before the work starts, which is the whole
       point: a tap whose work never finishes is a tap with no second line. */
    assert.match(
      read('mobile/src/lib/debugLog.js').replace(/\s+/g, ' '),
      /export function logTap\(what, detail\) \{ const began = Date\.now\(\) logDebug\('tap', what, detail\)/,
      'the tap is only written down once it has finished, so a hang writes nothing'
    )
  })

  test('typing a setlist name does not fight the screen redrawing', () => {
    /*
     * "When deleting the name to rename it won't let the entire name delete, it
     * stops at the first letter." And: "when adding a set list it adds the
     * names twice."
     *
     * Both are one bug. It saved on every keystroke; each save writes storage,
     * which announces, which re-renders this whole screen between one letter
     * and the next. A React text box is told what it holds by its `value`, and
     * a `value` one frame late puts back the letter just deleted. Deleting
     * faster than the redraw deletes nothing; typing faster than it duplicates.
     *
     * So the box owns the name while it is being typed, and storage hears once,
     * when the typing stops.
     */
    const flat = read('mobile/src/screens/Setlists.js').replace(/\s+/g, ' ')

    assert.match(flat, /onChangeText=\{setDraft\}/, 'a keystroke still writes to storage')
    assert.match(flat, /onBlur=\{commitName\}/, 'nothing saves the name when the box is left')
    assert.match(flat, /onSubmitEditing=\{commitName\}/, 'the keyboard’s Done does not save the name')
    /* An empty box has to be allowed while typing — you cannot type a new name
       without clearing the old one — and simply is not what gets saved. */
    assert.match(
      flat,
      /const name = \(draft \?\? ''\)\.trim\(\) setDraft\(null\) if \(!chosen \|\| !name \|\| name === chosen\.name\) return/,
      'an empty name can be saved over a real one, or the box cannot be cleared'
    )
    /* And leaving by the Done button at the top unmounts the screen without
       ever blurring the box, which is a rename typed and then lost. */
    assert.match(
      flat,
      /useEffect\( \(\) => \(\) => \{ const \{ draft: d, chosen: c, device: unit \} = live\.current/,
      'a name typed and then left by the Done button is thrown away'
    )

    /*
     * THE NAME IS EDITED IN THE CARD. "When creating a new list it should only
     * show one text entry box, have it already highlight the setlist created,
     * to rename just by typing." There were two: the chosen card in amber, and
     * a Name box a screen further down, behind the keyboard on Android. The
     * card is the box now; a new one opens with its name selected and the
     * keyboard up.
     */
    assert.doesNotMatch(flat, /<Label>Name<\/Label>/, 'there is still a separate Name box under the cards')
    assert.match(flat, /editing=\{ source === l\.id \? \{ value: draft \?\? l\.name, setDraft, commitName, selectAll: justMade === l\.id \}/, 'the chosen card is not the name box')
    assert.match(flat, /autoFocus=\{selectAll\} selectTextOnFocus/, 'a new setlist does not open with its name selected and the keyboard up')
    assert.match(flat, /const list = createList\(device\) setSource\(device, list\.id\) setJustMade\(list\.id\)/, 'a new setlist is not the one whose name is selected')
    /* Choosing another card takes the box away unblurred; the name goes first. */
    assert.match(flat, /const choose = \(src\) => \{ commitName\(\) setSource\(device, src\) \}/, 'a name typed and then chosen away from is lost')
    /* And the keyboard: the page moves out from under it, as sign-in does. */
    assert.match(flat, /<KeyboardAvoidingView behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/, 'the keyboard covers the box it opened for')
  })

  test('the gear sheet is this unit’s models, and knows the comps and delays', async () => {
    /*
     * "Double check we have all the correct amps and effects listed. I know
     * there is way more delay pedals and compressors."
     *
     * Right on both counts. The compressor list had three entries and the unit
     * has sixteen; the delays had three against twenty-odd. Worse, one of the
     * three was wrong: Optical was down as "Urei 1176, loosely", and Fractal's
     * own Blocks Guide says that is the JFET type. Optical is an optocoupler.
     *
     * "Make sure they are specific to the unit connected as well as AM4 would
     * have different ones versus FM9 or Axefx 3 or VP4."
     *
     * Keeping five researched tables would be wrong twice over: wrong the day a
     * firmware adds a model, and wrong for a unit nobody here has ever had in
     * front of them. Every one of these units knows its own list and hands it
     * over, so the sheet asks — and falls back to the printed catalog when
     * there is nothing on the other end.
     */
    const { GEAR_GROUPS, groupsFor, gearTotal } = await import('../mobile/src/lib/gearCatalog.js')
    const by = (key) => GEAR_GROUPS.find((g) => g.key === key)

    /* The two he said were short. Counted, not spot-checked: a list that grew
       by one and stopped would pass any check written as "does it have X". */
    assert.ok(by('comp').entries.length >= 16, `the compressor list is back down to ${by('comp').entries.length}`)
    assert.ok(by('delay').entries.length >= 14, `the delay list is back down to ${by('delay').entries.length}`)

    /* The correction, named: the 1176 belongs to the JFET type and nowhere else. */
    const comp = Object.fromEntries(by('comp').entries.map((e) => [e.name, e.gear]))
    assert.match(comp['JFET Compressor'], /1176/, 'the JFET compressor no longer names the 1176')
    assert.ok(
      !/1176/.test(comp['Optical Compressor'] || ''),
      'Optical is called a 1176 again, which is the JFET type — see the Blocks Guide'
    )

    /* Every line the guide actually names a maker for. */
    assert.match(comp['DynamiComp'], /MXR/)
    assert.match(comp['Tube Compressor'], /Altec Lansing/)
    assert.match(comp['Studio FB Compressor'], /LA-2A/)
    const delay = Object.fromEntries(by('delay').entries.map((e) => [e.name, e.gear]))
    assert.match(delay['2290'], /TC Electronic/)
    assert.match(delay['Graphite Copy'], /Carbon Copy/)
    assert.match(delay['Deluxe Mind Guy'], /Memory Man/)
    assert.match(delay['Stereo Mind Guy'], /Memory Man/, 'the stereo Memory Man is missing again')

    /* Nothing carries a row it cannot say anything about. */
    for (const g of GEAR_GROUPS) {
      for (const e of g.entries) {
        assert.ok(typeof e.name === 'string' && e.name, `${g.key} has a nameless row`)
      }
    }

    /*
     * AND THE UNIT DECIDES WHAT IS LISTED. Handed three compressors, the sheet
     * shows three — not sixteen with thirteen this unit has never had.
     */
    const asUnit = groupsFor({ comp: [{ name: 'Pedal 1' }, { name: 'Optical Compressor' }] })
    const shown = asUnit.find((g) => g.key === 'comp')
    assert.equal(shown.entries.length, 2, 'the sheet ignored what the unit said it has')
    assert.equal(shown.fromUnit, true, 'the sheet cannot tell whether it asked or guessed')
    assert.match(shown.entries.find((e) => e.name === 'Pedal 1').gear, /stompbox/, 'a model read off the unit lost its lineage')

    /* A family the unit did not answer for keeps the printed list rather than
       emptying: a reference sheet that goes blank when a cable is out is worse
       than one that is a little too generous. */
    const amps = asUnit.find((g) => g.key === 'amp')
    assert.ok(amps.entries.length > 100, 'a family the unit said nothing about was emptied instead of kept')
    assert.equal(amps.fromUnit, false, 'a printed list is being reported as the unit’s own')

    /* What the unit says wins over the catalog, because it is the better
       authority on its own models. */
    const its = groupsFor({ comp: [{ name: 'DynamiComp', basedOn: 'Something only this unit knows' }] })
    assert.equal(
      its.find((g) => g.key === 'comp').entries[0].gear,
      'Something only this unit knows',
      'the catalog overrode what the unit said about its own model'
    )

    assert.ok(gearTotal() > 440, 'the sheet names fewer models than it used to')
  })

  test('the gear sheet asks the unit rather than printing one list at everybody', () => {
    /*
     * The screen half of the above. It said "your unit's models" over a list
     * baked in at build time — a claim it could not back up, and the reason an
     * AM4 was being shown three hundred amps it does not have.
     */
    const src = read('mobile/src/screens/Gear.js')
    const flat = src.replace(/\s+/g, ' ')
    assert.match(flat, /const said = await blockTypes\(family\.key\)/, 'the sheet never asks the unit what it has')
    assert.match(flat, /for \(const family of GEAR_FAMILIES\)/, 'the families are not walked, so some are never asked for')
    /* One at a time. Each is a round trip down the same serial port, and firing
       them together only queues them somewhere less visible. */
    assert.ok(
      !/Promise\.all\(/.test(flat),
      'the five reads go out together, which queues five slow reads at the unit at once'
    )
    assert.match(flat, /groupsFor\(rosters\)/, 'what the unit said is not what gets drawn')
    /* And the subtitle no longer claims something it cannot back up. */
    assert.match(flat, /plug in to see only yours/, 'the sheet still says “your unit’s models” about a printed list')
  })

  test('the play screen is not drawn before there is a rig to draw', () => {
    /*
     * "This is the screen that pops up for about 5 seconds after force closing
     * and reopening the app. Maybe we need a splash screen while it's loading?"
     *
     * The screenshot was the play screen with nothing in it: SLOT —, Untitled,
     * eight blank scene tiles, an empty chain, Previous and Next both dead. Not
     * one of those was a bug — each is the honest answer to a question nobody
     * has got an answer to yet — but together they read as a rig that has lost
     * everything, which is a bad five seconds to hand somebody plugging in
     * before a set.
     *
     * A splash screen would have covered it and said nothing. This says what it
     * is waiting for, which on a dead evening is the useful half.
     */
    const app = read('mobile/App.js')
    const flat = app.replace(/\s+/g, ' ')

    /* Capabilities is the gate: the first thing the unit answers with, and the
       thing the shape of every other answer depends on. */
    assert.match(
      flat,
      /const settling = auth === 'in' && !demo && \(link\.link === 'joining' \|\| \(link\.link === 'connected' && !caps && !readFailed\)\)/,
      'the play screen is drawn before the unit has said what it is'
    )
    /* The demo has nothing to wait for — it answers from memory — so waiting on
       it would be a spinner in front of a unit that is already there. */
    assert.match(flat, /!demo &&/, 'the demo is made to wait for a computer it does not have')
    assert.match(
      flat,
      /\{settling && screen === 'stage' \? \( <Waking link=\{link\} onRetry=\{probeNow\} onSwitch=\{\(\) => setScreen\('settings'\)\} \/>/,
      'nothing is shown while the app waits'
    )

    /*
     * BOUNDED ON BOTH SIDES. A waiting screen that can wait forever is worse
     * than the empty one it replaced: joining ends by itself when the relay
     * gives up, and a read that fails sets an error, which is worth showing
     * rather than waiting through.
     */
    assert.match(flat, /!readFailed/, 'a failed read leaves the app waiting on a spinner with the error behind it')
    assert.ok(
      !/settling && screen !== 'settings'/.test(flat),
      'the wait covers Setup as well, so a computer that never answers cannot be fixed from here'
    )
    /* And the bar stays up through it, which is what makes the wait safe at
       all: whatever happens, the gear is one tap away. */
    const bar = flat.indexOf('<TopBar link={link}')
    const wait = flat.indexOf('{settling && screen')
    assert.ok(bar > 0 && wait > bar, 'the waiting screen is drawn over the bar, so Setup cannot be reached')

    /* It says which thing it is waiting for, not "Loading…" — the one a person
       can act on is usually the Mac. */
    assert.match(flat, /Finding \$\{link\.macName \|\| 'your computer'\}/, 'the wait does not say what it is waiting for')
  })

  test('Settings says which account is signed in beside the version, and opens it', async () => {
    /*
     * "On this screen at the top either next to the version number or next
     * to where it says the unit name can we also list the user account if
     * they're signed in and if they're not signed in, have it say not signed
     * in. Then clicking on it will take them to where they can sign in or
     * otherwise show them their account info."
     */
    const phone = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    const top = phone.slice(phone.indexOf("{head('Settings')}"), phone.indexOf('title="Amp & pedal names"'))
    assert.match(top, /\{`v\$\{APP_VERSION\}`\}/, 'the version left the top of the phone’s Settings')
    assert.match(top, /signedInAs \|\| \(isPairAccount\(account\?\.email\) \? 'Paired, no account' : 'Not signed in'\)/, 'the phone does not say who is signed in, or that nobody is')
    assert.match(top, /setPage\('link'\) setAccountMenu\(true\)/, 'the phone’s account line does not open the account')
    assert.match(top, /onSignIn\(\)/, 'the phone’s Not signed in goes nowhere near a sign-in')

    const web = read('src/App.jsx').replace(/\s+/g, ' ')
    const head = web.slice(web.indexOf('<div className="setup-version-row">'), web.indexOf('<div className="setup-rows">'))
    assert.match(head, /\{FULL\}/, 'the version left the top of the browser’s Settings')
    assert.match(head, /signedInHere \? link\.account\.email : isPairAccount\(link\.account\?\.email\) \? 'Paired, no account' : 'Not signed in'/, 'the browser does not say who is signed in, or that nobody is')
    assert.match(head, /onClick=\{\(\) => setSetupPage\('link'\)\}/, 'the browser’s account line does not open the page with the account on it')
  })

  test('the phone’s preset list has the browser’s jumps, sized to the unit', async () => {
    /*
     * "Can we add the 100 200 300 400 500 thing to the mobile apps as well?
     * And obviously on the AM4/VP4 since they have less slots, maybe just make
     * those like 20 40 60 80 100?"
     */
    const { jumpsFor } = await import('../src/lib/presetJumps.js')
    assert.deepEqual(jumpsFor(512), [100, 200, 300, 400, 500], 'a 512-slot unit does not get hundreds')
    assert.deepEqual(jumpsFor(104), [20, 40, 60, 80, 100], 'an AM4 or VP4 does not get twenties')
    const src = read('mobile/src/screens/Presets.js').replace(/\s+/g, ' ')
    assert.match(src, /import \{ jumpsFor \} from '\.\.\/lib\/presetJumps'/, 'the phone has its own rule for where the jumps land')
    assert.match(src, /const jumps = jumpsFor\(slots\)/, 'the phone’s jumps are not sized to the unit')
    assert.match(src, /\{jumps\.length && !hunting \?/, 'the jumps stay up over search results they cannot jump through')
    /* They scroll, never load: a tap on 300 mid-set must not change the sound. */
    const jump = src.slice(src.indexOf('const jumpTo = (n) =>'), src.indexOf('return ( <View style={{ flex: 1 }}>'))
    assert.match(jump, /scrollToIndex/, 'a jump does not move the list')
    assert.ok(!/load|choose|select|setPreset/i.test(jump.replace(/\/\*[\s\S]*?\*\//g, '')), 'a jump loads a preset')
  })

  test('a computer on this wifi signed into another account is said, not waited on', async () => {
    /*
     * "The issue it wasn't connecting is because I was signed into the wrong
     * account, but it didn't notify me at all… Please be clear which account
     * needs to be trying to sign into, or which one it is signing into, and
     * they don't match somehow."
     */
    const sql = read('supabase/migrations/20260923_computer_elsewhere.sql')
    assert.match(sql, /returns boolean/, 'the account server says more than yes or no about another account')
    assert.ok(!/auth\.users/.test(sql), 'the check reads other accounts’ details, which it has no need of')
    assert.match(sql, /grant execute on function public\.computer_elsewhere\(\) to authenticated/, 'a signed-in phone cannot ask')
    assert.match(sql, /revoke all on function public\.computer_elsewhere\(\) from public, anon/, 'anybody at all can ask')

    for (const file of ['mobile/src/lib/relay.js', 'src/lib/remote.js']) {
      const src = read(file)
      assert.match(src, /rpc\('computer_elsewhere'\)/, `${file} never asks`)
      assert.match(src, /return !error && data === true/, `${file} reads a failure as a yes`)
    }

    const phone = read('mobile/App.js').replace(/\s+/g, ' ')
    const waking = phone.slice(phone.indexOf('function Waking('))
    assert.match(waking, /useComputerElsewhere\(long && link\.link !== 'connected'\)/, 'the phone never asks while it waits')
    assert.match(waking, /This phone is signed in as \$\{email\}/, 'the phone does not say which account it is on')
    assert.match(waking, /Switch account on this phone/, 'the phone gives no way to change account')
    assert.match(read('mobile/src/screens/Settings.js'), /useComputerElsewhere\(link === 'no-answer'\)/, 'Setup never asks')

    const web = read('src/components/ConnectScreen.jsx').replace(/\s+/g, ' ')
    assert.match(web, /computerElsewhere\(\)\.then/, 'the browser never asks')
    assert.match(web, /This browser is signed in as \$\{email\}/, 'the browser does not say which account it is on')
    assert.match(web, /\{mismatch \|\|/, 'the browser says the generic line over the real reason')
  })

  test('Unlock waits for the box saying a computer and a USB cable are needed', async () => {
    /*
     * "On the unlock part of this can we add a disclaimer question that
     * says… I understand this app requires a computer connected to my
     * Fractal unit via USB cable for the Fractal Remote app to work. With a
     * checkbox that must be selected to select the unlock button?"
     */
    const { P3 } = await import('../shared/onboarding.mjs')
    assert.equal(
      P3.real.agree,
      'I understand this app requires a computer connected to my Fractal unit via USB cable for the Fractal Remote app to work.',
      'the sentence is not his'
    )
    const phone = read('mobile/src/screens/Onboarding.js').replace(/\s+/g, ' ')
    assert.match(phone, /const \[agreed, setAgreed\] = useState\(false\)/, 'the phone’s box starts ticked, or is not there')
    assert.match(phone, /<Agree on=\{agreed\} label=\{P3\.real\.agree\}/, 'the phone draws no box')
    assert.match(phone, /<Press label=\{P3\.real\.go\} height=\{TAP\} disabled=\{!agreed\}/, 'the phone’s Unlock presses before the box is ticked')
    assert.match(phone, /accessibilityRole="checkbox"/, 'a screen reader cannot tell the phone’s box is a box')
    const web = read('src/components/PhoneWalkthrough.jsx').replace(/\s+/g, ' ')
    assert.match(web, /const \[agreed, setAgreed\] = useState\(false\)/, 'the browser’s box starts ticked, or is not there')
    assert.match(web, /<input type="checkbox" checked=\{agreed\}/, 'the browser draws no box')
    assert.match(web, /disabled=\{!agreed\} onClick=\{\(\) => agreed && leave\(onUnlock\)\}/, 'the browser’s Unlock presses before the box is ticked')
  })

  test('EDIT splits a block into the pages Fractal’s editor uses', async () => {
    /*
     * "Splitting EDIT's long list of controls into pages, like Fractal's own
     * editor." The unit sends those pages with every params read, as
     * `layout`; the list used to be cut after six controls into Main and More.
     */
    const { editPages, pageHolding } = await import('../src/lib/editPages.js')
    const knob = (id, name) => ({ id, name, value: 0, min: 0, max: 10 })
    const params = [knob(1, 'Drive'), knob(2, 'Tone'), knob(12, 'Bass'), knob(13, 'Mid'), knob(4, 'Mix'), knob(99, 'Unplaced')]
    const layout = {
      pages: [
        { name: 'Basic', rows: [
          { section: 'parameters', controls: [{ paramId: 1 }, { paramId: 2 }, { paramId: null }, { paramId: 7 }] },
          { section: 'mixer', controls: [{ paramId: 4 }] }
        ] },
        { name: 'Tone', rows: [{ section: 'parameters', controls: [{ paramId: 12 }, { paramId: 13 }, { paramId: 2 }] }] },
        { name: 'Empty', rows: [{ section: 'parameters', controls: [{ paramId: 50 }] }] }
      ]
    }
    const pages = editPages(params, layout)
    assert.deepEqual(
      pages.map((p) => [p.name, p.params.map((q) => q.id)]),
      [['Basic', [1, 2]], ['Tone', [12, 13, 2]], ['More', [4, 99]]],
      'the pages are not the editor’s, or a control the unit sent became unreachable'
    )
    assert.equal(pageHolding(pages, 13).name, 'Tone', 'a search cannot find the page its control is on')

    /* No layout — an older unit, or a block the editor has none for — is the old split. */
    const many = Array.from({ length: 9 }, (_, i) => knob(i, `K${i}`))
    assert.deepEqual(editPages(many, null).map((p) => [p.name, p.params.length]), [['Main', 6], ['More', 3]])
    assert.deepEqual(editPages(many.slice(0, 4), undefined).map((p) => p.name), ['Main'], 'four controls grew a More tab')

    /* Both ends draw their tabs from it, and keep the layout a model swap brings. */
    for (const [where, file] of [['phone', 'mobile/src/screens/Edit.js'], ['browser', 'src/components/Console.jsx']]) {
      const src = read(file)
      assert.match(src, /const pages = editPages\(editable, layout\)/, `the ${where} still cuts the list after six`)
      assert.match(src, /pages\.map\(\(pg\) =>/, `the ${where} draws no tab per page`)
      assert.ok((src.match(/setLayout\((p|fresh)\?\.layout \|\| null\)/g) || []).length >= 2, `the ${where} keeps an old model’s pages after a swap`)
      assert.ok(!/editable\.slice\(0, 6\)/.test(src), `the ${where} still has its own six-and-the-rest split`)
    }
  })

  test('the demo’s blocks have the editor’s pages, and its Compressor the FM3’s own ranges', async () => {
    const { createMockDevice } = await import('../src/lib/mockDevice.js')
    const { editPages } = await import('../src/lib/editPages.js')
    const unit = createMockDevice('fm3')
    const blocks = await unit.presetBlocks()
    const pagesOf = async (slug) => {
      const b = blocks.find((x) => x.slug === slug)
      const r = await unit.blockParams(b.effectId)
      return editPages(r.named, r.layout).map((p) => p.name)
    }
    assert.deepEqual(await pagesOf('drive'), ['Basic', 'Tone', 'Graphic EQ', 'Advanced', 'More'], 'the demo Drive is not on its editor pages')
    assert.deepEqual((await pagesOf('comp')).slice(0, 2), ['Basic', 'Sidechain'], 'the demo Compressor is not on its editor pages')

    /* Read off the FM3's tables rather than typed in as typical. */
    const comp = JSON.parse(read('src/data/block-params.json')).blocks.comp
    const by = Object.fromEntries(comp.named.map((p) => [p.name, p]))
    assert.deepEqual([by.Threshold.min, by.Threshold.max], [-60, 20], 'the demo Threshold stops at 0 dB, which the FM3’s does not')
    assert.equal(by.Q.value, 0.707, 'the demo Q does not start where the FM3’s does')
    assert.ok(!comp.source, 'the demo Compressor still says its ranges are only typical')
  })

  test('the waiting screen stops just spinning after fifteen seconds', async () => {
    /*
     * "Been stuck on connecting screen for over a minute on iOS. How long
     * until it times out and displays troubleshooting or refresh button. I
     * usually force close."
     *
     * A join that fails goes back to joining, so the wait has no end of its
     * own. After fifteen seconds it has to say what to check and give him
     * something to press, on both ends.
     */
    const flat = read('mobile/App.js').replace(/\s+/g, ' ')
    assert.match(flat, /const WAKING_LONG_MS = 15000/, 'the phone never says more than "Finding your computer"')
    const waking = flat.slice(flat.indexOf('function Waking('))
    assert.match(waking, /setTimeout\(\(\) => setLong\(true\), WAKING_LONG_MS\)/, 'the phone never says more')
    assert.match(waking, /clearTimeout\(t\)/, 'the timer outlives the waiting screen')
    assert.match(
      waking,
      /\{long && link\.link !== 'connected' \?/,
      'the help shows while the unit is being asked, when the computer has already answered'
    )
    assert.match(waking, /Open the Fractal app on the computer and make sure the computer is awake\./, 'no advice on the phone')
    assert.match(waking, /<Press label="Look for the computer again" onPress=\{\(\) => onRetry\?\.\(\)\} \/>/, 'no button on the phone')

    const web = read('src/components/ConnectScreen.jsx').replace(/\s+/g, ' ')
    assert.match(web, /if \(state !== 'joining'\) return undefined const t = setTimeout\(\(\) => setLong\(true\), 15000\)/, 'the browser never says more than Connecting')
    const joining = web.slice(web.indexOf('<h2>Connecting…</h2>'), web.indexOf("state === 'no-answer'", web.indexOf('<h2>Connecting…</h2>')))
    assert.match(joining, /\{long \?/, 'the browser shows its help at once rather than after a wait')
    assert.match(joining, /Make sure the Fractal app is open on the computer and the computer is awake\./, 'no advice in the browser')
    assert.match(joining, /onClick=\{onRetry\}[^>]*>\s*Try now/, 'no button in the browser')
  })

  test('the phone can teach somebody how to connect a computer', async () => {
    /*
     * "We also need to make instructions that teach people how to connect by
     * either downloading the Mac app, installing forgefx with a helper file for
     * terminal or a windows app (after we build those ones later)."
     *
     * What this is for is the person holding a phone that says NO COMPUTER and
     * has no idea a computer was ever part of the arrangement. The sign-in
     * screen asked for a code "your computer shows" and offered no way at all
     * to find out which computer, or how to make one show anything.
     *
     * ALL FOUR EXIST NOW, and each still carries its own status — the page was
     * written when only the Mac app was real, and the statuses are what kept
     * it from sending somebody hunting a download that had not been built.
     * What they now carry is the honest difference between a signed app, an
     * unsigned one Windows argues about, and a route that builds from source.
     */
    /*
     * THE ROUTES ARE THE BROWSER'S NOW, not the phone's.
     *
     * "This screen should not show up on the phone. A phone can't download
     * desktop software, it also isn't suppose to go to GitHub directly."
     *
     * The phone drew all three routes with their install steps and a button
     * under each that opened the GitHub releases page — every line of it
     * about a machine the reader is not holding, ending in a download the
     * handset cannot use. The list still exists and the browser still draws
     * it, because the browser IS running on the computer in question.
     *
     * What the phone offers instead is the two things it can do about it: the
     * address to type on the computer, and the link sent somewhere the
     * computer can open it.
     */
    const src = read('shared/ways-in.mjs')
    const screen = read('mobile/src/screens/Connect.js')
    assert.ok(!/WAYS/.test(screen), 'the phone lists the desktop download routes again')
    assert.ok(!/Linking\.openURL/.test(screen), 'the phone can be sent to a download page again')
    assert.match(screen, /TYPE THIS ON YOUR COMPUTER/, 'nothing says which machine the address is for')
    assert.match(screen, /\{DOWNLOADS_URL\}/, 'the address to type is not shown')
    assert.match(screen, /sendDownloadLink\(email\)/, 'there is no way to send the link to a computer')
    /*
     * AND NOTHING ELSE. The prose went the same way the routes did.
     *
     * "Remove all text except what's in the screen shot and make the stuff
     * that's visible in the screenshot larger. The [same thing] is on the
     * download page that they go to, so we don't need it here."
     *
     * Three paragraphs outlasted the routes: what the USB cable is for, what
     * to do once it is installed, and the one-program-one-port warning. All
     * three are on the page this screen sends somebody to, all three are
     * about the machine they are not holding, and on a phone they pushed the
     * two things you CAN act on down the screen.
     */
    for (const [pattern, what] of [
      [/never talks to the unit directly/, 'the USB explanation is back on the phone'],
      [/Once it is installed/, 'the after-install steps are back on the phone'],
      [/Only one program at a time/, 'the USB port warning is back on the phone'],
      [/What it is, and how to get the app onto it/, 'the subtitle promises an explanation this screen no longer gives']
    ]) {
      assert.ok(!pattern.test(screen), what)
    }

    /* And what is left is big enough to read at arm's length: the address and
       the email box at title size, the two labels a step up from micro. */
    assert.match(
      screen,
      /\{DOWNLOADS_URL\}[\s\S]{0,40}<\/Text>/,
      'the address is no longer the thing the screen is built around'
    )
    assert.ok(!/fontSize: font\.micro/.test(screen), 'a label on this screen is back at the smallest size in the app')
    assert.equal(
      (screen.match(/fontSize: font\.title/g) || []).length,
      3,
      'the heading, the address and the email box are not all at title size'
    )

    assert.match(src, /The Mac app/, 'the route that actually works is not offered')
    /*
     * Whatever repository this code lives in — see shared/ways-in.mjs REPO,
     * which is now the one place that name is written down. Read as a VALUE
     * rather than searched for in the source: the source builds the link from
     * REPO, so the literal URL does not appear in it any more.
     */
    const { RELEASES, REPO } = await import('../shared/ways-in.mjs')
    assert.equal(RELEASES, `https://github.com/${REPO}/releases`, 'there is nowhere to get the Mac app from')
    /*
     * The list, not `/releases/latest`.
     *
     * `/latest` is the newest release of ANY kind, and this repository
     * publishes an Android build on nearly every merge — so the link that
     * said "Download Fractal Remote for Mac" landed a person on an .apk.
     *
     * Comments stripped first: the file EXPLAINS why it is not /latest, and
     * naming the thing it is not is the clearest way to write that down.
     * Reading a comment as code is the mistake CLAUDE.md warns about.
     */
    assert.ok(
      !/releases\/latest/.test(src.replace(/\/\*[\s\S]*?\*\//g, ' ')),
      'the download link points at /latest, which on this repository is usually the Android build'
    )
    assert.match(src, /The Windows app/, 'Windows is not mentioned at all')
    /*
     * And the blue box, said before it appears. An unsigned installer makes
     * Windows show "Windows protected your PC", and somebody who meets that
     * with no warning assumes they downloaded something bad and stops.
     */
    assert.match(src, /Windows protected your PC/, 'nothing warns about the SmartScreen box the unsigned installer causes')
    assert.match(src, /Run anyway/, 'the SmartScreen warning is named with no way past it')
    /* Linux has its own download now, which is what the terminal route used
       to stand in for — and it says which file to take, because AppImage and
       .deb are not the same decision. */
    assert.match(src, /Linux/, 'Linux is not mentioned at all')
    assert.match(src, /AppImage/, 'the Linux route does not say which file to take')

    /*
     * AND NO COMMAND IS INVENTED, which is the rule that has not changed —
     * only the answer has, twice.
     *
     * The page first said there was no one-line installer, because there was
     * not. Then there were two, and a test held each printed command to the
     * file it fetched. Now there are none again: both cloned private
     * repositories and could not work without a token, so they were removed
     * rather than left as a wall with instructions.
     *
     * What survives is the rule underneath all three versions — nothing on
     * this page may be a command that was never run. So there is no shell
     * line here at all, and the check is that none appears.
     */
    const shellish = /curl -fsSL|irm https?:|\| *(bash|iex)\b/
    assert.ok(
      !shellish.test(src),
      'the connect screen prints a shell command again — if it is real it needs a file behind it, and if it needs a token it is not a route'
    )
    for (const gone of ['mac.sh', 'windows.ps1']) {
      assert.ok(!src.includes(gone), `the connect screen still points at ${gone}, which no longer exists`)
    }

    /*
     * THE THING NOBODY KNOWS IS ON THE DOWNLOADS PAGE, not on the phone.
     *
     * Both of these used to be asserted against the phone screen as well.
     * They are still required — of shared/ways-in.mjs, which is what the
     * downloads page draws, and which is read on the computer the sentences
     * are actually about.
     */
    assert.match(src, /plugs into a computer|USB cable/, 'the downloads page never says why a computer is involved')
    /* And the trap that eats an evening: two programs, one port. */
    assert.match(src, /Only one program can hold the USB port/, 'nothing warns about the editor already holding the port')

    /* Reachable from both ends: Setup, and the sign-in screen — which is where
       somebody is stuck when they have no computer to get a code from. */
    assert.match(
      read('mobile/App.js').replace(/\s+/g, ' '),
      /screen === 'connect' \? \( <Connect onBack=/,
      'the app cannot open the page'
    )
    assert.match(read('mobile/src/screens/Settings.js'), /onPress=\{onOpenConnect\}/, 'Setup has no door to it')
    const signIn = read('mobile/src/screens/SignIn.js')
    assert.match(signIn, /if \(helping\) return <Connect onBack=/, 'the sign-in screen cannot reach it')
    assert.match(signIn, /Connect my computer/, 'the sign-in screen does not offer it')
  })

  test('the App Store review notes name buttons that exist', () => {
    /*
     * THE PARAGRAPH THAT DECIDES WHETHER THE APP IS REJECTED, and it had gone
     * stale without anything noticing.
     *
     * It told the reviewer: "On the first screen, tap 'Just looking? Try the
     * demo'".
     *
     * I FIRST WROTE THAT THE BUTTON DID NOT EXIST. It did — on the sign-in
     * screen, which is not the first screen. A fresh install opens the
     * walkthrough (App.js, `seenWalk === false`), and the sign-in screen is
     * only reached after it. So a reviewer followed that instruction, looked
     * for the button on a screen that does not have it, and concluded the app
     * does nothing — the exact rejection these notes exist to prevent. Right
     * button, wrong screen, same outcome.
     *
     * It is renamed in any case now: "Change just looking to just Try the
     * Demo - no text underneath".
     *
     * Nothing in the build reads store copy, so renaming a button cannot
     * break it. This is what breaks instead.
     */
    const notes = read('docs/app-store.md')
    const copy = read('shared/onboarding.mjs')

    /* Every button the notes tell a reviewer to tap is a label the app draws. */
    for (const [label, where] of [
      ['Get started', 'P1.go'],
      ['Got it', 'P2.go'],
      ['Start free demo', 'P3.demo.go'],
      ['Play with ', 'P4.go']
    ]) {
      assert.ok(copy.includes(label), `the notes send a reviewer to "${label}", which ${where} no longer says`)
      assert.ok(notes.includes(label), `the review notes stopped naming ${where}`)
    }

    /*
     * ONLY THE FENCED BLOCK, which is the text that actually gets pasted into
     * App Store Connect. The prose under it QUOTES the old wording to explain
     * what went wrong, and reading that as live copy fails the test on its own
     * explanation — the same trap CLAUDE.md warns about for App.jsx, hit for
     * the fifth time.
     */
    const after = notes.slice(notes.indexOf('## Review notes'))
    const pasted = after.slice(after.indexOf('```') + 3, after.indexOf('```', after.indexOf('```') + 3))

    /* The label that is gone stays gone. */
    assert.ok(
      !/Just looking\? Try the demo/.test(pasted),
      'the review notes name a button that was removed months ago'
    )
    /*
     * AND THEY DO NOT PROMISE WHAT THE APP STOPPED DOING. They said it worked
     * "on a local network" with no account, and that signing in was only for
     * reaching a computer from outside your home wifi. Both stopped being true
     * when pairing became account-only — and a reviewer told the app does
     * something it does not is the same rejection as a button that is not
     * there.
     */
    assert.ok(
      !/local network|outside your home\s+wifi/i.test(pasted),
      'the review notes describe the two-tier app that no longer exists'
    )
  })

  test('the unlock row is gone once there is nothing left to unlock', () => {
    /*
     * "This is the setup page when the phone has already been unlocked. The
     * unlock full version needs to disappear if it has been unlocked."
     *
     * It used to stay and reword itself to "Full version · Unlocked — thank
     * you": a row that can be pressed to be told a thing it has already said.
     * Nobody opens Setup to be thanked.
     */
    const settings = read('mobile/src/screens/Settings.js')
    const shown = settings.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

    assert.match(shown, /\{purchase\.unlocked \? null : \(/, 'the unlock row still draws for somebody who has paid')
    assert.ok(!/Unlocked — thank you/.test(shown), 'the row still rewords itself instead of going')

    /*
     * AND THE APPLE RULE IS UNTOUCHED, which is the only reason to be careful
     * here: a purchase has to be restorable and apps are rejected for hiding
     * it. That rule is about somebody who CANNOT reach what they bought, and
     * `unlocked` false is exactly that person — a new handset reads false
     * until a restore says otherwise. They still get the row, and it still
     * says restoring is on it.
     */
    assert.match(
      shown,
      /title="Unlock the full version"[\s\S]{0,400}Drive a real rig, or restore a purchase/,
      'somebody who paid and changed phones has no way back to what they own'
    )
    /* The paywall behind it keeps its own Restore button, checked elsewhere. */
    assert.match(shown, /onPress=\{onUnlock\}/, 'the row no longer opens the paywall')
  })

  test('every colour a screen asks for is a colour the theme has', () => {
    /*
     * A TOKEN THAT DOES NOT EXIST FAILS SILENTLY, which is why this is here.
     *
     * Writing `backgroundColor: color.ink` in the walkthrough bundled clean,
     * exported clean for both platforms and passed every test — because the
     * theme has no `ink`, the value was undefined, and React Native treats an
     * undefined background as no background. The pill I had drawn as a solid
     * chip over a lit cable would have shipped transparent, with the line
     * running straight through the words, and the first anyone knew would
     * have been a screenshot.
     *
     * The rule is the same one this project applies to gear facts: a name
     * that looks right and is wrong is worse than a name that is missing.
     */
    const theme = read('mobile/src/lib/theme.js')
    const known = new Set(
      [...theme.slice(theme.indexOf('const DARK = {'), theme.indexOf('}', theme.indexOf('const DARK = {')))
        .matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
    )
    assert.ok(known.size > 10, 'the theme moved; this test reads DARK by shape')

    /* Walked here rather than with a helper, because this file has none. */
    const under = (rel) => {
      const out = []
      const walk = (at) => {
        for (const entry of readdirSync(fileURLToPath(new URL(at, import.meta.url)))) {
          const next = `${at}/${entry}`
          if (statSync(fileURLToPath(new URL(next, import.meta.url))).isDirectory()) walk(next)
          else if (entry.endsWith('.js')) out.push(next)
        }
      }
      walk(rel)
      return out
    }

    const asked = new Set()
    for (const rel of under('../mobile/src')) {
      const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      for (const m of text.matchAll(/\bcolor\.(\w+)/g)) {
        if (!known.has(m[1])) asked.add(`${rel.replace('../', '')}: color.${m[1]}`)
      }
    }
    assert.deepEqual(
      [...asked],
      [],
      `a screen asks for a colour the theme does not have:\n${[...asked].join('\n')}`
    )
  })

  test('every picture in the app is one he actually sent', () => {
    /*
     * "the images I sent you are the images I had so use those images. If you
     * have to crop them out whatever you have to do use the images that I
     * already sent you. I don't have more images."
     *
     * So every file in mobile/assets/icons was cut out of his own mockup of
     * the play screen, and nothing is there that nobody draws. This checks the
     * second half of that — a file that no screen imports is either a picture
     * that quietly stopped being used or one that was never his.
     *
     * It also holds the other direction: an import of a file that isn't there
     * is a red screen on a phone and nothing at all in a bundle test, because
     * Metro resolves assets at build time and a missing one fails the build
     * rather than this suite.
     */
    const dir = new URL('../mobile/assets/icons/', import.meta.url)
    const files = readdirSync(fileURLToPath(dir)).filter((f) => f.endsWith('.png'))
    assert.ok(files.length > 0, 'the icons are gone')

    /* Every .js under mobile/src, plus the app's root. */
    const sources = []
    const walk = (at) => {
      for (const entry of readdirSync(fileURLToPath(new URL(at, import.meta.url)))) {
        const next = new URL(`${at}${entry}`, import.meta.url)
        if (statSync(fileURLToPath(next)).isDirectory()) walk(`${at}${entry}/`)
        else if (entry.endsWith('.js')) sources.push(readFileSync(next, 'utf8'))
      }
    }
    walk('../mobile/src/')
    sources.push(read('mobile/App.js'))
    const all = sources.join('\n')

    const unused = files.filter((f) => !all.includes(`assets/icons/${f}`))
    assert.deepEqual(unused, [], `a picture nothing draws: ${unused.join(', ')}`)

    const missing = []
    for (const m of all.matchAll(/assets\/icons\/([\w.-]+)/g)) {
      if (!files.includes(m[1])) missing.push(m[1])
    }
    assert.deepEqual(missing, [], `a screen imports a picture that is not there: ${missing.join(', ')}`)
  })

  test('the blocks he drew wear his drawings, and the rest wear none', () => {
    /*
     * Nine families are in the mockup and nine are mapped. The point of the
     * check is the SECOND half: a family he did not draw gets nothing rather
     * than the nearest-looking picture of a different effect, because a delay
     * wearing the flanger's swirl is worse than a delay wearing nothing.
     *
     * Read rather than imported, and that is not laziness: the module's whole
     * job is to import PNGs, which node refuses and Metro resolves. Every
     * other check in this file that touches a screen does the same.
     */
    const src = read('mobile/src/lib/blockIcons.js')

    /* What the map actually holds, taken from the object literal rather than
       from the file as a whole, so a name in a comment proves nothing. */
    const table = src.slice(src.indexOf('const ICONS = {'), src.indexOf('}', src.indexOf('const ICONS = {')))
    const keys = [...table.matchAll(/^ {2}(\w+)\s*(?::|,|$)/gm)].map((m) => m[1])

    for (const slug of ['amp', 'cab', 'comp', 'delay', 'drive', 'flanger', 'phaser', 'reverb', 'wah']) {
      assert.ok(keys.includes(slug), `${slug} is in the mockup and has no picture`)
      assert.ok(src.includes(`assets/icons/${slug}.png`), `${slug}'s picture is not the file of that name`)
    }

    /* Nothing else. The nine he drew and the one alias for the long spelling
       of the first of them — anything beyond that is a picture of some other
       effect being lent to a family, which is the failure this exists for. */
    assert.deepEqual(
      keys.filter((k) => !['amp', 'cab', 'comp', 'delay', 'drive', 'flanger', 'phaser', 'reverb', 'wah'].includes(k)),
      ['compressor'],
      'a family he did not draw was given somebody else’s picture'
    )

    /* A suffix and a display name reach the same picture the colours do —
       blockColors normalises the same three ways, and the two maps have to
       agree or a tile comes out red with the delay's dots on it. */
    assert.match(src, /key\.replace\(\/\\d\+\$\/, ''\)/, 'a second drive loses its picture')
    assert.match(src, /replace\(\/\[\^a-z\]\/g, ''\)/, 'a spelled-out name loses its picture')
    assert.match(src, /if \(!slug\) return null/, 'a block with no slug is not handled')

    /* And the stage actually asks for them. */
    assert.match(read('mobile/src/screens/Stage.js'), /icon=\{blockIcon\(block\.slug\)\}/, 'the chain tiles are drawn without their pictures')
  })

  test('the paywall sells the unlock, not whichever package came first', async () => {
    /*
     * FOUND IN THE LIVE ACCOUNT, not imagined.
     *
     * RevenueCat starts a project with three sample packages — $rc_monthly,
     * $rc_annual and $rc_lifetime — and all three are sitting in the offering
     * this app reads. They resolve to nothing today, because the only products
     * on them belong to the Test Store, so taking the first package happened
     * to land on the right one.
     *
     * Attach a real product to the monthly sample and first-wins sells a
     * MONTHLY SUBSCRIPTION in an app whose paywall says "One payment, once" —
     * with the button showing a plausible price the whole time. Nothing would
     * fail; somebody would just be billed every month for a thing they were
     * told they were buying outright.
     *
     * So the product id chooses, and first-wins is only the fallback.
     */
    const src = read('mobile/src/lib/purchases.js')
    const picker = src.slice(src.indexOf('const theUnlockIn'), src.indexOf('const loadPrice'))
    assert.ok(picker.length > 50, 'the package picker moved; this check reads it')
    assert.match(picker, /p\?\.product\?\.identifier === PRODUCT_ID/, 'the package is not chosen by which product it sells')
    assert.ok(
      picker.indexOf('=== PRODUCT_ID') < picker.indexOf('every[0]'),
      'first-wins is tried before the product id, so the id changes nothing'
    )

    /* And nothing reaches for a package by position any more. */
    const noProse = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
    assert.ok(
      !/availablePackages\?\.\[0\]/.test(noProse),
      'something still takes the first package out of an offering'
    )

    /* The picker itself, run against the shape RevenueCat actually returns —
       the three sample packages, with the real unlock on the last of them. */
    const mod = await import(`data:text/javascript,${encodeURIComponent(
      picker.replace('const theUnlockIn', 'export const theUnlockIn') +
        "\nexport const PRODUCT_ID = 'cloud.newbold.fractalremote.full'\n"
    )}`).catch(() => null)
    if (mod) {
      const pack = (id) => ({ product: { identifier: id } })
      const offerings = {
        current: {
          availablePackages: [pack('monthly.sub'), pack('yearly.sub'), pack('cloud.newbold.fractalremote.full')]
        },
        all: {}
      }
      assert.equal(
        mod.theUnlockIn(offerings)?.product?.identifier,
        'cloud.newbold.fractalremote.full',
        'the picker took the monthly subscription over the unlock'
      )
      assert.equal(mod.theUnlockIn({ current: { availablePackages: [] }, all: {} }), null, 'an empty offering does not come back empty')
    }
  })

  test('somebody who has paid gets a door out of the demo, where the price used to be', () => {
    /*
     * "There needs to be a more clear way to exit the demo if it's
     * registering the purchase... instead of it saying unlock 999 at the top
     * have it just clearly say exit demo if they're in the demo and they've
     * already paid."
     *
     * The demo stays useful after a purchase — "somebody that wants to maybe
     * view what it looks like having an AxeFX 3 or another model they don't
     * have yet" — so it is not taken away. What was missing was a way out on
     * the same wall as the way in. The only one was Settings, two screens
     * away, because the pill beside DEMO is the unlock, and an unlock is the
     * one thing that person does not need.
     */
    const bar = read('mobile/src/components/TopBar.js')
    const flat = bar.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ').replace(/\s+/g, ' ')

    assert.match(flat, /const canLeave = demo && purchase\.unlocked/, 'the bar cannot tell a paid demo from an unpaid one')
    assert.match(flat, /accessibilityLabel="Exit demo"/, 'there is no way out of the demo in the bar')
    assert.match(flat, /onPress=\{\(\) => \{ tick\(\) setDemo\(false\) \}\}/, 'the way out does not leave the demo')
    assert.match(bar, /import \{ setDemo, useDemo \} from '\.\.\/lib\/demo'/, 'the bar cannot turn the demo off')

    /*
     * `unlocked`, NOT `!canBuy`, and this is the part worth holding.
     *
     * canBuy is also false on a screen handed no onUnlock, and on a phone
     * whose store could not be reached. Neither of those is somebody who has
     * paid, and telling either of them that leaving is their only option
     * would be the paywall disappearing on the people most likely to need it.
     */
    assert.ok(!/canLeave = demo && !canBuy/.test(flat), 'a phone that merely cannot buy is treated as one that has paid')

    /* The two pills never appear together: one is for somebody who has paid
       and the other only shows when there is something to sell. */
    const buy = flat.indexOf('{canBuy && purchase.price ?')
    const leave = flat.indexOf('{canLeave ?')
    assert.ok(buy > 0 && leave > 0, 'one of the two pills is gone')
    assert.ok(leave < buy, 'the way out is drawn after the price, so a paid phone reads second')
  })

  test('the live app is never reached without an account', () => {
    /*
     * "Right now I'm not signed in and it's still letting me use it... the
     * user should be required to either sign in if they already have a sign
     * in or sign up right after they unlock it and they shouldn't be able to
     * get past that screen."
     *
     * THE HOLE, AND IT WAS OPENED BY THE FIX BEFORE THIS ONE.
     *
     * `auth` becomes 'in' at startup if the demo is on OR a session is found,
     * because the demo needs no account. That was honest while the only way
     * out of the demo was a button. Then buying started ending the demo —
     * right in itself — and left 'in' standing behind it: the live app,
     * unlocked, signed in to nothing, reaching nothing, and nothing on screen
     * saying so.
     *
     * So the state has to be rechecked whenever the demo goes off.
     */
    const app = read('mobile/App.js')

    /* The startup read is what grants 'in' to a demo with no session. */
    assert.match(app, /restoreDemo\(\)\s*\n\s*\.then\(\(on\) => \(on \? true : haveSession\(\)\)\)/, 'the startup check moved; this test reads it')

    /* And this is what takes it back. */
    const guard = app.slice(app.indexOf('THE DEMO IS NOT AN ACCOUNT'))
    assert.match(guard, /if \(demo \|\| auth !== 'in'\) return undefined/, 'the guard runs while the demo is on, or when nobody is in')
    assert.match(guard, /haveSession\(\)\s*\n\s*\.then\(\(id\) => alive && !id && setAuth\('out'\)\)/, 'a phone with no session is left in the live app')
    assert.match(guard, /\}, \[demo, auth\]\)/, 'the guard does not re-run when the demo ends')

    /*
     * ON THE DEMO ENDING, NOT ON THE PURCHASE. Leaving by the Exit demo
     * button has the identical gap, and a check on the state cannot be
     * forgotten by a route somebody adds later.
     */
    assert.ok(
      !/buyUnlock[\s\S]{0,400}setAuth\('out'\)/.test(read('mobile/src/lib/purchases.js')),
      'the account check hangs off the purchase, so other ways out of the demo skip it'
    )

    /* And the screen they land on is the one that claims the purchase. */
    assert.match(app, /onSignedIn=\{\(\) => \{[\s\S]{0,600}linkAccount\(\)/, 'signing in no longer attaches the purchase to the account')
  })

  test('signing in ends the demo, and a paid phone can start one', () => {
    /*
     * "When I sign in, it takes me directly to the demo."
     *
     * The way OUT to the sign-in screen already cleared the demo — toSignIn
     * does — but the way back IN did not. So somebody who tapped Try the Demo
     * on that screen, looked around, came back and signed in, arrived at a
     * simulated unit with their real one waiting behind it. Two halves of one
     * door disagreeing.
     */
    const app = read('mobile/App.js')
    const signedIn = app.slice(app.indexOf('onSignedIn={() => {'), app.indexOf("setAuth('in')", app.indexOf('onSignedIn={() => {')) + 20)
    assert.match(signedIn, /linkAccount\(\)/, 'signing in no longer claims the purchase')
    assert.match(signedIn, /setDemo\(false\)/, 'signing in leaves the phone in the demo')
    /* And the other half is still there, or the door only shuts one way. */
    assert.match(app, /const toSignIn = \(\) => \{[\s\S]{0,200}setDemo\(false\)/, 'leaving for the sign-in screen no longer ends the demo')

    /*
     * WHICH CLOSES THE ONLY WAY IN, so there has to be another.
     *
     * "It would be a good idea for somebody that wants to maybe view what it
     * looks like having an AxeFX 3 or another model they don't have yet." The
     * demo is off the walkthrough for anybody who has paid and signing in now
     * ends it, so without this a paying customer could never see one again.
     *
     * On the Phone & computer page, because that page is what the phone is
     * talking to. Behind the purchase, for the same reason Exit demo is.
     */
    const settings = read('mobile/src/screens/Settings.js')
    /* Comments out first: the note above this button is longer than any
       sensible window, and a check that depends on prose length is a check
       that breaks when somebody explains themselves properly. */
    const bare = settings.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ').replace(/\s+/g, ' ')
    assert.match(bare, /\) : purchase\.unlocked \? \( <Press label="Demo" onPress=\{\(\) => setDemo\(true\)\} \/>/, 'a paid phone has no way into the demo')

    /*
     * AND THE TWO DOORS ARE NAMED FOR THE TWO PEOPLE WALKING THROUGH THEM.
     *
     * "If they are already signed in and the app is unlocked, instead of
     * saying try the demo, have it just say Demo."
     *
     * Everywhere else in this app one errand gets one name, and that rule is
     * why Exit demo reads the same in the bar and in Setup. This is the
     * deliberate exception. "Try the Demo" is an offer, made to somebody who
     * has not paid and is still deciding. By the time the other button is on
     * screen the deciding is over — signed in, paid, and the demo is one of
     * the things they own. A place, not a pitch.
     *
     * Held from both ends so neither drifts into the other's wording.
     */
    assert.match(read('mobile/src/screens/SignIn.js'), /label="Try the Demo"/, 'the offer to somebody who has not paid stopped being an offer')
    assert.ok(!/label="Try the Demo"/.test(settings), 'Setup is pitching the demo at somebody who already owns it')
  })

  test('the three pieces and the scene bar come from his mockups, not from Views', () => {
    /*
     * "Crop the laptop and phone artwork from the second mockup to replace
     * the shapes I drew." And the play mockup's scene tiles each carry a rule
     * under the name that this screen did not have.
     */
    const onboarding = read('mobile/src/screens/Onboarding.js')
    for (const piece of ['piece-unit', 'piece-computer', 'piece-phone']) {
      assert.ok(onboarding.includes(`assets/${piece}.png`), `the walkthrough still draws ${piece} rather than showing it`)
    }
    /* The shapes are gone, not merely unused: three assemblies of Views that
       nothing renders is worse than either answer. */
    const art = onboarding.slice(onboarding.indexOf('const Art = ('), onboarding.indexOf('const ChainBox'))
    assert.ok(!/backgroundColor: color\.signal \}/.test(art), 'the drawn phone waveform is still in Art')
    assert.match(art, /source=\{PIECES\[kind\] \|\| PIECES\.unit\}/, 'Art no longer picks the picture by kind')

    /*
     * THE BAR, and the half of it worth holding: scenes have one, blocks do
     * not. He drew it that way, and a block already says On or Off in words —
     * a rule under those would be colour repeating what the text just said.
     */
    const tile = read('mobile/src/components/Tile.js')
    assert.match(tile, /\{bar \? \(/, 'the tile cannot draw the rule under the name')
    assert.match(tile, /backgroundColor: on \? at\(ink, 0\.8\) : hue/, 'the rule is not the tile’s own colour')

    const stage = read('mobile/src/screens/Stage.js')
    const scenes = stage.slice(stage.indexOf('<Label>Scenes</Label>'), stage.indexOf('blocks.map'))
    const chain = stage.slice(stage.indexOf('blocks.map'))
    assert.match(scenes, /\n\s+bar\n/, 'the scene tiles lost their rule')
    assert.ok(!/\n\s+bar\n/.test(chain), 'the chain tiles have a rule his mockup does not draw')
  })

  test('buying the app ends the demo', () => {
    /*
     * "After I did the test purchase, it just takes me back to the demo
     * screen."
     *
     * It did. The paywall is reachable from inside the demo — that is the
     * point of the demo — the purchase went through, the sheet closed, and
     * behind it was a simulated AM4 with DEMO in the bar. The one moment
     * somebody has definitely decided they want the real thing is the moment
     * the app was still pretending.
     *
     * In buyUnlock rather than on the screen that opened the paywall: there
     * is more than one way to that paywall, and this is the only place that
     * knows the money actually moved.
     */
    const src = read('mobile/src/lib/purchases.js')
    const buy = src.slice(src.indexOf('export const buyUnlock'), src.indexOf('export const restorePurchase'))
    assert.ok(buy.length > 100, 'buyUnlock moved; this check reads it')
    assert.match(buy, /if \(yes && isDemo\(\)\) \{\s*\n\s*setDemo\(false\)/, 'a purchase leaves the app in the demo')
    /* Guarded on both, and the order matters. A purchase that did NOT go
       through must not end the demo — somebody who cancelled is still
       looking around — and setDemo(false) in the live app is a write and a
       redraw for nothing. */
    assert.ok(
      buy.indexOf('if (yes && isDemo())') > buy.indexOf('set({ unlocked: yes })'),
      'the demo is ended before the purchase is known to have worked'
    )
    assert.match(src, /import \{ isDemo, setDemo \} from '\.\/demo'/, 'purchases cannot see the demo switch')

    /* And demo.js must not import purchases back, or Metro resolves one of
       the two to undefined at load and the failure is a blank screen. */
    const demo = read('mobile/src/lib/demo.js')
    assert.ok(!/from '\.\/purchases'/.test(demo), 'the demo and the purchases now import each other')
  })

  test('a purchase follows the person, not the handset', () => {
    /*
     * "It does unlock it on android because you can sign in with a user name
     * and password right?" — it did not. "Yes make it true, I don't want to
     * charge people to use other devices if they already purchased."
     *
     * The SDK was started anonymously: configure() with a key and no identity,
     * and no logIn anywhere. So RevenueCat knew "this install on this phone",
     * an iPhone purchase left an Android tablet locked with the same email
     * signed in on both, and the paywall meanwhile promised "the full version
     * of this app on any device you use, forever".
     */
    const buy = read('mobile/src/lib/purchases.js')

    /* The ACCOUNT id, not the email: an address can be changed, and a purchase
       tied to one somebody edits is a purchase they lose. */
    assert.match(buy, /api\.logIn\(id\)/, 'the SDK is still anonymous, so a purchase cannot cross devices')
    assert.match(buy, /const account = await currentAccount\(\)/, 'nothing asks who is signed in')
    assert.match(buy, /linkTo\(api, account\.id\)/, 'the link is not made with the account id')

    /* WHO before WHAT: the first read is already the account's, so a phone
       that never bought anything but is signed in to an account that did comes
       up unlocked rather than flashing the paywall and correcting itself. */
    const order = buy.indexOf('const linked = account?.id')
    assert.ok(order > 0 && order < buy.indexOf('const info = linked ||'), 'the store is asked before it is told who is asking')

    /*
     * AND SIGNING OUT FOLLOWS THE ACCOUNT OUT — which reverses what this
     * check used to require, so the reasoning matters.
     *
     * It used to keep the remembered answer: logOut returns a fresh anonymous
     * id that owns nothing, so re-reading would lock out somebody who bought
     * on this very phone and then signed out of an account they never needed
     * in order to buy.
     *
     * That protected one person and broke the screen for everybody else.
     * "When I log out of the phone... no option to unlock the app anywhere or
     * restore the purchase." Of course not — the Setup row and the paywall
     * are both hidden by the same `unlocked` flag, and the flag was still
     * true. A phone that can neither be unlocked nor restored is a dead end,
     * and the next person to sign in on it got the app for nothing.
     *
     * Restore is what the old rule was really reaching for, and it is better
     * at the job: it asks Apple or Google directly rather than asking
     * RevenueCat about an anonymous id, so a purchase made on this handset
     * comes back in one tap. Apple requires that button to exist anyway.
     */
    const out = buy.slice(buy.indexOf('export const unlinkAccount'))
    const body = out.slice(0, out.indexOf('\n}'))
    assert.match(body, /const info = await api\.logOut\(\)/, 'signing out throws away the answer logOut gives back')
    assert.match(body, /const yes = entitled\(info\)/, 'nothing reads whether the phone still owns anything')
    assert.match(body, /await remember\(yes\)/, 'the claim is not written down, so the next launch believes the old one')
    assert.match(body, /set\(\{ unlocked: yes \}\)/, 'the screen goes on showing the last person’s unlock')
    assert.ok(!/set\(\{ unlocked: true/.test(body), 'signing out hands the unlock to whoever signs in next')

    /* And the way back is still on the screen for the person the old rule
       protected: the Setup row appears the moment `unlocked` is false. */
    assert.match(
      read('mobile/src/screens/Settings.js'),
      /\{purchase\.unlocked \? null : \(/,
      'the unlock and restore row no longer comes back when the phone is locked'
    )

    /* Both ends wired: signing in links, signing out unlinks. */
    const app = read('mobile/App.js')
    assert.match(app, /checkOwner\(\)[\s\S]{0,260}linkAccount\(\)/, 'signing in does not link the account')
    assert.match(app, /await signOut\(\)[\s\S]{0,320}unlinkAccount\(\)/, 'signing out does not unlink')
  })

  test('leaving the demo takes the simulated rig with it', () => {
    /*
     * "This says I'm connected to an AM4 which I have not connected to in
     * weeks. I exited the demo and that's what it shows."
     *
     * It did. Leaving the demo left the screen dressed as a live rig: the
     * AM4's name in the bar, its 104 slots, its four scenes, its chain, and
     * CONNECTED in green beside them.
     *
     * startLink() short-circuits in the demo — there is no far end to poll, so
     * it sets link 'connected' with macName 'the demo' and returns. That is
     * right while the demo is on, because TopBar asks the DEMO store for the
     * word and says DEMO.
     *
     * The effect that runs it depended on `auth` alone. Turning the demo off
     * does not touch `auth` — Settings' "Leave the demo" calls setDemo(false)
     * and nothing else — so it never re-ran, stopLink() never happened, and
     * the invented 'connected' stayed while the word in the bar changed to
     * CONNECTED underneath it.
     */
    const app = read('mobile/App.js')

    /* The demo's short-circuit is still there, because it is not the bug. */
    const link = read('mobile/src/lib/link.js')
    assert.match(link, /if \(isDemo\(\)\) \{/, 'the demo polls a far end that does not exist')
    assert.match(link, /link: 'connected', macName: 'the demo'/, 'the demo stopped answering its own screens')

    /* And stopLink is what clears the rig, so it has to be the thing that runs. */
    assert.match(link, /resetRig\(\)/, 'stopping the link leaves the last unit on screen')

    /*
     * THE FIX, held exactly: the effect watches the demo as well as auth.
     * Whitespace-flattened, because a dependency array is the kind of line a
     * formatter moves.
     */
    const flat = app.replace(/\s+/g, ' ')
    assert.match(
      flat,
      /if \(auth !== 'in'\) return undefined startLink\(\) return \(\) => \{ stopLink\(\) \} \}, \[auth, demo\]\)/,
      'leaving the demo no longer tears the link down, so a simulated rig stays on screen as a real one'
    )

    /*
     * AND THE ROUTE THAT REPORTED IT. Settings' way out is setDemo(false) on
     * its own — which is fine now, and was the whole fault before.
     */
    assert.match(
      read('mobile/src/screens/Settings.js'),
      /label="Exit demo"[\s\S]{0,120}setDemo\(false\)/,
      'the way out of the demo moved; this test names it'
    )
  })

  test('the Setup list is in the order he put it in', () => {
    /*
     * "Move the amp and pedals button to the top of the list." Then: "Move
     * updates, troubleshooting, and the show the tutorial again underneath
     * the about section."
     *
     * Two instructions, a few months apart, and between them the list drifted
     * — Troubleshooting ended up between renaming presets and buying the app,
     * and the walkthrough between buying it and the version number. Nothing
     * decided that. Each row was added beside whatever it happened to be
     * written next to, which is how a list nobody holds ends up ordered by
     * the history of the file rather than by what anyone opens it for.
     *
     * So the order is held here. The split is his: everything somebody opens
     * Settings FOR, then About, then the three you only go looking for when
     * something is wrong or once, ever.
     */
    const settings = read('mobile/src/screens/Settings.js')
    /* Only the rows on the front page, not the ones inside the pages it opens. */
    const front = settings.slice(
      settings.indexOf("{page === null ? ("),
      settings.indexOf('THE TWO THAT ARE NOT DOORS')
    )
    const order = [...front.matchAll(/title=(?:"([^"]+)"|\{(?:purchase\.unlocked \? 'Full version' : '([^']+)'|(REPLAY))\})/g)]
      .map((m) => m[1] || m[2] || m[3])

    assert.deepEqual(order, [
      'Amp & pedal names',
      'Phone & computer',
      'Rename presets and scenes',
      'Unlock the full version',
      'About'
    ], 'the Setup rows are not in the order he asked for')

    /*
     * AND THE OTHER THREE ARE INSIDE ABOUT, not under it.
     *
     * "Move walkthrough, updates and troubleshooting INSIDE of the 'About'
     * menu." Moving them below About was the smaller version of the same
     * instruction an hour earlier: under it they still cost five lines of a
     * list somebody opens to do something else. In it they cost one.
     */
    const about = settings.slice(settings.indexOf("{page === 'about' ?"))
    for (const [pattern, what] of [
      [/title="Updates"/, 'Updates'],
      [/title="Troubleshooting"/, 'Troubleshooting'],
      [/title=\{REPLAY\}/, 'the walkthrough']
    ]) {
      assert.ok(pattern.test(about), `${what} is not inside About`)
    }
  })

  test('playing with no internet is explained, and only to somebody who paid', () => {
    /*
     * "Let's make that some kind of option in the app or to tell people how to
     * do it to connect without internet and give instructions to people that
     * have already unlocked it."
     *
     * The route is real and it is the only one that works in a room with no
     * signal. It was advertised in the wrong place — the website's signed-out
     * screen, headed "no account, no code", where it read as the way around
     * paying. Off that screen now, and told here instead, behind the unlock.
     */
    const settings = read('mobile/src/screens/Settings.js')
    const shown = settings.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

    assert.match(shown, /Playing with no internet/, 'nothing tells a paid-up person how to play without a signal')

    /*
     * BEHIND THE UNLOCK, and behind `mayDrive` rather than `unlocked` alone.
     * That one also says yes when the store could not be answered, and the
     * person whose signal is bad is exactly the person reading this.
     */
    assert.match(shown, /\{mayDrive\(purchase\) \?/, 'the instructions are shown to somebody who has not paid')
    assert.match(settings, /import \{ mayDrive \} from '\.\.\/lib\/unlock-rule'/, 'the gate is not the tested rule')

    /*
     * AND IT SENDS THEM TO THE BROWSER, because this app cannot do it.
     *
     * Everything here goes through the relay, which is on the internet. There
     * is no code in mobile/ that speaks to a computer over wifi, so any wording
     * implying this app connects without a signal would have somebody trying it
     * on a stage. The instruction names the browser and the menu bar.
     */
    assert.match(shown, /web browser/, 'the instructions do not say to use the browser')
    assert.match(shown, /menu bar/, 'nothing says where to find the address')
    assert.match(shown, /kept by that browser rather than in your account/, 'nothing says where those settings live')

    /* The claim the phone app can do it itself stays false, so it stays unmade. */
    for (const src of ['mobile/src/lib/relay.js', 'mobile/src/lib/rig.js', 'mobile/src/lib/device.js']) {
      assert.ok(
        !/http:\/\/\d+\.\d+\.\d+\.\d+|\.local:|localhost:/.test(read(src)),
        `${src} talks to a computer over the wifi, so the instructions above are out of date`
      )
    }
  })

  test('a report carries the log only when it is a bug, and only the useful end of it', async () => {
    /*
     * "Keep the last 200 lines plus the last 10 errors, only when they press
     * send, cap it around 100KB." And separately: the feature-suggestion box
     * is "separate from bug reports, with no debug log".
     *
     * THE SECOND OF THOSE IS THE ONE WITH TEETH. Somebody writing "it would be
     * nice if the tuner were bigger" has not offered a transcript of their
     * evening, and would be right to be annoyed to find they had sent one. So
     * the rule lives in one place, both apps ask it rather than each deciding,
     * and the table refuses a row that breaks it.
     */
    const r = await import('../shared/report-rules.mjs')

    assert.equal(r.carriesLog('bug'), true)
    assert.equal(r.carriesLog('idea'), false, 'a feature suggestion would carry the log')
    assert.deepEqual(r.KINDS, ['bug', 'idea'])

    const line = (i, source = 'app') => ({ at: i, source, message: `line ${i}`, detail: '' })

    /* A short log goes whole — nothing to choose between. */
    assert.equal(r.pickForReport([line(1), line(2)]).length, 2)
    assert.deepEqual(r.pickForReport([]), [])
    assert.deepEqual(r.pickForReport(), [], 'a missing log throws instead of being nothing')

    /*
     * A long one keeps the END. The lines just before a failure are the ones
     * that explain it; the ones an hour earlier are context somebody might
     * like. Taking the front is what a naive slice does and is the wrong way
     * round.
     */
    const long = [...Array(500)].map((_, i) => line(i))
    const tail = r.pickForReport(long)
    assert.equal(tail.length, r.LOG_LINES, 'the window is not the length it says')
    assert.equal(tail.at(-1).message, 'line 499', 'the newest line was dropped')
    assert.equal(tail[0].message, `line ${500 - r.LOG_LINES}`)

    /*
     * AND THE EARLY CRASH COMES BACK WITH IT, which is the case the window
     * alone gets wrong. A crash at the start of a long session, followed by an
     * hour of ordinary traffic, is exactly the report worth having and exactly
     * the one a 200-line tail loses.
     */
    const early = long.map((l, i) => (i === 3 || i === 7 ? line(i, 'crash') : l))
    const picked = r.pickForReport(early)
    assert.equal(picked.length, r.LOG_LINES + 2, 'the early crashes were not pulled back in')
    assert.deepEqual(picked.slice(0, 2).map((l) => l.message), ['line 3', 'line 7'])
    /* In the order they happened, and never twice. */
    assert.equal(new Set(picked).size, picked.length, 'a line is in the report twice')

    /* No more than ten of them, however many there were. */
    const many = [...Array(400)].map((_, i) => line(i, i < 50 ? 'error' : 'app'))
    assert.equal(r.pickForReport(many).length, r.LOG_LINES + r.LOG_ERRORS)

    /*
     * The cap, in bytes rather than characters — a log full of arrows and
     * em-dashes is not the length it looks — and it says what it left out. A
     * reader who cannot tell a short log from a trimmed one reads the first
     * surviving line as the beginning of the story.
     */
    const bytes = (v) => new TextEncoder().encode(v).length
    const fat = [...Array(5000)].map((_, i) => `${i} ${'x'.repeat(50)}`).join('\n')
    const cut = r.trimToBytes(fat)
    assert.ok(bytes(cut) <= r.LOG_BYTES, `trimmed to ${bytes(cut)}, over the ${r.LOG_BYTES} cap`)
    assert.match(cut.split('\n')[0], /earlier lines? left out to fit/, 'it trims silently')
    assert.match(cut.split('\n').at(-1), /^4999 /, 'it kept the front and dropped the answer')
    /* And leaves a log that fits completely alone. */
    assert.equal(r.trimToBytes('one\ntwo'), 'one\ntwo')

    /* The last thing that went wrong, for the top of the report. The message
       only — a stack belongs in the log, in order, not repeated in the one
       place meant to be readable at a glance. */
    assert.equal(r.lastErrorFrom(early), 'line 7')
    assert.equal(r.lastErrorFrom([line(1)]), '', 'a clean session invents an error')

    /*
     * And the whole row. `log` is null rather than "" when no log goes: a null
     * column says "no log was sent" and an empty one says "a log was sent and
     * it was empty", and a reader is asking the first question.
     */
    const format = (l) => `${l.source}: ${l.message}`
    const bug = r.buildReport({ kind: 'bug', message: ' it broke ', lines: [line(1)], format })
    assert.equal(bug.message, 'it broke', 'the message is not trimmed')
    assert.equal(bug.log, 'app: line 1')
    assert.equal(bug.contact, null, 'an empty contact is sent as a string')

    const idea = r.buildReport({ kind: 'idea', message: 'bigger tuner', lines: [line(1)], format })
    assert.equal(idea.log, null, 'a feature suggestion carried the log after all')

    /* Turning it off is the same as having none. */
    assert.equal(r.buildReport({ kind: 'bug', message: 'x', lines: [], format: null }).log, null)

    for (const [args, why] of [
      [{ kind: 'rant', message: 'x' }, 'an unknown kind was accepted'],
      [{ kind: 'bug', message: '   ' }, 'an empty message was accepted'],
      [{ kind: 'bug', message: 'x'.repeat(r.MAX_MESSAGE + 1) }, 'an over-long message was accepted']
    ]) {
      assert.throws(() => r.buildReport(args), why)
    }
  })

  test('both ends send a report the same way, and gather the log only on the press', async () => {
    /*
     * Two surfaces, one shape. The phone is where the bad evenings happen and
     * the browser is where they get read; a phone that trimmed differently
     * would produce reports nobody could compare with anything else.
     *
     * Read as text rather than run, because running either one means a
     * Supabase client and a React tree, and what is worth holding here is the
     * handful of decisions that are silent when wrong.
     */
    const web = read('src/lib/reports.js')
    const phone = read('mobile/src/lib/reports.js')

    for (const [where, src] of [['the browser', web], ['the phone', phone]]) {
      /* The rules come from the shared file, not from a second opinion. */
      assert.match(src, /report-rules/, `${where} decides for itself what a report carries`)
      assert.match(src, /buildReport/, `${where} assembles a report by hand`)

      /*
       * READ AT SEND AND AT NO OTHER MOMENT. "Only when they press send." The
       * log is fetched inside sendReport, so a report abandoned half-written
       * leaves no copy of anything anywhere.
       */
      const send = src.slice(src.indexOf('export async function sendReport'))
      assert.match(send, /lines: withLog \? getDebugLog\(\) : \[\]/, `${where} does not read the log at send`)

      /* And a report that says no log sends none, rather than sending one and
         hoping the far end ignores it. */
      assert.match(send, /format: withLog \? formatLine : null/, `${where} formats a log it was told not to send`)

      /*
       * The preview is the same two functions in the same order, so what
       * somebody is shown cannot drift from what goes. A preview built a
       * second way is a preview that is eventually a lie.
       */
      const preview = src.slice(src.indexOf('export function logPreview'))
      assert.match(
        preview,
        /trimToBytes\(pickForReport\(getDebugLog\(\)\)\.map\(formatLine\)\.join\('\\n'\)\)/,
        `${where} previews the log differently from how it sends it`
      )
      assert.match(preview, /if \(!carriesLog\(kind\)\) return ''/, `${where} previews a log for a kind that sends none`)

      /* What goes with it, and what must not. The context is built by the
         shared function, so neither end can quietly add a field. */
      assert.match(src, /contextFrom\(\{/, `${where} builds its own context`)
      assert.match(src, /lastError: lastErrorFrom\(getDebugLog\(\)\)/, `${where} does not say what last went wrong`)
    }

    /* The browser knows it is a browser and the phone knows it is a phone —
       the one place they are meant to differ. */
    assert.match(web, /navigator\.userAgent/, 'the browser never says which browser it is')
    assert.match(phone, /Platform\.OS/, 'the phone never says which OS it is on')
    assert.match(phone, /macVersion: link\?\.hostVersion/, 'the phone does not send the computer’s version')

    /*
     * And both screens draw the switch only where it means something. The
     * idea side does not get a log toggle it could leave on by accident.
     */
    for (const [where, src] of [
      ['the browser', read('src/components/Feedback.jsx')],
      ['the phone', read('mobile/src/screens/Report.js')]
    ]) {
      assert.match(src, /carriesLog\(kind\)/, `${where} decides for itself which kinds carry a log`)
      assert.match(src, /No log goes with this one/, `${where} never says that an idea sends no log`)
      assert.match(src, /logPreview\(kind\)/, `${where} offers no way to see what would be sent`)
      /* Switching kinds drops the preview: a log shown beside a form that is
         not sending one is worse than showing nothing. */
      assert.match(src, /setPreview\(null\)/, `${where} keeps a preview across a change of kind`)
    }

    /* Setup and the log screen both reach it on the phone, which is where the
       log is being looked at when somebody decides to send it. */
    assert.match(read('mobile/App.js'), /screen === 'report'/, 'the phone cannot open the report screen')
    assert.match(read('mobile/src/screens/Log.js'), /onReport/, 'the log screen offers no way to send it')
  })

  test('the three ways in are sorted for this computer, and never guessed at on a phone', async () => {
    /*
     * "Detect the user's OS and surface the matching option first."
     *
     * Straightforward in a browser and a trap on a handset, which is the whole
     * of what this holds. A browser is running ON the computer in question, so
     * its own user agent answers the question. A phone is not: knowing the app
     * is running on an iPhone says nothing about whether there is a Mac or a
     * PC on the desk, and putting the Mac routes first because somebody owns
     * an iPhone would be a guess dressed as an answer.
     *
     * So the phone takes the list as it comes and the browser sorts it — and
     * osGuess takes the user agent rather than reaching for `navigator`, which
     * a phone does not have and which would throw the first time that line ran.
     */
    const ways = await import('../shared/ways-in.mjs')

    assert.equal(ways.WAYS.length, 3, 'there are not three ways in')
    const ids = ways.WAYS.map((w) => w.id)
    assert.equal(new Set(ids).size, 3, 'two routes share an id')
    for (const want of ['mac-app', 'windows-app', 'linux-app']) {
      assert.ok(ids.includes(want), `there is no route for ${want}`)
    }
    for (const way of ways.WAYS) {
      assert.ok(['ready', 'manual', 'planned'].includes(way.status), `${way.id} has no honest status`)
      assert.ok(way.title && way.note, `${way.id} says nothing about itself`)
      assert.ok(way.steps.length >= 3, `${way.id} is a heading with no steps`)
      assert.ok(Array.isArray(way.links), `${way.id} has no links list`)
      /* A route that exists has to say where to get it. */
      if (way.status !== 'planned') assert.ok(way.links.length, `${way.id} names nowhere to go`)
      assert.equal(ways.wayById(way.id), way)
    }
    assert.equal(ways.wayById('nope'), null)

    /* Two are downloadable now — the app for each computer. The terminal
       routes stay `manual`, because building a server from source is not the
       same offer as an installer and should not read like one. */
    /*
     * THREE APPS NOW, and the Linux one exists because the answer to "what
     * does a Linux user do" was nothing. The one-paste installer looked like
     * the answer and was not: it clones three repositories, two of them
     * private, so a stranger stops at the first fetch.
     */
    assert.deepEqual(
      ways.WAYS.filter((w) => w.status === 'ready').map((w) => w.id),
      ['mac-app', 'windows-app', 'linux-app'],
      'the downloadable routes are not the three apps'
    )
    /*
     * AND THERE IS NO `manual` ROUTE ANY MORE. The two terminal ones cloned
     * private repositories and had to tell the reader to ask the author for a
     * token, which is a correspondence rather than a route. The apps cover
     * every computer, so the download is the only way in.
     */
    assert.equal(
      ways.WAYS.filter((w) => w.status === 'manual').length,
      0,
      'a terminal route is back — check it does not need a token before believing in it'
    )
    /* Nothing is `planned` any more, and the status stays in the vocabulary
       on purpose: the next route written will start out that way, and
       `waysFor` still has to sort it down the page. */
    assert.equal(ways.WAYS.filter((w) => w.status === 'planned').length, 0)

    const UA = {
      windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      /* An iPad's user agent says Macintosh, which is exactly the trap. */
      ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Macintosh',
      android: 'Mozilla/5.0 (Linux; Android 14)',
      linux: 'Mozilla/5.0 (X11; Linux x86_64)',
      chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)'
    }
    assert.equal(ways.osGuess(UA.windows), 'windows')
    assert.equal(ways.osGuess(UA.mac), 'mac')
    assert.equal(ways.osGuess(UA.linux), 'linux')
    /*
     * And the two that LOOK like Linux and are not. Every Android user agent
     * says "Linux", and a Chromebook says "X11; CrOS" — so both match the
     * Linux test unless they are ruled out before it. Android must not be
     * offered an AppImage, and ChromeOS's Linux environment is a container
     * whose USB access varies by machine.
     */
    assert.equal(ways.osGuess(UA.chromebook), null, 'a Chromebook was offered a Linux download')
    for (const handset of ['iphone', 'ipad', 'android'])
      assert.equal(ways.osGuess(UA[handset]), null, `a ${handset} was read as a computer`)
    assert.equal(ways.osGuess(''), null)
    assert.equal(ways.osGuess(), null, 'osGuess reaches for a user agent of its own')

    /* Sorted for this computer, and within it the thing that WORKS first — a
       Windows visitor used to open on "The Windows app — not built yet", which
       is a page that begins by saying it cannot help you. */
    assert.equal(ways.waysFor('windows')[0].id, 'windows-app')
    assert.equal(ways.waysFor('linux')[0].id, 'linux-app', 'a Linux visitor does not open on the Linux app')
    /*
     * THE SORT NOW HAS NOTHING TO SORT, and is checked anyway.
     *
     * There is one route per computer, so within an operating system the order
     * is the list's own. The rule still matters for the route after next: a
     * Windows visitor once opened on "The Windows app — not built yet", a page
     * whose first line says it cannot help you. Checked against a made-up pair
     * rather than against whichever statuses happen to be true today, because
     * the day this stops being checked is the day it silently stops working.
     */
    const works = (w) => (w.status === 'planned' ? 1 : 0)
    const madeUp = [
      { id: 'not-built', os: 'windows', status: 'planned' },
      { id: 'real', os: 'windows', status: 'ready' }
    ]
    assert.equal(
      [...madeUp].sort((a, b) => works(a) - works(b))[0].id,
      'real',
      'a route that does not exist would open the page'
    )
    assert.equal(ways.waysFor('mac')[0].id, 'mac-app')
    /* And nothing is reordered when nobody knows. */
    assert.deepEqual(ways.waysFor(null).map((w) => w.id), ways.WAYS.map((w) => w.id))
    assert.deepEqual(ways.waysFor().map((w) => w.id), ways.WAYS.map((w) => w.id))

    /* A module the phone bundles must not name a global the phone lacks. */
    assert.ok(
      !/navigator/.test(read('shared/ways-in.mjs').replace(/\/\*[\s\S]*?\*\//g, ' ')),
      'ways-in reaches for navigator, which a phone does not have'
    )

    /* Both ends draw it, and only the browser sorts it. */
    const web = read('src/App.jsx')
    assert.match(web, /waysFor\(thisComputer\)/, 'the browser does not sort the routes for this computer')
    assert.match(web, /osGuess\(typeof navigator === 'undefined' \? '' : navigator\.userAgent\)/, 'the browser never reads its own user agent')
    /*
     * The BROWSER draws it, and only the browser. The phone used to draw the
     * same list unsorted — a phone cannot know which computer is on the desk
     * — and now does not draw it at all: "a phone can't download desktop
     * software, it also isn't suppose to go to GitHub directly." So the
     * question of whether the phone sorts it cannot arise.
     */
    const phone = read('mobile/src/screens/Connect.js')
    assert.ok(
      !/WAYS|waysFor|osGuess/.test(phone.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')),
      'the phone is back in the business of listing desktop downloads'
    )
  })

  test('the app talks about a computer, not a Mac', () => {
    /*
     * "Go through the app and change any of the words Mac to computer. Some
     * people might be using a different device."
     *
     * Fair, and it was about to get worse rather than better: a Windows app is
     * on the list, and every sentence in here would have been wrong for it.
     *
     * COMMENTS ARE NOT TOUCHED, deliberately, and this check knows it. Several
     * of them quote Justin verbatim and several of those quotes say Mac — a
     * quote you have edited is not a quote. What a person reads is what had to
     * change.
     */
    const files = [
      ...walk(new URL('../mobile/src/', import.meta.url)),
      fileURLToPath(new URL('../mobile/App.js', import.meta.url))
    ]
    for (const file of files) {
      /*
       * ONE EXCEPTION, and it is the point rather than a hole in the rule.
       * The guide tells somebody what to install, and one of the four things
       * they can install is the Mac app. Calling it "the computer app" there
       * would be describing a download by a name it does not have.
       *
       * It used to be Connect.js alone. The routes moved into the list both
       * ends share (shared/ways-in.mjs, copied to lib/ways-in.js), so the
       * exception moved with the words — Connect.js is now only the phone's
       * way of drawing them.
       */
      if (file.endsWith('/screens/Connect.js') || file.endsWith('/lib/ways-in.js')) continue
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      for (const [, line] of text.matchAll(/'([^'\n]{8,})'/g)) {
        /* A real machine's own name is data, not copy: "MacBook Pro SG 566"
           comes off the host and is not ours to rewrite. */
        if (/MacBook/.test(line)) continue
        assert.ok(
          !/\bMac\b/.test(line),
          `${file.split('/mobile/')[1]}: "${line}" still says Mac`
        )
      }
    }

    /* And the word the top bar shows when there is nothing on the other end. */
    assert.match(read('shared/link-word.mjs'), /'no computer' : 'no phone'/, 'the bar still says NO MAC')
  })

  test('a new version number does not cost a build', async () => {
    /*
     * EAS Update only ever reaches a build whose runtime version matches, and
     * the runtime version here is a fingerprint of everything that ends up in
     * the binary. The fingerprint policy was chosen over appVersion for
     * exactly this reason — and it does not, on its own, do the job.
     *
     * `expo.version` is part of the app config, the app config is hashed
     * whole, so changing the version and nothing else moves the fingerprint.
     * Measured rather than reasoned about:
     *
     *   7.325.0 → 54612e0a85ee9a08a80322c34dbb96e460377165
     *   7.326.0 → 375fcaa1bc4c11c1911a6fe8106a99434b0e250c
     *
     * Every change in this repository carries a new version number — the
     * `version` job insists on it — so left alone, every change would have
     * been a new runtime no phone could take an update for, and the whole
     * thing would have been set up and never once used.
     */
    const config = read('mobile/fingerprint.config.js').replace(/\s+/g, ' ')
    assert.match(config, /sourceSkips: SourceSkips\.ExpoConfigVersions/, 'a version bump still makes a runtime nothing can update')
    assert.match(config, /require\('@expo\/fingerprint'\)/, 'the skip is a spelled-out string rather than the library’s own name for it')

    /*
     * The library's own SourceSkips is NOT imported to check the name is still
     * real, and this merged red once for trying. `npm ci` at the root installs
     * what the root declares; mobile/node_modules is a different install CI has
     * no reason to have made, so the import turned green only here, on a
     * machine where somebody had run it. The same trap is written up forty
     * lines further down in this file, about the decoder, and the remedy there
     * was to carry the packages at the root — worth it for a suite that cannot
     * run at all without them, not for one assertion.
     *
     * Nothing is lost by leaving it out: if Expo ever renames the constant,
     * fingerprint.config.js throws where the fingerprint is computed, which is
     * every build, every update and `expo-doctor`. That is louder than a test.
     */

    /* And the policy it is skipping FOR is still the fingerprint one. */
    const app = JSON.parse(read('mobile/app.json')).expo
    assert.deepEqual(app.runtimeVersion, { policy: 'fingerprint' }, 'the runtime version is not a fingerprint any more')
    assert.ok(app.updates?.url?.includes(app.extra.eas.projectId), 'the update url and the project id disagree')

    /*
     * AND THE COST OF A BUILD IS WRITTEN DOWN WHERE A MACHINE CAN CHECK IT.
     *
     * The policy above is only half of it. It guarantees an update never
     * reaches a build that cannot run it — which is the safety — and says
     * nothing about the phone that stops getting updates as a result. That
     * half used to be a habit: 7.332.0, 7.335.0 and 7.338.0 each recorded
     * "the fingerprint is e44c3556… before and after" by hand. After 7.327.0
     * the habit stopped and three native changes went through unseen.
     *
     * mobile/fingerprint.json is that habit made mechanical, and the check
     * lives in mobile.yml where the app's own dependencies are installed —
     * the fingerprint hashes those, not just the config, and this suite
     * deliberately does not reach into mobile/node_modules (see the note
     * above about the install CI does not have). So what is held here is that
     * the record exists, is a real pair of hashes, and is still wired up.
     */
    const fp = JSON.parse(read('mobile/fingerprint.json'))
    for (const platform of ['android', 'ios']) {
      assert.match(
        String(fp[platform]),
        /^[0-9a-f]{40}$/,
        `mobile/fingerprint.json has no recorded ${platform} fingerprint, so nothing can tell a build from an update`
      )
    }
    assert.notEqual(fp.android, fp.ios, 'both platforms record the same hash, which means one was pasted over the other')

    const wf = read('.github/workflows/mobile.yml')
    assert.match(wf, /npm run fingerprint/, 'nothing checks the fingerprint on a pull request, so a build cost lands unannounced')
    const scripts = JSON.parse(read('package.json')).scripts
    assert.equal(scripts.fingerprint, 'node scripts/fingerprint.mjs', 'npm run fingerprint no longer runs the check')
  })



  test('the gear descriptions say what a model is like, and never guess', async () => {
    /*
     * "Then work on the amp and cab descriptions and effects pedals."
     *
     * The lineage line says WHICH amp a model is. That is the fact and it is
     * useless to somebody who has never played one — which is most people who
     * have just bought one of these units. They can read that a model is a
     * Rectifier and still not know whether it is the one for the song.
     *
     * TWO RULES, AND THE SECOND IS THE ONE WORTH A TEST.
     *
     * Nothing is quoted. Lineage facts came from Yek's Guide and Fractal's own
     * Blocks Guide, and a fact — this model is that amp — is not something
     * anybody owns. A paragraph about how an amp sounds is somebody's writing,
     * so none of these are from either.
     *
     * And nothing is described that is not known. Ten amp families are
     * boutique amps obscure enough that any character written for them would
     * be invention, and eleven drives are Fractal's own designs with no real
     * pedal behind them. Those say nothing, deliberately — this file's own
     * rule is that the reader knows the gear better than the app does, and a
     * confident wrong sentence about an amp somebody owns costs more than a
     * blank.
     */
    const { descriptionFor } = await import('../src/lib/lineage.js')

    /* A model gets its family's description: "1959SLP Treble" is one voicing
       of a Super Lead and wants what is written about the Super Lead. */
    const slp = descriptionFor('amp', '1959SLP Treble')
    assert.ok(slp && slp.length > 30, 'an amp model no longer inherits its family description')
    assert.ok(descriptionFor('drive', 'Rat Distortion'), 'the drives have no descriptions')
    assert.ok(descriptionFor('cab', '4x12 RECTO SLANT'), 'the cabs have no descriptions')

    /*
     * WHAT AN OBSCURE AMP IS ALLOWED TO SAY, which is the half that matters.
     *
     * The rule used to be silence: ten boutique families said nothing at all,
     * because anything written about their character would be invention. The
     * rule was right about the character and wrong about the silence — a page
     * reading "nothing written down about this one yet" tells somebody
     * nothing, where "hand built, made in very small numbers, barely
     * documented" tells them exactly why they have never heard of it. That is
     * a fact about the amp and it is the useful one.
     *
     * So they get a maker and a rarity and they stop. Held here by length:
     * the well-known amps run two or three full paragraphs, and any of these
     * growing to that size means somebody has started describing a sound
     * nobody in this project has heard.
     */
    for (const obscure of ['Atomica Ch1', 'Capt Hook Ch1', 'Ruby Rocket Ch1', 'Cameron CCV Ch1']) {
      const d = descriptionFor('amp', obscure)
      assert.ok(d, `${obscure} says nothing at all, not even who made it`)
      assert.ok(d.length < 280, `${obscure}: ${d.length} characters is a character description of an amp nobody here has played`)
    }

    /*
     * A PEDAL THAT MODELS NOTHING REAL HAS NO HISTORY, AND STILL HAS A JOB.
     *
     * Eleven of the drives are Fractal's own designs with no pedal behind
     * them, and they used to say nothing at all for that reason. Half right:
     * there is no story to tell about a FAS Boost and inventing one would be
     * exactly the failure this file exists to prevent. But what it DOES is a
     * plain fact — it is a clean boost — and a reader staring at "nothing
     * written down about this one yet" learns less than one told that.
     *
     * So they describe the function and say outright that there is no pedal
     * behind them. Held here: each must name itself as Fractal's own, so
     * nobody can quietly give one a heritage later.
     */
    for (const own of ['FAS Boost', 'Bit Crusher', 'Tape Distortion', 'Mid Boost']) {
      const d = descriptionFor('drive', own)
      assert.ok(d, `${own} says nothing at all, not even what it does`)
      assert.match(
        d,
        /Fractal|not a pedal|not analogue|no pedal behind/i,
        `${own} reads as if there were a real pedal behind it`
      )
    }
    assert.equal(descriptionFor('amp', ''), null)
    assert.equal(descriptionFor('amp'), null, 'descriptionFor throws rather than answering for a missing name')
    assert.equal(descriptionFor('reverb', 'Ambient'), null, 'a family with no catalog is being answered for')

    /*
     * Every paragraph is a sentence rather than a fragment, and none of them
     * runs on.
     *
     * THE CAP MOVED FROM THE DESCRIPTION TO THE PARAGRAPH, and it had to.
     * "None of them is long enough to need scrolling on a phone" was written
     * when this page held one sentence and no photograph; it now holds a
     * picture, a line of numbers and as many paragraphs as were written,
     * which is a scrolling page on purpose. A 200-character cap on the whole
     * thing was a cap on how much anybody could say about an amp, enforced by
     * a test — the wrong thing to hold still.
     *
     * What is still worth holding is the shape of one paragraph: long enough
     * to be a thought, short enough to read on a handset. A wall of text is
     * not more informative than three paragraphs, it is just harder to read
     * in a dark room with a guitar on.
     */
    const { paragraphsOf } = await import('../src/lib/lineage.js')
    const ampFams = JSON.parse(read('src/data/amp-lineage.json'))
    const described = ampFams.filter((f) => f.description)
    assert.ok(described.length > 100, `only ${described.length} amp families are described`)
    const everyCab = JSON.parse(read('src/data/cab-types.json'))
    const everyDrive = JSON.parse(read('src/data/drive-types.json'))
    const alsoDescribed = [
      ...everyCab.filter((c) => c.description),
      ...everyDrive.filter((c) => c.description)
    ]
    for (const f of [...described, ...alsoDescribed]) {
      const who = f.family || f.name
      const paras = paragraphsOf(f.description)
      assert.ok(paras.length >= 1, `${who}: a description that is not a paragraph`)
      assert.ok(paras.length <= 6, `${who}: ${paras.length} paragraphs, which is an essay`)
      for (const d of paras) {
        assert.ok(d.length >= 40 && d.length <= 320, `${who}: a paragraph of ${d.length} characters`)
        assert.match(d, /[.!?]$/, `${who}: a paragraph that does not end as a sentence`)
      }
      assert.ok(!/^\s|\s$/.test(f.description), `${who}: has stray whitespace`)
    }

    /* And the spec line, where one is written, is numbers rather than prose:
       it is read at a glance and set apart from the paragraphs for that. */
    for (const f of [...ampFams, ...alsoDescribed].filter((a) => a.specs)) {
      const who = f.family || f.name
      assert.ok(f.specs.length <= 60, `${who}: a spec line of ${f.specs.length} characters is a sentence`)
      assert.ok(!/[.!?]$/.test(f.specs), `${who}: the spec line ends as a sentence`)
      assert.ok(!/^\s|\s$/.test(f.specs), `${who}: the spec line has stray whitespace`)
    }

    /*
     * AND NO PARAGRAPH SAYS WHAT THE ONE ABOVE IT ALREADY SAID.
     *
     * Every pedal and cabinet here was one sentence before it was a page, and
     * the quick way to make a page out of a sentence is to write the sentence
     * again at greater length. A draft of the pedal pass did exactly that on
     * most of the catalog — "Punchy, mid-forward, and it stays defined when
     * pushed" followed by "Punchy and mid-forward, and it stays defined when
     * the amp is pushed" — which costs a reader a scroll to learn nothing, and
     * which every other check in this file was happy to let through. Nothing
     * on main does it today; this is here so nothing starts.
     *
     * Five words is the line. A run that long appearing twice in one entry is
     * not two thoughts that happen to share a phrase, it is one thought typed
     * out twice. Anything shorter catches honest contrasts, like an Orange
     * high-gain amp being measured against an American high-gain amp.
     */
    const RUN = 5
    const runs = (p) => p.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
    for (const m of [...ampFams, ...everyCab, ...everyDrive]) {
      if (!m.description) continue
      const saidIn = new Map()
      paragraphsOf(m.description).forEach((p, i) => {
        const w = runs(p)
        for (let at = 0; at + RUN <= w.length; at++) {
          const run = w.slice(at, at + RUN).join(' ')
          const first = saidIn.get(run)
          assert.ok(
            first === undefined || first === i,
            `${m.family || m.name}: paragraph ${i + 1} says what paragraph ${first + 1} already said — "${run}"`
          )
          if (first === undefined) saidIn.set(run, i)
        }
      })
    }

    /*
     * AND A SPEC LINE NEVER APPEARS WITHOUT THE PARAGRAPHS UNDER IT.
     *
     * The page draws the line of facts above the writing, so an entry carrying
     * only a spec line renders as a heading with nothing beneath it — which
     * reads, to the person who just opened it, as a page that failed to load.
     *
     * This has to walk the whole catalog rather than `alsoDescribed`, which is
     * filtered to entries that already have a description: the one shape this
     * is looking for is precisely the one that list cannot contain, so asking
     * it would be asking the wrong list and always getting a yes.
     *
     * The other way round is fine and deliberate. A model with nothing written
     * about it says nothing at all, which is the honest answer rather than a
     * gap.
     */
    for (const m of [...ampFams, ...everyCab, ...everyDrive]) {
      if (!m.specs) continue
      assert.ok(m.description, `${m.family || m.name}: a spec line with no description under it`)
    }

    const console_ = read('src/components/Console.jsx')
    assert.match(console_, /descriptionFor\(block\.slug/, 'the screen never shows a description')
  })

  test('the phone can say what the computer is running', async () => {
    /*
     * "The app keeps crashing, but it might be the Mac app which is very laggy
     * also. Does the Mac app need to be updated to the latest version? Or would
     * that affect how the app performs?"
     *
     * A fair question with an answer nobody could reach. The computer has been
     * writing its version into `host.name` beside its own name since 7.205.0 —
     * and this end read the name and threw the version away. So neither the
     * Setup screen nor a pasted log could say which version was at the other
     * end of a slow evening.
     *
     * It matters: that app holds the cable to the unit and does every read this
     * phone asks for, so an old one is slow HERE, in a way that looks from a
     * phone exactly like this app being slow.
     */
    const link = read('mobile/src/lib/link.js')
    assert.match(link, /hostVersion: null/, 'the link state has nowhere to keep it')
    assert.match(
      link.replace(/\s+/g, ' '),
      /set\(\{ macName: String\(name\), hostVersion: version \? String\(version\) : null \}\)/,
      'the version the computer sends is still thrown away'
    )

    /*
     * AND ASKED AGAIN. "The Mac's version line still says did not say" — on a
     * Mac that was on the right version. This end read `host.name` once, at
     * join, and never again, so a computer updated while the phone sat
     * connected kept answering with whatever an older launcher had written,
     * which for a launcher older than 7.205.0 is a name and no version at all.
     * The computer rewrites it every five minutes; this end now asks again.
     */
    assert.match(link, /export const NAME_AGAIN = 2 \* 60 \* 1000/, 'the phone has no interval for asking again')
    assert.match(
      link.replace(/\s+/g, ' '),
      /if \(state\.link === 'connected' && Date\.now\(\) - namedAt > NAME_AGAIN\) await readMacName\(\)/,
      'the computer is asked what it is only at join, so an update while connected is never noticed'
    )

    /*
     * AND SAID IN THE LOG, all three ways. "Did not say" has three causes and
     * the pasted log could not tell them apart: the read got no answer, the
     * computer has written nothing, or it wrote a name with no version. Only
     * the last one is the old launcher the Setup screen blames.
     */
    const flat = link.replace(/\s+/g, ' ')
    assert.match(flat, /say\(`could not read what the computer is — \$\{err\?\.message/, 'a failed read is silent')
    assert.match(flat, /say\('the computer has not written its name yet'\)/, 'a computer that wrote nothing is silent')
    assert.match(flat, /`the computer is \$\{name\}, v\$\{version\}`/, 'the log never says which computer app answered')
    assert.match(flat, /`the computer is \$\{name\} and did not say its version`/, 'a name with no version beside it is silent')

    /* And said once. Asked again every couple of minutes, the same answer
       written every time is thirty lines an hour burying the one that matters
       in a log whose whole purpose is being pasted into a chat. */
    assert.match(
      flat,
      /function say\(line\) \{ if \(line === namedSaid\) return namedSaid = line logDebug\('link', line\) \}/,
      'the same answer is written into the log every couple of minutes'
    )

    /* In the log, because that is the copy that reaches a chat. */
    assert.match(
      read('mobile/src/screens/Log.js').replace(/\s+/g, ' '),
      /'computer app': link\.hostVersion \|\| 'did not say \(older than 7\.205\.0, or could not write it\)'/,
      'a pasted log still cannot say what the computer is running'
    )

    /* And on screen, where somebody can act on it. */
    const settings = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    assert.match(settings, /The app on the computer is v\$\{hostVersion\}/, 'Setup never says the computer’s version')
    assert.match(settings, /const behind = !!hostVersion && isOlder\(hostVersion, APP_VERSION\) === true/, 'a computer that did not say its version is told it is behind')
    /* A missing version is said as missing, with where to look, not as "behind". */
    assert.match(settings, /link === 'connected' && !demo && !hostVersion \? \( <Note> If the computer is on 7\.295\.0 or newer, its menu bar icon has a line saying what the phones hear about its version/, 'a missing version does not point at the Mac’s own menu line')

    /*
     * The comparison is strict about what it will answer, and that is the
     * point: telling somebody to update an app that is already current is
     * worse than saying nothing at all.
     */
    const { isOlder } = await import('../mobile/src/lib/versions.js')
    assert.equal(isOlder('7.191.0', '7.265.0'), true)
    assert.equal(isOlder('7.265.0', '7.265.0'), false)
    assert.equal(isOlder('7.266.0', '7.265.0'), false)
    assert.equal(isOlder('7.9.0', '7.10.0'), true, 'versions are being compared as text, so 7.9 reads as newer than 7.10')
    assert.equal(isOlder('7.265.1', '7.265.0'), false)
    assert.equal(isOlder(null, '7.265.0'), null, 'a version nobody sent is being treated as a number')
    assert.equal(isOlder('v7.265.0', '7.265.0'), null, 'a version this cannot parse still gets an opinion')
    assert.equal(isOlder('7.265', '7.265.0'), null)
  })

  test('the log survives the run that needed reading', () => {
    /*
     * "It crashes within a few minutes and is virtually unusable. I can't get
     * to the log before it crashes. Here are the few screen shots I could take
     * before the crash each time."
     *
     * Screenshots and a guess, for the second time. The log has been in memory
     * only, which means the one run worth reading — the one that ended — took
     * its log with it, every time.
     *
     * NOT A CRASH HANDLER, deliberately: one that writes on the way down
     * usually does not finish, and the death that matters most here is iOS
     * killing an app it has decided is wedged, which runs no JavaScript at all
     * on its way out. Written as it goes, it survives anything.
     */
    const keep = read('mobile/src/lib/logKeep.js')
    assert.match(keep, /const TAIL = 120/, 'the whole log is being written on every change')
    assert.match(keep, /setTimeout\(write, EVERY_MS\)/, 'a line is written to disk per line, which is the cost this app already died of once')
    assert.match(keep, /getDebugLog\(\)\.slice\(-TAIL\)/, 'the start of the log is kept rather than the end, which is the half that matters')

    /* Started at launch, before anything else can go wrong. */
    assert.match(read('mobile/App.js'), /useEffect\(\(\) => keepLog\(\), \[\]\)/, 'nothing starts keeping the log')

    /* And it reaches the paste, which is the only route it has to a chat. */
    const log = read('mobile/src/screens/Log.js').replace(/\s+/g, ' ')
    assert.match(log, /THE RUN BEFORE THIS ONE/, 'the copied log does not carry the previous run')
    assert.match(log, /pastRuns\(\)\.then/, 'the previous runs are never read back')
    /* And on the screen, not only in the copy. "It looks like the debug log is
       not persisting through crashes" — it was; it was only ever in the paste. */
    assert.match(log, /ListFooterComponent=\{ before\.length \? \(/, 'the runs before are not shown on the screen')
    assert.match(log, /run\.lines\.map\(\(text, j\) => \( <Line key=\{j\} text=\{text\}/, 'the kept lines are not drawn')
    /* Three runs, so a crash, a look, and a second crash leaves the first. */
    assert.match(keep, /const KEEP_RUNS = 3/, 'only one run is kept, and the next short run overwrites the crash')
    assert.match(keep, /logDebug\(\s*'app',\s*last \? 'kept from the run before' : 'nothing kept from the run before'/, 'the log does not say whether the keeper found anything, so a paste cannot tell')
  })

  test('the run before this one is the run before this one', async () => {
    /*
     * IT SHIPPED SHOWING THIS RUN TWICE, and Justin pasted it back:
     *
     *   07:57:34.857 [tap] press Just looking? Try the demo — 1993ms
     *   THE RUN BEFORE THIS ONE — 12 lines, oldest first
     *   07:57:34.857 [tap] press Just looking? Try the demo — 1993ms
     *
     * Same timestamps in both halves. The previous run was read when the log
     * screen opened, by which time this run had been writing over it for
     * minutes — so the heading was a lie, and a lie that looks like evidence
     * is worse than no evidence at all. This file exists because a crash takes
     * its log with it; a crash report quoting the run that did not crash is
     * the same dead end with extra confidence.
     *
     * RUN RATHER THAN READ, because this is a race, and finding an `await` in
     * the source proves nothing about which of two promises lands first. The
     * module is transplanted next to stubs — there is no phone storage and no
     * real log in node — and then actually raced, with the read made slower
     * than the first write on purpose. That ordering IS the bug.
     */
    const STORAGE = `
      let store = {}
      let wait = 0
      export const __seed = (k, v) => { store[k] = v }
      export const __delay = (ms) => { wait = ms }
      const after = (v) => new Promise((r) => setTimeout(() => r(v), wait))
      export default {
        getItem: (k) => after(k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = v; return Promise.resolve() },
        removeItem: (k) => { delete store[k]; return Promise.resolve() }
      }
    `
    const DEBUG_LOG = `
      const lines = []
      const watchers = new Set()
      export const getDebugLog = () => lines
      export const formatLine = (l) => String(l)
      export const onDebugLog = (fn) => { watchers.add(fn); return () => watchers.delete(fn) }
      export const logDebug = () => {}
      export const __say = (l) => { lines.push(l); for (const fn of watchers) fn() }
    `

    const src = read('mobile/src/lib/logKeep.js')
    const dir = mkdtempSync(join(tmpdir(), 'logkeep-'))
    try {
      /* Two seconds between writes is right on a phone and is dead time here,
         so the transplanted copy writes almost at once. If that constant is
         ever renamed this stops biting, so it has to have actually changed. */
      const quick = src
        .replace(/'@react-native-async-storage\/async-storage'/, "'./storage.mjs'")
        .replace(/'\.\/debugLog'/, "'./debugLog.mjs'")
        .replace(/const EVERY_MS = \d+/, 'const EVERY_MS = 5')
      assert.doesNotMatch(quick, /async-storage'|'\.\/debugLog'/, 'logKeep no longer imports what this stands in for')
      assert.match(quick, /const EVERY_MS = 5/, 'the write timer could not be shortened, so this is not testing the race')

      writeFileSync(join(dir, 'storage.mjs'), STORAGE)
      writeFileSync(join(dir, 'debugLog.mjs'), DEBUG_LOG)
      writeFileSync(join(dir, 'logKeep.mjs'), quick)

      const at = (f) => pathToFileURL(join(dir, f)).href
      const store = await import(at('storage.mjs'))
      const log = await import(at('debugLog.mjs'))
      const keep = await import(at('logKeep.mjs'))

      /* What the run that died left behind. */
      store.__seed('fractal.log.lastrun', JSON.stringify({ at: 1, lines: ['WHAT THE LAST RUN SAID'] }))
      /* And storage slower to answer than this run is to start writing, which
         is the ordinary case on a phone busy enough to be worth logging. */
      store.__delay(40)

      const off = keep.keepLog()
      log.__say('WHAT THIS RUN IS SAYING')
      await new Promise((r) => setTimeout(r, 120))
      const was = await keep.lastRun()
      off()

      assert.ok(was, 'the previous run was lost')
      assert.deepEqual(
        was.lines,
        ['WHAT THE LAST RUN SAID'],
        'the heading says the run before this one and this is what this run just wrote'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a crash on the phone writes a line before the phone goes', async () => {
    /*
     * THE CRASH HAS NEVER ONCE SHOWN UP IN A LOG, across a dozen builds — and
     * this is why. installCrashCapture listened on `window.addEventListener`,
     * which is the browser's way. React Native has a `window` (an alias of
     * the global) but no `addEventListener` on it, so on every phone the
     * install returned a no-op; and the phone never even called it. The log
     * survived the crash from 7.268.0 on and had nothing in it about the
     * crash, because nothing was ever told.
     *
     * A phone routes an uncaught error through ErrorUtils.setGlobalHandler
     * and a dropped promise through Hermes's rejection tracker, which React
     * Native only switches on in development. RUN, not read: a fake phone
     * runtime, an error thrown through it, and the line looked for.
     */
    const { installCrashCapture, getDebugLog, clearDebugLog, CRASH_FLUSH_MS } = await import(
      '../mobile/src/lib/debugLog.js'
    )

    let handled = []
    let tracker = null
    const phone = {
      ErrorUtils: {
        _h: (e, fatal) => handled.push([e.message, fatal]),
        getGlobalHandler() { return this._h },
        setGlobalHandler(fn) { this._h = fn }
      },
      HermesInternal: {
        enablePromiseRejectionTracker(opts) { tracker = opts }
      }
    }
    const phonesOwn = phone.ErrorUtils._h

    clearDebugLog()
    const off = installCrashCapture(phone)
    assert.notEqual(phone.ErrorUtils._h, phonesOwn, 'the phone was not given a handler')
    assert.ok(tracker?.allRejections, 'dropped promises are not tracked in a release build')

    /* Not fatal: logged, and handed straight on. */
    phone.ErrorUtils._h(new Error('setlist has no lists'), false)
    let lines = getDebugLog()
    assert.equal(lines.length, 1, 'the error was not logged')
    assert.equal(lines[0].source, 'crash')
    assert.equal(lines[0].message, 'setlist has no lists')
    assert.match(lines[0].detail, /^not fatal/)
    assert.deepEqual(handled, [['setlist has no lists', false]], 'the phone did not get its own turn')

    /* Fatal: logged now, the phone's own handler only after the line has had
       its head start to disk. In between is the whole point. */
    handled = []
    phone.ErrorUtils._h(new Error('Cannot read property of undefined'), true)
    lines = getDebugLog()
    assert.equal(lines.length, 2)
    assert.match(lines[1].detail, /^fatal\n/, 'a fatal crash is not marked as one, with its stack')
    assert.deepEqual(handled, [], 'the phone was told before the line could reach disk')
    await new Promise((r) => setTimeout(r, CRASH_FLUSH_MS + 30))
    assert.deepEqual(handled, [['Cannot read property of undefined', true]], 'the phone never got its turn, so it never crashed the way it should')

    /* A promise nobody caught. */
    tracker.onUnhandled(1, new Error('sync failed quietly'))
    assert.equal(getDebugLog()[2].message, 'unhandled promise')
    assert.match(getDebugLog()[2].detail, /sync failed quietly/)

    off()
    assert.equal(phone.ErrorUtils._h, phonesOwn, 'uninstalling does not give the phone back its handler')
    assert.equal(tracker.allRejections, false, 'uninstalling leaves the tracker on')
    clearDebugLog()

    /* Neither a browser nor a phone: a no-op, and not "installed" — so the
       next call on a real runtime still works. */
    assert.equal(typeof installCrashCapture({}), 'function')
    const again = installCrashCapture(phone)
    assert.notEqual(phone.ErrorUtils._h, phonesOwn, 'a no-op install used up the one install')
    again()

    /* And the phone actually starts it, at launch, next to the log keeper. */
    assert.match(read('mobile/App.js'), /useEffect\(\(\) => installCrashCapture\(\), \[\]\)/, 'the phone never installs the capture, which is the bug this test was written for')
  })

  test('a crash line goes to disk at once, not two seconds later', async () => {
    /*
     * The keeper writes on a two-second timer, which is right for a working
     * evening and wrong for the one line that matters: a fatal error ends
     * the app a quarter of a second after it is logged. So that line is
     * written the moment it lands. Run with the timer set far off, so the
     * only way the line reaches storage is the crash path.
     */
    const STORAGE = `
      let store = {}
      export const __get = (k) => store[k] ?? null
      export default {
        getItem: (k) => Promise.resolve(store[k] ?? null),
        setItem: (k, v) => { store[k] = v; return Promise.resolve() },
        removeItem: (k) => { delete store[k]; return Promise.resolve() }
      }
    `
    const DEBUG_LOG = `
      const lines = []
      const watchers = new Set()
      export const getDebugLog = () => lines
      export const formatLine = (l) => l.message
      export const onDebugLog = (fn) => { watchers.add(fn); return () => watchers.delete(fn) }
      export const logDebug = () => {}
      export const __say = (l) => { lines.push(l); for (const fn of watchers) fn(l) }
    `
    const src = read('mobile/src/lib/logKeep.js')
    const dir = mkdtempSync(join(tmpdir(), 'logkeep-crash-'))
    try {
      const slow = src
        .replace(/'@react-native-async-storage\/async-storage'/, "'./storage.mjs'")
        .replace(/'\.\/debugLog'/, "'./debugLog.mjs'")
        .replace(/const EVERY_MS = \d+/, 'const EVERY_MS = 100000')
      assert.match(slow, /const EVERY_MS = 100000/, 'the write timer could not be pushed out, so this proves nothing')
      writeFileSync(join(dir, 'storage.mjs'), STORAGE)
      writeFileSync(join(dir, 'debugLog.mjs'), DEBUG_LOG)
      writeFileSync(join(dir, 'logKeep.mjs'), slow)
      const at = (f) => pathToFileURL(join(dir, f)).href
      const store = await import(at('storage.mjs'))
      const log = await import(at('debugLog.mjs'))
      const keep = await import(at('logKeep.mjs'))

      const off = keep.keepLog()
      log.__say({ source: 'wire', message: 'GET /preset ok' })
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(store.__get('fractal.log.lastrun'), null, 'an ordinary line was written at once, which is the cost this app already died of')

      log.__say({ source: 'crash', message: 'Cannot read property of undefined' })
      await new Promise((r) => setTimeout(r, 30))
      const kept = JSON.parse(store.__get('fractal.log.lastrun') || 'null')
      off()
      assert.ok(kept, 'the crash line waited for the timer, and the app was gone by then')
      assert.deepEqual(kept.runs[0].lines, ['GET /preset ok', 'Cannot read property of undefined'], 'the crash went to disk without the run that led up to it')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the preset names come from the computer in one go, and are kept on disk', async () => {
    /*
     * "When selecting presets for the first time, it scrolls through and has
     * to load them all as you're scrolling. Is there a way we can set this to
     * load in the background when the app is first opened so that they're all
     * there?"
     *
     * Not by reading five hundred presets over the relay in the background:
     * that is the port everything else waits behind, and it is what 7.268.0
     * had to stop. The computer already reads them quietly and keeps the lot
     * in its own store, so the phone takes that list in ONE request the moment
     * it knows which unit it is on, and keeps it on disk for the next launch.
     *
     * RUN, with a fake computer and a fake disk: the module is transplanted
     * beside stubs for the unit and the store, because the real ones drag in
     * React Native.
     */
    const DEVICE = `
      export let hostDoc = null
      export let unitReads = []
      export const __host = (d) => { hostDoc = d }
      export async function storedNames(slug) {
        if (hostDoc instanceof Error) throw hostDoc
        return hostDoc ? hostDoc[slug] ?? null : null
      }
      export async function presetName(n) { unitReads.push(n); return { number: n, name: 'FROM UNIT ' + n, empty: false } }
    `
    const STORE = `
      const mem = new Map()
      export const hydrate = () => Promise.resolve()
      export const sync = {
        getItem: (k) => mem.has(k) ? mem.get(k) : null,
        setItem: (k, v) => { mem.set(k, String(v)) },
        removeItem: (k) => { mem.delete(k) }
      }
    `
    const src = read('mobile/src/lib/presetNames.js')
    const dir = mkdtempSync(join(tmpdir(), 'names-'))
    try {
      const moved = src
        .replace(/'\.\/device'/, "'./device.mjs'")
        .replace(/'\.\/store'/, "'./store.mjs'")
        .replace(/'\.\/presetName'/, "'./presetName.mjs'")
        .replace(/from 'react'/, "from './react.mjs'")
      assert.doesNotMatch(moved, /'\.\/device'|'\.\/store'|'\.\/presetName'|'react'/, 'presetNames no longer imports what this stands in for')
      /* The hook is not what is under test; React is a stub so the module
         loads from a temp folder that has no node_modules. */
      writeFileSync(join(dir, 'react.mjs'), 'export const useEffect = () => {}\nexport const useSyncExternalStore = () => 0\n')
      writeFileSync(join(dir, 'device.mjs'), DEVICE)
      writeFileSync(join(dir, 'store.mjs'), STORE)
      writeFileSync(join(dir, 'presetName.mjs'), read('mobile/src/lib/presetName.js'))
      writeFileSync(join(dir, 'presetNames.mjs'), moved)
      const at = (f) => pathToFileURL(join(dir, f)).href
      const unit = await import(at('device.mjs'))
      const store = await import(at('store.mjs'))
      const names = await import(at('presetNames.mjs'))

      /* Last time, on this FM3, the phone had learned two names. */
      store.sync.setItem('fractal.presetNames', JSON.stringify({ fm3: { at: 1, names: { 3: 'OLD THREE', 9: 'NINE' } } }))
      /* And the computer has scanned the lot, with a different name for 3
         (saved at the computer since) and an empty slot at 7. */
      unit.__host({ fm3: { 3: 'NEW THREE', 5: 'FIVE', 7: '<EMPTY>' } })

      const changed = await names.adopt('fm3')
      assert.equal(names.nameOf(9), 'NINE', 'what the phone knew from last time is gone')
      assert.equal(names.nameOf(3), 'NEW THREE', 'the computer is the end with the cable, and its name lost to the phone’s stale one')
      assert.equal(names.nameOf(5), 'FIVE', 'the computer’s list was not taken')
      assert.equal(names.nameOf(7), '', 'an empty slot from the computer does not read as empty')
      assert.equal(changed, 3, `${changed} names changed; the computer’s three should have`)
      assert.deepEqual(unit.unitReads, [], 'the unit was asked for names the computer already had')
      assert.equal(names.knownCount(), 4)

      /* It all went to disk, under the browser’s key. */
      names.flushPersist()
      const disk = JSON.parse(store.sync.getItem('fractal.presetNames'))
      assert.deepEqual(disk.fm3.names, { 3: 'NEW THREE', 5: 'FIVE', 7: '', 9: 'NINE' }, 'the disk copy is not the whole list')
      assert.ok(disk.fm3.at > 1, 'the disk copy does not say when the computer was last asked')

      /* Rows 5 and 12 are on screen. Nothing is read: no screen is mounted,
         so there is no interest, and that rule is tested elsewhere. */
      names.wantOnly([5, 12])
      await new Promise((r) => setTimeout(r, 20))
      assert.deepEqual(unit.unitReads, [], 'the queue drained with nobody looking')

      /* Refresh: the computer’s list again, and the rows on screen asked
         again — so 5 loses its name until the unit answers, 3 keeps its. */
      unit.__host({ fm3: { 3: 'NEW THREE', 5: 'FIVE RENAMED', 7: '<EMPTY>' } })
      const again = await names.refresh()
      assert.equal(again, 1, 'refresh did not take the renamed slot from the computer')
      assert.equal(names.nameOf(5), undefined, 'a row on screen keeps its old name through a refresh instead of being asked again')
      assert.equal(names.nameOf(12), undefined)
      assert.equal(names.nameOf(3), 'NEW THREE', 'a row off screen was thrown away by a refresh')

      /* A computer with no list — an older app, or the demo — costs nothing
         and changes nothing. */
      unit.__host(new Error('not found'))
      assert.equal(await names.refresh(), 0)
      assert.equal(names.nameOf(3), 'NEW THREE')

      /* A different unit: its own names off disk, and the FM3’s put away. */
      unit.__host(null)
      await names.adopt('am4')
      assert.equal(names.nameOf(3), undefined, 'an FM3 name is shown over an AM4 slot')
      assert.equal(names.knownCount(), 0)
      names.flushPersist()
      const both = JSON.parse(store.sync.getItem('fractal.presetNames'))
      assert.equal(both.fm3.names[3], 'NEW THREE', 'switching units lost the FM3’s list')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }

    /* And it is wired: the rig adopts as soon as it knows the unit, the list
       has a Refresh button, and says how full it is. */
    const rig = read('mobile/src/lib/rig.js')
    assert.match(rig, /adoptNames\(device\.nameOwner\(slug\)\)\.catch/, 'the rig never takes the computer’s list, or the demo’s names land on the real unit’s slots')
    /*
     * Inside refreshAll, not anywhere in the file. Read whole, this compared
     * the first `adoptNames(` against the first `await refreshPreset()` — and
     * the timed unit check higher up the file calls refreshPreset too, so the
     * ordering it measured was between two unrelated functions.
     */
    const refreshAll = rig.slice(rig.indexOf('export async function refreshAll()'), rig.indexOf('export function notePresetName'))
    assert.ok(refreshAll.length > 200, 'refreshAll moved; this check reads it')
    assert.ok(refreshAll.indexOf('adoptNames(') < refreshAll.indexOf('await refreshPreset()'), 'the names are taken after the slow reads instead of alongside them')
    const dev = read('mobile/src/lib/device.js')
    /*
     * AND IN THE DEMO THE UNIT ANSWERS IT, which is the whole of the fix for
     * a list that drew 512 rows of "Empty" over a bank sitting right there.
     *
     * This used to assert the demo returned null — correct on the face of it,
     * since there is no computer to have filed anything. What it missed is
     * that the OTHER way a name is learned, GET /presets/{n}, is a stub on
     * every gen-3 unit and in the mock alike. Null plus a stub is no source
     * at all, and "all presets are blank in the demo" is what that looks like
     * to somebody holding the phone.
     */
    assert.match(dev, /const mock = demoDevice\(\)/, 'the demo has no source of preset names again')
    assert.match(
      dev,
      /typeof mock\.storedNames === 'function' \? mock\.storedNames\(\)/,
      'the demo does not ask the unit for its own bank'
    )
    assert.match(dev, /if \(!slug\) return null/, 'a real unit with no slug still asks the computer')

    /* And the mock can actually answer that. */
    const mockSrc = read('src/lib/mockDevice.js')
    assert.match(
      mockSrc,
      /storedNames: \(\) => Object\.fromEntries\(state\.stored\)/,
      'the mock cannot hand over its bank, so the demo list is blank'
    )
    assert.match(
      mockSrc,
      /presetName: \(number\) => \(\{ number, name: '' \}\)/,
      'the per-slot stub is gone — the mock now claims an answer gen-3 hardware cannot give'
    )
    const screen = read('mobile/src/screens/Presets.js')
    assert.match(screen, /label=\{refreshing \? 'Reading…' : 'Refresh'\}/, 'there is no Refresh button')
    assert.match(screen, /names known/, 'the list does not say how full it is')
  })

  test('scene names are on the tiles before the unit has been asked', async () => {
    /*
     * "When you switch preset, it takes about 5 to 10 seconds for the scene
     * names to load." They came from the preset summary — a dump — queued
     * behind the chain read, another dump. Names hardly ever change, so what
     * this phone read last time goes on at once, then the computer's copy,
     * and the dump only runs when neither had them. Read the slow way once,
     * they are written to disk and given to the computer, so no device loads
     * that slot the slow way again.
     *
     * The cache runs against a fake disk; the wiring is read.
     */
    const STORE = `
      const mem = new Map()
      export const hydrate = () => Promise.resolve()
      export const sync = {
        getItem: (k) => mem.has(k) ? mem.get(k) : null,
        setItem: (k, v) => { mem.set(k, String(v)) },
        removeItem: (k) => { mem.delete(k) }
      }
    `
    const dir = mkdtempSync(join(tmpdir(), 'scenes-'))
    try {
      const moved = read('mobile/src/lib/sceneNameCache.js').replace(/'\.\/store'/, "'./store.mjs'")
      assert.doesNotMatch(moved, /'\.\/store'/)
      writeFileSync(join(dir, 'store.mjs'), STORE)
      writeFileSync(join(dir, 'sceneNameCache.mjs'), moved)
      const at = (f) => pathToFileURL(join(dir, f)).href
      const store = await import(at('store.mjs'))
      const cache = await import(at('sceneNameCache.mjs'))

      assert.deepEqual(await cache.recallSceneNames('fm3', 97), [], 'a slot never seen has names')
      assert.equal(cache.rememberSceneNames('fm3', 97, ['', '', '', '', '', '', '', '']), false, 'eight blanks were worth writing down')
      assert.equal(cache.rememberSceneNames('fm3', 97, [' Rhythm ', 'Lead', '', '', '', '', '', '']), true)
      assert.deepEqual(await cache.recallSceneNames('fm3', 97), ['Rhythm', 'Lead', '', '', '', '', '', ''], 'what was written is not what is read back, trimmed')
      assert.deepEqual(await cache.recallSceneNames('am4', 97), [], 'an FM3 slot’s names are shown over an AM4’s')
      /* And forgotten, for a rename dropped on a slot that had no names. */
      assert.equal(cache.forgetSceneNames('fm3', 98), false, 'forgetting a slot never written claims to have written')
      assert.equal(cache.forgetSceneNames('fm3', 97), true)
      assert.deepEqual(await cache.recallSceneNames('fm3', 97), [], 'a forgotten slot still has names')
      assert.equal(cache.rememberSceneNames('fm3', 97, [' Rhythm ', 'Lead', '', '', '', '', '', '']), true)
      /* The browser’s key and shape, so the two apps’ disks read the same. */
      const disk = JSON.parse(store.sync.getItem('fractal.sceneNames'))
      assert.deepEqual(Object.keys(disk), ['fm3:97'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }

    const rig = read('mobile/src/lib/rig.js')
    const flat = rig.replace(/\s+/g, ' ')
    /* Quick names before the chain, the dump only when they were missing — on
       a preset load and on the first read of the unit alike. */
    assert.equal((flat.match(/const quick = await quickSceneNames\(\) /g) || []).length, 2, 'the quick read is not taken on both a preset load and the first read')
    assert.equal((flat.match(/await refreshBlocks\(\) if \(!quick\) await refreshSceneNames\(\)/g) || []).length, 2, 'the slow read still runs when the names were already there, or before the chain')
    assert.match(rig, /const kept = await recallSceneNames\(owner, number\)/, 'the disk is not read first')
    assert.match(rig, /held = await device\.storedSceneNames\(slug, number\)/, 'the computer’s copy is never asked for')
    /* Read the slow way, they are kept everywhere. */
    assert.match(flat, /set\(\{ sceneNames: names \}\) [^]*?rememberSceneNames\(device\.nameOwner\(slug\), number, names\) device\.keepSceneNames\(slug, number, names\)/, 'a slow read is not written to disk and given to the computer')
    /* And never for the wrong slot: a slow read landing after the next tap. */
    assert.match(rig, /if \(!names\.length \|\| state\.preset\?\.number !== number\) return/, 'a slow read that lands after the next preset puts the last song’s names on this one')

    const dev = read('mobile/src/lib/device.js')
    assert.match(dev, /encodeURIComponent\(`scene-names-\$\{slug\}:\$\{number\}`\)/, 'the phone asks for a document the browser does not write')
    assert.match(dev, /\{ data: names, origin: 'fractal' \}/, 'the phone writes a document in a shape the browser does not read')
  })

  test('three runs are kept, and a run that died is not overwritten by the look at it', async () => {
    /*
     * "It looks like the debug log is not persisting through crashes."
     *
     * One slot on disk. Run A crashes; run B is opened to read it, and two
     * seconds in it writes its own tail over A; B crashes too, or is closed;
     * run C opens the log screen and sees B's twelve lines, and A is gone.
     * Three runs are kept now, newest first, and the old one-run shape on
     * disk still reads. Run, with the timer shortened.
     */
    const STORAGE = `
      let store = {}
      export const __seed = (k, v) => { store[k] = v }
      export const __get = (k) => store[k] ?? null
      export default {
        getItem: (k) => Promise.resolve(store[k] ?? null),
        setItem: (k, v) => { store[k] = v; return Promise.resolve() },
        removeItem: (k) => { delete store[k]; return Promise.resolve() }
      }
    `
    const DEBUG_LOG = `
      const lines = []
      const watchers = new Set()
      export const said = []
      export const getDebugLog = () => lines
      export const formatLine = (l) => l.message
      export const onDebugLog = (fn) => { watchers.add(fn); return () => watchers.delete(fn) }
      export const logDebug = (source, message, detail) => { said.push({ source, message, detail }) }
      export const __say = (l) => { lines.push(l); for (const fn of watchers) fn(l) }
    `
    const dir = mkdtempSync(join(tmpdir(), 'logkeep-runs-'))
    try {
      const quick = read('mobile/src/lib/logKeep.js')
        .replace(/'@react-native-async-storage\/async-storage'/, "'./storage.mjs'")
        .replace(/'\.\/debugLog'/, "'./debugLog.mjs'")
        .replace(/const EVERY_MS = \d+/, 'const EVERY_MS = 5')
      writeFileSync(join(dir, 'storage.mjs'), STORAGE)
      writeFileSync(join(dir, 'debugLog.mjs'), DEBUG_LOG)
      writeFileSync(join(dir, 'logKeep.mjs'), quick)
      const at = (f) => pathToFileURL(join(dir, f)).href
      const store = await import(at('storage.mjs'))
      const log = await import(at('debugLog.mjs'))
      const keep = await import(at('logKeep.mjs'))

      /* The disk as 7.275.0 left it: one run, the old shape, the crash. */
      store.__seed('fractal.log.lastrun', JSON.stringify({ at: 1000, lines: ['A: playing', 'A: [crash] died'] }))

      const off = keep.keepLog()
      const runs = await keep.pastRuns()
      assert.deepEqual(runs.map((r) => r.lines), [['A: playing', 'A: [crash] died']], 'the old one-run shape on disk is not read')
      /* And this run's log says so, so a paste can tell the keeper worked. */
      assert.equal(log.said[0]?.message, 'kept from the run before')
      assert.match(log.said[0]?.detail, /^2 lines, last written /)

      /* This run writes its own tail — and A survives behind it. */
      log.__say({ source: 'app', message: 'B: opened the log' })
      await new Promise((r) => setTimeout(r, 40))
      let disk = JSON.parse(store.__get('fractal.log.lastrun'))
      assert.deepEqual(disk.runs.map((r) => r.lines), [['B: opened the log'], ['A: playing', 'A: [crash] died']], 'run B overwrote run A instead of standing in front of it')
      off()

      /* A third and a fourth run: three are kept, the oldest goes. */
      for (const name of ['C', 'D']) {
        const again = await import(at('logKeep.mjs') + `?${name}`)
        const stop = again.keepLog()
        await again.pastRuns()
        log.__say({ source: 'app', message: `${name}: ran` })
        await new Promise((r) => setTimeout(r, 40))
        stop()
      }
      disk = JSON.parse(store.__get('fractal.log.lastrun'))
      assert.equal(disk.runs.length, 3, `${disk.runs.length} runs on disk; three should be`)
      assert.equal(disk.runs[2].lines[0], 'B: opened the log', 'the wrong run was dropped')
      assert.ok(!disk.runs.some((r) => r.lines.includes('A: playing')), 'the oldest run was kept past three')

      /* A first launch says so too. */
      store.__seed('fractal.log.lastrun', undefined)
      const fresh = await import(at('logKeep.mjs') + '?fresh')
      log.said.length = 0
      const stop = fresh.keepLog()
      assert.deepEqual(await fresh.pastRuns(), [])
      assert.equal(log.said[0]?.message, 'nothing kept from the run before')
      stop()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('at the smallest size the stage screen fits without scrolling', () => {
    /*
     * "On the smallest setting, if we could make it so the screen won't scroll
     * and everything fits on the screen — it's barely hanging off the edge."
     *
     * The tiles were at their smallest and everything around them was not:
     * the gaps between sections, the padding under the foot, the preset
     * button's extra height, the chain tiles held at the stage floor of 56
     * beside scene tiles of 48, and the foot's own 56s. At the smallest step
     * the screen is being asked to fit, so all of that gives — and nothing
     * pressable goes below the platform's 44.
     */
    const stage = read('mobile/src/screens/Stage.js').replace(/\s+/g, ' ')
    assert.match(stage, /const tight = size === SIZES\[0\]/, 'the smallest step is not told apart')
    assert.match(stage, /gap: tight \? space\.md : space\.lg, paddingBottom: tight \? space\.lg : space\.xxl/, 'the gaps and the padding under the foot do not give at the smallest size')
    assert.match(stage, /height=\{tight \? TAP : TAP \+ 12\}/, 'the preset button keeps its extra height at the smallest size')
    /* `|| fitted` for the same reason `tight` is there: when the screen is
       being asked to fit, a chain tile held at 56 beside scene tiles of 48 is
       the thing that stops it fitting. */
    assert.match(stage, /height=\{Math\.max\(tight \|\| fitted \? 44 : TAP, tileH - 12\)\}/, 'a chain tile is held at 56 beside scene tiles of 48')
    assert.match(stage, /const foot = tight \? 48 : TAP/, 'the foot does not give at the smallest size')
    /* Six: Previous, Setlists, Next, Tuner, Tap Tempo and Edit — the last of
       which joined the bar when it came down off the preset row, "exactly like
       it's set up on the web app". */
    assert.equal((stage.match(/height=\{foot\}/g) || []).length, 6, 'not every button in the foot follows the foot height')
    /* And never below the platform floor. */
    assert.doesNotMatch(stage, /tight \? (4[0-3]|[0-3]\d) :/, 'something pressable goes below 44 at the smallest size')
  })

  test('the button that looks for the computer again is only there while one is missing', () => {
    /*
     * "The Try now button is there and if you click it it does — I'm not sure
     * why it's even there if we're already all connected." It was on the page
     * in every state, and on a live link it is a button that does nothing you
     * can see. It reads as what it does, and only while there is something
     * to do.
     */
    const flat = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    assert.doesNotMatch(flat, /label="Try now"/, 'the button still says Try now, which says nothing about what it tries')
    assert.match(flat, /\{link !== 'connected' \? <Press label="Look for the computer again" onPress=\{onReconnect\} \/> : null\}/, 'the reconnect button is shown on a live link')
  })

  test('the password is asked for from the account line, not left open on the page', () => {
    /*
     * "For the password change section, change it to where the box isn't
     * just showing New password. Have it be where they click on the logged
     * in username or a little settings icon next to it, and then they can
     * select change password, and a screen pops up — or forgot password,
     * where they can have an email sent to reset it."
     */
    const flat = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    assert.doesNotMatch(flat, /placeholder="New password"/, 'a password box still sits open on the Setup page')
    assert.match(flat, /<Press label=\{`⚙ \$\{account\.email\}`\} sub="Signed in · tap for password options"/, 'the account line is not the way in')
    assert.match(flat, /<Sheet open=\{accountMenu\}/, 'the account line opens nothing')
    assert.match(flat, /label="Change password" sub="Type a new one here, twice"/, 'the sheet has no Change password')
    assert.match(flat, /await sendPasswordReset\(account\.email\)/, 'the sheet cannot send a reset email')
    assert.match(flat, /<PasswordBox open=\{changing\} onChange=\{async \(next\) => \{ await changePassword\(next\)/, 'the popup does not change the password')

    /* The popup: high, so the keyboard cannot reach it; typed twice; six at
       least, which is what the account service accepts. */
    const box = read('mobile/src/components/PasswordBox.js').replace(/\s+/g, ' ')
    assert.match(box, /paddingTop: Math\.max\(space\.xxl, height \* 0\.1\)/, 'the password box sits where the keyboard covers it')
    assert.equal((box.match(/secureTextEntry/g) || []).length, 2, 'the password is not typed twice, hidden')
    assert.match(box, /export const PASSWORD_MIN = 6/)
    assert.match(box, /const ready = first\.length >= PASSWORD_MIN && first === again && !busy/, 'Change lights up before the two match')
  })

  test('the way into the chain editor is called Edit chain', () => {
    /* "Change label for add or move blocks to edit chain." */
    const edit = read('mobile/src/screens/Edit.js')
    assert.match(edit, /<Press label="Edit chain" sub="Add, move or remove blocks in this preset"/, 'the chain editor button is not called Edit chain')
    assert.doesNotMatch(edit, /Add or move blocks/)
  })

  test('a move that has been let go of stays where it was put while it is written', () => {
    /*
     * The arithmetic above is only half of it: the screen has to actually draw
     * from it. Without this, settledItems could be deleted from the render and
     * every assertion about the maths would still pass while the card went on
     * snapping back for three seconds.
     */
    const edit = read('mobile/src/screens/Edit.js').replace(/\s+/g, ' ')
    assert.match(edit, /const \[settling, setSettling\] = useState\(null\)/, 'nothing holds the move while it is written')
    assert.match(
      edit,
      /setSettling\(\{ row: lane\.row, from: pos\.from, to: pos\.to \}\)/,
      'the move is not held from the moment the writes start'
    )
    assert.match(
      edit,
      /settling && settling\.row === lane\.row \? settledItems\(resting, settling\.from, settling\.to\) : resting/,
      'the lane is still drawn only from what the unit last said'
    )

    /*
     * And let go of once the unit has been asked again. Held any longer and
     * the move is dealt a second time on top of an answer that already has it;
     * never let go of at all and a failed write leaves the lane lying for ever.
     */
    assert.match(edit, /await after\(last\) \/\* The unit has been asked again[^*]*\*\/ setSettling\(null\)/, 'the preview outlives the read that replaces it')
    assert.match(edit, /finally \{ \/\*[^*]*\*\/ setSettling\(null\) endChainWrite\(\)/, 'a throw leaves the lane drawn in an order the unit never took')
  })

  test('a drag up or down the lane deals the blocks back into the same columns', async () => {
    /*
     * "Drag and drop with a little hamburger icon, where you can hold it and
     * rearrange them by dragging up or down." A drag changes the ORDER and
     * nothing else: the occupied columns stay, a gap stays a gap, and every
     * write to the unit is planned here, in a test, before it is structure.
     */
    const { reorderPlan, landingIndex, blockPositions } = await import('../mobile/src/lib/laneOrder.js')
    const B = (col, name) => ({ col, block: { name } })
    const lane = [B(0, 'In'), B(1, 'Comp'), B(3, 'Drive'), B(4, 'Amp')]

    /* Drive dragged up above Comp: Comp and Drive swap columns, the gap at 2 stays. */
    assert.deepEqual(
      reorderPlan(lane, 2, 1).map((m) => `${m.block.name}:${m.from}->${m.to}`),
      ['Drive:3->1', 'Comp:1->3']
    )
    /* Comp dragged to the end: three blocks shift, the columns are still 0,1,3,4. */
    assert.deepEqual(
      reorderPlan(lane, 1, 3).map((m) => `${m.block.name}:${m.from}->${m.to}`),
      ['Drive:3->1', 'Amp:4->3', 'Comp:1->4']
    )
    assert.deepEqual(reorderPlan(lane, 2, 2), [], 'a drag that lands where it started writes something')
    assert.deepEqual(reorderPlan(lane, 9, 1), [], 'a position off the end writes something')
    assert.deepEqual(reorderPlan([B(0, 'Only')], 0, 0), [])

    /*
     * AND WHAT IS ON SCREEN WHILE THOSE WRITES GO OUT. "Move blocks in the
     * chain works but it jumps back to where the block was for a few seconds
     * before actually moving to its final spot." Six writes and a re-read is
     * about three seconds on an FM3, and the lane is drawn from the last thing
     * the unit said — which, until the re-read, is still the old order. So the
     * card was released, snapped back, and sat there.
     *
     * The preview has to agree with the plan exactly, or the card moves twice:
     * once to a guess and again to the truth. Same columns, new order.
     */
    const { settledItems } = await import('../mobile/src/lib/laneOrder.js')
    const shown = (items) => items.map((it) => `${it.col}:${it.kind === 'block' ? it.block.name : 'gap'}`)
    const withKind = lane.map((b) => ({ kind: 'block', col: b.col, block: b.block }))

    assert.deepEqual(
      shown(settledItems(withKind, 2, 1)),
      ['0:In', '1:Drive', '3:Comp', '4:Amp'],
      'the lane is not drawn where the finger left it'
    )
    /* Which is the same answer reorderPlan writes to the unit. */
    const planned = new Map(reorderPlan(lane, 2, 1).map((m) => [m.block.name, m.to]))
    for (const it of settledItems(withKind, 2, 1)) {
      if (planned.has(it.block.name)) {
        assert.equal(it.col, planned.get(it.block.name), `${it.block.name} is previewed somewhere it is not being written`)
      }
    }

    /* A gap stays a gap, in its own column, while the blocks move around it. */
    const holey = [
      { kind: 'block', col: 0, block: { name: 'In' } },
      { kind: 'gap', col: 1 },
      { kind: 'block', col: 2, block: { name: 'Drive' } },
      { kind: 'block', col: 3, block: { name: 'Amp' } }
    ]
    assert.deepEqual(shown(settledItems(holey, 2, 0)), ['0:Amp', '1:gap', '2:In', '3:Drive'])

    /* Nothing to preview is the lane exactly as it was — the same array back,
       so a re-render over a move that changes nothing costs nothing. */
    assert.equal(settledItems(withKind, 2, 2), withKind)
    assert.equal(settledItems(withKind, 9, 1), withKind)
    assert.equal(settledItems(withKind, 0, null), withKind)

    /* Where the finger is, over cards and gaps of different heights. */
    const heights = [80, 80, 48, 80]
    assert.equal(landingIndex(heights, 0, 0, 8), 0)
    assert.equal(landingIndex(heights, 0, 90, 8), 1, 'a card dragged one card down is not over the next card')
    assert.equal(landingIndex(heights, 0, 300, 8), 3, 'a drag past the end goes past the end')
    /* Up 120 from the bottom card: its middle sits over the second card. Up
       200: over the first. The card's MIDDLE decides, not its top edge. */
    assert.equal(landingIndex(heights, 3, -120, 8), 1)
    assert.equal(landingIndex(heights, 3, -200, 8), 0)
    assert.equal(landingIndex(heights, 3, -900, 8), 0, 'a drag past the top goes past the top')

    /* Items with a gap in them: a drop over the gap lands before the next block. */
    const items = [
      { kind: 'block', col: 0 },
      { kind: 'block', col: 1 },
      { kind: 'gap', col: 2 },
      { kind: 'block', col: 3 }
    ]
    assert.equal(blockPositions(items, 3, 2), null, 'a drop over the gap just above where the block came from changes something')
    assert.deepEqual(blockPositions(items, 3, 1), { from: 2, to: 1 }, 'the last block dragged over the second does not take its place')
    assert.deepEqual(blockPositions(items, 0, 3), { from: 0, to: 2 }, 'the first block dragged to the end does not go last')
    assert.equal(blockPositions(items, 2, 0), null, 'a gap can be dragged')
    assert.equal(blockPositions(items, 1, 1), null)

    /* And the screen: a grip on every card, Add and Remove under it, no
       question in the card, the page locked while a grip is held. */
    const editor = read('mobile/src/screens/Edit.js').replace(/\s+/g, ' ')
    assert.doesNotMatch(editor, /What can I do with this\?/, 'the cards still ask what you can do with them')
    assert.match(editor, /<Press grow label="Add" sub="A new block after this one"/, 'the card has no Add')
    assert.match(editor, /<Press grow label="Remove" sub="Delete this block"/, 'the card has no Remove')
    assert.doesNotMatch(editor, /label="Move"|label="Take out"/, 'the old Move and Take out are still there')
    assert.match(editor, /<Grip label=\{`Drag \$\{block\.name\}`\}/, 'there is no grip to drag a card by')
    assert.match(read('mobile/src/components/Grip.js'), /onPanResponderTerminationRequest: \(\) => false/, 'the grip hands the touch back to the page')
    assert.match(editor, /const dragStart = \(row, index\) => \{ onScrollLock\?\.\(true\)/, 'the page can scroll under a drag')
    assert.match(editor, /<ChainEditor blocks=\{blocks\} caps=\{caps\} onError=\{setError\} onScrollLock=\{setHeld\} \/>/, 'the chain editor is not wired to the scroll lock')
    assert.match(editor, /const free = \(lane\.gaps \|\| \[\]\)\.filter\(\(c\) => c > col\)/, 'Add does not put the new block after the card it was pressed on')
  })

  test('Save asks twice, then asks the computer, and says what became of it', async () => {
    /*
     * "There needs to be a save button that actually writes it and saves it
     * to the unit. Have it just say Save, then a pop up warning that says it
     * will override the current settings, and tap again to confirm."
     *
     * A phone cannot write a slot: the computer refuses that from a handset,
     * and should. So the request is left in the computer's store — the same
     * document the browser has left there since its Save sheet learned to
     * say "the computer writes it" — and the computer's answer is read back.
     * Run against a fake store and a fake clock.
     */
    const { askComputerToSave, pendingSaveDoc, saveResultDoc, SAVE_WAIT_MS } = await import('../mobile/src/lib/saveViaComputer.js')
    assert.equal(pendingSaveDoc('fm3'), 'fractal.pendingSave.fm3', 'the phone leaves the request where the computer does not look')
    assert.equal(saveResultDoc('fm3'), 'fractal.saveResult.fm3', 'the phone reads the answer from where the computer does not write it')

    let parked = null
    let clock = 1000
    const tick = async (ms) => { clock += ms }
    const now = () => clock

    /* The computer writes it and says so. */
    let result = null
    const ok = await askComputerToSave({
      park: async (req) => { parked = req; result = { id: req.id, ok: true, slot: req.slot } },
      readResult: async () => result,
      slot: 48, name: 'Carol Ann OD-2', id: 'p1', sleep: tick, now, pollMs: 10, waitMs: 1000
    })
    assert.deepEqual(parked, { id: 'p1', slot: 48, name: 'Carol Ann OD-2', fromSlot: 48, fromName: 'Carol Ann OD-2' }, 'the request is not the one the computer understands')
    assert.deepEqual(ok, { ok: true, slot: 48 })

    /* An answer for some other request is not this one's. */
    const stale = { id: 'old', ok: true, slot: 3 }
    const late = await askComputerToSave({
      park: async () => {}, readResult: async () => stale,
      slot: 48, id: 'p2', sleep: tick, now, pollMs: 10, waitMs: 50
    })
    assert.equal(late.ok, false)
    assert.match(late.error, /has not picked this up/, 'a computer that never answered is not said to have')

    /* The computer refuses, in its own words. */
    const refused = await askComputerToSave({
      park: async () => {}, readResult: async () => ({ id: 'p3', ok: false, slot: 48, error: 'The computer had moved to slot 12.' }),
      slot: 48, id: 'p3', sleep: tick, now, pollMs: 10, waitMs: 1000
    })
    assert.deepEqual(refused, { ok: false, error: 'The computer had moved to slot 12.' })

    /* Nothing loaded, nothing parked. */
    const none = await askComputerToSave({ park: async () => { throw new Error('should not park') }, readResult: async () => null, slot: null })
    assert.equal(none.ok, false)
    assert.equal(SAVE_WAIT_MS, 3 * 60 * 1000)

    /* And the button: Save, then Confirm changes with the warning, then the ask. */
    const saver = read('mobile/src/components/SaveToSlot.js').replace(/\s+/g, ' ')
    assert.match(
      saver,
      /label=\{s\.saving \? 'Saving…' : s\.armed \? 'Confirm changes' : 'Save'\}/,
      'there is no Save button, or it does not ask twice'
    )

    /*
     * THE WARNING IS ONE LINE, AND LARGER THAN EVERYTHING ELSE.
     *
     * "Change the warning message to say 'This will overwrite the current
     * preset', only that text, and make the text larger."
     *
     * It used to name the slot and then explain the gesture — three sentences
     * to read while standing over the one button in the app that can lose a
     * preset, and the second half only repeated what the button under it
     * already said.
     */
    /* The whole element, not the words anywhere in the file: the comment
       above it quotes the sentence it replaced, and a check that cannot tell
       a quotation from the thing itself makes the history unwritable. Third
       time that trap has been sprung in one evening. */
    assert.match(
      saver,
      /<Note tone="warn" size=\{font\.lead\} onDismiss=\{s\.disarm\}> This will overwrite the current preset <\/Note>/,
      'the overwrite warning is not his one line, at font.lead, still dismissible'
    )

    /*
     * AND IT IS FILLED WHILE THERE IS SOMETHING TO LOSE.
     *
     * "If a user has changed the preset name, make the save button yellow and
     * obvious that that's how they save it."
     *
     * An outline among outlines is the wrong weight for the one control that
     * stands between a typed name and losing it at the next preset change —
     * the name IS on the unit already, which is exactly what makes walking
     * away from this screen feel finished when it is not.
     */
    assert.match(saver, /on=\{s\.armed \|\| waiting\}/, 'the Save button does not light up when there is unsaved work')

    /* Both screens that can leave work unsaved read the same store value — a
       moved knob is lost exactly as a typed name is. */
    for (const [file, where] of [
      ['mobile/src/screens/Settings.js', 'the rename screen'],
      ['mobile/src/screens/Edit.js', 'the Edit screen']
    ]) {
      const text = read(file)
      assert.match(text, /const pending = !!unsaved && unsaved\.number === preset\?\.number/, `${where} cannot tell whether there is unsaved work`)
    }

    /*
     * AND ON THE EDIT SCREEN IT IS NOT THERE AT ALL UNTIL THEN.
     *
     * "The save button is visible and able to be clicked even though there's
     * nothing that I change and nothing to save. Can we set that to only show
     * up after a parameter has been changed?"
     *
     * The two screens differ on purpose. In Setup the button is the end of a
     * rename flow and the paragraph under it explains what saving does, so it
     * stays put and lights up. On Edit it sits in the header beside Done,
     * where an always-present button is an invitation to press it — and
     * pressing it on an untouched preset wrote the preset over itself.
     */
    assert.match(
      read('mobile/src/screens/Edit.js').replace(/\s+/g, ' '),
      /\{pending \? <SaveButton s=\{saveTo\} waiting \/> : null\}/,
      'the Edit screen draws Save whether or not there is anything to save'
    )
    assert.match(
      read('mobile/src/screens/Settings.js'),
      /<SaveButton[^/]*waiting=\{pending\}/,
      'the rename screen never lights its Save button'
    )
    assert.match(saver, /const res = await askComputerToSave\(\{ park: \(req\) => parkSave\(slug, req\), readResult: \(\) => readSaveResult\(slug\), slot: preset\?\.number, name: preset\?\.name \|\| ''/, 'the button does not ask the computer, or sends no name')
    /* On both screens where something gets changed. */
    for (const screen of ['mobile/src/screens/Edit.js', 'mobile/src/screens/Settings.js']) {
      const flat = read(screen).replace(/\s+/g, ' ')
      assert.match(flat, /const saveTo = useSaveToSlot\(\)/, `${screen} has no Save`)
      assert.match(flat, /<SaveButton s=\{saveTo\}/, `${screen} does not draw the Save button`)
      assert.match(flat, /<SaveNotes s=\{saveTo\} \/>/, `${screen} does not say what became of a save`)
    }
    const dev = read('mobile/src/lib/device.js')
    assert.match(dev, /encodeURIComponent\(`fractal\.pendingSave\.\$\{slug\}`\)/)
    assert.match(dev, /encodeURIComponent\(`fractal\.saveResult\.\$\{slug\}`\)/)
  })

  test('the log says when the phone went to sleep and came back', () => {
    /*
     * Six times in one evening's log: "connected → joining" a few seconds
     * after the last tap, "→ connected" a second before the next. Android
     * cutting the connection when the screen goes off, and the app coming
     * back — not a fault, and nothing in the log said so.
     */
    const link = read('mobile/src/lib/link.js').replace(/\s+/g, ' ')
    assert.match(link, /logDebug\('app', status === 'active' \? 'back on screen' : `put to sleep \(\$\{status\}\)`\)/, 'a paste still cannot tell a sleeping phone from a dropping link')
    assert.match(link, /if \(status === 'active'\) probeNow\(\)/, 'the phone does not look for the computer the moment it wakes')
  })

  test('a song in a setlist can be tapped to play it, and a lone song has no arrows', () => {
    /*
     * "I clicked Add to the Test setlist and it pulled up Hot Kitty, but the
     * little arrows to go up and down don't work, and clicking on the actual
     * preset name doesn't work." One song has nowhere to move, so the arrows
     * were greyed out and read as broken; the name was a label.
     */
    const flat = read('mobile/src/screens/Setlists.js').replace(/\s+/g, ' ')
    assert.match(flat, /alone=\{chosen\.presets\.length === 1\} onPlay=\{\(\) => loadPreset\(n\)\}/, 'a song row does not load its preset')
    assert.match(flat, /\{alone \? null : \( <Grip label=\{`Drag \$\{name\}`\}/, 'a lone song still shows a grip that cannot move it')
    assert.match(flat, /`\$\{slot\} · tap to play`/, 'nothing says the song can be tapped')
  })

  test('a setlist is rearranged by dragging, the way the chain is', () => {
    /*
     * "Let's make the set lists drag to rearrange as well, like it is on the
     * chain editor, instead of the up-down arrows." The same grip, the same
     * landing arithmetic, and the same two rules that keep a drag off the
     * page: the grip claims the touch and the page stops scrolling.
     */
    const flat = read('mobile/src/screens/Setlists.js').replace(/\s+/g, ' ')
    assert.match(flat, /import Grip from '\.\.\/components\/Grip'/, 'the setlist does not use the shared grip')
    assert.match(flat, /import \{ landingIndex \} from '\.\.\/lib\/laneOrder'/, 'the setlist decides where a drag lands its own way')
    assert.match(flat, /scrollEnabled=\{!held\}/, 'the page still scrolls under a dragged song')
    assert.match(flat, /const heights = rowHeights\.current\.slice\(0, chosen\?\.presets\?\.length \|\| 0\) setDrag\(\{ index: i, dy, to: landingIndex\(heights, i, dy, space\.sm\) \}\)/, 'a removed song\'s height still counts in where a drag lands')
    assert.match(flat, /if \(to !== i\) setPresets\(moveIn\(chosen\.presets, i, to\)\)/, 'a drop does not reorder the setlist')
    assert.ok(!/▲|▼/.test(flat), 'the arrows are still there')
    /* The chain editor and the setlist share one grip. */
    const grip = read('mobile/src/components/Grip.js').replace(/\s+/g, ' ')
    assert.match(grip, /onPanResponderTerminationRequest: \(\) => false/, 'the shared grip hands the touch back')
    assert.match(grip, /onStartShouldSetPanResponderCapture: \(\) => !live\.current\.disabled/, 'the shared grip does not claim the touch on landing')
    assert.match(read('mobile/src/screens/Edit.js'), /import Grip from '\.\.\/components\/Grip'/, 'the chain editor has its own grip')
  })

  test('a model called Null is explained where it is shown', () => {
    /* "In the edit menu it says Null on the current effect." The Filter
       block's flat type is called that on the unit; it reads as an error. */
    const flat = read('mobile/src/screens/Edit.js').replace(/\s+/g, ' ')
    assert.match(flat, /const modelNote = \(name\) => typeof name === 'string' && name\.trim\(\)\.toLowerCase\(\) === 'null' \? 'Flat: the sound passes through unchanged\. For a level or pan control\.' : null/, 'Null is not explained')
    assert.match(flat, /sub=\{picking \? 'Close' : modelNote\(type\?\.name\) \|\| 'Tap to change'\}/, 'the model button does not carry the note')
    assert.match(flat, /sub=\{m\.basedOn \|\| modelNote\(m\.name\) \|\| undefined\}/, 'the model list does not carry the note')
  })

  test('a knob that did not take says what the unit is holding, and why when it is the tempo', () => {
    /*
     * "Says Time 1 didn't take when I adjusted a preset." On a delay whose
     * Tempo is set to a note value the time follows the song tempo and the
     * unit puts its own number back. "Didn't take" reads as the app failing.
     */
    const flat = read('mobile/src/screens/Edit.js').replace(/\s+/g, ' ')
    assert.match(flat, /if \(!res\.ok\) onError\(didNotTake\(p, res\.actual, fresh\?\.named \|\| \[\]\)\)/, 'a refused write is not explained')
    assert.match(flat, /The unit is holding it at \$\{fmt\(actual\)\}/, 'the read-back value is not said')
    assert.match(flat, /Set Tempo to None to set the time by hand\./, 'a tempo-locked delay time is not explained')
    const dev = read('mobile/src/lib/device.js').replace(/\s+/g, ' ')
    assert.match(dev, /return \{ ok: false, continuous: null, retried: true, actual \}/, 'the confirmed write does not hand back what the unit read')
  })

  test('a write is read back off the hardware, and twice before it is called a miss', async () => {
    /*
     * "Change the volume again, and it said volume didn't take." The level was
     * where it had been put; the read that followed the write came back one
     * write behind, which is a documented habit of the computer's cache. So
     * the phone now does what the browser does — drops that cache first — and
     * reads once more after a pause before saying a write did not take.
     */
    const dev = read('mobile/src/lib/device.js').replace(/\s+/g, ' ')
    assert.match(dev, /await remoteRequest\('\/device\/cache', \{ method: 'DELETE' \}\)/, 'the phone never drops the computer\'s read cache')
    assert.match(dev, /export const READ_BACK_AGAIN_MS = 400/)
    assert.match(dev, /for \(let go = 0; go < 2; go\+\+\) \{ if \(go\) await new Promise\(\(r\) => setTimeout\(r, READ_BACK_AGAIN_MS\)\)/, 'a value that came back wrong is not read a second time')
    assert.match(dev, /await dropReadCache\(\) actual = await readParamValue\(eid, paramId\)/, 'the read-back does not follow the cache drop')
    assert.match(dev, /if \(err\?\.status === 403 \|\| err\?\.remoteBlocked\) cacheDropRefused = true/, 'a refused drop is asked for again on every write')
    /* And the relay lets it through. */
    const rules = await import('../shared/relay-rules.mjs')
    assert.equal(rules.forbiddenRemotely('DELETE', '/device/cache'), null, 'the relay refuses the cache drop')

    /* The volume says what was asked and what the unit holds, and shows it, like a knob does. */
    const vol = read('mobile/src/components/Volume.js').replace(/\s+/g, ' ')
    assert.match(vol, /The volume didn’t take\. You asked for \$\{volumeLabel\(v, p\)\}; the unit says \$\{volumeLabel\(holding, p\)\}\./, 'a volume that did not take does not say what was asked and what the unit holds')
    assert.match(vol, /if \(holding !== null\) setValue\(holding\)/, 'the slider keeps pointing at a number the unit refused')

    /* And a miss is written to the log in numbers: what was asked, what each
       read saw, which encoding went, and whether the cache drop was taken.
       "The unit is holding it at +0.8 dB" said none of that. */
    assert.match(dev, /logDebug\( 'set', `\$\{who\}: asked \$\{value\}, read \$\{actual === null \? 'nothing' : actual\}`, `\$\{continuous \? 'continuous' : 'discrete'\}, read \$\{go \+ 1\} of 2, cache drop \$\{dropped \? 'taken' : 'not taken'\}` \)/, 'a missed read-back is not logged in numbers')
    assert.match(dev, /logDebug\('set', `\$\{who\} did not take`, `asked \$\{value\}, unit holds \$\{actual === null \? 'nothing readable' : actual\}`\)/, 'a write that did not take is not logged')
    assert.match(dev, /logDebug\('set', 'cache drop failed', err\?\.message \|\| String\(err\)\)/, 'a refused cache drop is silent')
  })

  test('a rename is believed, not read back out of a stale cache', () => {
    /*
     * "Renaming a preset doesn't work, just goes right back to the original
     * name." The write landed. The re-read that followed came back with the
     * old name out of the computer's cache and put it back on screen — and
     * the scene boxes never changed at all, because refreshing the scene
     * does not refresh its names. So the write is the evidence: the cache is
     * dropped, and the screen, the name list and the scene tiles are told
     * the name that was written. That is also the name the next Save
     * carries, and the computer renames the preset to whatever the save
     * request says, so a stale one would have undone the rename in the slot.
     */
    const settings = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    assert.match(settings, /await setPresetName\(wanted\) await dropReadCache\(\) notePresetName\(wanted\)/, 'a preset rename is not believed')
    assert.match(settings, /await setSceneName\(index, wanted\) await dropReadCache\(\) noteSceneName\(index, wanted\)/, 'a scene rename is not believed')
    assert.ok(!/await refreshPreset\(\)/.test(settings), 'the preset is re-read after a rename, which is where the old name came from')
    assert.ok(!/await refreshScene\(\)/.test(settings), 'the scene is re-read after a rename, which never carried the names')

    const rig = read('mobile/src/lib/rig.js').replace(/\s+/g, ' ')
    assert.match(rig, /set\(\{ preset: \{ \.\.\.preset, name \}, unsaved \}\) if \(Number\.isInteger\(preset\.number\)\) learnName\(preset\.number, name\)/, 'the rename does not reach the screen and the name list')
    assert.match(rig, /names\[index\] = name const number = state\.preset\?\.number const unsaved = pendingFor\(number\) set\(\{ sceneNames: names, unsaved \}\)/, 'a scene rename does not reach the tiles')
    assert.match(rig, /rememberSceneNames\(device\.nameOwner\(slug\), number, names\) \}/, 'a scene rename is not kept on this phone for the next screen')

    const names = read('mobile/src/lib/presetNames.js').replace(/\s+/g, ' ')
    assert.match(names, /export function learn\(n, name\) \{ if \(!Number\.isInteger\(n\) \|\| typeof name !== 'string'\) return names\.set\(n, cleanPresetName\(name\)\) persist\(\) announce\(\)/, 'a learned name is not kept or announced')

    /* And the note says what makes it permanent, in the app's own words. */
    assert.match(settings, /Save asks the computer to write this slot, and that keeps everything changed from this phone: names, knobs, blocks and the chain\./)
  })

  test('a dead account service is given twelve seconds, not the whole evening', async () => {
    /*
     * "I can't log into supper base anymore. It says server error, so now I
     * can just do the demo."
     *
     * What the log underneath that said:
     *
     *   sign in — 19874ms
     *   sign in — 19661ms
     *   sign in — 19735ms
     *
     * Three goes, twenty seconds each, with a frozen phone in between. There
     * was no limit on a request to the account service at all — the project
     * had run out of its disk allowance and everything sent to it simply hung.
     * A phone that does not repaint for twenty seconds is a crash as far as
     * anybody holding one is concerned.
     *
     * STOOD IN FOR RATHER THAN SERVED, and the stub honours the only part of
     * fetch this depends on: a request rejects with an AbortError when its
     * signal fires, and otherwise never settles. That is the contract, and
     * standing it up as a real socket would test node's networking instead of
     * the one thing worth testing here, which is what fires when.
     */
    const { notForever, ACCOUNT_MS } = await import('../mobile/src/lib/notForever.js')
    assert.ok(ACCOUNT_MS > 0 && ACCOUNT_MS <= 15000, 'the cap is long enough to feel like the freeze it replaced')

    /* Other tests in this suite leave a stub on the global, so put back
       whatever was there rather than the real one. */
    const before = globalThis.fetch
    const signals = []
    let answer = null
    globalThis.fetch = (_url, init = {}) =>
      new Promise((resolve, reject) => {
        signals.push(init.signal)
        if (answer) {
          resolve(answer)
          return
        }
        init.signal?.addEventListener('abort', () => {
          const err = new Error('This operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })

    try {
      /* It gives up, and it says something a person can act on.
         Raced against a deadline rather than simply awaited: a version with no
         stopwatch at all never settles, and a test that waits for it wedges the
         whole suite instead of naming what broke. */
      const gaveUp = await Promise.race([
        notForever('/token', {}, 40).then(() => 'it answered', (e) => e.message),
        new Promise((r) => setTimeout(() => r('it is still waiting'), 500))
      ])
      assert.match(
        String(gaveUp),
        /account service timed out/,
        'a request to a service that never answers still waits forever'
      )

      /* A caller cancelling its own request gets its own error back. supabase-js
         cancels requests, and one of those reported as "the service timed out"
         would be a lie told exactly when somebody is trying to work out what is
         wrong. */
      const mine = new AbortController()
      const caught = notForever('/token', { signal: mine.signal }, 5000).then(
        () => null,
        (e) => e
      )
      mine.abort()
      const err = await caught
      assert.ok(err, 'the caller cancelled and the request carried on')
      assert.doesNotMatch(
        String(err.message),
        /account service timed out/,
        'the caller’s own cancel is being reported as the service failing'
      )

      /* And an answer that arrives is just an answer, passed straight back. */
      answer = { ok: true, status: 200 }
      const got = await notForever('/token', {}, 5000)
      assert.equal(got, answer)

      /* The stopwatch is called off when the answer beats it. Left running, a
         request that already finished still gets aborted on the way past — and
         every one of them holds a timer open for twelve seconds after it is
         done, which on a phone is a wakeup per request. That is the shape of
         cost this app has already been made unusable by once. */
      await notForever('/token', {}, 30)
      const its = signals[signals.length - 1]
      await new Promise((r) => setTimeout(r, 80))
      assert.equal(its.aborted, false, 'the stopwatch runs on over a request that already finished')
    } finally {
      globalThis.fetch = before
    }
  })

  test('scrolling the preset list does not queue five hundred reads at the unit', () => {
    /*
     * THIS IS WHAT MADE IT UNUSABLE, and it is worth its own check because
     * nothing about it looks wrong until you count.
     *
     * Every row that scrolled past was asked for and nothing was ever taken
     * back. A flick from slot 0 to slot 512 queued five hundred reads — each
     * one making the unit dump that preset off its own hardware, down the one
     * serial port the chain, the scene and the tuner all wait behind. Ten to
     * twenty minutes of solid reading for names nobody was looking at any more.
     *
     * And every name that landed redrew a five-hundred-row list, on the thread
     * that also has to answer a finger.
     */
    const names = read('mobile/src/lib/presetNames.js')

    /* What is on screen is what is worth asking for. */
    assert.match(names, /export function wantOnly\(list\)/, 'there is no way to ask for only what is visible')
    assert.match(names, /for \(const n of queue\.splice\(0\)\) asked\.delete\(n\)/, 'rows that scrolled off stay queued at the unit')
    /* Given back properly: a slot dropped from the queue has to leave `asked`
       too, or landing on it later waits forever on a read that was thrown. */
    const drop = names.indexOf('queue.splice(0)) asked.delete(n)')
    assert.ok(drop > 0 && names.slice(drop, drop + 400).includes('asked.add(n)'), 'a dropped slot is never asked for again')

    /* One re-render for a burst, not one per name. */
    assert.match(names.replace(/\s+/g, ' '), /let telling = false const announce = \(\) => \{ revision \+= 1 if \(telling\) return/, 'every name that lands redraws every watching screen')

    /* Still one read at a time: firing them together does not make the unit
       answer faster, it makes the queue longer. */
    assert.match(names, /if \(draining\) return/, 'name reads can now overlap at the unit')
  })

  test('the demo answers every route the phone actually asks for', async () => {
    /*
     * "Yes I want the demo mode on the phone as well. It helps me make sure the
     * lag isn't just the app, also."
     *
     * The second reason is the better one and it decides how this is built. The
     * demo answers from memory — no relay, no serial port, no unit — so a
     * screen that is STILL slow in the demo is slow because of this app, and
     * one that is quick here and slow on a rig is waiting on the wire. Nothing
     * else in this project can tell those two apart, and it has now guessed
     * wrong about which is which more than once.
     *
     * WHY THIS CHECK EXISTS: the demo stands in at `remoteRequest`, which means
     * it has to know every route `device.js` asks for. Miss one and the failure
     * is not an error — it is a screen that is simply empty, in a mode built so
     * somebody can look around. So this asks for all of them.
     */
    const { demoRequest } = await import('../mobile/src/lib/demoWire.js')
    const { createMockDevice } = await import('../src/lib/mockDevice.js')
    const unit = createMockDevice()

    const send = (path, method = 'GET', body) =>
      demoRequest(unit, path, { method, body: body === undefined ? null : JSON.stringify(body) })

    /*
     * The list below is written out by hand, and that is the weakness in it:
     * it was written from memory rather than from device.js, and it asked for
     * `/blocks/catalog` — a route the phone has never requested. The demo
     * answered that one happily while the real `/blocks` fell through, so
     * this test passed green for as long as the Edit screen was broken.
     *
     * So the count below is not the guard it looks like. The guard is "the
     * demo answers every path the phone asks for", further down this file,
     * which reads the paths OUT of device.js and holds the wire to them.
     * What this test is for is the other half: that each route, once found,
     * comes back with something. Keep both.
     */
    const device = read('mobile/src/lib/device.js')
    const paths = [...device.matchAll(/['`](\/[a-z][^'`\s]*)['`]/g)].map((m) => m[1])
    assert.ok(paths.length > 15, `only ${paths.length} routes were found in device.js; this check read nothing`)

    const answered = [
      ['/healthz'], ['/device/detect'], ['/preset'], ['/preset/blocks'], ['/preset/grid'],
      ['/scene'], ['/tempo'], ['/mod/model'], ['/blocks'],
      ['/presets/5/summary'], ['/presets/5'], ['/preset/blocks/58/params'],
      ['/blocks/amp/types'], ['/blocks/comp/types'],
      ['/preset/select', 'POST', { number: 7 }],
      ['/scene', 'POST', { index: 2 }],
      ['/scene/name', 'POST', { index: 0, name: 'X' }],
      ['/preset/name', 'POST', { name: 'Y' }],
      ['/tempo', 'POST', { bpm: 120 }],
      ['/tempo/tap', 'POST'],
      ['/tuner', 'POST', { on: true }],
      ['/preset/blocks/118/bypass', 'POST', { bypassed: true }],
      ['/preset/blocks/58/channel', 'POST', { channel: 'B' }],
      ['/preset/blocks/58/type', 'POST', { value: 3 }],
      ['/preset/blocks/58/params/0', 'PUT', { value: 0.5 }]
    ]
    for (const [path, method, body] of answered) {
      const got = await send(path, method, body)
      assert.ok(got !== undefined && got !== null, `the demo has no answer for ${method || 'GET'} ${path}`)
    }

    /*
     * The real thing behind it: a chain, and a preset that changes when asked.
     *
     * The preset is named, because the demo holds twelve seeded ones now
     * (src/data/demo-presets.json) and the chain differs between them — the
     * route list above leaves the unit on 7, whose chain is deliberately a
     * short one. Asking without saying which preset used to pass on whichever
     * chain happened to be loaded.
     */
    await send('/preset/select', 'POST', { number: 0 })
    const blocks = await send('/preset/blocks')
    assert.ok(blocks.length > 5, 'the demo has no chain to draw')
    assert.ok(blocks.some((b) => b.slug === 'amp'), 'the demo preset has no amp in it')
    await send('/preset/select', 'POST', { number: 12 })
    assert.equal((await send('/preset')).number, 12, 'the demo ignored a preset change')

    /* A route it does not know throws rather than answering nothing: an empty
       screen in a mode built for looking around reads as a broken screen. */
    await assert.rejects(() => send('/nonsense'), /no answer/, 'an unknown route answers nothing instead of saying so')

    /* And the switch itself, read rather than run: it reaches for React and the
       phone's storage, neither of which exists here. */
    const demo = read('mobile/src/lib/demo.js')
    assert.match(demo, /export const demoDevice = \(\) => mock/, 'nothing hands the simulated unit out')
    /* Built AS the chosen unit — the demo is five units now, not one. */
    assert.match(demo, /mock = want \? createMockDevice\(unit\) : null/, 'the switch does not build a unit')
    assert.match(
      read('mobile/src/lib/device.js').replace(/\s+/g, ' '),
      /const demo = demoDevice\(\) return demo \? demoRequest\(demo, path, options\) : overTheWire\(path, options\)/,
      'the app does not route through the demo, so turning it on changes nothing'
    )
  })

  test('the demo is offered, escapable, and never pretends to be a rig', () => {
    /*
     * Offered on the sign-in screen, because that is where somebody with no
     * computer is standing, and it is the screen that otherwise asks them for a
     * code no computer of theirs has ever shown.
     */
    const signIn = read('mobile/src/screens/SignIn.js').replace(/\s+/g, ' ')
    assert.match(signIn, /label="Try the Demo"/, 'nothing offers the demo where somebody needs it')
    /*
     * AND NOTHING UNDER IT. "No text underneath."
     *
     * The PROP rather than the words: the comment above the button quotes the
     * subtitle it replaced, so searching the file for that sentence finds the
     * explanation and fails on it. Sixth time.
     */
    const demoBtn = signIn.slice(signIn.indexOf('label="Try the Demo"'))
    assert.ok(
      !/sub=/.test(demoBtn.slice(0, demoBtn.indexOf('/>'))),
      'the demo button has a subtitle again'
    )
    assert.match(signIn, /setDemo\(true\)/, 'the button does not turn the demo on')

    /*
     * AND ESCAPABLE, or it is a trap rather than a demo — but the door is
     * not the same one for everybody.
     *
     * "Someone should only be able to exit a demo if they've already
     * purchased the app or paid." So Settings' way out is behind the
     * purchase now: for somebody who has not paid it led to an empty room,
     * the live app with nothing it can drive.
     *
     * Which makes the OTHER door the one that matters, and it is the one
     * this check now holds. Heading for Sign in ends the demo — App.js's
     * toSignIn — and the sign-in screen offers the demo again, so somebody
     * who has not paid can always get out and back in. Lose that and the
     * gate above turns the demo into a room with no handle on the inside.
     */
    const settings = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    assert.match(settings, /purchase\.unlocked \? \( <Press label="Exit demo"/, 'the way out of the demo is not behind the purchase')

    const app = read('mobile/App.js')
    const toSignIn = app.slice(app.indexOf('const toSignIn = ()'), app.indexOf('const toSignIn = ()') + 260)
    assert.match(toSignIn, /setDemo\(false\)/, 'signing in no longer ends the demo, so an unpaid phone is shut in')
    assert.match(signIn, /setDemo\(true\)/, 'the sign-in screen no longer offers the way back in')
    assert.match(settings, /onPress=\{\(\) => setDemo\(false\)\}/, 'the way out does not turn it off')
    /* It says what it is, every time, rather than letting somebody think a
       simulated FM3 is their FM3. */
    /* It names whichever unit it is being, which is the whole point of
       offering five of them. */
    assert.match(settings, /This is the demo — a simulated \$\{/, 'the demo does not say it is one')
    /* Named off the SUBSCRIPTION rather than a plain read. It was
       `demoUnit()`, which cannot be told it has gone stale, so this sentence
       went on naming the unit the app started as after somebody had picked
       another one. */
    assert.match(settings, /const unit = useDemoUnit\(\)/, 'the demo screen does not follow which unit it is')
    assert.match(settings, /DEMO_UNITS\.find\(\(u\) => u\.key === unit\)/, 'the demo says a unit it may not be')
    /*
     * AND IT NAMES THE UNIT THE DEMO ACTUALLY IS.
     *
     * This was the literal 'Demo — simulated FM3' whatever had been picked,
     * so an Axe-Fx III demo described itself as an FM3 one row under a bar
     * reading Axe-Fx III. That is the exact fault the five demo units were
     * added to end, left behind in a string.
     */
    assert.match(settings, /`Demo — simulated \$\{DEMO_UNITS\.find\(\(u\) => u\.key === unit\)\?\.name \|\| 'unit'\}`/, 'Setup does not say which unit the demo is')
    assert.ok(!/'Demo — simulated FM3'/.test(settings), 'Setup calls every demo an FM3 again')

    /* The link reads as connected, because from every screen's point of view it
       is: the questions get answered. Otherwise the app refuses to open the
       preset list over a unit that is right there. */
    assert.match(
      read('mobile/src/lib/link.js').replace(/\s+/g, ' '),
      /if \(isDemo\(\)\) \{ set\(\{ link: 'connected', macName: 'the demo', hostVersion: null \}\)/,
      'the demo does not read as a working link, so the app refuses to use it'
    )

    /*
     * NO ARTIFICIAL DELAY ANYWHERE. A demo that pretended to be as slow as a
     * serial port would be prettier and would answer nothing — and answering
     * the lag question is half of why this exists.
     */
    const wire = read('mobile/src/lib/demoWire.js')
    assert.ok(!/setTimeout|sleep|delay/i.test(wire.replace(/\/\*[\s\S]*?\*\//g, '')), 'the demo has been given a fake delay, which is the one thing it must not have')
  })

  test('the demo touches nothing on the network', () => {
    /*
     * "I can't log into supabase anymore. It says server error… It says the
     * supabase database is like maxed out or something."
     *
     * It is — Supabase said so by email and every query to it times out. Which
     * makes this worse than untidy: the demo signed itself in as far as App is
     * concerned, so the account sync ran underneath it, pushing setlists at a
     * database the demo has no business touching, on an account somebody
     * looking around may not even have.
     *
     * It is also the opposite of what the demo is for. The whole value of it is
     * that nothing leaves the phone, so a screen that is slow in the demo is
     * slow for its own reasons. A cloud sync running under it puts the network
     * back in the measurement.
     */
    const app = read('mobile/App.js').replace(/\s+/g, ' ')
    assert.match(app, /if \(demo\) return undefined let alive = true let stop = null hydrate\(\)\.then/, 'the account sync still runs in the demo')
    assert.match(app, /\}, \[auth, demo\]\)/, 'the sync is not re-decided when the demo goes on or off')

    /* And the link loop never starts, so no channel is joined and no session
       is fetched: the demo makes no request at all. */
    assert.match(
      read('mobile/src/lib/link.js').replace(/\s+/g, ' '),
      /if \(isDemo\(\)\) \{ set\(\{ link: 'connected'/,
      'the demo starts the link loop, which joins a channel it has no use for'
    )
  })

  test('the bar says DEMO rather than wearing a real rig’s green', () => {
    /*
     * "It does sound connected, even in demo."
     *
     * It said CONNECTED, in the same green a real FM3 gets. The demo reads as a
     * connected link everywhere else on purpose — the questions do get answered
     * — but the bar is the one place somebody looks to know what they are
     * driving, and dressing a simulated unit as a real one there is the app
     * lying in the exact spot that exists to stop it.
     */
    const bar = read('mobile/src/components/TopBar.js').replace(/\s+/g, ' ')
    assert.match(bar, /const demo = useDemo\(\)/, 'the bar cannot tell whether it is in the demo')
    /* `canBuy` is now the first rung — the word says UNLOCK where there is
       one to sell. What this test is about is the rung after it: the demo
       must never wear CONNECTED. */
    assert.match(
      bar,
      /const word = canBuy \? 'unlock' : demo \? 'demo' : linkWord\(tone, 'remote'\)/,
      'the bar still says CONNECTED in the demo'
    )
    assert.match(bar, /const mark = demo \? 'wait' : linkTone\(tone\)/, 'the demo word is drawn in the colour a real connection gets')
  })

  test('the bar has two spots, and each tells its own truth', async () => {
     /*
     * "The whole time I was playing around with the app, it said I was still
     * connected to the FM3." It was connected -- to the Mac. The FM3 had
     * frozen: no preset number, no chain, every read timing out, and the bar
     * green for the whole of it. "It has two spots for connections already.
     * One is to the computer, the other is the unit link. They both need to
     * tell the truth." The right-hand word stays the computer's; the lamp and
     * name on the left are the unit's.
     */
    const words = await import('../shared/link-word.mjs')
    assert.equal(words.unitWord('good', 'missing'), 'no unit')
    assert.equal(words.unitWord('good', 'silent'), 'not answering')
    assert.equal(words.unitWord('good', 'present'), null)
    assert.equal(words.unitWord('bad', 'silent'), null, 'with the link down, the link is the news')
    const phone = await import('../mobile/src/lib/link-word.js')
    assert.equal(phone.unitWord('good', 'silent'), words.unitWord('good', 'silent'), 'the two apps disagree about the unit word')
    const bar = read('mobile/src/components/TopBar.js').replace(/\s+/g, ' ')
    assert.match(bar, /const unitSaid = demo \? null : unitWord\(tone, unitState\)/, 'the bar does not ask about the unit')
    assert.match(bar, /<Lamp state=\{unitLamp\} \/>/, 'the lamp is about the link, not the unit')
    assert.match(bar, /const unitLamp = demo \? 'idle' : connected && unitState === 'present' \? 'good' : !connected \|\| unitSaid \? 'fault' : 'idle'/, 'the unit lamp is not green when the unit answers and red when it does not')
    assert.match(read('mobile/src/components/Lamp.js'), /state === 'good' \? color\.ok/, 'the lamp has no green')
    assert.match(bar, /const named = unitSaid \? `\$\{unit \? `\$\{unit\} · ` : ''\}\$\{unitSaid\}`\.toUpperCase\(\) : unit \|\| \(connected \? 'Looking…' : '—'\)/, 'the unit spot does not say the unit is silent')
    assert.match(bar, /color: unitSaid \? color\.fault : color\.silk/, 'a silent unit is not drawn in red')
    const rig = read('mobile/src/lib/rig.js').replace(/\s+/g, ' ')
    assert.match(rig, /const unit = caps\?\.connected === false \? 'missing' : 'present'/, 'a Mac with no unit is not noticed')
    assert.match(rig, /fresh\?\.number === -1 \? \{ unit: 'silent' \}/, 'a unit that stops answering its name is not noticed')
    const settings = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    assert.match(settings, /unitState === 'silent' \? `Computer connected · \$\{deviceName \|\| 'unit'\} not answering`/, 'Setup still says connected over a silent unit')
  })

  test('somebody asks whether the unit is still there, rather than waiting to be told', async () => {
    /*
     * "I purposefully unplugged the FM3 from the computer and it still said
     * connected. I waited a few minutes, went ahead and tried to click some
     * buttons, go to different presets, still said connected, so it's lying.
     * There needs to be a way for it to actually show disconnected when it
     * disconnects. which gave us the whole problem before where the unit froze
     * and we still thought it was connected."
     *
     * Every piece of the answer was already here except the question. The
     * store knows what a silent unit looks like (-1 where a preset number
     * should be), the top bar draws it in red, Setup says it in words — and
     * nothing ever asked, because refreshAll runs once at the moment of
     * connecting and the stage screens read everything they draw out of the
     * store.
     *
     * Note what does NOT count as asking: pressing buttons. A preset change
     * is a write, and a write into a port whose far end has been pulled out
     * does not have to fail. Only an answer proves anybody is home.
     */
    const watch = await import('../shared/unit-watch.mjs')

    /* A preset number is an answer. Anything else is silence, whether it came
       back as -1, as nothing, or as a thrown error. */
    assert.equal(watch.probeSays({ preset: { number: 12 } }), 'answering')
    assert.equal(watch.probeSays({ preset: { number: 0 } }), 'answering', 'slot zero is a real slot')
    assert.equal(watch.probeSays({ preset: { number: -1 } }), 'quiet', 'the computer said the unit did not answer')
    assert.equal(watch.probeSays({ preset: null }), 'quiet')
    assert.equal(watch.probeSays({ failed: true }), 'quiet')

    /*
     * One quiet answer is not evidence. "My Mac is connected just fine. The
     * phone app says it has lost the unit" — the computer asks that same port
     * several times a second, and a question that loses the race looks exactly
     * like a unit that has gone.
     */
    assert.equal(watch.unitGone(watch.countQuiet(0, 'quiet')), false, 'one missed answer tears the screen down')
    assert.equal(watch.unitGone(watch.countQuiet(1, 'quiet')), true, 'two in a row still is not enough')
    assert.equal(watch.countQuiet(1, 'answering'), 0, 'an answer does not clear the run of silence')

    /* Cheaper to ask at the machine holding the cable than from a phone on a
       cell connection, so the two are not the same number. */
    assert.ok(watch.watchEvery(false) < watch.watchEvery(true), 'the relay is asked as often as a loopback')
    assert.ok(watch.watchEvery(false) >= 5000, 'the unit is asked so often it is being interrogated')

    /* And both apps ask. A phone and a Mac disagreeing about whether a unit is
       plugged in is not a difference between them; it is one of them lying. */
    const rig = read('mobile/src/lib/rig.js').replace(/\s+/g, ' ')
    assert.match(rig, /export function watchUnit\(\)/, 'the phone never asks')
    assert.match(rig, /probeSays\(\{ preset: await device\.currentPreset\(\) \}\)/, 'the phone asks something a write could fake')
    assert.match(rig, /if \(unitGone\(quiet\)\) \{/, 'the phone believes one quiet answer')
    const link = read('mobile/src/lib/link.js').replace(/\s+/g, ' ')
    assert.match(link, /watchUnit\(\)/, 'nothing starts the phone asking')
    /* A phone in a pocket has no screen to be wrong on. */
    assert.match(link, /if \(status === 'active'\) watchUnit\(\) else stopWatching\(\)/, 'the asking does not stop with the screen')

    const app = read('src/App.jsx').replace(/\s+/g, ' ')
    assert.match(app, /if \(status !== 'live'\) return undefined/, 'the browser asks about a unit it never had')
    assert.match(app, /said = probeSays\(\{ preset: await currentPreset\(\) \}\)/, 'the browser asks something a write could fake')
    assert.match(app, /if \(unitGone\(quiet\)\) \{/, 'the browser believes one quiet answer')
    assert.match(app, /document\.visibilityState === 'hidden'/, 'a tab nobody is looking at keeps asking')
    assert.match(app, /await read\(\)/, 'the browser never confirms what the check found')
  })
  test('the tempo is worked out here, so the wifi cannot change it', async () => {
    /*
     * "Right now after I tap it a few times slowly, it'll send a number and
     * then I'm done tapping and it sends back a different one, so maybe do a
     * little more research on it or figure out why it's not working
     * correctly, but and I understand it's going over Wi-Fi and stuff, so but
     * there's gotta be way to do it and make it work."
     *
     * The wifi was the whole of it. Each press was forwarded to the unit as a
     * TAP, and the unit worked the tempo out from the spacing between them AS
     * THEY ARRIVED THERE — thumb spacing plus whatever the network and the
     * computer's queue added to each one, differently every time. The unit
     * then answered, correctly, about a rhythm nobody played, and the slower
     * the taps the more room the jitter had to accumulate.
     *
     * This is what that looked like, and why no amount of work at the far end
     * could have fixed it: the information is destroyed on the way.
     */
    const { tappedBpm, keepTaps, tempoSender, TAP_AVERAGE } = await import('../shared/tempo.mjs')

    /* A steady 100 BPM: presses 600ms apart. */
    const played = [0, 600, 1200, 1800]
    let list = []
    for (const at of played) list = keepTaps(list, at)
    assert.equal(tappedBpm(list), 100, 'a press every 600ms is not 100 BPM')

    /*
     * The same thumb, seen through a network that held each press up a little
     * longer than the one before it — which is what a queue does when writes
     * start stacking behind each other on a busy link. Nothing here is
     * unreasonable: the worst of it is a third of a second.
     *
     * Note which way this goes wrong. Plain random jitter partly cancels in
     * the average, so the unit is only a few BPM out; delay that GROWS
     * stretches every gap in the same direction and none of it cancels. That
     * is why "a few times slowly" was the case that showed it up — a longer
     * burst gives the queue more time to build.
     */
    const jitter = [0, 80, 180, 320]
    let asArrived = []
    for (let i = 0; i < played.length; i += 1) asArrived = keepTaps(asArrived, played[i] + jitter[i])
    const heard = tappedBpm(asArrived)
    assert.notEqual(heard, 100, 'this jitter happens to cancel out; pick numbers that do not')
    assert.ok(Math.abs(heard - 100) >= 5, `the unit would have heard ${heard}, which is too close to make the point`)

    /*
     * So the taps do not leave. "It should basically take the last three taps
     * and use that to calculate the tempo" — three taps, two gaps, averaged,
     * and the ANSWER is what crosses the network.
     */
    assert.equal(TAP_AVERAGE, 3, 'the tempo is worked out from a different number of taps than he asked for')
    assert.equal(tappedBpm([0, 600, 1200]), 100, 'three taps 600ms apart are not 100 BPM')
    /* A fourth tap does not drag the answer back towards the older gaps. */
    assert.equal(tappedBpm([0, 2000, 600, 1200]), 100, 'a tap older than the last three still counts')

    /*
     * And a burst does not queue writes behind each other. One in the air at
     * a time, newest number replacing whatever is waiting — because the last
     * number shown has to be the last number sent, and a queue makes it the
     * last to LAND, possibly after the read-back meant to confirm it.
     */
    const reached = []
    const send = tempoSender((bpm) => new Promise((go) => { reached.push(bpm); setTimeout(go, 20) }))
    send.push(90)
    send.push(95)
    send.push(100)
    assert.equal(send.idle, false, 'a write in the air reads as nothing happening')
    await new Promise((go) => setTimeout(go, 150))
    assert.equal(send.idle, true, 'the sender never finishes')
    assert.equal(send.sent, 100, 'the last number tapped is not the last number the unit was told')
    assert.equal(reached[reached.length - 1], 100, 'the unit ends up on a tempo from the middle of the burst')
    assert.ok(reached.length < 3, 'every intermediate tempo took its own round trip')

    /* A failed write is reported rather than swallowed, and does not wedge the
       sender shut for the next tap. */
    const said = []
    const bad = tempoSender(() => Promise.reject(new Error('port not open')), (err) => said.push(err.message))
    await bad.push(120)
    assert.deepEqual(said, ['port not open'], 'a refused tempo says nothing')
    assert.equal(bad.idle, true, 'one refusal stops the button working for good')
  })

  test('a model in the reference opens its own page, with the picture and the words', async () => {
    /*
     * "Still not seeing any amp cab and pedal photos or descriptions. Should
     * be able to tap on the card and open a detailed page like this."
     *
     * Both were written months ago and wired into one place: the panel inside
     * the block editor, for the model ALREADY CHOSEN — the one model nobody
     * is wondering about. The reference list, whose entire purpose is "what
     * have I got", had rows that could not be opened, on the reasoning that
     * there was nothing to choose. Nothing to choose; something to read.
     */
    const gear = read('mobile/src/screens/Gear.js')
    assert.match(gear, /onPress=\{\(\) => setOpen\(item\)\}/, 'the phone\u2019s rows still cannot be opened')
    assert.match(gear, /if \(open\) return <GearCard entry=\{open\} onBack=\{\(\) => setOpen\(null\)\} \/>/, 'there is nothing behind a row')
    assert.match(gear, /accessibilityRole="button"/, 'a row that opens a page does not say it is a button')

    const card = read('mobile/src/components/GearCard.js')
    assert.match(card, /descriptionFor\(entry\.slug, entry\.name\)/, 'the page never asks what the model is like')
    assert.match(card, /photoFor\(entry\.name, `\$\{HOSTED_ORIGIN\}\/gear`\)/, 'the phone looks for the photographs somewhere it has no files')
    /* The credit cannot be separated from the picture: every one is Creative
       Commons and naming the photographer is the condition of showing it. */
    assert.ok(
      card.indexOf('source={{ uri: photo.src }}') < card.indexOf('{photo.credit}'),
      'the photograph is drawn somewhere the credit is not'
    )

    /*
     * Both ends match models to photographs by the same rule, from the same
     * generated file. A second copy of the family-prefix matching would drift,
     * and drift here shows up as a picture of the WRONG amp under the right
     * name — the exact failure that threw away the first batch of two hundred.
     */
    const web = await import('../src/lib/gearPhotos.js')
    const phone = await import('../mobile/src/lib/gearPhotos.js')
    assert.equal(phone.photoCount, web.photoCount, 'the two apps carry different numbers of photographs')
    for (const name of ['1959SLP Normal', 'Brit JVM', 'Nothing At All XYZ']) {
      const a = web.photoFor(name)
      const b = phone.photoFor(name, '/gear')
      assert.deepEqual(b, a, `the two apps disagree about the photograph for ${name}`)
    }

    /* A relative path is right for a web page and wrong for a phone, which has
       no site root to be relative to. */
    const remote = phone.photoFor('1959SLP Normal', 'https://example.test/gear')
    assert.ok(remote.src.startsWith('https://example.test/gear/'), 'the phone cannot be told where the files are')

    /* And a catalog row carries the block it came from, or nothing above can
       be looked up at all. */
    const { groupsFor } = await import('../mobile/src/lib/gearCatalog.js')
    const amps = groupsFor({}).find((g) => g.key === 'amp')
    assert.ok(amps.entries.length > 0, 'the amp list is empty')
    assert.ok(amps.entries.every((e) => e.slug === 'amp'), 'a catalog row does not know which block it came from')
  })

  test('the phone has light, dark and auto, and every screen follows', async () => {
    /*
     * "I'm not seeing where the light/dark/auto theme buttons are anymore.
     * Please put that back on Setup."
     *
     * The browser has had all three for a long time. The phone had none: it
     * was dark whatever the handset was set to, which is the wrong answer in
     * a lit room and the wrong answer on a phone in light mode.
     *
     * HOW IT WORKS WITHOUT 252 EDITS. There are 252 reads of `color.x` across
     * 25 files and not one StyleSheet.create in the app — normally a small
     * inefficiency, and here the thing that makes a theme possible at all.
     * Inline styles are read fresh on every render, so swapping the VALUES on
     * the one exported palette and re-rendering the root repaints everything
     * with no call site changing. Which means the object must be MUTATED and
     * never replaced: an `export const color = next` would leave every module
     * that already imported it pointing at the old one.
     */
    const theme = await import('../mobile/src/lib/theme.js')
    const before = theme.color
    assert.deepEqual(theme.MODES, ['auto', 'light', 'dark'], 'the three settings are not the three the browser has')

    theme.setMode('light')
    assert.equal(theme.color, before, 'the palette object was replaced, so every screen still holds the old one')
    assert.equal(theme.isDark(), false)
    const light = theme.color.chassis
    theme.setMode('dark')
    assert.equal(theme.isDark(), true)
    assert.notEqual(theme.color.chassis, light, 'light and dark are the same colour')

    /* Auto follows the handset rather than guessing. */
    theme.setMode('auto')
    theme.setSystemDark(false)
    assert.equal(theme.isDark(), false, 'auto ignores a phone set to light')
    theme.setSystemDark(true)
    assert.equal(theme.isDark(), true, 'auto ignores a phone set to dark')

    /*
     * Every key is written on every change. A colour that existed in one
     * palette and not the other would otherwise keep the previous theme's
     * value, which shows up as one wrong-coloured thing on one screen in one
     * mode — the kind of bug nobody reproduces.
     */
    const src = read('mobile/src/lib/theme.js')
    const dark = src.match(/const DARK = \{([\s\S]*?)\n\}/)[1]
    const lightSrc = src.match(/const LIGHT = \{([\s\S]*?)\n\}/)[1]
    const keys = (t) => [...t.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]).sort()
    assert.deepEqual(keys(lightSrc), keys(dark), 'the two palettes do not carry the same colours')

    /* Subscribed once, at the root, because one re-render there is every
       screen's next render. */
    const app = read('mobile/App.js')
    assert.match(app, /useSyncExternalStore\(watchTheme, themeVersion, themeVersion\)/, 'nothing repaints when the theme changes')
    assert.match(app, /Appearance\.addChangeListener/, 'auto never hears the handset change')
    assert.match(app, /hydrate\(\)\.then\(\(\) => loadMode\(sync\)\)/, 'the chosen theme is forgotten between launches')
    /* The clock and the battery have to be readable against what is behind
       them, which is the one thing a palette swap cannot reach. */
    assert.match(app, /<StatusBar style=\{isDark\(\) \? 'light' : 'dark'\} \/>/, 'the status bar is light ink on a light screen')

    /* And it is reachable: on Setup, beside the other setting about how the
       thing on the stand looks. */
    const settings = read('mobile/src/screens/Settings.js')
    assert.match(settings, /<Section>Appearance<\/Section>/, 'there is nowhere to choose a theme')
    assert.match(settings, /setMode\(m, sync\)/, 'choosing a theme does not remember it')

    theme.setMode('auto')
  })

  test('the demo tuner moves on the phone, not just in the browser', async () => {
    /*
     * "Demo tuner animations." The needle never moved on a phone.
     *
     * The simulation has had a proper tuner in it the whole time —
     * lib/tunerStream holds a note for the life of a ring and picks a new
     * string only coming out of a quiet gap, because a real detector cannot
     * hop mid-note. The BROWSER subscribes to it and animates.
     *
     * The phone never did. Its readings arrive as events off the relay, and
     * in the demo there is no relay to carry them, so the tuner opened, the
     * timer ran, and nothing reached the needle. On that screen "nothing is
     * happening" and "this is broken" look identical.
     */
    const { createTunerStream } = await import('../mobile/src/lib/tunerStream.js')

    /*
     * SEEDED, BECAUSE THIS ASKED CHANCE A QUESTION IT COULD ANSWER WRONG.
     *
     * The stream picks a string at random coming out of each quiet gap, and
     * 2000 polls hold somewhere around forty-six gaps. The odds of one string
     * never coming up are about one in seven hundred — which is rare enough to
     * read as a solid test and common enough to fail a pull request that had
     * nothing to do with the tuner. It did exactly that: "the demo tuner only
     * ever finds E2, B3, E4, A2, D3", on a change to a workflow file.
     *
     * `createTunerStream` has always taken its own random function for this
     * reason; the test simply never passed one. Several seeds rather than one,
     * so this still says the stream visits all six strings whatever it is fed,
     * rather than that one lucky sequence does.
     */
    const seeded = (seed) => () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const stream = createTunerStream(seeded(seed))
      const strings = new Set()
      let ringing = 0
      for (let i = 0; i < 2000; i += 1) {
        const said = stream.next()
        if (said.note) {
          ringing += 1
          strings.add(`${said.note}${said.octave}`)
        }
      }
      /* A tuner that is silent more than it rings is one nobody would call
         working. */
      assert.ok(ringing > 1000, `seed ${seed}: the demo tuner is quiet ${100 - Math.round(ringing / 20)}% of the time`)
      assert.equal(strings.size, 6, `seed ${seed}: the demo tuner only ever finds ${[...strings].join(', ')}`)
    }

    /* A ring never hops mid-note: the note only changes across a silent gap,
       which is the failure this stream was written to fix. */
    const held = createTunerStream()
    let last = null
    for (let i = 0; i < 2000; i += 1) {
      const said = held.next()
      if (!said.note) {
        last = null
        continue
      }
      const now = `${said.note}${said.octave}`
      if (last) assert.equal(now, last, 'the demo tuner changed string without a gap')
      last = now
    }

    /* And the phone drives it, into the same handler every real reading goes
       through — a second copy of the tuner screen would prove nothing. */
    const rig = read('mobile/src/lib/rig.js')
    assert.match(rig, /setInterval\(\(\) => handleEvent\(source\.next\(\)\), 400\)/, 'the phone never feeds the demo tuner')
    assert.match(rig, /if \(on\) startDemoTuner\(\)/, 'the demo tuner never starts')
    assert.match(rig, /if \(!on\) stopDemoTuner\(\)/, 'the demo tuner runs after it is switched off')
    const device = read('mobile/src/lib/device.js')
    assert.match(device, /export const demoTuner = \(\) => demoDevice\(\)\?\.tunerStream\?\.\(\) \|\| null/, 'there is nothing for the phone to read')
    /* Null on a real rig, where the relay carries the readings and a second
       source would fight them. */
    assert.match(device, /demoDevice\(\)\?\./, 'the phone would drive a tuner over a real unit too')
  })

  test('the phone can change which unit the demo is, and see that it did', () => {
    /*
     * "On the demo, it's not letting you switch to a different demo. It's
     * stuck on the FM3. And when you click the top left unit button, it brings
     * up the setup screen where it used to bring up the demo page."
     *
     * Three faults, and every one of them had to go for a tap on a unit to
     * mean anything.
     *
     * ONE: NOTHING REDREW. `setDemoUnit` recorded the choice, rebuilt the
     * simulated unit and told every watcher, exactly as it reads — and the
     * only subscription on offer was `useDemo`, whose SNAPSHOT is `isDemo`, a
     * boolean. Going from a simulated FM3 to a simulated Axe-Fx III leaves
     * that boolean true; `useSyncExternalStore` compares snapshots with
     * Object.is and skips the render when nothing moved. So the announcement
     * arrived and was correctly ignored, and the five buttons kept the old
     * unit lit however many times they were pressed.
     *
     * TWO: NOTHING RE-READ. The stage screen's read runs on mount, with no
     * dependencies. The rig underneath really had become another unit and
     * nothing had asked it anything since, so the screen went on showing the
     * old one's presets, scenes and chain.
     *
     * THREE: NOTHING TOOK YOU THERE. The name in the corner opened Setup —
     * the whole screen, from the top — with the five units two doors further
     * in, inside a page named after pairing a phone.
     */
    const demo = read('mobile/src/lib/demo.js')

    /* The snapshot is the unit, and that is the entire first fault. A hook
       here whose snapshot is `isDemo` cannot report a change of unit, however
       loudly the store announces one. */
    assert.match(
      demo,
      /export const useDemoUnit = \(\) => useSyncExternalStore\(subscribe, demoUnit, demoUnit\)/,
      'nothing can subscribe to WHICH unit the demo is, so changing it redraws nothing'
    )
    assert.match(
      demo,
      /export const useDemo = \(\) => useSyncExternalStore\(subscribe, isDemo, isDemo\)/,
      'the on/off subscription changed shape — the two must stay separate questions'
    )
    assert.match(demo, /announce\(\)/, 'a change of unit tells nobody')

    /* The screens ask the store, not a plain function: `demoUnit()` in a
       render is a read that can never be told it is stale. */
    for (const where of ['mobile/src/screens/Settings.js', 'mobile/src/components/DemoUnit.js']) {
      const src = read(where)
      assert.match(src, /useDemoUnit\(\)/, `${where} reads the unit without subscribing to it`)
      assert.ok(
        !/[^e]demoUnit\(\)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
        `${where} still reads demoUnit() directly, which cannot redraw when it changes`
      )
    }

    /* Two: the rig is read again when the unit changes. */
    const stage = read('mobile/src/screens/Stage.js')
    assert.match(stage, /import \{ useDemoUnit \} from '\.\.\/lib\/demo'/, 'the stage screen uses a hook it never imported')
    assert.match(stage, /const demoIs = useDemoUnit\(\)/, 'the stage screen does not watch which unit the demo is')
    assert.match(
      stage,
      /useEffect\(\(\) => \{\s*reload\(\)\s*\}, \[reload, demoIs\]\)/,
      'the stage screen reads once on mount again, so a new demo unit keeps the old one’s presets'
    )

    /* Three: the name in the corner goes to the units in the demo, and to the
       facts outside it. */
    const app = read('mobile/App.js')
    assert.match(
      app,
      /onOpenUnit=\{\(\) => \(demo \? setPickUnit\(true\) : setScreen\('settings'\)\)\}/,
      'the unit name opens Setup in the demo again, with the five units two doors further in'
    )
    assert.match(app, /<DemoUnit open=\{pickUnit\} onClose=\{\(\) => setPickUnit\(false\)\}/, 'the picker is never drawn')
    assert.match(app, /import DemoUnit from '\.\/src\/components\/DemoUnit'/, 'the picker is used and never imported')

    /* And the browser end still does the same thing, because this was asked
       for once about one app that exists twice. */
    const web = read('src/components/TopBar.jsx')
    assert.match(web, /aria-label=\{demo \? 'Demo Unit' : 'Phone & computer'\}/, 'the browser’s unit name stopped being two destinations')
    /* Each end's name says where it goes. "About this unit" opened Phone &
       computer in the browser and Setup on the phone. */
    assert.match(
      read('mobile/src/components/TopBar.js'),
      /accessibilityLabel=\{demo \? 'Demo Unit' : 'Settings'\}/,
      'the phone’s unit name is labelled for a page it does not open'
    )
    assert.ok(!/About this unit/.test(web + read('mobile/src/components/TopBar.js')), 'the unit name still promises a page that is not there')
  })


  /**
   * THE PAYWALL, AND THE ONE WAY IT COULD RUIN SOMEBODY'S NIGHT.
   *
   * "The app is gonna be a free download and then they can access the demo for
   * free and then we need to do an in app purchase to unlock it."
   *
   * The money is not the risky part. The risky part is the app deciding, on a
   * stage, in a room with bad wifi, that somebody who paid has not paid. The
   * rule is written to fail OPEN for exactly that reason, and a fail-open rule
   * is one careless edit from a fail-closed one — the edit would look like a
   * tidy-up and would be invisible until it happened to somebody.
   *
   * So the rule lives in a module with no imports at all, and this walks every
   * combination of it rather than trusting the source to read correctly.
   */
  test('nobody is locked out by a question the app could not answer', async () => {
    const { mayDrive, shouldAskToPay } = await import(
      new URL('../mobile/src/lib/unlock-rule.js', import.meta.url).href
    )

    /* Paid is paid, however the rest of the world is behaving. */
    for (const available of [true, false]) {
      assert.equal(mayDrive({ unlocked: true, available }), true, 'a paid person was refused')
    }

    /* Not paid, and the store IS reachable, is the only refusal there is. */
    assert.equal(mayDrive({ unlocked: false, available: true }), false, 'the paywall never closes')

    /*
     * And every shape of "don't know" lets them in. Each of these is a real
     * situation: a build made before purchasing existed, an app with no API key
     * yet, a phone that cannot reach RevenueCat.
     */
    assert.equal(mayDrive({ unlocked: false, available: false }), true, 'an unanswerable check locked the app')
    assert.equal(mayDrive({}), true, 'the empty case locks the app')
    assert.equal(mayDrive(), true, 'no answer at all locks the app')

    /*
     * The paywall itself asks only when all four are certain. Walked as a full
     * truth table: sixteen combinations, exactly one of which may charge.
     */
    const asked = []
    for (const demo of [true, false]) {
      for (const checking of [true, false]) {
        for (const available of [true, false]) {
          for (const unlocked of [true, false]) {
            if (shouldAskToPay({ inApp: true, demo, checking, available, unlocked })) {
              asked.push({ demo, checking, available, unlocked })
            }
          }
        }
      }
    }
    assert.deepEqual(
      asked,
      [{ demo: false, checking: false, available: true, unlocked: false }],
      'the paywall appears in a case where the app is not certain the person should pay'
    )

    /* And never before somebody is through the door. */
    assert.equal(
      shouldAskToPay({ inApp: false, demo: false, checking: false, available: true, unlocked: false }),
      false,
      'the paywall meets people before the sign-in screen does'
    )
  })

  /**
   * The demo is never behind the paywall, and Apple's reviewer needs it not to be.
   *
   * A reviewer has no Fractal unit. docs/app-store.md tells them to open the
   * demo, and if the demo were gated the app would be rejected as broken — which
   * has a way of costing a week rather than an evening.
   */
  /**
   * THE DEMO ANSWERS EVERY PATH THE PHONE ASKS FOR — and it did not, twice.
   *
   * "My Demo version is saying it failed to read blocks."
   *
   * mobile/src/lib/demoWire.js is a SECOND COPY of the ForgeFX API, written
   * to answer the phone from a simulated unit. A second copy of an API can be
   * wrong in a way that is invisible from the other end, and both faults were
   * exactly that:
   *
   *   - it answered `/blocks/catalog`, a path nothing requests. The real one
   *     is `/blocks` — BUILD-PROMPT says so and the browser asks there. In
   *     the demo the request fell through and the Edit screen said it could
   *     not read the list of blocks.
   *   - the mock reported `slotModel: 'chain'`, a word nothing reads. Four
   *     places ask for 'linear', so a VP4 drew as a 4x12 grid.
   *
   * The browser's demo showed neither, because it holds the mock in-process
   * and calls its methods directly. Only the phone comes through this wire.
   *
   * So this walks the paths out of device.js and holds the wire to them.
   */
  test('the demo answers every path the phone asks for', () => {
    const dev = read('mobile/src/lib/device.js')
    const wire = read('mobile/src/lib/demoWire.js')

    const asked = new Set()
    for (const m of dev.matchAll(/(?:remoteRequest|request|get|post|put|del)\(\s*[`'"]([^`'"$]+)[`'"]/g)) {
      asked.add(m[1])
    }
    assert.ok(asked.size > 10, `only found ${asked.size} paths — the extractor stopped working`)

    /*
     * ONE EXEMPTION, and it is a decision rather than an oversight.
     *
     * `/device` is the whole device record, and the only thing the phone
     * wants from it that /device/detect lacks is the FIRMWARE VERSION. A
     * simulated unit has no firmware, and inventing one would be the same sin
     * as the two faults above: a mock asserting a fact about hardware that is
     * not true. device.js already wraps that call in a try and falls back, so
     * the demo simply reports no firmware, which is the honest answer.
     */
    const exempt = new Set(['/device'])

    const missing = [...asked].filter((p) => !exempt.has(p) && !wire.includes(`'${p}'`))
    assert.deepEqual(
      missing,
      [],
      `the demo does not answer ${missing.join(', ')} — the phone asks for it and would get nothing`
    )
  })

  /**
   * EVERY RELATIVE IMPORT ON THE PHONE POINTS AT A FILE THAT IS THERE.
   *
   * purchases.js was pushed with `import { isOwner } from './owner-unlock'`
   * and no such file beside it — the source lives in shared/, and Metro
   * resolves a relative import inside mobile/src/lib and cannot reach up out
   * of it. The result is not a missing owner check. It is:
   *
   *   Unable to resolve module ./owner-unlock
   *
   * which fails the whole bundle, so the app does not start. On a phone that
   * is the worst failure this project can ship, and the entire suite was
   * silent about it: the test for that file imports shared/owner-unlock.mjs
   * directly, and nothing in `npm test` bundles the phone.
   *
   * CI caught it, in the `check` job, by running `npx expo export` — which is
   * why CLAUDE.md calls that the real check that the app still bundles. This
   * test is the cheap half of it: it cannot prove the app runs, but a missing
   * file is most of what goes wrong here and it takes a few milliseconds
   * rather than eight seconds of Metro.
   *
   * The fix for that one was a sync entry, not a hand-written copy. Anything
   * shared with the browser is generated into mobile/src/lib by
   * `npm run sync:rules`; see scripts/sync-relay-rules.mjs.
   */
  test('every file the phone imports is a file that exists', () => {
    const dir = new URL('../mobile/src/', import.meta.url)
    const walk = (at) => {
      const out = []
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), at)
        if (entry.isDirectory()) out.push(...walk(next))
        else if (/\.jsx?$/.test(entry.name)) out.push(next)
      }
      return out
    }

    const files = [...walk(dir), new URL('../mobile/App.js', import.meta.url)]
    assert.ok(files.length > 30, `only ${files.length} phone files were found; this check read nothing`)

    /*
     * The extensions Metro will try, taken from the resolver's own error
     * message rather than guessed:
     *
     *   None of these files exist:
     *     * src/lib/owner-unlock(.ios.ts|.native.ts|.ts|…|.mjs|…|.js|…)
     *
     * Guessing cost a false alarm already: a first draft listed only .js,
     * .jsx and .json and accused relay.js of importing a missing './decode',
     * which is decode.mjs and resolves perfectly. A guard that cries wolf
     * about a working import is worse than no guard, because the next real
     * one gets waved through with it.
     */
    const EXT = ['', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json', '.cjs']
    const tries = (base) => [
      ...EXT.map((e) => base + e),
      ...EXT.filter(Boolean).map((e) => base + '/index' + e)
    ]

    const broken = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      /* Relative imports only. A bare specifier is a package and npm's
         problem, not this file's. */
      for (const m of text.matchAll(/(?:^|\n)\s*(?:import[^'"\n]*from|export[^'"\n]*from)\s*['"](\.[^'"]*)['"]/g)) {
        const target = new URL(m[1], file)
        if (!tries(fileURLToPath(target)).some((p) => existsSync(p))) {
          broken.push(`${fileURLToPath(file).split('/mobile/')[1]} imports ${m[1]}`)
        }
      }
    }

    assert.deepEqual(
      broken,
      [],
      `the phone bundle cannot resolve:\n  ${broken.join('\n  ')}\n` +
        'a shared file needs an entry in scripts/sync-relay-rules.mjs'
    )
  })

  /**
   * AND THE WORD FOR A UNIT WITH NO GRID IS 'linear'.
   *
   * Four places ask `slotModel === 'linear'`: gridShape, isLinearChain at
   * both ends, and the play screen's meter. All were written against what
   * ForgeFX reports. The mock said 'chain', which matches none of them, so
   * every check answered "no, it is a grid" and a VP4 — four blocks in a line
   * — drew as a 4x12 grid captioned ROW 2, COLUMN 1.
   */
  test('a unit with no grid says the word the app reads', async () => {
    const { createMockDevice } = await import(
      new URL('../src/lib/mockDevice.js', import.meta.url).href
    )
    const { gridShape } = await import(new URL('../shared/grid-plan.mjs', import.meta.url).href)

    for (const key of ['vp4', 'am4']) {
      const caps = createMockDevice(key).detect().capabilities
      assert.equal(caps.slotModel, 'linear', `${key} reports a slotModel nothing in the app reads`)
      const shape = gridShape(caps)
      assert.equal(shape.linear, true, `${key} is drawn as a grid`)
      assert.equal(shape.rows, 1, `${key} is drawn with ${shape.rows} rows`)
    }

    /* And a unit that HAS a grid still has one. */
    for (const key of ['fm3', 'fm9', 'axefx3']) {
      const caps = createMockDevice(key).detect().capabilities
      assert.equal(caps.slotModel, 'grid', `${key} lost its grid`)
      assert.equal(gridShape(caps).linear, false, `${key} is drawn as a chain`)
    }
  })


  /**
   * SWIPE IN FROM THE LEFT TO GO BACK, AND DONE LEAVES FROM ANY DEPTH.
   *
   * "Under the settings menu they could swipe on the left side of the screen
   * to the right to go back to the play screen, or in one of the submenus on
   * the settings screen, it would swipe and go back to the previous page they
   * were on. Then add the done button to all submenus, and if they click
   * done, it takes them directly back to the play screen, no matter how deep
   * they are. Swiping back should always take them to the previous screen."
   *
   * Two gestures with two different jobs, and the test is mostly about them
   * not being confused for one another: back is ONE step, Done is the whole
   * way out.
   */
  test('a left-edge swipe goes back one step, and Done goes all the way out', () => {
    const edge = read('mobile/src/components/EdgeBack.js')

    /*
     * PanResponder, NOT react-native-gesture-handler — and this is the part
     * worth holding. The usual library is a native module, so adding it moves
     * mobile/fingerprint.json, which stops every installed handset receiving
     * updates until a new build is made. Spending an iOS build slot to add a
     * swipe is the wrong trade. PanResponder is inside React Native.
     */
    assert.match(edge, /from 'react-native'/, 'the swipe is not built on React Native itself')
    assert.match(edge, /PanResponder\.create/, 'the swipe no longer uses PanResponder')
    const pkg = JSON.parse(read('mobile/package.json'))
    assert.ok(
      !pkg.dependencies['react-native-gesture-handler'],
      'a native gesture library was added — that moves the fingerprint and costs a build'
    )

    /* It must not eat taps, and must not eat a knob. */
    assert.match(edge, /onStartShouldSetPanResponder: \(\) => false/, 'the swipe claims plain taps')
    assert.ok(
      !/onMoveShouldSetPanResponderCapture/.test(edge.replace(/\/\*[\s\S]*?\*\//g, ' ')),
      'the swipe captures gestures from its children — a slider at the left edge would lose its drag'
    )
    /* Started at the edge, going sideways, by a margin over vertical. */
    assert.match(edge, /g\.x0 <= EDGE/, 'a drag from anywhere on screen counts as going back')
    assert.match(edge, /Math\.abs\(g\.dx\) > Math\.abs\(g\.dy\) \* 2/, 'a vertical scroll can trigger the back swipe')

    /*
     * WHERE BACK GOES IS THE SAME PLACE DONE ALREADY WENT.
     *
     * App.js hands every screen an onBack; the swipe reads a map beside it.
     * Two lists of the same facts drift, so this holds them to each other:
     * every screen the map names must hand its own Done the same target.
     */
    const app = read('mobile/App.js')
    const map = app.slice(app.indexOf('const BACK_TO = {'), app.indexOf('const backFrom ='))
    assert.ok(map.length > 40, 'the back-target map moved; this check reads it')
    for (const [screen, target] of [
      ['presets', 'stage'],
      ['setlists', 'stage'],
      ['edit', 'stage'],
      ['connect', 'settings'],
      ['gear', 'settings'],
      ['log', 'settings']
    ]) {
      assert.match(map, new RegExp(`${screen}: '${target}'`), `a swipe on ${screen} does not go to ${target}`)
    }
    /* The two that are not constants, because they are reached from two
       places and going "back" to the wrong one is the wrong room. */
    assert.match(map, /report: reportFrom/, 'the feedback form sends a swipe to a fixed screen')
    assert.match(map, /fixes: fixFrom/, 'the guide sends a swipe to a fixed screen')

    /* The stage is the bottom of the stack: no handler, rather than a
       gesture that does nothing. */
    assert.ok(!/\bstage: /.test(map), 'the stage screen has somewhere to swipe back to')
    assert.match(
      app,
      /const backFrom = BACK_TO\[screen\] \? \(\) => setScreen\(BACK_TO\[screen\]\) : null/,
      'the swipe is wired to something other than the map'
    )

    /*
     * SETTINGS CARRIES ITS OWN, because it is the only screen with pages
     * inside it. One step from a submenu is the page it hangs off; one step
     * from the list is the way out. The same function answers the Back button
     * and the swipe, so they cannot disagree.
     *
     * IT USED TO BE `setPage(null)` FLAT, and that was right while every page
     * came off the front list. Troubleshooting lives inside About now — "Move
     * walkthrough, updates and troubleshooting INSIDE of the 'About' menu" —
     * so a flat back walks past the page you came from.
     */
    const set = read('mobile/src/screens/Settings.js')
    assert.match(
      set,
      /const goBack = \(\) => \(page === null \? onBack\?\.\(\) : setPage\(upFrom\(page\)\)\)/,
      'a swipe in Settings does not go back one step'
    )
    /* And the Back button asks the same thing, rather than its own copy. */
    assert.match(
      set,
      /onPress=\{\(\) => setPage\(upFrom\(page\)\)\}/,
      'the Back button and the swipe can disagree about where one step up is'
    )
    assert.match(set, /const PARENT = \{ trouble: 'about' \}/, 'Troubleshooting is not inside About')
    /* And it says where it is going, because "Settings" would be a lie. */
    assert.match(set, /label=\{upLabel\(page\)\}/, 'the Back button names a screen it does not go to')
    assert.match(set, /<EdgeBack onBack=\{goBack\}>/, 'Settings cannot be swiped out of')

    /*
     * AND EVERY SUBMENU HAS BOTH. It had Back and no Done, so leaving from
     * three levels in was three taps; the list had Done and no Back.
     */
    const head = set.slice(set.indexOf('const head = (title, onDone) =>'), set.indexOf('const goBack ='))
    assert.ok(head.length > 100, 'the page header moved; this check reads it')
    const back = head.slice(head.indexOf("onDone === 'back' ?"), head.indexOf(') : ('))
    /* The label is computed now rather than fixed: a page inside About says
       "‹ About", because "‹ Settings" would name a screen it does not go to. */
    assert.match(back, /label=\{upLabel\(page\)\}/, 'a submenu has no way back to the list')
    assert.match(back, /label="Done" height=\{40\} onPress=\{onBack\}/, 'a submenu has no Done, so leaving takes a tap per level')
  })

  /**
   * FIT ON SCREEN, AND IT IS WHAT A NEW PHONE GETS.
   *
   * "Make one that says fit on screen, and if they click that, it'll just make
   * sure whatever size device they're on, all of those will fit onto the
   * screen so they don't have to manually push up and down for sizes and then
   * go back to the play screen to see what it did and then go back, so that
   * way it's just always set up, good to go. Also make this the default
   * setting from the beginning."
   *
   * The round trip is the complaint, and no fixed step can end it: a step is a
   * number of pixels, and whether a rig fits at that number depends on the
   * preset and the handset. Fit measures instead.
   */
  test('Play fits itself to the screen, and that is the setting out of the box', async () => {
    const { loadFit, saveFit, fitTiles } = await import('../mobile/src/lib/gigSize.js')

    /*
     * THREE STATES, WHICH IS THE WHOLE TRICK.
     *
     * This stored '1' or nothing, so "off" and "never chosen" were the same
     * value. That is fine while the default is off and impossible once it is
     * on: turning fit off would be indistinguishable from never having
     * touched it, and it would come back on at the next launch. So off is
     * written down.
     */
    const store = () => {
      const held = new Map()
      return {
        getItem: (k) => (held.has(k) ? held.get(k) : null),
        setItem: (k, v) => held.set(k, String(v)),
        removeItem: (k) => held.delete(k),
        held
      }
    }

    const fresh = store()
    assert.equal(loadFit(fresh, true), true, 'a phone that has never chosen does not get fit')
    assert.equal(loadFit(fresh), false, 'the browser default moved — it was not asked to')

    const off = store()
    saveFit(false, off)
    assert.equal(loadFit(off, true), false, 'turning fit off does not stick, so it returns at the next launch')
    const on = store()
    saveFit(true, on)
    assert.equal(loadFit(on, true), true, 'turning fit on does not stick')
    assert.equal(loadFit(on), true, 'an explicit yes is ignored in the browser')

    /* And it is never REMOVED, which would read as "never chosen" and hand
       the answer back to the default — the bug this shape exists to avoid. */
    assert.equal(off.held.get('fractal.gigFit'), '0', 'off is stored as absence, which means default')

    /*
     * THE ARITHMETIC ITSELF: more rig, smaller tiles, and never under a thumb.
     */
    const roomy = fitTiles({ available: 600, scenes: 4, blocks: 8 })
    const packed = fitTiles({ available: 600, scenes: 8, blocks: 24 })
    assert.ok(packed.tile <= roomy.tile, 'a bigger rig does not get smaller tiles')
    assert.ok(packed.tile >= 44, `a tile came out at ${packed.tile}px, which is under a thumb`)
    assert.ok(fitTiles({ available: 50, scenes: 8, blocks: 24 }).tile >= 44, 'a cramped screen draws tiles nobody can hit')

    /*
     * THE SCREEN ASKS FOR IT, and asks with the phone's default rather than
     * the browser's.
     */
    const stage = read('mobile/src/screens/Stage.js')
    assert.match(stage, /const fitOn = loadFit\(sync, true\)/, 'the stage screen does not default to fitting')
    assert.match(stage, /const chrome = Math\.max\(0, content - sceneGrid - blockGrid\)/, 'nothing works out how much screen the tiles may have')
    assert.match(stage, /available: viewport - chrome - trim/, 'fit is measured against something other than what is left')

    /*
     * AND IT CORRECTS ITSELF AGAINST WHAT ACTUALLY HAPPENED.
     *
     * "This is set to the fit to screen setting but the tempo numbers are
     * cutting off."
     *
     * fitTiles works out how tall a tile may be and assumes every row comes
     * out that tall. Tiles take it as a MINIMUM — a scene tile carrying a
     * number over a name grows past it — so the grids landed taller than
     * their budget and the footer went off the bottom. And it was stable
     * there: chrome and the budget both stay put, so it settled overflowing.
     *
     * Rather than teach the prediction about every way a tile can grow, the
     * overflow is measured and taken off the budget. Monotone within a
     * layout so it converges rather than oscillating, and thrown away when
     * the thing being fitted changes.
     */
    assert.match(stage, /const over = content - viewport/, 'nothing notices when the fitted screen overflows anyway')
    assert.match(stage, /setTrim\(\(was\) => was \+ over\)/, 'the overflow is measured and then not used')
    assert.match(stage, /if \(over > 2\)/, 'a rounding pixel starts another fitting pass')
    /* Reset when what is being fitted changes, or a preset with fewer blocks
       inherits the trim from a bigger one and draws tiny tiles. */
    assert.match(
      stage,
      /const fitKey = `\$\{viewport\}:\$\{scenes\.hasScenes \? scenes\.count : 0\}:\$\{blocks\.length\}:\$\{fitOn\}`/,
      'the trim is not thrown away when the rig or the screen changes'
    )
    assert.match(stage, /if \(trim !== 0\) setTrim\(0\)/, 'the trim survives a change of preset, so a smaller rig gets a smaller tile')
    /* Not until everything has been measured: fitting against a chrome of
       zero hands the grids the whole screen for a frame, which is the flash
       of wrong sizes this screen already learned to avoid. */
    assert.match(stage, /viewport > 0 && content > 0/, 'fit runs before the screen has been measured')

    /*
     * AND THE CONTROL IS THE BROWSER'S: a stepper, with fit as a tick box
     * under it rather than a sixth step on the ladder.
     *
     * "Update the mobile app's tile size screen to look like this with the
     * +/- buttons instead of the tab buttons."
     */
    const set = read('mobile/src/screens/Settings.js')
    const tile = set.slice(set.indexOf('function TileSize()'), set.indexOf('function Choice('))
    assert.ok(tile.length > 400, 'the tile size control moved; this check reads it')

    assert.match(tile, /label="−"/, 'there is no way to step the tiles down')
    assert.match(tile, /label="\+"/, 'there is no way to step the tiles up')
    assert.ok(!/SIZES\.map\(/.test(tile), 'the five tab buttons are back')
    /* The stepper says what it is set to, and says fit when fit is deciding. */
    assert.match(tile, /fit \? 'Fit to screen' : SIZES\[now\]\?\.name/, 'the stepper does not say what it is set to')

    /*
     * GREYED WHILE FIT IS ON, not hidden. The value is being overridden, and
     * "not now" is a different thing to say than "never" — hiding them would
     * say the second.
     */
    assert.match(tile, /disabled=\{fit \|\| now <= 0\}/, 'the smaller button works while fit is deciding the size')
    assert.match(tile, /disabled=\{fit \|\| now >= SIZES\.length - 1\}/, 'the bigger button works while fit is deciding the size')

    /* Fit is the tick box, and it is a real checkbox to a screen reader. */
    assert.match(tile, /label="Fit everything on one screen"/, 'there is no way to ask for a screen that fits')
    assert.match(tile, /on=\{fit\}/, 'the tick box never shows that it is on')
    assert.match(tile, /onPress=\{\(\) => saveFit\(!fit, sync\)\}/, 'the tick box does not toggle')
    assert.match(set, /accessibilityRole="checkbox"/, 'the tick box announces itself as a button rather than a checkbox')

    /* And the stepper's own buttons say something other than their shapes. */
    assert.match(tile, /accessibilityLabel="Smaller tiles"/, 'the minus button reads out as a shape')
    assert.match(tile, /accessibilityLabel="Bigger tiles"/, 'the plus button reads out as a shape')
    const press = read('mobile/src/components/Press.js')
    assert.match(
      press,
      /accessibilityLabel=\{accessibilityLabel \|\|/,
      'Press ignores an explicit accessible name again, so the stepper is two shapes'
    )
  })

  /**
   * LEAVING THE DEMO LEAVES NOTHING OF IT BEHIND, and a read that works
   * clears the message from the read that did not.
   *
   * "Says I'm not connected but I'm clearly connected based on the green FM3
   * and connected button. It's also still showing demo presets when I'm no
   * longer in the demo. I logged out and back in and now it's showing up
   * correctly."
   *
   * Two faults, one screenshot, and signing out cured both — which is the
   * tell: `reset` is called from exactly one place, the disconnect path, so
   * anything this store gets wrong stays wrong until a sign-out.
   */
  test('the red note and the green bar cannot disagree about the link', async () => {
    /*
     * "Says I'm not connected to the computer, but it also says I'm
     * connected." Second time, and the first fix was real but aimed one
     * moment too early.
     *
     * That fix made a SUCCESSFUL detect clear the note. The note in this
     * screenshot was set by a read that failed just after one had worked —
     * at launch, while the relay was still joining — so there was no later
     * success to clear it, and it sat over a working rig with a green bar
     * above it and a "what to try" button below.
     *
     * The link arriving is the other half of that evidence, and nothing was
     * listening for it.
     */
    const { faultFrom, withdrawsFault } = await import('../mobile/src/lib/fault-rule.js')

    /* A fault the relay raised because the link had gone. */
    const gone = new Error('Not connected to your computer.')
    gone.aboutLink = true
    const linkFault = faultFrom(gone)
    assert.deepEqual(linkFault, { error: 'Not connected to your computer.', errorLink: true })
    assert.equal(withdrawsFault(linkFault, 'connected'), true, 'the link came back and the note about it having gone is still up')

    /* Not on the way there, only on arrival. */
    for (const half of ['joining', 'no-answer', 'off']) {
      assert.equal(withdrawsFault(linkFault, half), false, `a link that is only ${half} already took the note down`)
    }

    /*
     * AND ONLY THAT KIND. The unit refusing a write is still worth reading
     * after a reconnect — clearing every message on every reconnect would
     * lose exactly the ones somebody needs on a bad night.
     */
    const realFault = faultFrom(new Error('The unit refused that write.'))
    assert.deepEqual(realFault, { error: 'The unit refused that write.', errorLink: false })
    assert.equal(withdrawsFault(realFault, 'connected'), false, 'a reconnect swallows a fault that had nothing to do with the link')

    /* Nothing on screen, nothing to withdraw. */
    assert.equal(withdrawsFault({ error: null, errorLink: true }, 'connected'), false)
    assert.equal(withdrawsFault(undefined, 'connected'), false)

    /* And the store routes every fault through it, rather than some of them. */
    const rigSrc = read('mobile/src/lib/rig.js')
    assert.ok(!/error: err\.message/.test(rigSrc), 'a fault is still being set without recording what caused it')
    assert.match(rigSrc.replace(/\s+/g, ' '), /export function clearLinkFault\(link = 'connected'\) \{ if \(!withdrawsFault\(state, link\)\) return/, 'the store decides this for itself instead of using the rule')

    /* The flag comes off the error the relay threw, not off its wording. */
    const relay = read('mobile/src/lib/relay.js')
    assert.match(relay, /err\.linkDown = true/, 'a link failure is no longer marked for retry')
    assert.match(relay.replace(/\s+/g, ' '), /err\.aboutLink = true return err/, 'a link failure is not marked as being about the link')
    assert.match(relay.replace(/\s+/g, ' '), /quiet\.aboutLink = true reject\(quiet\)/, 'a computer that never answered is not counted as a link fault')
    /*
     * Two flags on purpose. `linkDown` decides whether `request` tries again,
     * and the tap tempo route is excluded from retries because a beat sent
     * twice is a beat that never happened. Marking the silent timeout as
     * linkDown to save a property would have put it back in.
     */
    const timeout = relay.slice(relay.indexOf('const reply = new Promise'), relay.indexOf('waiting.set(id,'))
    assert.ok(!/linkDown = true/.test(timeout), 'the silent timeout is retryable now, which resends beats')

    /* And App is what hears the link and says so. */
    const app = read('mobile/App.js').replace(/\s+/g, ' ')
    assert.match(app, /subscribeLink\(\(next\) => \{ setLink\(next\) clearLinkFault\(next\.link\) \}\)/, 'nothing withdraws the note when the link comes back')
  })

  test('a working read clears the old failure, and the demo takes its names with it', () => {
    const rig = read('mobile/src/lib/rig.js')

    /*
     * FAULT ONE: the note and the bar read different things, and only one of
     * them was kept up to date. The bar reads the live link. The red note
     * reads `state.error`, which nothing but a later failure ever cleared —
     * so a message from a minute ago sat over a working rig.
     */
    /* To the next export rather than a character count: the comment in here
       has grown twice, and a fixed window silently stopped covering the line
       this is about. */
    const allFrom = rig.indexOf('export async function refreshAll()')
    const all = rig.slice(allFrom, rig.indexOf('export function notePresetName'))
    assert.ok(all.length > 400 && allFrom > 0, 'refreshAll moved; this check reads it')
    assert.match(all, /error: null/, 'a successful re-read leaves the last failure on screen')

    /*
     * FAULT TWO: the demo's FM3 and a real FM3 both answer 'fm3', so the
     * check that forgets stale names saw no change and kept the
     * simulation's. They are filled in lazily and never re-read wholesale,
     * so nothing downstream corrected them.
     */
    assert.match(rig, /const simulated = isDemo\(\)/, 'the store cannot tell a simulated unit from a real one')
    assert.match(
      all,
      /if \(slug !== state\.deviceSlug \|\| simulated !== state\.simulated\) forgetNames\(\)/,
      'the demo keeps its preset names when a real unit of the same model arrives'
    )
    assert.match(rig, /simulated: false/, 'the simulated flag has no starting value')
    assert.match(all, /simulated,/, 'the simulated flag is worked out and then not stored')

    /* It is genuinely a different question from the slug, which is the whole
       reason this bug existed: same model, different source. */
    const slugs = read('mobile/src/lib/device-slug.js')
    assert.ok(!/isDemo|demo/i.test(slugs), 'the slug now knows about the demo — then the flag above is redundant and one of them is wrong')
  })

  /**
   * A SONG IS SWIPED AWAY, AND THE ✕ ONLY APPEARS IF YOU HESITATE.
   *
   * "Make the setlist songs swipe to delete instead of the x. Make a full
   * swipe delete it and a partial swipe show the x that can be tapped.
   * Otherwise hide the X."
   *
   * Two gestures out of one movement: a short pull parks the row open and
   * hands you a button to think about, a long pull means you were never in
   * any doubt.
   */
  test('a setlist song is swiped away, and the cross is only there once it is', () => {
    const swipe = read('mobile/src/components/SwipeAway.js')

    /* Built on React Native itself, for the same reason the back swipe is:
       a native gesture library moves the fingerprint and costs a build. */
    assert.match(swipe, /PanResponder\.create/, 'the swipe no longer uses PanResponder')
    const pkg = JSON.parse(read('mobile/package.json'))
    assert.ok(
      !pkg.dependencies['react-native-gesture-handler'],
      'a native gesture library was added — that moves the fingerprint and costs a build'
    )

    /* Two thresholds, and the long one is the one that acts without asking. */
    assert.match(swipe, /if \(total <= -FULL\)/, 'a full swipe does not remove the song')
    assert.match(swipe, /if \(total <= -OPEN \/ 2\)/, 'a part swipe does not park the row open')
    const full = Number(swipe.match(/const FULL = (\d+)/)?.[1])
    const open = Number(swipe.match(/export const OPEN = (\d+)/)?.[1])
    assert.ok(full > open * 1.5, `a full swipe is ${full}px and the open stop is ${open}px — too close to tell apart`)

    /* Leftward only, and only when it is clearly sideways. */
    assert.match(swipe, /Math\.abs\(g\.dx\) > Math\.abs\(g\.dy\) \* 2/, 'a vertical scroll can swipe a song away')
    assert.match(swipe, /Math\.min\(0, rest\.current \+ g\.dx\)/, 'the row can be dragged to the right, where there is nothing')
    assert.match(swipe, /onStartShouldSetPanResponder: \(\) => false/, 'the swipe claims plain taps')
    /* Not capture: the drag grip beside it must keep its own gesture, or a
       reorder turns into a row sliding open. */
    assert.ok(
      !/onMoveShouldSetPanResponderCapture/.test(swipe.replace(/\/\*[\s\S]*?\*\//g, ' ')),
      'the swipe captures from its children, so the reorder grip loses its drag'
    )

    /*
     * AND THE ROW NO LONGER CARRIES A STANDING OFFER TO DELETE IT.
     */
    const list = read('mobile/src/screens/Setlists.js')
    assert.match(list, /<SwipeAway onRemove=\{onRemove\} label=\{`Remove \$\{name\}`\}>/, 'a song cannot be swiped away')
    assert.ok(!/<Nudge/.test(list), 'the ✕ is back on every row')
    assert.ok(!/function Nudge/.test(list), 'the button the ✕ used to be is still here with nothing using it')

    /* The button behind stays in the tree rather than being drawn only once
       the row has moved: a screen reader cannot swipe, and this is the only
       other way to remove a song. */
    assert.match(swipe, /accessibilityLabel=\{label\}/, 'the remove button behind the row has no accessible name')
  })

  /**
   * VIBRANT, AND STILL THE SAME COLOURS.
   *
   * "I want this to look more like the liquid glass type stuff that Apple
   * does, and the color is a little bit more vibrant like it is in this
   * mock-up."
   *
   * The trap this guards is the obvious way to do it: open blockColors and
   * type sixty livelier hex values. Those are not a style choice — several are
   * marked VERIFIED against FM3-Edit, because the promise that palette makes
   * is that a drive is the red the unit itself shows. Sixty new values is
   * sixty chances to break that quietly, and nobody would notice until they
   * looked at the hardware.
   */
  test('the vibrancy is a lift, not a repaint — every hue stays put', async () => {
    const { vivid, at, readHex } = await import('../mobile/src/lib/vivid.js')

    /* Hue is identity and must not move. Saturation and lightness are what
       vibrancy IS, so those are the only two that do. */
    const hueOf = ({ r, g, b }) => {
      const R = r / 255, G = g / 255, B = b / 255
      const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min
      if (!d) return null
      if (max === R) return (((G - B) / d + (G < B ? 6 : 0)) / 6) * 360
      if (max === G) return (((B - R) / d + 2) / 6) * 360
      return (((R - G) / d + 4) / 6) * 360
    }
    for (const hex of ['#b5502f', '#2f5f9c', '#94357a', '#c0392b', '#2a7f9c', '#4a8f7a']) {
      const before = hueOf(readHex(hex))
      const after = hueOf(readHex(vivid(hex)))
      assert.ok(Math.abs(before - after) < 2, `${hex} moved hue from ${before} to ${after} — that is a different colour, not a brighter one`)
      assert.notEqual(vivid(hex), hex, `${hex} came back unchanged, so nothing got more vibrant`)
    }

    /* Grey stays grey, out of the maths rather than a list of exceptions: a
       slate scene and the utility blocks must not turn into pastels. */
    const grey = '#5d626b'
    const moved = Math.abs(readHex(vivid(grey)).r - readHex(grey).r)
    assert.ok(moved < 16, `a grey shifted by ${moved} — the neutrals are being tinted`)

    /* Anything it cannot read comes back untouched. The browser's palette
       carries var(--panel-hi) for an unknown block, and turning that into
       garbage would paint a tile black rather than leave it neutral. */
    assert.equal(vivid('var(--panel-hi)'), 'var(--panel-hi)')
    assert.equal(vivid(undefined), undefined)
    assert.match(at('#b5502f', 0.14), /^#[0-9a-f]{8}$/, 'the alpha helper does not produce a colour RN can read')

    /* The palettes themselves are untouched, which is the whole point — they
       are shared with the browser through sync:rules. */
    const scenes = read('mobile/src/lib/sceneColors.js')
    assert.match(scenes, /#b5502f/, 'the scene palette was repainted rather than lifted')
    const tile = read('mobile/src/components/Tile.js')
    assert.match(tile, /const hue = vivid\(fill\)/, 'the tiles are not lifted')

    /*
     * AND THE GLASS COST NOTHING. expo-blur is already a dependency, which is
     * the only reason this look was available without a build at all.
     */
    const pkg = JSON.parse(read('mobile/package.json'))
    assert.ok(pkg.dependencies['expo-blur'], 'the blur package is gone, so the glass is gone with it')
    assert.ok(
      !pkg.dependencies['expo-linear-gradient'] && !pkg.dependencies['react-native-svg'],
      'a native drawing package was added — that moves the fingerprint and costs a build'
    )
    const bar = read('mobile/src/components/TopBar.js')
    assert.match(bar, /<BlurView/, 'the top bar is a flat panel again')
    assert.match(bar, /experimentalBlurMethod="dimezisBlurView"/, 'the blur does nothing on Android without this')

    /* The sheen is a stand-in for a gradient and must not affect layout: the
       fit-to-screen arithmetic is budgeting this tile's height. */
    assert.match(tile, /pointerEvents="none"/, 'the sheen swallows presses')
    assert.match(tile, /position: 'absolute'/, 'the sheen is in the layout, so it changes the tile height')
  })

  /**
   * THE PHONE'S WALKTHROUGH IS THE WAY IN, AND IT USES THE REAL THING AT
   * EVERY STEP.
   *
   * Nine screens, and the order of them is a decision: this phone can never
   * reach a Fractal unit on its own. It talks to a computer, and the computer
   * holds the cable. So the demo comes first and costs nothing — somebody who
   * has just installed this may have no computer running, no code, and no
   * idea a computer was part of the arrangement — and the purchase comes last,
   * after the computer has been proved to work.
   */
  test('the start screen claims nothing the app does not do', () => {
    /*
     * "How do we verify their computer connects before purchasing? Didn't
     * know we built that. If we don't actually do that then remove it. Also
     * remove the text to the bottom that says free forever. And the text at
     * top that says free. And remove the text that says where do you want to
     * start."
     *
     * The first of those was a real promise the app used to keep, and the
     * reason it stopped is in this repository: the walkthrough paired with a
     * code, said "Connection verified", and offered the unlock on the
     * strength of it. When the codes went out, pairing left the walkthrough
     * and that step became unreachable, so it was removed — and the sentence
     * advertising it was left behind on the screen before.
     *
     * A claim outliving the thing it describes is the shape of fault worth a
     * test, so this holds the four lines out rather than trusting that
     * nobody puts them back.
     */
    const copy = read('mobile/src/lib/onboarding.js')
    const screen = read('mobile/src/screens/Onboarding.js')
    /* Comments stripped first. The note above the new heading QUOTES the one
       it replaced, so a raw search finds the explanation and fails on it —
       the seventh time this repository has tripped over its own reasons. */
    const p3 = copy
      .slice(copy.indexOf('export const P3'), copy.indexOf('export const P4'))
      .replace(/\/\*[\s\S]*?\*\//g, ' ')

    for (const [gone, why] of [
      ['verify the computer connection', 'the app promises to verify a connection before purchase, which it no longer does'],
      /*
       * THE OLD HEADING STAYS GONE, but a heading does not.
       *
       * "Remove the text that says where do you want to start" took out
       * "WHERE DO YOU WANT TO START?", which asked the question the screen
       * already was. The mockup he sent later puts one back doing a different
       * job: it names the DECISION, and the line under it says what the two
       * choices are before you read either card. His design, later, and it
       * wins — so what is held here is the old wording, not the idea.
       */
      ['WHERE DO YOU WANT TO START', 'the heading that asks the question the screen already is, is back'],
      ["tag: 'FREE'", 'the demo card carries a third label saying what its button already says'],
      ['stays free forever', 'the demo is told to be free a third time, at the bottom of the screen']
    ]) {
      assert.ok(!p3.includes(gone), why)
    }
    /* And nothing on the screen reaches for them. */
    assert.ok(!/P3\.foot|P3\.demo\.tag/.test(screen), 'the screen draws a P3 line that no longer exists')
    /* P3.head and P3.real.body came BACK with his mockup, and are drawn. */
    assert.match(screen, /<Head>\{P3\.head\}<\/Head>/, 'the screen lost the heading his mockup asks for')
    assert.match(screen, /body=\{P3\.real\.body\}/, 'the hardware card is a title and a button again')

    /* What is left is the two ways in, the way back for somebody who paid,
       and the way in for somebody with an account. */
    for (const [needed, why] of [
      ['P3.demo.go', 'the demo has no button'],
      ['P3.real.go', 'the real-rig card has no button'],
      ['P3.restore', 'there is no way to restore a purchase from the first screen'],
      ['P3.signIn', 'there is no way to sign in from the first screen']
    ]) {
      assert.ok(screen.includes(needed), why)
    }
  })

  test('every screen in the walkthrough is reachable, and none of them is a trap', () => {
    /*
     * "The whole onboarding process and tutorials have been an absolute
     * nightmare. Can we please go through everything again, double check it
     * all and make sure everything works."
     *
     * So this reads the screen as a GRAPH rather than checking one button at
     * a time, because every fault it found was a fault in the joins: a step
     * you could enter and not leave, a step nothing led to, a message from
     * the screen before following you onto the next one.
     *
     * It is deliberately derived from the source rather than listed by hand.
     * A list would have to be kept in step with the screen, and the whole
     * point is to notice a step somebody added and wired up halfway.
     */
    const src = read('mobile/src/screens/Onboarding.js')
    const steps = [...src.matchAll(/at === '(\w+)'/g)].map((m) => m[1])
    /*
     * Six, not eight. Two steps went with the pairing codes:
     *
     *   `scan`   — the camera, the QR code and the box for eight characters
     *   `unlock` — "Connection verified", which could only be said because
     *              the step before it had just paired something
     *
     * Nothing pairs inside the walkthrough now, so neither could be reached.
     * The Paywall asks about the purchase instead, which is where it was
     * always asked for everybody who did not arrive through here.
     */
    assert.ok(steps.length >= 6, `only ${steps.length} steps found; this check reads them out of the source`)

    /* Each step's own block, to the start of the next one. */
    const at = steps.map((name) => ({ name, from: src.indexOf(`at === '${name}'`) })).sort((a, b) => a.from - b.from)
    const block = {}
    at.forEach((s0, i) => {
      block[s0.name] = src.slice(s0.from, i + 1 < at.length ? at[i + 1].from : src.length)
    })

    /* Where each one can go: a move between steps, or a handler that lands on
       a named step, or a way out of the walkthrough altogether. */
    const edges = {}
    const leaves = {}
    for (const name of steps) {
      edges[name] = [...new Set([
        ...[...block[name].matchAll(/go\('(\w+)'\)/g)].map((m) => m[1]),
        ...[...block[name].matchAll(/restore\('(\w+)'\)/g)].map((m) => m[1])
      ])]
      leaves[name] = /onDone|onEnterDemo|intoDemo|onAccount|connect\b/.test(block[name])
    }
    /* The one handler whose destination is a condition rather than a literal. */
    /* The demo's last screen is reached from `intoDemo`, which is declared
       above the steps rather than inside one, so the edge is read from there
       — the same reason the conditional edge into the old unlock step had to
       be named by hand. */
    if (/const intoDemo = [\s\S]{0,200}?go\('connected'\)/.test(src)) {
      edges.pick = [...new Set([...edges.pick, 'connected'])]
    }
    if (/if \(out\.ok\) return go\('connected'\)/.test(src)) edges.unlock = [...new Set([...edges.unlock, 'connected'])]

    /* NOTHING IS A DEAD END. Every step either leads somewhere or finishes
       the walkthrough — the demo picker used to do neither, so choosing a
       unit and changing your mind meant going into the demo and back out
       through Setup to reach the screen two steps behind you. */
    for (const name of steps) {
      assert.ok(edges[name].length || leaves[name], `the "${name}" step is a trap: nothing leads out of it`)
    }

    /*
     * AND A STEP WHOSE ONLY EXIT COMMITS YOU STILL OFFERS A WAY BACK.
     *
     * The check above passes for the demo picker, because starting the demo
     * IS leaving the walkthrough — which is exactly what made it a trap
     * rather than a dead end. Every button on it picked a unit and the only
     * one that went anywhere started the demo, so somebody who got there and
     * then decided they would rather connect their real rig had to enter the
     * demo and come back out through Setup. Named here rather than inferred,
     * because "leaving" and "leaving on purpose" cannot be told apart from
     * the source.
     */
    assert.ok(edges.pick.includes('mode'), 'the demo picker commits you to the demo with no way back to the screen that offers both')

    /* AND NOTHING IS STRANDED. */
    const seen = new Set()
    const walk = (n) => {
      if (seen.has(n)) return
      seen.add(n)
      for (const next of edges[n] || []) walk(next)
    }
    walk('welcome')
    assert.deepEqual(
      steps.filter((n) => !seen.has(n)),
      [],
      'a step was added that nothing in the walkthrough leads to'
    )

    /*
     * A RESTORED PURCHASE IS NOT A CONNECTED RIG, which is what the old
     * destination claimed. Restore runs from two screens: from the unlock
     * step a pairing has already succeeded, so "You're connected" is true;
     * from "where do you want to start" nothing has been paired, and it
     * announced a unit online that nobody had plugged in.
     */
    assert.match(block.mode, /restore\('app'\)/, 'restoring from the first screen claims a connection that does not exist')
    /* The second caller was the unlock step, which is gone: restore runs from
       one screen now, and its one destination is the computer-app step. */
    assert.ok(!('unlock' in block), 'the unlock step is back inside the walkthrough')

    /*
     * MOVING CLEARS THE LAST SCREEN'S NOTES. `said` and `error` are one pair
     * for the whole walkthrough and most steps draw them, so a failed restore
     * followed you onto the next screen and sat under a heading it had
     * nothing to do with.
     */
    assert.match(
      src.replace(/\s+/g, ' '),
      /const go = \(next\) => \{ setSaid\(null\) setError\(null\) setAt\(next\) \}/,
      'there is no single way between steps, so the last screen’s notes follow you'
    )
    assert.ok(
      !/setAt\('/.test(src.replace(/const go = \(next\)[\s\S]*?\}/, '')),
      'a step change goes around `go`, so it carries the previous screen’s notes with it'
    )

    /*
     * THE TWO DOORS FOR SOMEBODY WHO ALREADY OWNS IT, on the screen that asks
     * where to start. "If they've already purchased it they can either
     * restore purchase from the App Store or they can login with their
     * username and password." They are different doors — restore asks the
     * App Store about this Apple ID; signing in reaches a computer set up
     * with an account rather than a pairing code — so both are here.
     */
    /*
     * BOTH, AS A FOOTNOTE RATHER THAN TWO FULL-WIDTH BUTTONS. They are the
     * smallest things on the screen and were shouting over the choice it
     * exists to ask — his mockup makes them one question and two short links.
     */
    assert.match(block.mode, /label: P3\.restore[^]{0,80}restore\('app'\)/, 'there is no way to restore a purchase from the first screen')
    assert.match(block.mode, /label: P3\.signIn[^]{0,80}onAccount\?\.\(\)/, 'there is no way to sign in from the first screen')

    /*
     * AND THE LAST TWO SCREENS NAME THE UNIT THAT ANSWERED. `unitName` is the
     * DEMO picker's choice and defaults to FM3, so somebody who had just
     * paired an FM9 was told "Connection verified · FM3".
     */
    assert.match(src, /const detected = useRig\(\(st\) => st\.deviceName\)/, 'the walkthrough cannot see which unit actually answered')
    assert.match(src, /const provenUnit = detected \|\| unitName/, 'a real pairing has no name to fall back from')
    assert.match(block.connected, /P9\.tag\(provenUnit\)/, 'the connected line names the demo picker’s unit')
    assert.match(block.connected, /P9\.demo\.status\(provenUnit\)/, 'the status line names the demo picker’s unit')
    /* The picker itself still names what is lit, which is the one place the
       demo choice IS the answer. */
    assert.match(block.pick, /P4\.go\(unitName\)/, 'the demo picker stopped naming the unit you picked')

    /*
     * AND THE DEMO GETS THE LAST SCREEN TOO.
     *
     * "When I did a fresh app install, not logged in, there's no tutorial,
     * nothing. So it just brings up the screen. This is a new user trying it
     * out. Not a very good experience."
     *
     * Picking a unit was the end of it: the mock was built and the app opened
     * on the Play screen mid-stride, with nothing having said what any of it
     * is. The screen that says so was already written — PLAY, EDIT and SAVE
     * in three lines — and was reached only after a real pairing, so the one
     * person who has never seen this app was the one person who never got it.
     */
    const flat = src.replace(/\s+/g, ' ')
    assert.match(flat, /const intoDemo = \(\) => \{ setDemoUnit\(unit\) setDemo\(true\) go\('connected'\) \}/, 'choosing the demo still drops somebody straight onto the Play screen')

    /* The three tips are the same either way; only the two lines that name a
       computer change, because there is no computer in the demo. */
    /* The demo's words unconditionally: it is the only way to this screen
       now, and "You're connected" named a computer that is not there. */
    assert.match(block.connected, /<Head>\{P9\.demo\.head\}<\/Head>/, 'the demo is told it is connected to a computer')
    assert.match(block.connected, /P9\.tips\.map/, 'the three tips are no longer on the last screen')

    /* And the right handler finishes it. onDone marks an owner unlocked,
       which is wrong for somebody who has just chosen a simulation. */
    assert.match(block.connected, /onPress=\{onEnterDemo\}/, 'a demo run finishes as though a rig had been paired')

    /*
     * THE DOWNLOAD ADDRESS IS PRINTED, NOT PRESSED.
     *
     * "It just says download when you click on it. And it tries downloading
     * it on the phone."
     *
     * It did. The address was a button, and a button on a phone opens the
     * thing on the phone — so it went to the downloads page on the handset
     * and started fetching a Mac installer onto a device that can do nothing
     * with it. This phone is never the computer that needs this download,
     * which is the whole difficulty of the step.
     */
    assert.ok(!/Linking\.openURL/.test(src), 'the phone can still be sent to the desktop downloads page')
    assert.ok(!/import \{ Linking,/.test(src), 'Linking is imported but no longer used')
    assert.match(block.app, /<Eyebrow>\{P6\.address\}<\/Eyebrow>/, 'nothing says the address is for the computer')
    assert.match(block.app, /<Text selectable style=\{\{ color: color\.silk, fontSize: font\.lead, fontFamily: face \}\}>\s*\n?\s*\{DOWNLOADS_URL\}/, 'the address is not printed as text to read and type')
    assert.match(block.app, /<Eyebrow>\{P6\.emailLabel\}<\/Eyebrow>/, 'the email route is unlabelled')
    /* Said where he said to say it: above the address, not under it. */
    assert.ok(
      block.app.indexOf('{P6.address}') < block.app.indexOf('{DOWNLOADS_URL}'),
      'the line about which machine this is for comes after the address'
    )
    assert.match(read('mobile/src/lib/onboarding.js'), /address: '[^']*NOT ON THIS PHONE'/, 'the address line no longer rules out this phone')

    /*
     * AND IT IS CALLED A QR CODE. "Call it a QR code not a square."
     */
    for (const [file, what] of [
      ['mobile/src/lib/onboarding.js', 'the walkthrough'],
      ['mobile/src/screens/SignIn.js', 'the sign-in screen']
    ]) {
      const text = read(file)
      /* Comments quote the sentences they replaced, so only the strings are
         read — the same trap as the save warning, four times over now. */
      const strings = (text.match(/'[^'\n]{12,}'/g) || []).join(' ')
      assert.ok(!/\bsquare\b/i.test(strings), `${what} still calls the QR code a square`)
    }

    /* Both lines of the demo wording exist rather than being typed here. */
    const copy = read('mobile/src/lib/onboarding.js')
    assert.match(copy, /demo: \{\s*\n?\s*head: 'Here’s the app\.'/, 'the demo has no heading of its own')
    assert.match(copy, /status: \(unit\) => `\$\{unit\}  ·  simulated`/, 'the demo has no status line of its own')
  })

  test('the phone walkthrough pairs, buys and starts the demo for real', async () => {
    const onb = read('mobile/src/screens/Onboarding.js')

    /* Not one word typed in: it all comes from the generated copy. */
    assert.match(onb, /from '\.\.\/lib\/onboarding'/, 'the copy is not coming from the one file that holds it')
    const bare = onb.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    for (const typed of ['Try the demo', 'Start free demo', 'Connection verified', '$9.99']) {
      assert.ok(!bare.includes(typed), `"${typed}" is typed into the screen rather than read from the copy`)
    }

    /* The demo is really started — the mock is built and the unit is the one
       they picked, not whatever the default was. */
    assert.match(onb, /setDemoUnit\(unit\)\s*\n\s*setDemo\(true\)/, 'the demo is not actually started')
    assert.match(onb, /P4\.go\(unitName\)/, 'the button does not say which unit it starts')

    /*
     * NEITHER PAIRING NOR BUYING HAPPENS HERE ANY MORE.
     *
     * The walkthrough used to turn a pairing code into a session and then
     * offer the unlock on the strength of it. Codes are gone, so signing in
     * is a screen of its own, and the Paywall asks about the purchase.
     */
    assert.ok(!/pairCredentials|<ScanCode|await buyUnlock/.test(onb), 'the walkthrough pairs or sells again')
    /* Restore stays: somebody who already paid needs it before anything. */
    assert.match(onb, /await restorePurchase\(\)/, 'there is no way to restore a purchase already made')
    /*
     * AND NO PRICE ON THE BUTTON THAT TAKES NO MONEY.
     *
     * "Have the button just say 'Unlock'." It read "Set up  ·  $9.99 once",
     * which puts a till on a button that opens the computer-app step. The
     * price belongs on the paywall, where the store quotes it itself.
     */
    assert.match(onb, /label=\{P3\.real\.go\}/, 'the real-rig button is not the plain Unlock label')
    assert.ok(!/P3\.real\.go\(/.test(onb), 'the real-rig button is quoting a price again')

    /*
     * THE UNLOCK IS NOT ASKED ABOUT HERE ANY MORE.
     *
     * This used to hold the walkthrough's own copy of the paywall's rule: a
     * pairing that succeeded went to the unlock step unless the store said
     * this person had already paid. Both halves have gone — the pairing,
     * because there are no codes, and the step, because it could only say
     * "Connection verified" off the back of one.
     *
     * The rule itself is unchanged and still tested where it lives; the only
     * thing that reads it now is App.js, which raises the Paywall. That is
     * where the question was always asked for everybody who did not come
     * through this screen.
     */
    assert.ok(!/shouldAskToPay/.test(onb), 'the walkthrough keeps its own copy of the paywall rule again')
    assert.ok(!/'unlock'/.test(onb), 'the unlock step is back in the walkthrough')

    /* Seen once, and reachable again from Settings under the name its own
       last screen promises. */
    const app = read('mobile/App.js')
    assert.match(app, /walkthroughSeen\(\)\.then\(setSeenWalk\)/, 'nothing decides whether the walkthrough has been through')
    assert.match(app, /auth === 'out' && !seenWalk/, 'the walkthrough is not the way in')
    assert.match(app, /onReplay=\{/, 'there is no way back into the walkthrough')
    const set = read('mobile/src/screens/Settings.js')
    assert.match(set, /title=\{REPLAY\}/, 'Settings does not offer the walkthrough again')

    /*
     * AND THE EMAIL NEVER THROWS. It is one optional convenience inside a
     * first-run flow; a rejected promise halfway through somebody's first
     * minute is a worse outcome than the mail not arriving.
     */
    const mail = read('mobile/src/lib/downloadLink.js')
    assert.ok(!/throw /.test(mail.replace(/\/\*[\s\S]*?\*\//g, ' ')), 'the download-link helper throws')
    assert.match(mail, /ok: false/, 'failures are not reported as an answer')
    /* The address is on screen either way, so the button failing is never a
       dead end. */
    assert.match(onb, /DOWNLOADS_URL/, 'the download address is not shown, so a failed email is a dead end')
    /* The controller is made before the timeout that aborts it — written the
       other way round once, which is a ReferenceError on every call. */
    assert.ok(
      mail.indexOf('const controller = new AbortController()') < mail.indexOf('setTimeout(() => controller.abort()'),
      'the abort timeout closes over a const that does not exist yet'
    )
  })

  test('the demo stays in front of the paywall', () => {
    const app = read('mobile/App.js')
    /* Not `[^>]*` — the arrow in `() =>` is a `>` and would end the class. */
    /* Not one line any more — signing in also re-checks whether the account
       carries an unlock. What matters is unchanged: onDemo goes straight in
       and asks nothing of anybody. */
    assert.match(
      app,
      /onDemo=\{\(\) => setAuth\('in'\)\}/,
      'the demo no longer goes straight in from the sign-in screen'
    )
    const paywall = read('mobile/src/screens/Paywall.js')
    assert.match(paywall, /Keep using the demo/, 'the paywall offers no way back to the demo')
    assert.match(paywall, /Restore a purchase/, 'there is no restore button, which Apple rejects apps for')
  })

  /**
   * And the door nobody thinks of: a phone that cannot pay in the first place.
   *
   * The APK on the Releases page is installed from a link, not from the Play
   * Store, and an app installed outside Play has no Play Billing. RevenueCat
   * answers perfectly — "no purchase" — and every sideloaded copy would sit
   * behind a button that cannot take money, the developer's own test handset
   * first among them. Parental controls and managed work phones land here too.
   *
   * So the store being REACHABLE is not enough to lock anybody; it also has to
   * be able to sell them something.
   */
  /**
   * THE KEYS ARE IN, AND THE ONE THAT MUST NEVER BE IS NOT.
   *
   * RevenueCat issues two kinds of key and they are easy to confuse because
   * they arrive on the same dashboard page. The PUBLIC ones belong in the app
   * — they are compiled into every copy of it and can be read out of any
   * handset, which is why RevenueCat says to embed them. The SECRET one, `sk_`,
   * can refund purchases and grant entitlements, and this repository is
   * public.
   *
   * So this holds both halves: the public keys are present and the right shape
   * for their platform, and no `sk_` key appears anywhere in the tree. The
   * second is the one that matters, and it is cheap enough to check for ever.
   */
  test('the purchase keys are the public ones, and no secret key is committed', () => {
    const app = JSON.parse(read('mobile/app.json'))
    const keys = app.expo?.extra?.revenuecat || {}

    assert.match(String(keys.ios), /^appl_[A-Za-z0-9]+$/, 'the Apple key is missing or not an Apple public key')
    assert.match(String(keys.android), /^goog_[A-Za-z0-9]+$/, 'the Google key is missing or not a Google public key')

    /* A secret key anywhere under version control, whatever it is called. */
    const hunted = [
      'mobile/app.json',
      'mobile/src/lib/purchases.js',
      'eas.json',
      'app.json',
      'package.json'
    ]
    for (const f of hunted) {
      let text
      try {
        text = read(f)
      } catch {
        continue
      }
      assert.ok(
        !/\bsk_[A-Za-z0-9]{8,}/.test(text),
        `${f} contains what looks like a RevenueCat SECRET key — it can refund and grant, and this repository is public`
      )
    }
  })

  /**
   * THERE IS A WAY TO BUY IT FROM INSIDE THE DEMO, which there was not.
   *
   * The paywall was raised at exactly one moment — somebody with a pairing
   * code who had not paid — so the demo, which is the entire shop window and
   * where a person spends an hour before deciding, had no way to buy anything
   * at all. "Where is the unlock button to unlock to the full version? I don't
   * see it anywhere in the app." It was not buried; it was not there.
   *
   * And the half of it that is not about money: RESTORE was on that same
   * unreachable paywall. Somebody who had paid, changed handset and opened
   * the demo had no way back to what they owned — which Apple rejects apps
   * for, and rightly.
   */
  test('the demo can reach the purchase, and a purchase already made', () => {
    const bar = read('mobile/src/components/TopBar.js')
    assert.match(bar, /usePurchase/, 'the bar cannot know whether there is anything to sell')
    assert.match(
      bar,
      /const canBuy = Boolean\(onUnlock\) && shouldOffer\(\{ demo \}\)/,
      'the Unlock button is gone from the bar, or decides for itself when to show'
    )
    assert.match(bar, /Unlock the full version/, 'the Unlock button has no accessible name')

    /* And the word DEMO itself, which is the thing an eye lands on. Both it
       and the pill are gated on ONE named condition, so they cannot drift
       into disagreeing about whether there is anything to sell. */
    assert.match(
      bar,
      /const canBuy = Boolean\(onUnlock\) && shouldOffer\(\{ demo \}\)/,
      'the word and the pill no longer share one condition'
    )
    assert.match(bar, /\{\.\.\.\(canBuy\s*\?\s*\{/, 'the word is not a way into the unlock page')
    /* Comments stripped: the block above `word` explains the rule by naming
       canBuy, and counting prose as a use is how this number goes wrong. */
    const code = bar.replace(/\/\*[\s\S]*?\*\//g, ' ')
    assert.equal(
      (code.match(/canBuy/g) || []).length,
      4,
      'the condition is declared and used three times — the word, its press, and the pill'
    )

    /*
     * AND IT IS DECLARED AFTER `demo`, WHICH IS NOT A STYLE POINT.
     *
     * canBuy sat ABOVE `const demo = useDemo()` and read `demo` off the line
     * below it. A const read before its declaration is in the temporal dead
     * zone, so depending on how the bundler lowers block scoping that is a
     * ReferenceError on every render of this bar, or a silent `undefined` —
     * and shouldOffer({ demo: undefined }) is false forever, so the unlock
     * never appears in the demo at all.
     *
     * That is the exact fault the offer was written to fix ("where is the
     * unlock button? I don't see it anywhere"), reintroduced one line above
     * the fix, and invisible to every check here because the source still
     * said all the right words in the right order.
     */
    assert.ok(
      bar.indexOf('const demo = useDemo()') < bar.indexOf('const canBuy ='),
      'canBuy reads `demo` before it is declared — the unlock never shows in the demo'
    )

    /*
     * THE WORD ITSELF SAYS UNLOCK, and only where there is one to sell.
     *
     * "Change this word demo to Unlock and bring up the unlock page when it's
     * tapped... Make sure it doesn't change how this button functions on
     * unlocked versions when connected to an actual unit."
     *
     * So the ladder is canBuy, then demo, then the link word — a real unit is
     * untouched, and somebody who already owns it still reads DEMO rather
     * than being sold a thing they have.
     */
    assert.match(
      bar,
      /const word = canBuy \? 'unlock' : demo \? 'demo' : linkWord\(tone, 'remote'\)/,
      'the word no longer says UNLOCK in the demo, or says it outside one'
    )

    /* Settings carries it too — for reading before tapping, and for restoring
       on a handset that has never paid but whose owner has. */
    const set = read('mobile/src/screens/Settings.js')
    assert.match(set, /onUnlock,/, 'Settings cannot open the paywall')
    assert.match(set, /Unlock the full version/, 'there is no purchase row in Settings')
    assert.match(set, /Restore a purchase/, 'Settings offers no way back to a purchase already made')

    /* And both are wired to a paywall that opens OVER the app rather than
       replacing it: nothing is being withheld, they came looking. */
    const app = read('mobile/App.js')
    /* The count itself is owned by the four-ways test below; this one only
       cares that the routes reach the SAME paywall rather than each growing
       its own. */
    assert.ok(
      (app.match(/onUnlock=\{\(\) => setBuying\(true\)\}/g) || []).length >= 2,
      'the routes no longer open one shared paywall'
    )
    assert.match(app, /\{buying \? \(\s*<Paywall\s+asked/, 'the asked-for paywall is not rendered')

    /* Asked for, it does not offer the demo they are already in, and it does
       not show a buy button that cannot take money. */
    const pay = read('mobile/src/screens/Paywall.js')
    assert.match(pay, /asked \? null : \(/, 'the asked-for paywall still offers the demo it was opened from')
    assert.match(pay, /disabled=\{busy \|\| !available\}/, 'the Unlock button works when purchasing does not')
    assert.match(pay, /asked \? \(\s*<Sheet/, 'the asked-for paywall replaces the screen instead of sitting over it')
  })

  /**
   * AN OWNER IS UNLOCKED WITHOUT BUYING, and the list that says who is public.
   *
   * "Is there any way we can set it up so that my email unlocks the app
   * automatically? I still wanna be able to test with live connections."
   *
   * Somebody has to drive a real rig before the thing is on sale. The list
   * grants nothing by being read — it names ACCOUNTS, and the app consults it
   * only for an account somebody is already signed in as, which means the
   * password is the gate exactly as it is everywhere else.
   */
  test('an owner account is unlocked, and no address is in the repository', async () => {
    const { isOwner, fold } = await import(
      new URL('../shared/owner-unlock.mjs', import.meta.url).href
    )

    assert.equal(isOwner('justinnewbold@gmail.com'), true, 'the author is not unlocked')
    assert.equal(isOwner('  JustinNewbold@GMAIL.com '), true, 'case and spacing break the match')
    assert.equal(isOwner('someone@else.com'), false, 'a stranger is unlocked')
    assert.equal(isOwner('pair-abcd@fractal.local'), false, 'a pairing-code account is unlocked')
    for (const nothing of ['', null, undefined, 'notanemail']) {
      assert.equal(isOwner(nothing), false, `"${nothing}" counted as an owner`)
    }

    /* The hashing buys no secrecy and is not meant to — it keeps an address
       out of a public file, where it would be scraped within a week. So the
       file must not contain one. */
    const src = readFileSync(new URL('../shared/owner-unlock.mjs', import.meta.url), 'utf8')
    const found = src.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []
    assert.deepEqual(
      found.filter((a) => a !== 'someone@example.com'),
      [],
      'an email address is written into shared/owner-unlock.mjs'
    )
    assert.equal(typeof fold, 'function', 'fold is gone, so owners cannot be added')

    /* And the app reads the account from the SESSION, never from a box. */
    const lib = read('mobile/src/lib/purchases.js')
    assert.match(lib, /await currentAccount\(\)/, 'the owner check trusts something other than the session')
    assert.match(lib, /await checkOwner\(\)/, 'the owner check never runs at startup')
    const app = read('mobile/App.js')
    assert.match(app, /checkOwner\(\)/, 'signing in does not re-check the account')
  })

  /**
   * THE OFFER MUST NEVER HIDE ITSELF, which is the bug that made the whole
   * purchase invisible on a real handset.
   *
   * Every route was gated on `purchase.available`, reasoning that a button
   * which cannot take money is worse than no button. The consequence is worse
   * than either: `available` is false whenever the store is not set up yet,
   * unreachable, or still propagating permissions, and in all of those the
   * offer VANISHED. An absent button is indistinguishable from a feature that
   * does not exist.
   *
   * "I'm building this app and I don't know where to unlock it."
   *
   * He wrote it, knew it was there, and could not find it. So `shouldOffer`
   * asks one thing — are they in the demo and have they not paid — and what
   * `available` decides is what the PAYWALL says when they arrive.
   */
  test('the way to buy it is never hidden by the store not being ready', async () => {
    const src = read('mobile/src/lib/purchases.js')
    assert.match(
      src,
      /export const shouldOffer = \(\{ demo \}\) => Boolean\(demo\) && !state\.unlocked/,
      'shouldOffer changed shape — it must not consult `available`'
    )
    const fn = src.slice(src.indexOf('export const shouldOffer'), src.indexOf('export const shouldOffer') + 200)
    assert.ok(!/available/.test(fn), 'the offer is gated on the store being ready again')

    /* And every route uses it rather than rolling its own condition. */
    /* Comments explaining the fix necessarily NAME the thing they warn about,
       so this reads the code with them stripped. A file-wide grep tripped on
       its own explanation. */
    const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    for (const f of ['mobile/src/components/TopBar.js', 'mobile/src/components/UnlockOffer.js']) {
      const text = code(read(f))
      assert.match(text, /shouldOffer\(\{ demo \}\)/, `${f} decides for itself whether to offer`)
      assert.ok(
        !/purchase\.available/.test(text),
        `${f} consults \`available\` again, which is what made the offer vanish`
      )
    }
  })

  /**
   * FOUR WAYS IN, ONE DESTINATION.
   *
   * "We need lots of ways to unlock the phone from different menus and
   * different screens, not to the point that it's annoying but to the point
   * where there is a clear path."
   */
  test('there are five ways to the purchase and they all go to one place', () => {
    const app = read('mobile/App.js')
    assert.equal(
      (app.match(/onUnlock=\{\(\) => setBuying\(true\)\}/g) || []).length,
      4,
      'the bar, Settings, the stage screen and the walkthrough do not all open the same paywall'
    )

    /*
     * AND THE WALKTHROUGH'S ONE HAS A PAYWALL TO OPEN.
     *
     * "The unlock button and the two buttons at the bottom where it says sign
     * in and the button where it says restore purchase, all take you to the
     * other screen." That button used to advance the walkthrough, whose next
     * step is the sign-in form — so three buttons saying three different
     * things did one thing.
     *
     * The paywall lives inside the signed-in branch, which the walkthrough is
     * not. Wiring the button without drawing a Paywall in that branch would
     * set `buying` true and change no pixels, which is worse than the wrong
     * screen: a haptic and nothing else reads as a broken app.
     */
    const walk = app.slice(app.indexOf('seenWalk === false ? ('), app.indexOf("auth === 'out' ? ("))
    assert.match(walk, /onUnlock=\{\(\) => setBuying\(true\)\}/, 'the walkthrough cannot open the paywall')
    assert.match(walk, /\{buying \? \(\s*<Paywall/, 'the walkthrough opens a paywall that is never drawn')
    /* And buying from there claims the purchase onto an account rather than
       leaving it on the handset — see linkAccount on SignIn's onSignedIn. */
    assert.match(walk, /onUnlocked=\{\(\) => \{[\s\S]{0,200}setAuth\('out'\)/, 'a purchase made in the walkthrough is left unattached to an account')
    assert.match(read('mobile/src/screens/Onboarding.js'), /onPress=\{\(\) => agreed && onUnlock\?\.\(\)\}/, 'the Unlock card still advances the walkthrough instead of selling')

    /* The fourth is the word DEMO itself, inside the bar. */
    const bar = read('mobile/src/components/TopBar.js')
    assert.match(bar, /\{\.\.\.\(canBuy\s*\?\s*\{/, 'the word DEMO is no longer a way in')

    /* The price goes ON the buttons. Asking somebody to tap to find out what
       it costs is asking for the tap most people will not make. */
    const offer = read('mobile/src/components/UnlockOffer.js')
    assert.match(
      offer,
      /purchase\.price \? `Unlock \$\{purchase\.price\}` : 'Unlock'/,
      'the stage offer does not show the price on the button'
    )
    /*
     * The bar is the exception, and only because the verb moved next to it.
     * The word itself now reads UNLOCK, so the pill beside it carries the
     * price alone — "Unlock" in both would be the same word twice in half an
     * inch. Which also means the pill must not draw at all before a price
     * arrives, or it is an empty amber blob.
     */
    assert.match(bar, /\{purchase\.price\}/, 'the bar does not show the price on the button')
    assert.match(
      bar,
      /\{canBuy && purchase\.price \? \(/,
      'the bar draws an empty pill while the store has no price yet'
    )

    /* And it can be put away, or it is an advertisement rather than an offer —
       on a screen that is open on a dark stage between songs. */
    assert.match(offer, /Put this away/, 'the stage offer cannot be dismissed')
    assert.match(offer, /fractal\.offerDismissed/, 'dismissing it is not remembered')
  })

  test('a phone that cannot buy anything is never locked out', () => {
    const src = read('mobile/src/lib/purchases.js')
    assert.match(src, /canMakePayments/, 'nothing asks whether this install can pay at all')

    /*
     * TWO facts now, not one, and the second is what was missing.
     *
     * `canMakePayments` answers "could this handset pay for something" and
     * says nothing about whether a product EXISTS. Before the item is created
     * in the stores there is no offering, so the gate closed over a paywall
     * with nothing to sell — "I'm blocked now by the gate for the unlock" —
     * and a failed offerings fetch would do the same to a real customer on a
     * bad hotel network.
     */
    assert.match(
      src,
      /const sellable = await loadPrice\(\)/,
      'nothing asks whether the store has anything to sell'
    )
    assert.match(
      src,
      /const available = canPay && sellable/,
      'the gate no longer needs BOTH a phone that can pay and something to sell'
    )
    /* And it must not be able to throw its way into locking the app. */
    const block = src.slice(src.indexOf('let canPay'), src.indexOf('set({\n      available'))
    assert.match(block, /catch/, 'a failed canMakePayments check is not caught')
    assert.match(block, /canPay = true/, 'the unknown case does not default to "can pay"')
  })

}
