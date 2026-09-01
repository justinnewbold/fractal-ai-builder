/**
 * Tests for the conversion and validation logic.
 *
 * Every case here comes from a real failure. The write path produced presets
 * that reported success and were silently wrong for an entire evening, and none
 * of it was reproducible without hardware. Now it is.
 */
import assert from 'node:assert/strict'
import { toNormalized, fromNormalized } from '../src/lib/scale.js'
import { isSilencingParam } from '../src/lib/guardrails.js'
import { validateSpec, countWrites, countSceneWrites } from '../src/lib/validate.js'
import { preferredEncoding, rememberEncoding, disambiguate } from '../src/lib/encoding.js'
import { forbiddenRemotely, explainAuth, timeoutFor } from '../src/lib/remote.js'
import * as taste from '../src/lib/taste.js'
import {
  patchSchemaValue,
  invalidateSchema,
  resetSchemaCache,
  seedSchemaCache,
  cachedSchema
} from '../src/lib/schemaCache.js'

let passed = 0
let failed = 0

/*
 * Async tests are awaited, not fired and forgotten.
 *
 * This used to call fn() and count the test passed on the spot. A test written
 * `async () => {…}` therefore returned a promise nobody held: a failed
 * assertion inside one became an unhandled rejection, which node turns into a
 * crash — so instead of one FAIL line you got a stack trace, no tally, and
 * every test after it never ran at all.
 */
let queue = Promise.resolve()
const test = (name, fn) => {
  const ok = () => {
    passed++
    console.log(`  ok  ${name}`)
  }
  const bad = (err) => {
    failed++
    console.error(`FAIL  ${name}\n      ${err.message}`)
    process.exitCode = 1
  }

  /*
   * An async test is queued behind the ones before it, not started alongside
   * them. Awaiting a set of already-running promises is not the same as
   * running them in order: the device-state tests share one module-level
   * store, so concurrent bodies reset it out from under each other and the
   * failure looks like a bug in the code under test rather than in the runner.
   */
  if (fn.constructor?.name === 'AsyncFunction') {
    queue = queue.then(fn).then(ok, bad)
    return
  }

  try {
    const out = fn()
    if (out && typeof out.then === 'function') queue = queue.then(() => out).then(ok, bad)
    else ok()
  } catch (err) {
    bad(err)
  }
}

/** Every queued test, settled, before anything counts the score. */
const settle = () => queue

const close = (a, b, tol = 0.0005) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`)

console.log('\nscale')

test('linear midpoint', () => close(toNormalized(5, { min: 0, max: 10 }), 0.5))

test('linear dB matches device report', () =>
  // device reported Amp1 Level -8.001 at norm 0.7199
  close(toNormalized(-8.001, { min: -80, max: 20 }), 0.71999))

test('log matches the device own norm for low cut', () =>
  // device reported 71.999 Hz at norm 0.42866 on a 10-1000 log range
  close(toNormalized(71.999, { min: 10, max: 1000, log: true }), 0.42866, 0.0001))

test('log matches the device own norm for high cut', () =>
  // device reported 10399.685 Hz at norm 0.70748 on 400-40000 log
  close(toNormalized(10399.685, { min: 400, max: 40000, log: true }), 0.70748, 0.0001))

test('log is not linear — the bug that pinned frequencies', () => {
  const log = toNormalized(72, { min: 10, max: 1000, log: true })
  const linear = toNormalized(72, { min: 10, max: 1000 })
  assert.ok(Math.abs(log - linear) > 0.3, 'log and linear should diverge sharply')
})

test('out of range clamps rather than exceeding', () => {
  assert.equal(toNormalized(999, { min: 0, max: 10 }), 1)
  assert.equal(toNormalized(-999, { min: 0, max: 10 }), 0)
})

test('refuses to guess without a range', () =>
  assert.equal(toNormalized(7.5, {}), null))

test('passes through a value already normalised when range is unknown', () =>
  assert.equal(toNormalized(0.5, {}), 0.5))

test('round trips', () => {
  const p = { min: 10, max: 1000, log: true }
  close(fromNormalized(toNormalized(72, p), p), 72, 0.01)
})

console.log('\nguardrails')

test('blocks output levels', () => {
  for (const n of ['Amp1 Level', 'Level', 'Out Level', 'Balance', 'Pan L'])
    assert.ok(isSilencingParam(n), n)
})

test('allows real tone controls', () => {
  for (const n of ['Gain 1', 'Bass 1', 'Master Volume', 'Boost Level', 'Input Level', 'Mix'])
    assert.ok(!isSilencingParam(n), n)
})

console.log('\nvalidate')

const schema = [
  {
    eid: 58,
    name: 'Amp 1',
    slug: 'amp',
    bypassed: false,
    models: [{ value: 82, name: '5153 100W Blue' }],
    params: [
      { id: 7, name: 'Gain 1', value: 5, min: 0, max: 10 },
      { id: 12, name: 'Low Cut Frequency', value: 10, min: 10, max: 1000, log: true }
    ]
  }
]

test('accepts a good spec and carries the range through', () => {
  const r = validateSpec(
    { presetName: 'test', blocks: [{ eid: 58, type: 82, params: [{ id: 7, value: 7.5 }] }] },
    schema
  )
  assert.equal(r.changes.length, 1)
  assert.equal(r.changes[0].params[0].to, 7.5)
  assert.deepEqual(r.changes[0].params[0].range, { min: 0, max: 10, log: undefined })
})

test('drops an unknown model rather than writing it', () => {
  const r = validateSpec({ blocks: [{ eid: 58, type: 9999, params: [] }] }, schema)
  assert.equal(r.changes.length, 0)
  assert.match(r.problems[0], /isn't in this unit's list/)
})

test('drops an out-of-range value', () => {
  const r = validateSpec({ blocks: [{ eid: 58, params: [{ id: 7, value: 50 }] }] }, schema)
  assert.equal(r.changes.length, 0)
  assert.match(r.problems[0], /outside/)
})

test('drops an unknown block', () => {
  const r = validateSpec({ blocks: [{ eid: 999, params: [] }] }, schema)
  assert.match(r.problems[0], /no such block/)
})

test('keeps preset names within the 31-char hardware limit', () => {
  const long = validateSpec(
    { presetName: 'a preset name far longer than any Fractal unit will store', blocks: [] },
    schema
  )
  assert.equal(long.presetName.length, 31)
})

test('preserves case and normal punctuation in preset names', () => {
  // Units ship with names like "Leon's Live AM4" — mixed case, apostrophes.
  const r = validateSpec({ presetName: "Leon's Live AM4", blocks: [] }, schema)
  assert.equal(r.presetName, "Leon's Live AM4")
})

test('strips characters the hardware will not store', () => {
  const r = validateSpec({ presetName: 'Drop A  <metal>\n rhythm', blocks: [] }, schema)
  assert.equal(r.presetName, 'Drop A metal rhythm')
})

console.log('\npresets that follow the account')

const cloud = await import('../src/lib/cloudPresets.js')

test('a cloud row is the same shape as a local one', () => {
  /*
   * The design claim of this feature: nothing above these two modules should
   * have to care where a tone came from. The loader in App takes an entry and
   * reads entry.spec, entry.name, entry.description — so a row that maps to a
   * different shape breaks loading a cloud preset and nothing else, which is
   * the kind of thing found by a person rather than a test.
   */
  const entry = cloud.toEntry({
    id: 'abc',
    name: 'Black Album',
    description: 'tight and scooped',
    summary: 'a summary',
    spec: { blocks: [] },
    device: { name: 'FM3' },
    block_names: ['Amp 1', 'Cab 1'],
    created_at: '2026-09-01T00:00:00Z'
  })
  const local = buildEntryShape()
  assert.deepEqual(Object.keys(entry).filter((k) => k !== 'where').sort(), local.sort())
  assert.equal(entry.name, 'Black Album')
  assert.deepEqual(entry.blockNames, ['Amp 1', 'Cab 1'])
  assert.equal(entry.where, 'cloud', 'the UI needs to know which store to delete from')
})

function buildEntryShape() {
  // The local shape, from history.js — usage is local-only (token cost of the
  // run that made it) and deliberately not stored per account.
  return ['id', 'at', 'name', 'description', 'summary', 'spec', 'device', 'blockNames']
}

test('a row with nothing in it still yields a usable entry', () => {
  const entry = cloud.toEntry({ id: 'x', spec: {} })
  assert.equal(entry.name, 'Untitled')
  assert.deepEqual(entry.blockNames, [])
  assert.ok(Number.isFinite(entry.at))
})

test('a policy refusal is translated into something a player can act on', () => {
  /*
   * PostgREST reports it as code 42501 and "new row violates row-level
   * security policy", which is true and useless. The only way to reach it here
   * is a session that expired, and that has an obvious remedy.
   */
  const said = cloud.explain({ code: '42501', message: 'new row violates row-level security policy' })
  assert.match(said, /session has expired/i)
  assert.doesNotMatch(said, /row-level/i)
})

test('a missing table says the project is not set up, not "relation does not exist"', () => {
  const said = cloud.explain({ message: 'relation "public.presets" does not exist' })
  assert.match(said, /no preset storage/i)
})

test('anything else is passed through rather than swallowed', () => {
  assert.equal(cloud.explain({ message: 'network unreachable' }), 'network unreachable')
  assert.match(cloud.explain(null), /failed/i)
})

test('the client never sends user_id', async () => {
  /*
   * It is the column default, which is auth.uid(). A client-supplied value is
   * one the client can get wrong, and the policy would then reject the insert
   * for a reason the player cannot act on — while a correct one is redundant.
   */
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/lib/cloudPresets.js', import.meta.url), 'utf8')
  )
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
  assert.ok(!/user_id\s*:/.test(code), 'cloudPresets sets user_id from the client')
})

console.log('\nserving it locally')

const host = await import('../desktop/lib/host.mjs')

test('the phone is offered an address a phone can reach', () => {
  /*
   * Loopback is useless here by definition — the whole point is a second
   * device. The QR carries the IP rather than the .local name because iOS
   * resolves .local natively and Android often does not, and a scanned code
   * that fails is the worst possible first impression.
   */
  const w = host.addresses({ port: 5056, name: 'fractal', ip: '10.0.0.191' })
  assert.equal(w.forPhone, 'http://10.0.0.191:5056')
  assert.ok(w.all.includes('http://fractal.local:5056'))
  assert.ok(w.all.includes('http://localhost:5056'))
})

test('with no network there is nothing to scan, and it says so rather than lying', () => {
  const w = host.addresses({ port: 5056, ip: null })
  assert.equal(w.forPhone, null)
  assert.equal(w.lan, null)
  // localhost still works for the machine itself.
  assert.ok(w.all.includes('http://localhost:5056'))
})

test('a loopback-only machine yields no phone address', () => {
  const only = () => ({ lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] })
  assert.equal(host.lanAddress(only), null)
})

test('the first real interface is the one offered', () => {
  const nics = () => ({
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    en0: [
      { family: 'IPv6', address: 'fe80::1', internal: false },
      { family: 'IPv4', address: '192.168.1.44', internal: false }
    ]
  })
  assert.equal(host.lanAddress(nics), '192.168.1.44')
})

test('ForgeFX is only found where the server actually is', () => {
  /*
   * A half-finished clone that merely exists is worse than no match: it fails
   * later, further from the cause. So the check is for server/package.json,
   * not for the directory.
   */
  const exists = (p) => p === '/Users/x/src/forgefx/server/package.json'
  assert.equal(host.findForgeFX({ env: { HOME: '/Users/x' }, exists }), '/Users/x/src/forgefx')
  assert.equal(host.findForgeFX({ env: { HOME: '/Users/x' }, exists: () => false }), null)
})

test('FORGEFX_PATH wins over the guesses', () => {
  const exists = () => true
  assert.equal(
    host.findForgeFX({ env: { HOME: '/Users/x', FORGEFX_PATH: '/opt/ff' }, exists }),
    '/opt/ff'
  )
})

test('the server is told to serve this app — the whole of local mode', () => {
  // FORGEFX_STATIC is what makes the page and the device API the same origin,
  // which is what lets a phone skip the account entirely.
  const env = host.serverEnv({ env: { PATH: '/bin' }, port: 5056, dist: '/app/dist' })
  assert.equal(env.FORGEFX_STATIC, '/app/dist')
  assert.equal(env.PORT, '5056')
  assert.equal(env.PATH, '/bin', 'the rest of the environment must survive')
})

test('publishing without mDNS available still gives a usable stop', async () => {
  // The desktop app treats bonjour as optional — without it the IP still
  // works and only the .local name is lost, so this must not throw.
  const ad = host.publish(null, { port: 5056 })
  await ad.stop()
})

console.log('\nwho may call the model')

const { allowedOrigin } = await import('../api/_cors.js')

test('the hosted app and its previews are allowed', () => {
  assert.equal(allowedOrigin('https://fractal.newbold.cloud'), 'https://fractal.newbold.cloud')
  assert.ok(allowedOrigin('https://fractal-ai-builder-git-branch.vercel.app'))
})

test('a machine on the player own network is allowed', () => {
  /*
   * Local mode: ForgeFX serves the UI over plain http on the LAN so a phone
   * can reach the unit without an account, which makes the page a cross-origin
   * caller here. The address is whatever DHCP handed the Mac this morning, so
   * the ranges are matched rather than listed.
   */
  for (const o of [
    'http://localhost:5056',
    'http://127.0.0.1:5056',
    'http://10.0.0.191:5056',
    'http://192.168.1.44:5056',
    'http://172.16.9.9:5056',
    'http://fractal.local:5056'
  ]) {
    assert.equal(allowedOrigin(o), o, o)
  }
})

test('the open internet is not allowed', () => {
  /*
   * These functions spend money on every call, and the key lives on the server
   * precisely so a browser never holds it. A wildcard would let any page on
   * the internet spend it, which is why this is a list and not a `*`.
   */
  for (const o of [
    'https://evil.example',
    'http://evil.example',
    'https://fractal.newbold.cloud.evil.example',
    'http://8.8.8.8',
    'http://172.32.0.1',
    'https://notvercel.app',
    null,
    undefined,
    'not a url'
  ]) {
    assert.equal(allowedOrigin(o), null, String(o))
  }
})

test('a private address over https is still not a device serving the app', () => {
  // ForgeFX serves plain http. An https private address is not the local case
  // and does not need the allowance.
  assert.equal(allowedOrigin('https://192.168.1.44'), null)
})

console.log('\nscenes')

/* A preset with an amp, a cab and two pedals — enough to have a scene plan
   that means something, and enough for a scene to be wrong in each way. */
const sceneSchema = [
  { eid: 58, name: 'Amp 1', slug: 'amp', models: [], params: [] },
  { eid: 106, name: 'Cab 1', slug: 'cab', models: [], params: [] },
  { eid: 118, name: 'Drive 1', slug: 'drive', models: [], params: [] },
  { eid: 132, name: 'Delay 1', slug: 'delay', models: [], params: [] }
]
const scened = (scenes, count = 8) =>
  validateSpec({ blocks: [], scenes }, sceneSchema, count)

test('a scene plan becomes explicit per-block bypass', () => {
  // The model says what is ON; the hardware is told what is OFF. That
  // inversion happens once, in validation, not at every call site.
  const r = scened([{ index: 0, name: 'Rhythm', engaged: [58, 106, 118] }])
  assert.equal(r.scenes.length, 1)
  const off = r.scenes[0].blocks.filter((b) => b.bypassed).map((b) => b.eid)
  assert.deepEqual(off, [132], 'the delay was not listed, so it should be off')
})

test('a scene that forgets the amp is repaired, not shipped', () => {
  /*
   * The silent-scene case. The prompt tells the model amp and cab belong in
   * every scene and it can still drop one on the eighth scene of a long reply
   * — and the failure is inaudible until someone stands on a footswitch
   * mid-set, which is the worst possible moment to find it.
   */
  const r = scened([{ index: 2, name: 'Lead', engaged: [118, 132] }])
  const on = r.scenes[0].blocks.filter((b) => !b.bypassed).map((b) => b.eid)
  assert.ok(on.includes(58) && on.includes(106), 'amp and cab should be switched back on')
  assert.match(r.problems.join(' '), /would have silenced it/)
})

test('a scene past the end of the unit is dropped', () => {
  // An AM4 has fewer scenes than an FM3. Writing scene 8 to a unit with four
  // is eight round trips that end in a refusal, or worse.
  const r = scened([{ index: 6, name: 'Too far', engaged: [58, 106] }], 4)
  assert.deepEqual(r.scenes, [])
  assert.match(r.problems.join(' '), /outside this unit/)
})

test('the same scene described twice keeps the first', () => {
  const r = scened([
    { index: 1, name: 'First', engaged: [58, 106] },
    { index: 1, name: 'Second', engaged: [58, 106, 132] }
  ])
  assert.equal(r.scenes.length, 1)
  assert.equal(r.scenes[0].name, 'First')
})

test('scenes come back in the order the unit holds them', () => {
  const r = scened([
    { index: 3, name: 'Solo', engaged: [58, 106] },
    { index: 0, name: 'Clean', engaged: [58, 106] }
  ])
  assert.deepEqual(r.scenes.map((x) => x.index), [0, 3])
})

test('an unknown effect id in a scene is ignored, not written', () => {
  const r = scened([{ index: 0, name: 'Ghost', engaged: [58, 106, 9999] }])
  assert.ok(!r.scenes[0].blocks.some((b) => b.eid === 9999))
})

test('no scenes is a normal answer, not an error', () => {
  const r = scened([])
  assert.deepEqual(r.scenes, [])
  assert.deepEqual(r.problems, [])
})

test('the cost of a scene plan is a switch plus a bypass each', () => {
  // Shown on the button before anything is written, because this is the half
  // that walks the unit through every scene.
  const r = scened([
    { index: 0, name: 'A', engaged: [58, 106] },
    { index: 1, name: 'B', engaged: [58, 106, 118] }
  ])
  assert.equal(countSceneWrites(r.scenes), 2 * (1 + 4))
})

test('counts writes including model and bypass', () => {
  const r = validateSpec(
    { blocks: [{ eid: 58, type: 82, bypassed: true, params: [{ id: 7, value: 7 }] }] },
    schema
  )
  assert.equal(countWrites(r.changes), 3)
})



console.log('command plan')

const { validatePlan } = await import('../src/lib/actions.js')

const cmdBlocks = [
  {
    eid: 58,
    name: 'Amp 1',
    slug: 'amp',
    row: 1,
    col: 4,
    models: [{ value: 82, name: '5153 100W Blue' }],
    params: [
      { id: 7, name: 'Gain 1', value: 5, min: 0, max: 10 },
      { id: 1, name: 'Amp1 Level', value: -8, min: -80, max: 20 }
    ]
  },
  { eid: 118, name: 'Drive 1', slug: 'drive', row: 1, col: 6, models: [], params: [] }
]
const caps = { grid: { rows: 4, cols: 12 }, sceneCount: 8, channelNames: ['A', 'B', 'C', 'D'] }

test('accepts a parameter change in range', () => {
  const r = validatePlan(
    { actions: [{ kind: 'setParam', eid: 58, paramId: 7, value: 7.5, why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(r.actions.length, 1)
  assert.match(r.actions[0].label, /Gain 1/)
})

test('refuses to touch output levels', () => {
  const r = validatePlan(
    { actions: [{ kind: 'setParam', eid: 58, paramId: 1, value: -40, why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(r.actions.length, 0)
  assert.match(r.problems[0], /gain staging|yours to set/i)
})

test('refuses an out-of-range value', () => {
  const r = validatePlan(
    { actions: [{ kind: 'setParam', eid: 58, paramId: 7, value: 99, why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(r.actions.length, 0)
})

test('refuses an invented model', () => {
  const r = validatePlan({ actions: [{ kind: 'setModel', eid: 58, value: 4242, why: '' }] }, cmdBlocks, caps)
  assert.equal(r.actions.length, 0)
  assert.match(r.problems[0], /isn't on this unit/)
})

test('refuses a move onto an occupied cell', () => {
  const r = validatePlan(
    { actions: [{ kind: 'moveBlock', eid: 118, row: 1, col: 4, why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(r.actions.length, 0)
  assert.match(r.problems[0], /already taken/)
})

test('refuses a cell off the grid', () => {
  const r = validatePlan(
    { actions: [{ kind: 'moveBlock', eid: 118, row: 9, col: 2, why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(r.actions.length, 0)
})

test('orders structure before the values that depend on it', () => {
  const r = validatePlan(
    {
      actions: [
        { kind: 'setParam', eid: 58, paramId: 7, value: 8, why: '' },
        { kind: 'setModel', eid: 58, value: 82, why: '' },
        { kind: 'moveBlock', eid: 118, row: 1, col: 2, why: '' }
      ]
    },
    cmdBlocks,
    caps
  )
  assert.deepEqual(
    r.actions.map((a) => a.kind),
    ['moveBlock', 'setModel', 'setParam']
  )
})

test('refuses a scene the device does not have', () => {
  const r = validatePlan({ actions: [{ kind: 'setScene', value: 40, why: '' }] }, cmdBlocks, caps)
  assert.equal(r.actions.length, 0)
})

test('writes start on the continuous path', () => {
  // Every parameter the app can reach comes from a block's `named` list, which
  // is ForgeFX's continuous-knob half. Defaulting to discrete floored AM4
  // controls to their minimum on the first attempt.
  assert.equal(preferredEncoding(58, 17), true)
})

test('a remembered encoding still wins over the default', () => {
  rememberEncoding(58, 99, false)
  assert.equal(preferredEncoding(58, 99), false)
})

test('leaves distinct parameter names alone', () => {
  const out = disambiguate([
    { id: 11, name: 'Gain', value: 6.5, min: 0, max: 10, unit: '' },
    { id: 15, name: 'Master', value: 6, min: 0, max: 10, unit: '' }
  ])
  assert.deepEqual(out.map((p) => p.name), ['Gain', 'Master'])
  assert.equal(out[0].subBlockId, null)
})

test('separates a sub-block parameter that collides by name', () => {
  // The AM4 amp page carries its integrated cab, so both report a "High Cut".
  const out = disambiguate([
    { id: 17, name: 'High Cut', value: 8000, min: 400, max: 40000, unit: 'Hz' },
    { id: 4063264, name: 'High Cut', value: 4016, min: 200, max: 20000, unit: 'Hz' }
  ])
  assert.notEqual(out[0].name, out[1].name)
  assert.equal(out[0].subBlockId, null)
  assert.equal(out[1].subBlockId, 62)
  assert.ok(out[1].name.includes('sub-block 62'))
})

test('saves to a named slot', () => {
  const r = validatePlan(
    { actions: [{ kind: 'savePreset', value: 67, text: 'Drop A Rhythm', why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(r.actions.length, 1)
  assert.ok(r.actions[0].label.includes('67'))
  // Overwrites a slot, so it must not run without being asked twice.
  assert.equal(r.actions[0].destructive, true)
})

test('refuses a slot that is not a number', () => {
  const r = validatePlan(
    { actions: [{ kind: 'savePreset', value: null, text: '', why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(r.actions.length, 0)
  assert.equal(r.problems.length, 1)
})

test('loading is destructive and runs before edits, saving after', () => {
  const r = validatePlan(
    {
      actions: [
        { kind: 'savePreset', value: 12, text: null, why: '' },
        { kind: 'setParam', eid: 58, paramId: 7, value: 8, why: '' },
        { kind: 'loadPreset', value: 12, why: '' }
      ]
    },
    cmdBlocks,
    caps
  )
  assert.deepEqual(
    r.actions.map((a) => a.kind),
    ['loadPreset', 'setParam', 'savePreset']
  )
  assert.equal(r.actions[0].destructive, true)
})

test('backing up a preset needs no confirmation', () => {
  const r = validatePlan({ actions: [{ kind: 'backupPreset', value: 3, why: '' }] }, cmdBlocks, caps)
  assert.equal(r.actions.length, 1)
  assert.ok(!r.actions[0].destructive)
})

test('a confirmed write updates the cached value in place', () => {
  resetSchemaCache()
  const params = [{ id: 7, name: 'Gain', value: 5, min: 0, max: 10 }]
  seedSchemaCache(58, params)
  patchSchemaValue(58, 7, 8)
  assert.equal(params[0].value, 8)
})

test('patching a block that was never cached is harmless', () => {
  resetSchemaCache()
  assert.doesNotThrow(() => patchSchemaValue(999, 1, 5))
})

test('invalidating one block leaves the others cached', () => {
  resetSchemaCache()
  seedSchemaCache(58, [{ id: 7, value: 5 }])
  seedSchemaCache(118, [{ id: 2, value: 3 }])
  invalidateSchema(58)
  // The swapped block must be re-read; the untouched one must not.
  assert.equal(cachedSchema(58), undefined)
  assert.ok(cachedSchema(118))
})

test('keeping a preset in the library asks no permission', () => {
  const r = validatePlan(
    { actions: [{ kind: 'keepInLibrary', value: null, text: 'Drop A Rhythm', why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(r.actions.length, 1)
  // A file appearing in a folder overwrites nothing on the unit.
  assert.ok(!r.actions[0].destructive)
  assert.ok(r.actions[0].label.includes('Drop A Rhythm'))
})

test('the library is written after the slot, not before', () => {
  const r = validatePlan(
    {
      actions: [
        { kind: 'keepInLibrary', value: null, text: 'Take one', why: '' },
        { kind: 'setParam', eid: 58, paramId: 7, value: 8, why: '' },
        { kind: 'savePreset', value: 4, text: null, why: '' }
      ]
    },
    cmdBlocks,
    caps
  )
  assert.deepEqual(
    r.actions.map((a) => a.kind),
    ['setParam', 'savePreset', 'keepInLibrary']
  )
})

test('a tone description is not treated as a list of changes', () => {
  // designTone is routed to the design flow before validatePlan sees it, so the
  // validator has no business inventing actions for it.
  const r = validatePlan(
    { actions: [{ kind: 'designTone', text: 'tight modern metal in drop A', why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(r.actions.length, 0)
})

test('building a chain needs no confirmation and runs before edits', () => {
  const r = validatePlan(
    {
      actions: [
        { kind: 'setParam', eid: 58, paramId: 7, value: 8, why: '' },
        { kind: 'buildChain', text: 'drive, amp, cab', why: '' }
      ]
    },
    cmdBlocks,
    caps
  )
  assert.deepEqual(
    r.actions.map((a) => a.kind),
    ['buildChain', 'setParam']
  )
  // Placing blocks into an empty slot destroys nothing.
  assert.ok(!r.actions[0].destructive)
  assert.ok(r.actions[0].label.includes('drive'))
})

test('a chain with no blocks named falls back to a default', () => {
  const r = validatePlan({ actions: [{ kind: 'buildChain', text: null, why: '' }] }, cmdBlocks, caps)
  assert.equal(r.actions.length, 1)
  assert.ok(r.actions[0].label.includes('amp'))
})

test('the relay refuses what the host refuses', () => {
  assert.ok(forbiddenRemotely('POST', '/preset/store'))
  assert.ok(forbiddenRemotely('POST', '/preset/backup'))
  assert.ok(forbiddenRemotely('POST', '/ports/select'))
  // Renames and version moves are host-refused too; the mirror used to allow
  // them, so a phone rename died as a raw relay error instead of an explanation.
  assert.ok(forbiddenRemotely('POST', '/preset/name'))
  assert.ok(forbiddenRemotely('POST', '/scene/name'))
  assert.ok(forbiddenRemotely('POST', '/version/3/restore'))
  assert.ok(forbiddenRemotely('DELETE', '/device/cache'))
})

test('live performance edits travel fine', () => {
  assert.equal(forbiddenRemotely('PUT', '/preset/blocks/58/params/17'), null)
  assert.equal(forbiddenRemotely('POST', '/scene'), null)
  assert.equal(forbiddenRemotely('POST', '/tempo'), null)
  assert.equal(forbiddenRemotely('POST', '/preset/select'), null)
  // GETs are broadly allowed by the host — the old mirror needlessly killed the
  // backup and port lists on the phone, and these assertions encoded that bug.
  assert.equal(forbiddenRemotely('GET', '/backups'), null)
  assert.equal(forbiddenRemotely('GET', '/ports'), null)
  assert.equal(forbiddenRemotely('GET', '/local/presets'), null)
  // Trailing slashes and query strings must not sneak past the check.
  assert.ok(forbiddenRemotely('POST', '/preset/store/'))
  assert.ok(forbiddenRemotely('POST', '/preset/backup?x=1'))
})

test('the mirror agrees with the host about every route this app calls', () => {
  /*
   * The host's rule, transcribed from ForgeFX server/src/remote.ts
   * remoteAllowed() and verified against that file this session. If ForgeFX
   * changes its allowlist, update BOTH this transcription and hostAllows() in
   * src/lib/remote.js — this test exists because the two drifted on eight
   * routes before anyone compared them.
   */
  const hostAllows = (method, p) => {
    if (method === 'GET')
      return !p.startsWith('/cloud') && !p.startsWith('/remote') && p !== '/debug/raw'
    if (method === 'PUT')
      return (
        /^\/preset\/blocks\/\d+\/params(\/\d+)?$/.test(p) ||
        /^\/preset\/grid\/cell$/.test(p) ||
        /^\/am4\/param$/.test(p) ||
        /^\/device\/param$/.test(p) ||
        p === '/telemetry/config' ||
        /^\/store\/config\/[^/]+$/.test(p)
      )
    if (method === 'POST')
      return (
        /^\/preset\/blocks\/\d+\/(bypass|channel|type|read|readrange)$/.test(p) ||
        [
          '/preset/meters',
          '/preset/select',
          '/preset/grid/cable',
          '/preset/grid/select',
          '/scene',
          '/tempo',
          '/tempo/tap',
          '/tuner',
          '/mod/bind'
        ].includes(p) ||
        /^\/am4\/(bypass|scene|preset)$/.test(p)
      )
    return false
  }

  const calls = [
    ['DELETE', '/device/cache'],
    ['DELETE', '/store/config/x'],
    ['GET', '/backups'],
    ['GET', '/blocks'],
    ['GET', '/device/detect'],
    ['GET', '/ports'],
    ['GET', '/preset'],
    ['GET', '/preset/blocks'],
    ['GET', '/preset/blocks/1/params'],
    ['GET', '/preset/grid'],
    ['GET', '/presets/1'],
    ['GET', '/scene'],
    ['GET', '/store/config/x'],
    ['GET', '/tempo'],
    ['POST', '/backup/device'],
    ['POST', '/mod/bind'],
    ['POST', '/ports/select'],
    ['POST', '/preset/backup'],
    ['POST', '/preset/blocks/1/bypass'],
    ['POST', '/preset/blocks/1/channel'],
    ['POST', '/preset/blocks/1/type'],
    ['POST', '/preset/grid/cable'],
    ['POST', '/preset/grid/select'],
    ['POST', '/preset/name'],
    ['POST', '/preset/select'],
    ['POST', '/preset/store'],
    ['POST', '/scene'],
    ['POST', '/scene/name'],
    ['POST', '/tempo'],
    ['POST', '/tempo/tap'],
    ['POST', '/tuner'],
    ['POST', '/version/1/load'],
    ['POST', '/version/1/restore'],
    ['PUT', '/preset/blocks/1/params/1'],
    ['PUT', '/preset/grid/cell'],
    ['PUT', '/store/config/x']
  ]

  for (const [m, p] of calls) {
    const mirror = forbiddenRemotely(m, p) === null
    assert.equal(
      mirror,
      hostAllows(m, p),
      `${m} ${p}: mirror says ${mirror ? 'allowed' : 'blocked'}, host says the opposite`
    )
  }
})

test('an unconfirmed account is not reported as a bad password', () => {
  // Supabase's own wording sends people off changing credentials that were
  // right all along.
  const msg = explainAuth('Email not confirmed')
  assert.ok(/confirm/i.test(msg))
  assert.ok(!/password/i.test(msg))
})

test('unrecognised auth errors pass through unchanged', () => {
  assert.equal(explainAuth('Rate limit exceeded'), 'Rate limit exceeded')
})

test('a preset backup is refused remotely, matching the host', () => {
  // Which is why scene names have to be cached: on an AM4 they only exist
  // inside the dump, and the dump cannot cross the relay.
  assert.ok(forbiddenRemotely('POST', '/preset/backup'))
  // The summary is a GET and does travel — that's the FM3's path to names.
  assert.equal(forbiddenRemotely('GET', '/presets/12/summary'), null)
})

test('a preset name is made safe to use as a filename', async () => {
  // This writes to a real folder on someone's Mac, so a name with a slash in it
  // must not become a path.
  let written = null
  const folder = {
    getFileHandle: async (file) => {
      written = file
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) }
    }
  }
  const { writePresetFile } = await import('../src/lib/localFolder.js')
  await writePresetFile(folder, 'Drop A / "Lead" *rhythm*', [1, 2, 3])
  assert.ok(!written.includes('/'))
  assert.ok(!written.includes('"'))
  assert.ok(written.endsWith('.syx'))
})

test('an empty name still produces a usable file', async () => {
  let written = null
  const folder = {
    getFileHandle: async (file) => {
      written = file
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) }
    }
  }
  const { writePresetFile } = await import('../src/lib/localFolder.js')
  await writePresetFile(folder, '   ', [1])
  assert.equal(written, 'preset.syx')
})

test('a name of dots cannot produce a hidden file', async () => {
  let written = null
  const folder = {
    getFileHandle: async (file) => {
      written = file
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) }
    }
  }
  const { writePresetFile } = await import('../src/lib/localFolder.js')
  await writePresetFile(folder, '...', [1])
  assert.ok(!written.startsWith('.'))
})

// Panel order is stored per screen and read back into whatever panels exist
// today, so it has to survive ids appearing, vanishing and repeating.
const sortIds = (order, ids) => [
  ...new Set([...order.filter((x) => ids.includes(x)), ...ids.filter((x) => !order.includes(x))])
]

test('with no saved order panels keep their natural order', () => {
  assert.deepEqual(sortIds([], ['a', 'b', 'c']), ['a', 'b', 'c'])
})

test('a saved order is applied and unknown panels follow', () => {
  assert.deepEqual(sortIds(['c', 'a'], ['a', 'b', 'c']), ['c', 'a', 'b'])
})

test('a panel that no longer exists is ignored', () => {
  // A unit without scenes shows fewer panels than the one that saved the order.
  assert.deepEqual(sortIds(['gone', 'b'], ['a', 'b']), ['b', 'a'])
})

test('a repeated id cannot render a panel twice', () => {
  // React throws on duplicate keys, and the panel would appear twice.
  const out = sortIds(['b', 'b', 'a'], ['a', 'b'])
  assert.equal(out.length, new Set(out).size)
  assert.deepEqual(out, ['b', 'a'])
})

test('dropping a panel moves it without losing any', () => {
  const drop = (sorted, dragging, target) => {
    const next = sorted.filter((x) => x !== dragging)
    next.splice(next.indexOf(target), 0, dragging)
    return next
  }
  assert.deepEqual(drop(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c'])
  assert.equal(drop(['a', 'b', 'c'], 'a', 'c').length, 3)
})

// The gig screen on a phone. Both failures here were silent: a read that timed
// out looked like a preset with no blocks, and names that couldn't travel the
// relay looked like scenes nobody had named.
console.log('\ngig over the relay')

test('a preset dump read gets longer than a scene change', () => {
  assert.ok(timeoutFor('GET', '/preset/blocks') > timeoutFor('POST', '/scene'))
})

test('the block list read is treated as slow — it dumps the preset on an AM4', () => {
  assert.equal(timeoutFor('GET', '/preset/blocks'), 45000)
  assert.equal(timeoutFor('GET', '/preset/blocks?fresh=1'), 45000)
  assert.equal(timeoutFor('GET', '/presets/97/summary'), 45000)
})

test('an ordinary write keeps the short timeout', () => {
  assert.equal(timeoutFor('POST', '/scene'), 20000)
  assert.equal(timeoutFor('PUT', '/preset/grid/cell'), 20000)
})

test('a block that looks slow but is a plain write is not given the long wait', () => {
  // The bypass toggle is the one thing that has to feel instant on stage.
  assert.equal(timeoutFor('POST', '/preset/blocks/58/bypass'), 20000)
})

test('scene names still travel to the host, which is why the phone can read them', () => {
  // GET of a stored doc is allowed; the config PUT is on the host allowlist.
  assert.equal(forbiddenRemotely('GET', '/store/config/scene-names-am4:97'), null)
  assert.equal(forbiddenRemotely('PUT', '/store/config/scene-names-am4:97'), null)
})

test('the dump those names come from still does not', () => {
  // Which is the whole reason for the host copy.
  assert.ok(forbiddenRemotely('POST', '/preset/backup'))
})

// Cached names are keyed per unit. An AM4 and an FM3 both have a slot 97 and
// they are not the same preset.
const key = (model, n) => `${model}:${n}`

test('two units cannot share one preset cache entry', () => {
  assert.notEqual(key('am4', 97), key('fm3', 97))
})

// What the gig screen shows for the block row, given how the read went.
const chainState = (state, count) =>
  state === 'failed' ? 'explain' : state === 'reading' && !count ? 'reading' : count ? 'buttons' : 'empty'

test('a failed read explains itself rather than showing nothing', () => {
  assert.equal(chainState('failed', 0), 'explain')
})

test('a preset that genuinely has no blocks says so', () => {
  assert.equal(chainState('ok', 0), 'empty')
})

test('blocks that arrived are just buttons', () => {
  assert.equal(chainState('ok', 4), 'buttons')
})

test('a refresh that fails after blocks were showing still explains itself', () => {
  // The old code cleared the row and left it looking like an empty preset.
  assert.equal(chainState('failed', 4), 'explain')
})

// Saving. Both complaints were about the button, not the write: it couldn't be
// found, and when it was found it appeared to do nothing.
console.log('\nsaving')

// What the bar offers, given where the app is running and what it's waiting on.
const saveButton = (remote, busy, queued) =>
  queued ? 'waiting' : busy ? 'working' : remote ? 'ask the Mac' : 'save'

test('a slot write is offered when the cable is on this machine', () => {
  assert.equal(saveButton(false, false, null), 'save')
})

test('a remote session saves through the Mac rather than refusing', () => {
  // ForgeFX refuses POST /preset/store over the relay — correctly, and still.
  // The request goes by the road that IS open, and the page at the Mac writes
  // it; the button says who does the writing instead of being dead.
  assert.equal(saveButton(true, false, null), 'ask the Mac')
  assert.ok(forbiddenRemotely('POST', '/preset/store'))
  // The road: config docs are the one write the host takes from a distance.
  assert.equal(forbiddenRemotely('PUT', '/store/config/fractal.pendingSave.fm3'), null)
  assert.equal(forbiddenRemotely('GET', '/store/config/fractal.saveResult.fm3'), null)
  // And the clean-up stays at the Mac, which is why the phone never deletes.
  assert.ok(forbiddenRemotely('DELETE', '/store/config/fractal.pendingSave.fm3'))
})

test('a queued save says it is waiting rather than offering to ask twice', () => {
  assert.equal(saveButton(true, false, { id: 'x', slot: 12 }), 'waiting')
})

// The bar is present whether or not the app believes anything changed.
const barShown = (status, view) => status === 'live' && view !== 'gig'

test('the save bar is there before anything is edited', () => {
  // dirty is the app's belief; a knob turned on the front panel doesn't set it,
  // and a button that comes and goes by an invisible rule can't be learned.
  assert.ok(barShown('live', 'design'))
  assert.ok(barShown('live', 'edit'))
})

test('gig keeps no slot write within reach of a mis-tap', () => {
  assert.ok(!barShown('live', 'gig'))
})

test('nothing to save to when no unit is attached', () => {
  assert.ok(!barShown('fault', 'design'))
})

// An empty slot field means the slot already loaded, so the common save needs
// nothing typed at all.
const target = (slot, loaded) => (slot === '' ? loaded : Number(slot))

test('an untouched slot field saves over the preset you are playing', () => {
  assert.equal(target('', 97), 97)
})

test('a typed slot saves a copy elsewhere', () => {
  assert.equal(target('12', 97), 12)
})

test('slot zero is a real slot, not an empty field', () => {
  // `slot || preset.number` would have sent this to 97.
  assert.equal(target('0', 97), 0)
})

console.log('\nthe relay coming and going')

test('the host can be asked whether it is there', () => {
  // The probe that replaced presence: the host joins the channel but never
  // tracks presence, so "is anyone else here?" was always answered no. A
  // relayed GET is the test instead, and it has to be one the host allows.
  assert.equal(forbiddenRemotely('GET', '/healthz'), null)
})

test('a channel whose socket closed is never handed back', async () => {
  const { canReuseChannel } = await import('../src/lib/remote.js')
  const client = { id: 'a' }
  const joined = { state: 'joined' }
  const closed = { state: 'closed' }
  assert.equal(canReuseChannel(joined, { client, chan: joined }, client), true)
  // The bug: connect returned this one, so every request went into a dead
  // socket and only reloading the page ever fixed it.
  assert.equal(canReuseChannel(closed, { client, chan: closed }, client), false)
})

test('a channel belonging to a previous sign-in is never handed back', async () => {
  const { canReuseChannel } = await import('../src/lib/remote.js')
  const old = { id: 'old' }
  const fresh = { id: 'fresh' }
  const chan = { state: 'joined' }
  assert.equal(canReuseChannel(chan, { client: old, chan }, fresh), false)
})

test('nothing to reuse is not something to reuse', async () => {
  const { canReuseChannel } = await import('../src/lib/remote.js')
  const client = { id: 'a' }
  assert.equal(canReuseChannel(null, null, client), false)
  assert.equal(canReuseChannel({ state: 'joined' }, null, client), false)
})

console.log('\nparameter matching')

const ampSchema = [
  {
    eid: 58,
    name: 'Amp 1',
    slug: 'amp',
    params: [
      { id: 3, name: 'Bass', value: 5, min: 0, max: 10 },
      { id: 12, name: 'Low Cut Frequency', value: 20, min: 10, max: 1000, log: true },
      { id: 4, name: 'Amp 1 Level', value: 0, min: -80, max: 20 }
    ],
    models: []
  }
]

test('a control named right and addressed wrong is still written', () => {
  // The FM3 run that prompted this: "Amp 1 / Low Cut Frequency: 5.5 is outside
  // 10-1000" was a Bass of 5.5 sent to the id the model believed Bass was.
  const res = validateSpec(
    { blocks: [{ eid: 58, params: [{ id: 12, name: 'Bass', value: 5.5 }] }] },
    ampSchema
  )
  assert.equal(res.changes[0].params[0].id, 3)
  assert.equal(res.changes[0].params[0].to, 5.5)
  assert.equal(res.problems.length, 0)
  assert.match(res.repairs[0], /Low Cut Frequency/)
})

test('a name that matches nothing is still a rejection', () => {
  const res = validateSpec(
    { blocks: [{ eid: 58, params: [{ id: 99, name: 'Sparkle', value: 4 }] }] },
    ampSchema
  )
  assert.equal(res.changes.length, 0)
  assert.match(res.problems[0], /no parameter 99/)
})

test('matching by name never resurrects an output level', () => {
  const res = validateSpec(
    { blocks: [{ eid: 58, params: [{ id: 3, name: 'Amp 1 Level', value: -60 }] }] },
    ampSchema
  )
  assert.equal(res.changes.length, 0)
  assert.match(res.problems[0], /yours to set/)
})

test('a name matched to the right id is not reported as a correction', () => {
  const res = validateSpec(
    { blocks: [{ eid: 58, params: [{ id: 3, name: 'Bass', value: 7 }] }] },
    ampSchema
  )
  assert.equal(res.repairs.length, 0)
  assert.equal(res.changes[0].params[0].id, 3)
})

test('a matched name is still checked against that control own range', () => {
  const res = validateSpec(
    { blocks: [{ eid: 58, params: [{ id: 12, name: 'Bass', value: 50 }] }] },
    ampSchema
  )
  assert.equal(res.changes.length, 0)
  assert.match(res.problems[0], /Bass: 50 is outside 0–10/)
})

console.log('\nslot addressing')

test('a gen-3 slot is a number, not a bank letter', async () => {
  const { slotLabel } = await import('../src/lib/slots.js')
  assert.equal(slotLabel(0, 'numeric'), '000')
  assert.equal(slotLabel(2, 'numeric'), '002')
  assert.equal(slotLabel(511, 'numeric'), '511')
})

test('the AM4 keeps its lettered banks of four', async () => {
  const { slotLabel } = await import('../src/lib/slots.js')
  assert.equal(slotLabel(0, 'bankLetter'), 'A01')
  assert.equal(slotLabel(7, 'bankLetter'), 'B04')
  assert.equal(slotLabel(103, 'bankLetter'), 'Z04')
})

test('past Z there is no letter, so it falls back to the number', async () => {
  // 512 slots lettered in fours ran off the end of the alphabet: slot 200 was
  // labelled "s1" and slot 460 "À1", addresses that name nothing.
  const { slotLabel } = await import('../src/lib/slots.js')
  assert.equal(slotLabel(200, 'bankLetter'), '200')
  assert.equal(slotLabel(460, 'bankLetter'), '460')
})

test('bank rules are drawn only where there are banks', async () => {
  const { startsBank } = await import('../src/lib/slots.js')
  assert.equal(startsBank(4, 3, 'bankLetter'), true)
  assert.equal(startsBank(5, 4, 'bankLetter'), false)
  assert.equal(startsBank(0, null, 'bankLetter'), true)
  assert.equal(startsBank(4, 3, 'numeric'), false)
})

test('a scan says how long it has left, in words', async () => {
  const { timeLeft } = await import('../src/lib/slots.js')
  assert.equal(timeLeft(400, 300), 'about 2 minutes left')
  assert.equal(timeLeft(100, 600), 'about 1 minute left')
  assert.equal(timeLeft(10, 300), 'under a minute left')
  // Nothing to say before anything has been timed.
  assert.equal(timeLeft(400, null), null)
  assert.equal(timeLeft(0, 300), null)
})

console.log('\nstructure')
const { run: structure } = await import('./structure.mjs')
structure(test)

console.log('\nthe dimensional system')
const { run: styles } = await import('./styles.mjs')
styles(test)

console.log('\ntouch')
const { run: touch } = await import('./touch.mjs')
touch(test)

console.log('\nlimits')
const { run: limits } = await import('./limits.mjs')
limits(test)

test('both file kinds are listed and told apart', async () => {
  // A .syx goes back to the unit verbatim; a design re-validates first. Load
  // treating one as the other would either corrupt or silently no-op.
  const files = [
    { kind: 'file', name: 'Drop A.syx', getFile: async () => ({ size: 3, lastModified: 2 }) },
    { kind: 'file', name: 'Lead.design.json', getFile: async () => ({ size: 9, lastModified: 5 }) },
    { kind: 'file', name: 'notes.txt', getFile: async () => ({ size: 1, lastModified: 9 }) },
    { kind: 'directory', name: 'versions' }
  ]
  const handle = { values: async function* () { for (const f of files) yield f } }
  const { listPresetFiles } = await import('../src/lib/localFolder.js')
  const out = await listPresetFiles(handle)
  assert.deepEqual(out.map((e) => [e.name, e.kind]), [['Lead', 'design'], ['Drop A', 'capture']])
})

test('a re-run of the version sync writes nothing twice', async () => {
  // Idempotence lives in the filename: the version id rides at the end, and the
  // synced-id scan reads it back.
  const { writeVersionFile, syncedVersionIds } = await import('../src/lib/localFolder.js')
  const written = []
  const dir = {
    getFileHandle: async (name) => {
      written.push(name)
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) }
    },
    values: async function* () {
      for (const name of written) yield { kind: 'file', name }
    }
  }
  await writeVersionFile(dir, { id: 'bk-abc123', capturedAt: 0, location: 5, name: 'Rig' }, new Uint8Array([1]))
  const have = await syncedVersionIds(dir)
  assert.ok(have.has('bk-abc123'))
})

test('a design file survives the round trip', async () => {
  const store = {}
  const dir = {
    getFileHandle: async (name, opts) => {
      if (!opts?.create && !(name in store)) throw new Error('not found')
      return {
        createWritable: async () => ({ write: async (t) => { store[name] = t }, close: async () => {} }),
        getFile: async () => ({ text: async () => store[name] })
      }
    }
  }
  const { writeDesignFile, readDesignFile } = await import('../src/lib/localFolder.js')
  const entry = { id: 'x', name: 'Lead / "Solo"', spec: { amp: { gain: 7 } } }
  const file = await writeDesignFile(dir, entry)
  assert.ok(file.endsWith('.design.json') && !file.includes('/'))
  const back = await readDesignFile(dir, file)
  assert.deepEqual(back.spec, entry.spec)
})

test('every block colour is real CSS', async () => {
  // A Cyrillic а slipped into the reverb hex on first writing: identical on
  // screen, invalid to CSS, and the colour just never appears — no error, no
  // clue. Colour strings must be plain ASCII hex or a var() reference.
  const { blockColor } = await import('../src/lib/blockColors.js')
  for (const slug of ['drive', 'amp', 'delay', 'reverb', 'cab', 'chorus', 'pitch', 'mystery']) {
    const { fill, ink } = blockColor(slug)
    for (const value of [fill, ink]) {
      assert.ok(
        /^#[0-9a-f]{6}$/.test(value) || /^var\(--[\w-]+\)$/.test(value),
        `${slug}: "${value}" is not valid CSS`
      )
    }
  }
})

test('display-name shapes resolve to their family', async () => {
  // Axis's category map showed which shapes actually arrive: spaces, hyphens,
  // slashes, instance numbers.
  const { blockColor } = await import('../src/lib/blockColors.js')
  assert.deepEqual(blockColor('Plex Delay'), blockColor('plex'))
  assert.deepEqual(blockColor('Ten-Tap'), blockColor('tentap'))
  assert.deepEqual(blockColor('Vol/Pan'), blockColor('volpan'))
  assert.deepEqual(blockColor('RingMod'), blockColor('ringmod'))
})

test('instance suffixes and unknowns resolve sensibly', async () => {
  const { blockColor } = await import('../src/lib/blockColors.js')
  assert.deepEqual(blockColor('delay2'), blockColor('delay'))
  assert.deepEqual(blockColor('drive1'), blockColor('drive'))
  assert.equal(blockColor('definitely-new-block').fill, 'var(--panel-hi)')
  assert.equal(blockColor(null).fill, 'var(--panel-hi)')
})

test('the chain builder places into columns the unit has', async () => {
  // The builder 1-based a 0-based API: the client adds the wire's +1 itself,
  // so placements landed one slot right and the fourth asked an AM4 for
  // column 5, which it refuses — failing the whole plan on the last block.
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/lib/actions.js', import.meta.url), 'utf8')
  assert.ok(src.includes('d.placeBlock(1, i, block.page'), 'the builder is 1-basing columns again')
})

console.log('\nadd a block')

test('the free cell is on the chain row, judged against every block', async () => {
  const { firstFreeCell } = await import('../src/lib/actions.js')
  // Input and output count as occupants — the raw-versus-editable lesson,
  // pointed the other way.
  const blocks = [
    { slug: 'input', row: 0, col: 0 },
    { slug: 'drive', row: 0, col: 1 },
    { slug: 'amp', row: 0, col: 2 }
  ]
  assert.deepEqual(firstFreeCell(blocks, 1, 4), { row: 0, col: 3 })
  // A full row says so rather than inventing a cell.
  assert.equal(firstFreeCell([...blocks, { slug: 'delay', row: 0, col: 3 }], 1, 4), null)
  // An empty grid starts at the top left.
  assert.deepEqual(firstFreeCell([], 1, 4), { row: 0, col: 0 })
})

test('placeable names resolve however the player said them', async () => {
  const { resolvePlaceable } = await import('../src/lib/actions.js')
  const palette = [
    { slug: 'reverb', name: 'Reverb', page: 66 },
    { slug: 'delay', name: 'Delay', page: 70 },
    { slug: 'volpan', name: 'Vol/Pan', page: 102 }
  ]
  assert.equal(resolvePlaceable(palette, 'reverb').page, 66)
  assert.equal(resolvePlaceable(palette, 'Reverb ').page, 66)
  assert.equal(resolvePlaceable(palette, 'vol/pan').page, 102)
  assert.equal(resolvePlaceable(palette, 'rev').page, 66)
  assert.equal(resolvePlaceable(palette, 'chorus'), null)
})

console.log('\nxy pad')

test('the write gate holds against a fast finger', async () => {
  const { gateWrite } = await import('../src/lib/xy.js')
  // First touch always writes.
  assert.ok(gateWrite({ now: 0, lastAt: 0, lastFrac: null, frac: 0.5, interval: 60 }))
  // A twitch below the epsilon never writes, no matter how much time passed.
  assert.ok(!gateWrite({ now: 9999, lastAt: 0, lastFrac: 0.5, frac: 0.502, interval: 60 }))
  // Real movement too soon after the last write waits.
  assert.ok(!gateWrite({ now: 30, lastAt: 0, lastFrac: 0.5, frac: 0.7, interval: 60 }))
  // Real movement after the interval goes through.
  assert.ok(gateWrite({ now: 61, lastAt: 0, lastFrac: 0.5, frac: 0.7, interval: 60 }))
})

test('pointer positions clamp to the pad and up means more', async () => {
  const { padFraction } = await import('../src/lib/xy.js')
  const rect = { left: 100, top: 100, width: 200, height: 200 }
  assert.deepEqual(padFraction(200, 200, rect), { x: 0.5, y: 0.5 })
  // Top edge of the pad is full value, not zero.
  assert.deepEqual(padFraction(100, 100, rect), { x: 0, y: 1 })
  // A drag that leaves the pad pins to the edge instead of overshooting.
  assert.deepEqual(padFraction(999, -50, rect), { x: 1, y: 1 })
  assert.deepEqual(padFraction(-50, 999, rect), { x: 0, y: 0 })
})

console.log('\ndevice state')

/*
 * The store is a pure module on purpose — it takes its device functions rather
 * than importing them — so the whole write path is exercisable here, with no
 * hardware, no browser and no mock. These are the cases that cost real
 * evenings: an optimistic write that never rolls back, and an echo that fights
 * the write that caused it.
 */
const ds = await import('../src/lib/deviceState.js')

/** A fake unit: records what it was told, and can be made to refuse. */
function fakeUnit(overrides = {}) {
  const calls = []
  const record = (name) => (...args) => {
    calls.push([name, ...args])
    return Promise.resolve({ ok: true })
  }
  return {
    calls,
    setScene: record('setScene'),
    setTempo: record('setTempo'),
    setBypass: record('setBypass'),
    setTuner: record('setTuner'),
    presetBlocks: () => Promise.resolve([]),
    getScene: () => Promise.resolve({ index: 0, names: [] }),
    ...overrides
  }
}

const fresh = (unit) => {
  ds.reset()
  ds.attachDriver(unit)
  return unit
}

test('a snapshot that did not change is the same snapshot', () => {
  fresh(fakeUnit())
  const before = ds.getSnapshot()
  assert.equal(ds.set({ bpm: null }), false, 'setting a field to what it already is reported a change')
  assert.equal(ds.getSnapshot(), before, 'an unchanged store handed back a new object')
  assert.equal(ds.set({ bpm: 120 }), true)
  assert.notEqual(ds.getSnapshot(), before)
})

test('subscribers hear a real change and only a real change', () => {
  fresh(fakeUnit())
  let heard = 0
  const off = ds.subscribe(() => heard++)
  ds.set({ bpm: 140 })
  ds.set({ bpm: 140 })
  assert.equal(heard, 1, 'an idempotent set woke every listener')
  off()
  ds.set({ bpm: 90 })
  assert.equal(heard, 1, 'a listener kept being called after unsubscribing')
})

test('a scene write shows immediately and reaches the device', async () => {
  const unit = fresh(fakeUnit())
  const done = ds.writeScene(3)
  assert.equal(ds.getSnapshot().sceneIndex, 3, 'the scene did not move until the device answered')
  await done
  assert.deepEqual(unit.calls, [['setScene', 3]])
})

test('a refused write rolls back to what was on screen before it', async () => {
  fresh(fakeUnit({ setScene: () => Promise.reject(new Error('port busy')) }))
  ds.set({ sceneIndex: 2 })
  await assert.rejects(() => ds.writeScene(5), /port busy/)
  assert.equal(ds.getSnapshot().sceneIndex, 2, 'a refusal left the optimistic value on screen')
})

test('a refused bypass restores the whole chain, not a rebuilt one', async () => {
  fresh(fakeUnit({ setBypass: () => Promise.reject(new Error('nope')) }))
  const chain = [
    { effectId: 1, bypassed: false },
    { effectId: 2, bypassed: false }
  ]
  ds.set({ blocks: chain })
  await assert.rejects(() => ds.writeBypass(1, true), /nope/)
  assert.equal(ds.getSnapshot().blocks, chain, 'the chain came back as a copy, not the array it was')
})

test("the device's echo of a local write does not fight it", () => {
  fresh(fakeUnit())
  ds.markLocal('sceneIndex', 4)
  ds.set({ sceneIndex: 4 })
  // The unit reports the scene it just changed to. Acting on it is harmless
  // here, but the same echo arriving for a value already superseded is what
  // makes a button flicker back through the old scene.
  ds.handleEvent({ type: 'scene', index: 4 })
  assert.equal(ds.getSnapshot().sceneIndex, 4)
})

test('a footswitch press is followed, an echo is not', () => {
  fresh(fakeUnit())
  ds.markLocal('sceneIndex', 1)
  ds.set({ sceneIndex: 1 })
  // Someone moves on to scene 6 in the app before the echo for 1 arrives.
  ds.set({ sceneIndex: 6 })
  ds.handleEvent({ type: 'scene', index: 1 })
  assert.equal(ds.getSnapshot().sceneIndex, 6, 'a stale echo dragged the screen back')
  // A genuine press on the floor is a different fact and must be followed.
  ds.handleEvent({ type: 'scene', index: 2 })
  assert.equal(ds.getSnapshot().sceneIndex, 2, 'a real footswitch press was ignored')
})

test('the guard is spent by one echo and expires on its own', () => {
  fresh(fakeUnit())
  ds.markLocal('sceneIndex', 7, 1000)
  assert.equal(ds.isEcho('sceneIndex', 7, 1100), true)
  assert.equal(ds.isEcho('sceneIndex', 7, 1150), false, 'one write silenced two echoes')

  // An echo that never arrives must not leave the guard armed against a press
  // a minute later.
  ds.markLocal('sceneIndex', 8, 2000)
  assert.equal(ds.isEcho('sceneIndex', 8, 2000 + ds.ECHO_MS + 1), false)
})

test('a chain read that fails says so and keeps the last chain', async () => {
  fresh(fakeUnit({ presetBlocks: () => Promise.reject(new Error('timeout')) }))
  const chain = [{ effectId: 1, slug: 'amp' }]
  ds.set({ blocks: chain })
  assert.equal(await ds.refreshBlocks(), null, 'a failed read reported success')
  assert.equal(ds.getSnapshot().blocks, chain, 'a failed read emptied the chain on screen')
})

test('a reading with the tuner off is not a reading', () => {
  fresh(fakeUnit())
  ds.handleEvent({ type: 'tuner', note: 'E', cents: 3 })
  assert.equal(ds.getSnapshot().tuning, null, 'a reading landed with no tuner open')
  ds.set({ tunerOn: true })
  ds.handleEvent({ type: 'tuner', note: 'E', cents: 3 })
  assert.equal(ds.getSnapshot().tuning?.note, 'E')
})

test('a tuner the unit cannot run turns itself back off', async () => {
  fresh(fakeUnit({ setTuner: () => Promise.resolve({ ok: false }) }))
  await ds.writeTuner(true)
  assert.equal(ds.getSnapshot().tunerOn, false, 'a refused tuner stayed lit, waiting forever')
})

test('there is one event subscription, however many times it is asked for', () => {
  let bound = 0
  let unbound = 0
  fresh(
    fakeUnit({
      subscribeEvents: () => {
        bound++
        return () => unbound++
      }
    })
  )
  ds.listen()
  ds.listen()
  ds.listen()
  assert.equal(bound, 1, 'the store subscribed to the event stream more than once')
  assert.equal(ds.isListening(), true)
  ds.stopListening()
  assert.equal(unbound, 1)
  assert.equal(ds.isListening(), false)
})

ds.reset()

/* ------------------------------------------------------------------
   Taste — what the generator is told about the player's own history.

   This is the one feature whose failure mode is quiet. A wrong figure here
   does not throw; it just steers every future generation slightly wrong, and
   nobody can tell that from a tone they merely did not love.
   ------------------------------------------------------------------ */

/** A kept preset, shaped as history.js and cloudPresets.js both produce them. */
const keptPreset = (name, description, blocks, at = Date.now()) => ({
  id: name,
  at,
  name,
  description,
  spec: { blocks },
  blockNames: blocks.map((b) => b.blockName).filter(Boolean)
})

const amp = (typeName, drive, extra = {}) => ({
  eid: 1,
  blockName: 'Amp 1',
  typeName,
  params: [
    { id: 1, name: 'Drive', value: drive },
    ...Object.entries(extra).map(([name, value], i) => ({ id: i + 2, name, value }))
  ]
})

test('a profile needs enough history to mean anything', () => {
  const three = [1, 2, 3].map((n) => keptPreset(`P${n}`, 'heavy rhythm', [amp('Brit Brown', 8)]))
  assert.equal(
    taste.profileFrom(three),
    null,
    'three presets produced a confident profile — a taste inferred from three is an accident, and it steers every generation after it'
  )
  assert.notEqual(taste.profileFrom([...three, keptPreset('P4', 'heavy lead', [amp('Brit Brown', 8)])]), null)
})

test('the typical value is the middle one, so a single outlier cannot move it', () => {
  const entries = [2, 7, 7, 8, 90].map((d, i) => keptPreset(`P${i}`, 'rhythm tone', [amp('Brit Brown', d)]))
  const drive = taste.profileFrom(entries).controls.find((c) => c.name === 'Drive')
  assert.equal(drive.typical, 7, `the mean would have said ${(2 + 7 + 7 + 8 + 90) / 5}`)
  assert.equal(drive.low, 2)
  assert.equal(drive.high, 90)
  assert.equal(drive.n, 5)
})

test('a preset kept in both stores is one preset', () => {
  /*
   * Copying this browser's presets to the account is a copy, not a move, so
   * anyone who used the Phase 6 migration holds every preset twice. Counted
   * twice, four real presets clear a threshold that asks for four.
   */
  const local = [1, 2].map((n) => keptPreset(`P${n}`, 'heavy rhythm', [amp('Brit Brown', 8)]))
  const cloud = local.map((e) => ({ ...e, id: `cloud-${e.id}`, at: e.at + 4000, where: 'cloud' }))
  assert.equal(
    taste.profileFrom([...local, ...cloud]),
    null,
    'two presets counted from both stores passed for four'
  )
})

test('a control set once is not a preference', () => {
  const entries = [1, 2, 3, 4].map((n) =>
    keptPreset(`P${n}`, 'rhythm', [amp('Brit Brown', 8, n === 1 ? { Presence: 6 } : {})])
  )
  const names = taste.profileFrom(entries).controls.map((c) => c.name)
  assert.ok(names.includes('Drive'), 'Drive was set in all four and should count')
  assert.ok(!names.includes('Presence'), 'a control touched in one preset was reported as a tendency')
})

test('the words counted are the ones that distinguish a player', () => {
  const entries = [1, 2, 3, 4].map((n) =>
    keptPreset(`P${n}`, 'I want a tight modern tone', [amp('Brit Brown', 8)])
  )
  const words = taste.profileFrom(entries).words.map((w) => w.name)
  assert.ok(words.includes('tight') && words.includes('modern'), `got ${words.join(', ')}`)
  for (const dull of ['want', 'tone', 'the']) {
    assert.ok(!words.includes(dull), `"${dull}" was counted as taste — every request contains it`)
  }
})

test('the profile sent to the model says the request outranks it', () => {
  const entries = [1, 2, 3, 4].map((n) => keptPreset(`P${n}`, 'heavy rhythm', [amp('Brit Brown', 8)]))
  const prose = taste.describeProfile(taste.profileFrom(entries))
  assert.match(prose, /Brit Brown/)
  assert.match(prose, /around 8/)
  /*
   * The failure this guards against is the profile behaving as an instruction:
   * a player asking for a clean tone and being handed their usual gain because
   * "they always use 8". Without this sentence that is exactly what a model
   * does with a confident list of preferences.
   */
  assert.match(
    prose,
    /the request wins/i,
    'nothing tells the model that an explicit request beats the profile'
  )
})

test('nothing is described when there is nothing to describe', () => {
  assert.equal(taste.describeProfile(null), null)
  assert.deepEqual(taste.suggestionsFrom(null), [])
  assert.match(taste.summariseProfile(null), /once you/i)
})

test('every suggestion is something the player actually did', () => {
  const entries = [
    keptPreset('Drop A Rhythm', 'tight modern metal rhythm in drop A', [amp('Brit Brown', 8)], 4),
    keptPreset('Night Lead', 'singing lead with a long delay', [amp('Brit Brown', 8)], 3),
    keptPreset('P3', 'heavy rhythm', [amp('Brit Brown', 8)], 2),
    keptPreset('P4', 'heavy rhythm', [amp('Brit Brown', 8)], 1)
  ]
  const profile = taste.profileFrom(entries)
  const lines = taste.suggestionsFrom(profile)
  assert.ok(lines.length, 'no suggestions came out of four presets')
  const said = entries.map((e) => e.description)
  const names = entries.map((e) => e.name)
  for (const line of lines) {
    const grounded = said.includes(line) || names.some((n) => line.includes(n))
    assert.ok(grounded, `"${line}" names nothing the player made — an invented suggestion is a bug wearing a friendly face`)
  }
  // A library that sits at drive 8 is offered the other direction, not more.
  assert.ok(
    lines.some((l) => /cleaner/.test(l)),
    `a high-gain library was not offered a cleaner starting point: ${lines.join(' | ')}`
  )
})

test('a low-gain library is offered the other direction', () => {
  const entries = [1, 2, 3, 4].map((n) => keptPreset(`Clean ${n}`, 'warm clean', [amp('Deluxe Verb', 2)]))
  const lines = taste.suggestionsFrom(taste.profileFrom(entries))
  assert.ok(lines.some((l) => /dirtier/.test(l)), lines.join(' | '))
})

await settle()
/*
 * The tally has to say when it is red.
 *
 * It used to print "141 passed" and nothing else, with the FAIL lines scrolled
 * off above it — so the last line of a failing run read exactly like the last
 * line of a passing one. The exit code was right the whole time; the summary
 * was the part a person actually looks at.
 */
console.log(
  process.exitCode ? `\n${passed} passed, ${failed} FAILED\n` : `\n${passed} passed\n`
)
