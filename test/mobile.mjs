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

  test('the way into the tone screen waits until it knows, then obeys the switch', async () => {
    /*
     * Three states, not two. `null` is "the setting has not been read back
     * yet", which AsyncStorage makes unavoidable — the browser reads
     * localStorage synchronously and this cannot.
     *
     * Hidden during that gap on purpose. Both choices flicker; only one of them
     * flickers dangerously. A button that appears a beat late is one nobody has
     * reached for. A button that vanishes out from under a thumb already on its
     * way down turns into a press on whatever the layout put there instead,
     * which in a row of stage controls is a scene change mid-song.
     */
    const { toneWayIn, clampMode } = await import('../shared/play-mode.mjs')
    assert.equal(toneWayIn({ connected: true, playing: false }), true)
    assert.equal(toneWayIn({ connected: true, playing: true }), false)
    assert.equal(
      toneWayIn({ connected: true, playing: null }),
      false,
      'the button is drawn before the switch has been read, so it can vanish under a press'
    )
    /* And nothing to ask about until the Mac is answering. */
    assert.equal(toneWayIn({ connected: false, playing: false }), false)

    /* Unreadable is never "hide it": a missing button reads as the feature
       being gone, an extra one is a button somebody can ignore. */
    assert.equal(clampMode('nonsense'), false)
    assert.equal(clampMode(null), false)
    assert.equal(clampMode('1'), true)
  })

  test('the tone screen is reachable, and says what it cannot do', () => {
    const app = read('mobile/App.js')
    const stage = read('mobile/src/screens/Stage.js')
    const tone = read('mobile/src/screens/Tone.js')

    assert.match(app, /screen === 'tone'/, 'nothing routes to the tone screen')
    assert.match(app, /toneWayIn\(/, 'the tone button ignores play mode')
    assert.match(stage, /onOpenTone \? \(/, 'the stage screen draws a dead tone button rather than none')

    /*
     * The promise this screen makes. A phone cannot save to a slot, which is
     * the whole reason a generate button is allowed near a stage screen at all
     * — so the screen has to offer the undo and say why it is safe.
     */
    assert.match(tone, /revert\(device, result\.presetNumber\)/, 'there is no way back from a tone on the phone')
    assert.match(tone, /can’t save to a slot/, 'the screen no longer says why nothing here is permanent')
    assert.match(tone, /running\.current\?\.abort\(\)/, 'a stuck generation can only be escaped by force-quitting')
  })

  test('the phone writes a tone in the order the unit needs', async () => {
    /*
     * The whole reason the order is shared rather than written twice. Every one
     * of these is silent when wrong: values dialled on a channel nobody hears,
     * ranges from a model that is no longer there, a block audible half-dialled.
     */
    const tone = await import('../mobile/src/lib/tone.js')
    const unit = fakeUnit()
    await tone.applyChanges(unit, [
      {
        eid: 100,
        name: 'Amp 1',
        channel: 2,
        type: 42,
        typeName: 'Recto',
        bypassed: false,
        params: [{ id: 1, name: 'Gain', to: 7, range: { min: 0, max: 10 } }]
      }
    ])
    assert.deepEqual(unit.calls, [
      'channel:100:2',
      'type:100:42',
      'read:100',
      'param:100:1:7',
      'bypass:100:false'
    ])
  })

  test('a write the unit ignored is reported rather than counted as done', async () => {
    /*
     * The device accepts a write it then ignores and reports success either
     * way. setParamConfirmed reads it back; this is what happens when both
     * write paths fail.
     */
    const tone = await import('../mobile/src/lib/tone.js')
    const unit = fakeUnit({ setParamConfirmed: async () => ({ ok: false }) })
    const failures = await tone.applyChanges(unit, [
      { eid: 100, name: 'Amp 1', params: [{ id: 1, name: 'Gain', to: 7, range: { min: 0, max: 10 } }] }
    ])
    assert.equal(failures.length, 1)
    assert.match(failures[0], /ignored both write paths/)
  })

  test('one step failing does not abandon the rest of the tone', async () => {
    /*
     * Half a tone with a list of what did not land beats a run that stopped at
     * step three and left the rig in a state nobody can describe.
     */
    const tone = await import('../mobile/src/lib/tone.js')
    const unit = fakeUnit({
      setChannel: async () => {
        throw new Error('the relay dropped')
      }
    })
    const failures = await tone.applyChanges(unit, [
      { eid: 100, name: 'Amp 1', channel: 2, params: [], bypassed: true }
    ])
    assert.equal(failures.length, 1)
    assert.ok(unit.calls.includes('bypass:100:true'), 'the rest of the block was abandoned')
  })

  test('scenes are written standing in each one, and put you back where you were', async () => {
    /*
     * A scene remembers a bypass and a channel, so writing one means standing
     * in it. A run that does not restore leaves somebody on scene 8 wondering
     * what happened.
     */
    const tone = await import('../mobile/src/lib/tone.js')
    const unit = fakeUnit({ getScene: async () => ({ index: 3 }) })
    await tone.applyScenes(unit, [
      { index: 0, name: 'Rhythm', blocks: [{ eid: 100, name: 'Amp 1', bypassed: false }] }
    ])
    assert.deepEqual(unit.calls, [
      'scene:0',
      'sceneName:0:Rhythm',
      'bypass:100:false',
      'scene:3'
    ])
  })

  test('a scene name the Mac refuses is said out loud, not swallowed', async () => {
    /*
     * This was an empty catch once. Naming was refused outright over a remote
     * session for months and, because nothing said so, it read as the feature
     * simply not working.
     */
    const tone = await import('../mobile/src/lib/tone.js')
    const unit = fakeUnit({
      setSceneName: async () => {
        throw new Error('not allowed from a phone')
      }
    })
    const failures = await tone.applyScenes(unit, [{ index: 0, name: 'Lead', blocks: [] }])
    assert.equal(failures.length, 1)
    assert.match(failures[0], /kept its old name/)
  })

  test('a rig that reads back empty is refused rather than designed against', async () => {
    /*
     * A relay that has gone reads every block empty, and what comes out the far
     * end is a rig with no controls in it that the model then cheerfully
     * designs a tone for.
     */
    const tone = await import('../mobile/src/lib/tone.js')
    const unit = fakeUnit({ presetBlocks: async () => [] })
    await assert.rejects(
      tone.buildTone({ unit, description: 'warmer', device: {} }),
      /Nothing came back from the unit/
    )
  })

  test('undo is the saved version, which a phone can always get back to', async () => {
    /*
     * Not an undo stack — the unit already has one. A phone cannot save to a
     * slot, so what is stored is always the version from before the tone.
     */
    const tone = await import('../mobile/src/lib/tone.js')
    const unit = fakeUnit()
    await tone.revert(unit, 28)
    assert.deepEqual(unit.calls, ['select:28'])
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
