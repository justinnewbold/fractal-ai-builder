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
import { parse } from '@babel/parser'

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

  test('the first release ships with the AI switched off, and every door to it obeys that', async () => {
    /*
     * "For the initial releases I only want to release the stuff related to
     * the live gig pedal board, nothing with the AI or chat changes or things
     * like that."
     *
     * The promise is not "the tone code is gone" — it is still in the bundle,
     * and going back on in a later update. The promise is that NOTHING IN THE
     * APP CAN REACH IT. There is exactly one door (the ✦ Tone button on the
     * stage screen, which opens the one screen that calls the model), so this
     * checks the switch is off and that both halves of that door read it.
     *
     * Worth a test rather than a careful commit because the failure is silent
     * and lands in a store: a build that ships with the switch flipped, or a
     * new way onto the tone screen added later without one, looks identical
     * from the outside until somebody taps it on a stage.
     */
    const { AI } = await import('../mobile/src/lib/features.js')
    assert.equal(AI, false, 'the first store release must ship with the AI off')

    const app = read('mobile/App.js')
    const settings = read('mobile/src/screens/Settings.js')

    /* The route onto the screen, and the button that reaches it. */
    assert.match(
      app,
      /AI && screen === 'tone'/,
      'the tone screen can be routed to with the AI off'
    )
    assert.match(
      app,
      /AI && toneWayIn\(/,
      'the stage screen is handed a tone button with the AI off'
    )

    /* Play mode hides the tone button and does nothing else, so with no tone
       button it is a switch that reports success and changes nothing. */
    assert.match(settings, /\{AI \? \(/, 'the play mode switch is offered with the AI off')

    /* And the one module that talks to the model is reached from the tone
       screen and nowhere else — so the door above is the only door. */
    let reaches = []
    for (const file of walk(new URL('../mobile/src/', import.meta.url))) {
      const text = readFileSync(file, 'utf8')
      if (/from '\.\.?\/(lib\/)?tone(\.js)?'/.test(text)) reaches.push(file.split('/mobile/')[1])
    }
    assert.deepEqual(
      reaches,
      ['src/screens/Tone.js'],
      'something other than the tone screen imports the tone builder, so the switch no longer covers every way to the model'
    )
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

    /*
     * The unit is named, not just described. api/generate.js reads
     * `device.name` and FALLS BACK TO 'FM3' when it is absent, so a request
     * carrying only capabilities designs an FM3 tone on whatever is plugged in
     * — silently, and wrongly on an AM4.
     */
    assert.match(
      tone,
      /device: \{ name: deviceName, capabilities: caps \}/,
      'the unit is not named in the request, so the generator designs for an FM3 whatever is plugged in'
    )
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
      'the name reader fires reads together, which queues them behind each other at the Mac'
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
    assert.match(
      screen,
      /want\(v\.item\)/,
      'the preset list no longer asks only for the rows on screen'
    )

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

  test('the phone and the Mac file a setlist under the same unit', async () => {
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

  test('Previous and Next on the phone follow the setlist, and the SOURCE button says which', () => {
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
    assert.match(stage, /caption="Source"/, 'nothing on the stage screen says what the buttons walk')
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
    assert.ok(!/Promise\.all/.test(index), 'the index fires its reads together, which queues them behind each other at the Mac')
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

    assert.deepEqual(grid.toWireCell(1, 0), { row: 1, col: 1 }, 'the first column is not column one on the wire')
    assert.deepEqual(grid.toWireCell(2, 5), { row: 2, col: 6 }, 'rows are being shifted as well as columns')
    assert.deepEqual(grid.toWireCell(1, 0), web.toWireCell(1, 0), 'the two apps disagree about the wire boundary')

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
    /* The row that holds something, plus the first empty one — so a bare preset
       can be started and a parallel row can be begun. Not all four. */
    assert.equal(lanes.length, 2, 'every row of the grid is drawn, empty or not')
    assert.deepEqual(lanes[0].blocks.map((b) => b.name), ['Drive 1', 'Amp 1'], 'a lane is not in signal order')
    assert.deepEqual(lanes[0].gaps, [1, 3], 'the free cells in a lane are wrong')

    const items = laneItems(lanes[0])
    assert.deepEqual(
      items.map((i) => `${i.kind}${i.col}`),
      ['block0', 'gap1', 'block2', 'gap3'],
      'the cards and gaps do not read as one chain in column order'
    )

    /* A preset with nothing in it still offers somewhere to start. */
    assert.equal(lanesShown([], caps).length, 1)
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
    const move = editor.slice(editor.indexOf('const move = async'), editor.indexOf('const remove = async'))
    assert.ok(move.length > 200, 'the move moved; this check reads it')

    assert.ok(
      !/ok === false/.test(move),
      'a move is being undone because the unit answered ok:false, which means nothing on this hardware'
    )
    assert.match(
      move,
      /catch \(err\) \{\s*\n\s*await placeBlock\(from\.row, from\.col, idOf\(from\.block\)\)/,
      'a move that throws part-way leaves the block in no cell at all'
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
    assert.match(vol, /latestWriter\(\(v\) => \{[\s\S]{0,200}?setParam\(eid, p\.id, v, p\)/, 'a drag confirms every value, which doubles the traffic it was written to avoid')
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
    const stage = read('mobile/src/screens/Stage.js')
    assert.match(stage, /showVolume \? '🔊 ✕' : '🔊'/, 'the volume is not behind a speaker button')
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
    assert.match(stage, /width: tileWidth\(grid, size\.scenes\)/, 'the scenes are a fixed number across whatever the setting says')
    assert.match(stage, /width: tileWidth\(grid, size\.fx\)/, 'the chain is a fixed number across whatever the setting says')
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
      /permanent when the preset is saved to a slot/,
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
    assert.match(rig, /chain: 'reading', sceneNames: \[\]/, 'the last preset’s scene names stay on the new preset’s tiles')

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
     * learn, each opening its own page. Renaming lives on the Unit page, which
     * is where the browser put it: "move the rename presets and scenes button
     * to the settings menu".
     */
    const settings = read('mobile/src/screens/Settings.js')

    for (const row of ['Unit', 'Phone & Mac', 'Play screen', 'About']) {
      assert.match(
        settings,
        new RegExp(`title="${row.replace('&', '&')}"`),
        `Setup has no ${row} row`
      )
    }
    assert.match(settings, /const \[page, setPage\] = useState\(null\)/, 'Setup is one scroll again rather than a list of pages')

    /*
     * The renaming boxes are behind the Unit row, not in front of everything.
     * Checked by position: what is drawn for `page === null` must not contain
     * them.
     */
    const root = settings.slice(settings.indexOf('{page === null ? ('), settings.indexOf("{page === 'unit' ?"))
    assert.ok(root.length > 200, 'the Setup root moved; this check reads it')
    assert.ok(!/UnitBits/.test(root), 'the scene-name boxes are back on the front page of Setup')
    assert.ok(!/TileSize/.test(root), 'the tile size buttons are on the front page rather than behind Play screen')

    const unit = settings.slice(settings.indexOf("{page === 'unit' ?"), settings.indexOf("{page === 'link' ?"))
    assert.match(unit, /<UnitBits \/>/, 'renaming is not on the Unit page')

    /* Each row says something true about the state it leads to, which is the
       whole point of the list: it answers most questions without a tap. */
    assert.match(settings, /status=\{link === 'connected' \? `\$\{deviceName \|\| 'Unit'\} · connected`/)
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
    assert.match(tap, /setTimeout\(\(\) => refreshTempo\(\), TAP_REREAD_MS\)/, 'the tempo is never read back after a tap')
    assert.ok(
      !/await refreshTempo\(\)/.test(tap),
      'the read-back is awaited inside the tap, which makes the tap itself late and the rhythm wrong'
    )

    /* Both apps do it the same way. */
    assert.match(read('src/components/Gig.jsx'), /setTimeout\(\(\) => refreshTempo\(\), TAP_REREAD_MS\)/)
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
    logDebug('wire', 'GET /preset/blocks failed', 'Your Mac didn’t answer.')
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
    assert.match(log, /label="Copy the log"/)
    assert.match(read('mobile/src/screens/Settings.js'), /title="Help & fixes"/, 'Setup has no way into the log')
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

    /* And the screen it lives on honours it. */
    assert.match(edit, /scrollEnabled=\{!held\}/, 'the bench scrolls under its own knobs')
    assert.match(edit, /onScrollLock=\{onScrollLock\}/, 'the knobs are not wired to the lock')
    assert.match(edit, /onScrollLock=\{setHeld\}/, 'the block panel is not wired to the lock')
  })

  test('every component the phone draws is one that exists', () => {
    /*
     * THE HOLE THIS FILLS, found the hard way.
     *
     * A screen used <Label> without defining or importing it. Nothing caught
     * it: `<Label>` compiles to a call on an identifier, so Metro bundles it
     * happily, `expo export` succeeds, and the app installs. The crash arrives
     * when somebody opens the fold that draws it — on a phone, which is the
     * one place in this project nothing here can run.
     *
     * There is no linter in this repository, and CI runs the tests and two
     * bundles. None of the three has an opinion about an identifier that is
     * used and never declared, so this does: every capitalised thing any screen
     * or component draws must be imported into that file, declared in it, or
     * bound by it.
     *
     * Capitalised only, because that is JSX's own rule — a lowercase tag is a
     * host element and means nothing to this check.
     */
    const files = [
      ...walk(new URL('../mobile/src/screens/', import.meta.url)),
      ...walk(new URL('../mobile/src/components/', import.meta.url)),
      fileURLToPath(new URL('../mobile/App.js', import.meta.url))
    ]
    assert.ok(files.length >= 8, `only ${files.length} phone files were read; this check found nothing`)

    for (const file of files) {
      const name = file.split('/mobile/')[1] || file
      const ast = parse(readFileSync(file, 'utf8'), {
        sourceType: 'module',
        plugins: ['jsx']
      })

      /* Everything this file brings into scope at the top level. */
      const declared = new Set()
      const bind = (node) => {
        if (!node) return
        if (node.type === 'Identifier') declared.add(node.name)
        else if (node.type === 'ObjectPattern') for (const pr of node.properties) bind(pr.value || pr.argument)
        else if (node.type === 'ArrayPattern') for (const el of node.elements) bind(el)
        else if (node.type === 'AssignmentPattern') bind(node.left)
        else if (node.type === 'RestElement') bind(node.argument)
      }
      for (const node of ast.program.body) {
        if (node.type === 'ImportDeclaration') for (const sp of node.specifiers) declared.add(sp.local.name)
        else if (node.type === 'FunctionDeclaration') declared.add(node.id?.name)
        else if (node.type === 'ClassDeclaration') declared.add(node.id?.name)
        else if (node.type === 'VariableDeclaration') for (const d of node.declarations) bind(d.id)
        else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
          const d = node.declaration
          if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') declared.add(d.id?.name)
          else if (d.type === 'VariableDeclaration') for (const one of d.declarations) bind(one.id)
        } else if (node.type === 'ExportDefaultDeclaration' && node.declaration?.id) {
          declared.add(node.declaration.id.name)
        }
      }

      /* Every capitalised tag it draws. Walked by hand rather than with a
         traverse dependency: the shape being looked for is one field deep. */
      const drawn = new Set()
      const seen = new Set()
      const walkNode = (node) => {
        if (!node || typeof node !== 'object' || seen.has(node)) return
        seen.add(node)
        if (node.type === 'JSXOpeningElement') {
          let tag = node.name
          /* <Foo.Bar> is Foo's business, so only the head of it is checked. */
          while (tag?.type === 'JSXMemberExpression') tag = tag.object
          const named = tag?.type === 'JSXIdentifier' ? tag.name : null
          if (named && /^[A-Z]/.test(named)) drawn.add(named)
        }
        for (const key of Object.keys(node)) {
          const value = node[key]
          if (Array.isArray(value)) for (const v of value) walkNode(v)
          else if (value && typeof value === 'object' && value.type) walkNode(value)
        }
      }
      walkNode(ast.program)

      for (const tag of drawn) {
        assert.ok(
          declared.has(tag),
          `${name} draws <${tag}> without importing or defining it — it bundles, installs, and crashes when that part of the screen opens`
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
}
