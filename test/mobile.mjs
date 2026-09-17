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

  test('a scene name the computer refuses is said out loud, not swallowed', async () => {
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
     * learn, each opening its own page. Renaming lives on the Unit page, which
     * is where the browser put it: "move the rename presets and scenes button
     * to the settings menu".
     */
    const settings = read('mobile/src/screens/Settings.js')

    for (const row of ['Unit', 'Phone & computer', 'Play screen', 'About']) {
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

    /*
     * "At first it scrolls the whole screen when I try to slide up and down on
     * a knob. It did start working for a minute." The lock is a prop, and a
     * prop reaches the native side a frame after the finger lands; the first
     * movement on a fresh screen got there first. Two more things, both in
     * force before the finger lands: the knob refuses to hand the touch back
     * when the scroll view asks, and the scroll view is told it may not take
     * a touch a child is already tracking.
     */
    assert.match(knob, /onPanResponderTerminationRequest: \(\) => false/, 'the knob hands the touch back the moment the scroll view asks')
    assert.match(edit, /canCancelContentTouches=\{false\}/, 'the scroll view may still take a touch a knob is tracking')

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
     * ONLY ONE OF THE THREE EXISTS TODAY, which is why each says where it
     * stands. A page that dressed all three up as equals would send somebody
     * hunting a download that has not been built.
     */
    const src = read('mobile/src/screens/Connect.js')

    assert.match(src, /The Mac app/, 'the route that actually works is not offered')
    assert.match(src, /github\.com\/justinnewbold\/fractal-ai-builder\/releases\/latest/, 'there is nowhere to get the Mac app from')
    assert.match(src, /The Windows app/, 'Windows is not mentioned at all')
    assert.match(src, /Not built yet/, 'the Windows app is offered as though it exists')
    assert.match(src, /ForgeFX in a terminal/, 'the only route a Windows or Linux machine has today is missing')
    assert.match(src, /github\.com\/sKuhLight\/ForgeFX/, 'the terminal route names no repository to go and find')

    /*
     * AND NO COMMAND IS INVENTED. There is no one-line installer yet; printing
     * one that does not work is worse than saying so, because it fails at the
     * far end of somebody's evening with nothing to go on.
     */
    assert.match(src, /no one-file installer for this yet/, 'the page claims an installer that does not exist')

    /* The thing nobody knows and everything else depends on. */
    assert.match(src, /Your unit plugs into a computer with a USB cable/, 'the page never says why a computer is involved')
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
       * Connect.js tells somebody what to install, and one of the three things
       * they can install is the Mac app. Calling it "the computer app" there
       * would be describing a download by a name it does not have.
       */
      if (file.endsWith('/screens/Connect.js')) continue
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

  test('the phone can say what the computer is running', async () => {
    /*
     * "The app keeps crashing, but it might be the Mac app which is very laggy
     * also. Does the Mac app need to be updated to the latest version? Or would
     * that affect how the app performs?"
     *
     * A fair question with an answer nobody could reach. The computer has been
     * writing its version into `host.name` beside its own name since 7.192.0 —
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
      /const version = doc\?\.data\?\.version \|\| doc\?\.version if \(version\) set\(\{ hostVersion: String\(version\) \}\)/,
      'the version the computer sends is still thrown away'
    )

    /* In the log, because that is the copy that reaches a chat. */
    assert.match(
      read('mobile/src/screens/Log.js').replace(/\s+/g, ' '),
      /'computer app': link\.hostVersion \|\| 'did not say \(older than 7\.192\.0\)'/,
      'a pasted log still cannot say what the computer is running'
    )

    /* And on screen, where somebody can act on it. */
    const settings = read('mobile/src/screens/Settings.js').replace(/\s+/g, ' ')
    assert.match(settings, /The app on the computer is v\$\{hostVersion\}/, 'Setup never says the computer’s version')
    assert.match(settings, /const behind = !hostVersion \|\| isOlder\(hostVersion, APP_VERSION\) === true/, 'nothing works out whether the computer is behind')

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
    assert.ok(rig.indexOf('adoptNames(') < rig.indexOf('await refreshPreset()'), 'the names are taken after the slow reads instead of alongside them')
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

    /* The real thing behind it: a chain, and a preset that changes when asked. */
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
    assert.match(settings, /status=\{demo \? 'Demo — simulated FM3' : linkWord\}/, 'Setup does not show that the demo is on')

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
}
