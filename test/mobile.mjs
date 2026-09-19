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
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
    assert.match(stage, /height=\{size\.tile\}/, 'the scene tiles ignore the size setting')
    /* The tiles are measured rather than given a percentage now — a percentage
       cannot pay for the gaps, and the last tile of a short row stretched the
       width of the screen. The rule being checked is the same: how many go
       across comes from the setting. */
    assert.match(stage, /width: tileWidth\(row, size\.scenes\)/, 'the scenes are a fixed number across whatever the setting says')
    assert.match(stage, /width: tileWidth\(row, size\.fx\)/, 'the chain is a fixed number across whatever the setting says')
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
    assert.match(stage, /onLayout=\{\(e\) => setGrid\(e\.nativeEvent\.layout\.width\)\}/, 'nothing measures the row any more, so an unusual screen stays guessed at')
    assert.ok(
      !/flexGrow: 1[\s\S]{0,40}flexBasis/.test(stage),
      'a tile can grow into the spare room again, so the last one in a short row fills the screen'
    )

    const settings = read('mobile/src/screens/Settings.js')
    assert.match(settings, /saveSize\(i, sync\)/, 'the size buttons do not save anything')
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

    const nav = stage.indexOf('‹ Previous')
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
      'Play screen',
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
    assert.ok(!/TileSize/.test(root), 'the tile size buttons are on the front page rather than behind Play screen')

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
    assert.match(settings, /status=\{\s*demo\s*\?\s*'Demo — simulated FM3'[\s\S]{0,500}?`\$\{deviceName \|\| 'Unit'\} · connected`/)
    assert.match(settings, /status=\{SIZES\[loadSize\(sync\)\]\?\.name/)
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

    /* Absent rather than disabled when there is nowhere to go. */
    assert.match(read('mobile/src/screens/Stage.js'), /\{onOpenEdit \? \(/, 'the Edit button is drawn whether or not there is anywhere to go')
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
    assert.match(load, /set\(\{ error: err\.message, chain: 'ok', preset: was \}\)/, 'a refused select leaves the wrong preset on screen')

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
    assert.match(rig, /export const clearError = \(\) => set\(\{ error: null \}\)/, 'the store cannot be told to forget an error')

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

    /* And the gear can be seen. "The settings icon is too dark to even see" —
       on Android, where ⚙ is a text character drawn in the text colour, and
       the text colour was never set, so it was black on black. The iPhone
       swaps that character for a picture and hid the bug. */
    assert.match(
      flat,
      /<Text style=\{\{ color: color\.silk, fontSize: font\.lead \}\}>⚙<\/Text>/,
      'the gear has no colour of its own, so Android draws it black on a black bar'
    )

    /* The unit's own short name, not the Mac's. */
    assert.match(bar, /const ofDeviceName = \(s\) => s\.deviceName/, 'the header does not say what the unit is')
    /* The version, off the build rather than typed. */
    assert.match(bar, /from '\.\.\/lib\/version'/, 'the version on the bar is not the one that was built')
    /* And the word is the shared one, so the two apps cannot drift. */
    assert.match(bar, /from '\.\.\/lib\/link-word'/, 'the phone decides the word for itself')
    assert.match(flat, /linkWord\(tone, 'remote'\)/, 'the phone is not using the shared word')

    /* The old bar is gone rather than stacked above the new one. */
    const app = read('mobile/App.js')
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
    assert.match(flat, /\{settling && screen === 'stage' \? \( <Waking link=\{link\} \/>/, 'nothing is shown while the app waits')

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

  test('the phone can teach somebody how to connect a computer', () => {
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
    /* The routes themselves are the list both ends share; what is in
       Connect.js is the phone's way of drawing them. Both are read, because
       either one going missing takes the page down. */
    const src = read('shared/ways-in.mjs')
    const screen = read('mobile/src/screens/Connect.js')
    assert.match(screen, /WAYS\.map/, 'the phone no longer draws the routes')

    assert.match(src, /The Mac app/, 'the route that actually works is not offered')
    assert.match(src, /github\.com\/justinnewbold\/fractal-remote\/releases/, 'there is nowhere to get the Mac app from')
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

    /* The thing nobody knows and everything else depends on. */
    assert.match(screen, /Your unit plugs into a computer with a USB cable/, 'the page never says why a computer is involved')
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
    assert.match(signIn, /How do I connect a computer\?/, 'the sign-in screen does not offer it')
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
    const phone = read('mobile/src/screens/Connect.js')
    assert.match(phone, /WAYS\.map/, 'the phone does not draw the routes')
    /* Comments stripped first. The screen's own note EXPLAINS why it does not
       sort, and naming the function it is not calling is the clearest way to
       say that — reading it as a call is the mistake CLAUDE.md warns about,
       one file along. */
    assert.ok(
      !/waysFor|osGuess/.test(phone.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')),
      'the phone sorts the routes, which means it guessed which computer somebody owns'
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

  test('a square the scanner cannot use says so, instead of doing nothing', async () => {
    /*
     * "Android phone scanner doesn't work. It pulls up the camera and
     * everything fine, but nothing scans the QR code when it's in the
     * viewfinder. It does nothing."
     *
     * THE COMPUTER SHOWS TWO SQUARES AND ONLY ONE IS FOR THIS APP. The page
     * served from the computer shows a "same wifi" square carrying its own
     * address — http://192.168.x.x:5056 — captioned "point your phone's
     * camera at this". That one is for the phone's BROWSER, which loads the
     * app from the computer directly. This app cannot use it: every call it
     * makes goes through the relay and there is no direct-to-host path
     * anywhere in mobile/. So it read the square perfectly, found no pairing
     * code, and said nothing — which looks exactly like a camera that is not
     * scanning.
     *
     * The silence was deliberate and was wrong: a reader restricted to QR
     * codes is not going to be swamped by a room, and somebody deliberately
     * aiming at a square has earned an answer.
     */
    const src = read('mobile/src/components/ScanCode.js')

    /* The props are the ones this Expo version actually reads. onBarCodeScanned
       with a capital C is the old name and fails silently, which is the other
       way this screen could look broken. */
    assert.match(src, /onBarcodeScanned=/, 'the scanner has no barcode handler')
    assert.ok(!/onBarCodeScanned/.test(src), 'the pre-SDK-51 prop name is back, and it never fires')
    assert.match(src, /barcodeTypes: \['qr'\]/, 'the reader is no longer restricted to QR codes')

    /* A square that cannot be used is now said out loud. */
    assert.match(src, /setTrouble\(/, 'an unusable square is silently ignored again')
    assert.match(src, /tone="warn"/, 'the complaint is not shown on screen')

    /* And the camera is mounted only while the sheet is up — a Modal on
       Android is its own window, and a camera left behind a hidden one comes
       back showing a preview that never delivers a scan. */
    assert.match(src, /\{open \? \(\s*<CameraView/, 'the camera is mounted behind a closed modal again')

    const { looksLikeTheWifiSquare } = await import('../mobile/src/components/ScanCode.js')
      .catch(() => ({ looksLikeTheWifiSquare: null }))
    if (looksLikeTheWifiSquare) {
      for (const yes of ['http://192.168.1.47:5056', 'http://fractal-macbook.local:5056', 'http://10.0.0.5:5056']) {
        assert.equal(looksLikeTheWifiSquare(yes), true, `${yes} is the wifi square and is not being recognised`)
      }
      for (const no of ['https://fractal.newbold.cloud/#pair=ABCD2345', 'ABCD2345', 'https://example.com', '']) {
        assert.equal(looksLikeTheWifiSquare(no), false, `${no} is being called the wifi square`)
      }
    }
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

    /* Silence where nothing is known, which is the half that matters. */
    assert.equal(descriptionFor('amp', 'Atomica Ch1'), null, 'an obscure amp is being described anyway')
    assert.equal(descriptionFor('drive', 'FAS Boost'), null, "Fractal's own pedal is being given a history it does not have")
    assert.equal(descriptionFor('amp', ''), null)
    assert.equal(descriptionFor('amp'), null, 'descriptionFor throws rather than answering for a missing name')
    assert.equal(descriptionFor('reverb', 'Ambient'), null, 'a family with no catalog is being answered for')

    /* Every description is a sentence rather than a fragment, and none of them
       is long enough to need scrolling on a phone. */
    const ampFams = JSON.parse(read('src/data/amp-lineage.json'))
    const described = ampFams.filter((f) => f.description)
    assert.ok(described.length > 100, `only ${described.length} amp families are described`)
    for (const f of [...described, ...JSON.parse(read('src/data/cab-types.json')).filter((c) => c.description)]) {
      const d = f.description
      assert.ok(d.length >= 40 && d.length <= 200, `${f.family || f.name}: a description of ${d.length} characters`)
      assert.match(d, /[.!?]$/, `${f.family || f.name}: does not end as a sentence`)
      assert.ok(!/^\s|\s$/.test(d), `${f.family || f.name}: has stray whitespace`)
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
    assert.match(dev, /if \(!slug \|\| demoDevice\(\)\) return null/, 'the demo asks a computer it does not have for a list')
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
    assert.match(stage, /height=\{Math\.max\(tight \? 44 : TAP, size\.tile - 12\)\}/, 'a chain tile is held at 56 beside scene tiles of 48')
    assert.match(stage, /const foot = tight \? 48 : TAP/, 'the foot does not give at the smallest size')
    assert.equal((stage.match(/height=\{foot\}/g) || []).length, 5, 'not every button in the foot follows the foot height')
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

    /* And the button: Save, then Tap again with the warning, then the ask. */
    const saver = read('mobile/src/components/SaveToSlot.js').replace(/\s+/g, ' ')
    assert.match(saver, /label=\{s\.saving \? 'Saving…' : s\.armed \? 'Tap again' : 'Save'\}/, 'there is no Save button, or it does not ask twice')
    assert.match(saver, /replacing what was saved there\. Tap Save again to do it\./, 'the warning does not say what a save overwrites')
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

    /* Every path in device.js, read off it rather than remembered. */
    const device = read('mobile/src/lib/device.js')
    const paths = [...device.matchAll(/['`](\/[a-z][^'`\s]*)['`]/g)].map((m) => m[1])
    assert.ok(paths.length > 15, `only ${paths.length} routes were found in device.js; this check read nothing`)

    const answered = [
      ['/healthz'], ['/device/detect'], ['/preset'], ['/preset/blocks'], ['/preset/grid'],
      ['/scene'], ['/tempo'], ['/mod/model'], ['/blocks/catalog'],
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
    assert.match(demo, /mock = want \? createMockDevice\(\) : null/, 'the switch does not build a unit')
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
    assert.match(signIn, /Just looking\? Try the demo/, 'nothing offers the demo where somebody needs it')
    assert.match(signIn, /setDemo\(true\)/, 'the button does not turn the demo on')

    /* And escapable, or it is a trap rather than a demo. */
    const settings = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    assert.match(settings, /Leave the demo/, 'there is no way out of the demo')
    assert.match(settings, /onPress=\{\(\) => setDemo\(false\)\}/, 'the way out does not turn it off')
    /* It says what it is, every time, rather than letting somebody think a
       simulated FM3 is their FM3. */
    assert.match(settings, /This is the demo — a simulated FM3/, 'the demo does not say it is one')
    assert.match(settings, /status=\{ demo \? 'Demo — simulated FM3' :/, 'Setup does not show that the demo is on')

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
    assert.match(bar, /const word = demo \? 'demo' : linkWord\(tone, 'remote'\)/, 'the bar still says CONNECTED in the demo')
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

}
