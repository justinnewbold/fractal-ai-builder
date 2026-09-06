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
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/** Every .js under a directory, so a new screen cannot quietly opt out. */
function* walk(dir) {
  for (const entry of readdirSync(fileURLToPath(dir))) {
    const path = fileURLToPath(new URL(entry, dir))
    if (statSync(path).isDirectory()) yield* walk(new URL(`${entry}/`, dir))
    else if (/\.js$/.test(entry)) yield path
  }
}

export function run(test) {
  test('the phone and the browser use the same relay rules, character for character', async () => {
    /*
     * The web app imports shared/relay-rules.mjs; the phone gets a generated
     * copy, because Metro would otherwise have to reach outside mobile/ and an
     * EAS build that uploads only that directory would fail on a build machine
     * minutes in. The copy is only safe while this passes.
     */
    const { generate, sourceText, copyText } = await import('../scripts/sync-relay-rules.mjs')
    assert.equal(
      copyText(),
      generate(sourceText()),
      'mobile/src/lib/relay-rules.js is stale — run `npm run sync:rules`'
    )
  })

  test('the phone signs into the project the Mac hosts on', () => {
    const url = (text) => text.match(/url:\s*'([^']+)'/)?.[1]
    const key = (text) => text.match(/anonKey:\s*\n?\s*'([^']+)'/)?.[1]

    const mac = read('desktop/lib/project.mjs')
    const phone = read('mobile/src/lib/project.js')

    assert.ok(url(mac), 'the Mac project url moved')
    assert.equal(url(phone), url(mac), 'the phone would sign into a different project than the Mac')
    assert.equal(key(phone), key(mac), 'the phone carries a different key than the Mac')
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
        `${name} disagrees, so the two apps decide a Mac is gone at different moments`
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
        assert.ok(!jargon.test(line), `${file.split('/mobile/')[1]}: "${line}"`)
      }
    }
  })

  test('the phone cannot ask for anything the Mac refuses', async () => {
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

  test('the phone stores nothing it should be asking the Mac for', () => {
    /*
     * localStorage was the wrong shape for a fact the Mac learns and the phone
     * needs, and AsyncStorage is the same shape. Only two things are kept here:
     * the account session, which is the account library's own business, and
     * which Mac to drive, which is a choice about this handset.
     */
    const relay = read('mobile/src/lib/relay.js')
    const keys = [...relay.matchAll(/AsyncStorage\.(?:get|set)Item\(([^),]+)/g)].map((m) => m[1].trim())
    assert.deepEqual([...new Set(keys)], ['HOST_KEY'], 'the phone started keeping device state locally')
  })
}
