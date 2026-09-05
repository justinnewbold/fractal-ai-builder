/**
 * Tests for the conversion and validation logic.
 *
 * Every case here comes from a real failure. The write path produced presets
 * that reported success and were silently wrong for an entire evening, and none
 * of it was reproducible without hardware. Now it is.
 */
import assert from 'node:assert/strict'
import { toNormalized, fromNormalized } from '../src/lib/scale.js'
import { isForbiddenParam, isLevelParam, isSilencingParam, levelLimits } from '../src/lib/guardrails.js'
import { validateSpec, countWrites, countSceneWrites } from '../src/lib/validate.js'
import { preferredEncoding, rememberEncoding, disambiguate } from '../src/lib/encoding.js'
import { forbiddenRemotely, explainAuth, timeoutFor } from '../src/lib/remote.js'
import * as taste from '../src/lib/taste.js'
import * as link from '../src/lib/link.js'
import * as corrections from '../src/lib/corrections.js'
import * as slots from '../src/lib/slots.js'
import * as names from '../src/lib/presetName.js'
import * as hold from '../src/lib/longPress.js'
import { readFileSync as readSrc } from 'node:fs'
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

test('keeps the controls that can silence a preset out of the quick knob list', () => {
  for (const n of ['Amp1 Level', 'Level', 'Out Level', 'Balance', 'Pan L'])
    assert.ok(isSilencingParam(n), n)
})

test('allows real tone controls', () => {
  for (const n of ['Gain 1', 'Bass 1', 'Master Volume', 'Boost Level', 'Input Level', 'Mix'])
    assert.ok(!isSilencingParam(n), n)
})

test('balance and routing are never the AI to set; a level is', () => {
  for (const n of ['Balance', 'Pan L', 'Output Mode', 'Bypass Mode'])
    assert.ok(isForbiddenParam(n), n)
  for (const n of ['Amp1 Level', 'Level', 'Out Level']) {
    assert.ok(!isForbiddenParam(n), `${n} is refused outright`)
    assert.ok(isLevelParam(n), n)
  }
  // Named a level, but not one: these move a tone, not the output.
  for (const n of ['Boost Level', 'Input Level']) assert.ok(!isLevelParam(n), n)
})

test('a level window is a nudge from where it sits, never near the floor', () => {
  /*
   * The two ends have different jobs. The ceiling keeps a change to a nudge —
   * a lead scene louder than the rhythm one, not a new gain structure. The
   * floor is the one that matters: a preset can be musically perfect and
   * silent, and that failure looks identical to a good one until you play it.
   */
  const amp = levelLimits({ name: 'Amp 1 Level', value: 0, min: -80, max: 20 })
  assert.deepEqual(amp, { floor: -15, ceiling: 15 })

  const drive = levelLimits({ name: 'Drive Level', value: 5, min: 0, max: 10 })
  assert.deepEqual(drive, { floor: 3.5, ceiling: 6.5 })

  /*
   * Sitting below the floor already — the player's own doing. The window is
   * still the bottom fifth upward, so the only move offered is a raise. The
   * app never drags a level back up on its own; it just will not go down.
   */
  const low = levelLimits({ name: 'Amp 1 Level', value: -70, min: -80, max: 20 })
  assert.deepEqual(low, { floor: -60, ceiling: -55 })

  assert.equal(levelLimits({ name: 'Bass', value: 5, min: 0, max: 10 }), null)
  assert.equal(levelLimits({ name: 'Amp 1 Level', value: 0 }), null, 'no range, no window')
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

test('a phone that cannot reach the Mac is told the likely reason', async () => {
  /*
   * The address in the menu works from the Mac and fails from a phone, and
   * nothing said why. macOS asks separately about connections arriving from
   * other machines, and until that is allowed the server is listening at a
   * door nobody can knock on.
   *
   * Best effort on purpose: it adds a line to a menu, so anything unclear says
   * nothing. An app that cries wolf about a firewall is worse than a quiet one.
   */
  const say = (out) => () => out
  assert.deepEqual(
    host.readFirewall({ run: say('Firewall is disabled. (State = 0)') }),
    { known: true, on: false, blocked: false }
  )

  // On, and this app explicitly allowed through: nothing to report.
  const allowed = host.readFirewall({
    appPath: '/Applications/Fractal AI Builder.app',
    run: (_cmd, args) =>
      args[0] === '--getglobalstate'
        ? 'Firewall is enabled. (State = 1)'
        : 'ALF: Fractal AI Builder is set to allow incoming connections'
  })
  assert.deepEqual(allowed, { known: true, on: true, blocked: false })

  // On and blocking: the case worth a line in the menu.
  const blocked = host.readFirewall({
    appPath: '/Applications/Fractal AI Builder.app',
    run: (_cmd, args) =>
      args[0] === '--getglobalstate'
        ? 'Firewall is enabled. (State = 1)'
        : 'ALF: Fractal AI Builder is set to block all incoming connections'
  })
  assert.equal(blocked.blocked, true)

  // Anything it cannot read is not guessed at.
  assert.deepEqual(host.readFirewall({}), { known: false }, 'it guesses when it cannot run the tool')
  assert.deepEqual(
    host.readFirewall({
      run: () => {
        throw new Error('no such tool')
      }
    }),
    { known: false },
    'a missing tool is reported as a firewall answer'
  )
  assert.deepEqual(host.readFirewall({ run: say('something unexpected') }), { known: false })
})

test('the window waits for the server to answer, rather than racing it', async () => {
  /*
   * Spawning is not starting. Fastify listens a second or two after the
   * process exists, and a window opened into that gap gets a refused
   * connection and shows nothing at all — for ever, because a page that failed
   * to load is not retried.
   *
   * That is what the first genuinely working install did: a blank window, no
   * error, and an app that had started correctly. It had looked fine before
   * only because a ForgeFX someone else had running answered instantly.
   */
  let asked = 0
  const up = await host.waitForServer({
    sleep: async () => {},
    fetch: async () => {
      asked += 1
      if (asked < 4) throw new Error('connection refused')
      return { ok: true }
    }
  })
  assert.equal(up, true)
  assert.equal(asked, 4, 'it gave up before the server had a chance to wake')

  // And it does not wait for ever.
  const never = await host.waitForServer({
    attempts: 3,
    sleep: async () => {},
    fetch: async () => {
      throw new Error('connection refused')
    }
  })
  assert.equal(never, false, 'a server that never answers would hang the launch')
})

test('the app refuses to serve from a port something else already holds', async () => {
  /*
   * The first person to run this app got a bare 404 in the window, and the
   * cause was ForgeFX being helpful: it catches EADDRINUSE and re-listens on a
   * port the OS picks. Started by hand that is kind. Started by an app it is a
   * trap, because the app still opens a window on the port it asked for — and
   * a ForgeFX the person already had running answered it, knowing nothing
   * about serving the page.
   *
   * Two of them must not both hold the serial port either, so the launcher
   * asks before it starts anything, and distinguishes a ForgeFX from anything
   * else because the two need different sentences.
   */
  const free = await host.whoHasPort({ connect: (_p, done) => done(false) })
  assert.deepEqual(free, { free: true })

  const theirs = await host.whoHasPort({
    connect: (_p, done) => done(true),
    fetch: async () => ({ ok: true })
  })
  assert.deepEqual(theirs, { free: false, forgefx: true })

  const stranger = await host.whoHasPort({
    connect: (_p, done) => done(true),
    fetch: async () => {
      throw new Error('connection refused')
    }
  })
  assert.deepEqual(stranger, { free: false, forgefx: false })

  assert.match(host.PORT_TAKEN(5056), /already running on this Mac, on port 5056/)
  assert.match(host.PORT_TAKEN(), /serial port/, 'the reason two cannot share is not explained')
})

test('quitting always finishes, and never leaves the server holding the port', async () => {
  /*
   * Reported from a real Mac: "after closing it, it won't let you reopen it.
   * You have to force close then restart."
   *
   * Two halves of that are here. The quit handler cancelled the quit, awaited
   * the mDNS teardown and then asked to quit again — so anything thrown in
   * between left an app that would not close. And the server was sent SIGINT
   * and abandoned, so a child that ignores it outlives the app still holding
   * port 5056, and the next launch finds a ForgeFX it did not start, says so,
   * and quits.
   */
  const sleep = async () => {}

  // An advert that throws on the way down must not stop anything.
  const angry = await host.shutdown({
    advert: {
      stop: async () => {
        throw new Error('the network went away')
      }
    }
  })
  assert.equal(angry.advert, 'failed', 'a thrown teardown was not contained')

  // A server that goes on SIGINT is left alone.
  const signals = []
  let running = true
  const polite = await host.shutdown({
    server: {},
    kill: (_p, sig) => {
      signals.push(sig)
      running = false
    },
    alive: () => running,
    sleep
  })
  assert.deepEqual(signals, ['SIGINT'])
  assert.equal(polite.server, 'stopped')

  // One that ignores it is killed, so the port is free for the next launch.
  const stubborn = []
  const killed = await host.shutdown({
    server: {},
    kill: (_p, sig) => stubborn.push(sig),
    alive: () => true,
    sleep,
    grace: 300,
    step: 100
  })
  assert.deepEqual(stubborn, ['SIGINT', 'SIGKILL'], 'a server that ignores SIGINT is left running')
  assert.equal(killed.server, 'killed')

  // A server that is already gone is not signalled at all.
  const dead = []
  const gone = await host.shutdown({
    server: {},
    kill: (_p, sig) => dead.push(sig),
    alive: () => false,
    sleep
  })
  assert.deepEqual(dead, [])
  assert.equal(gone.server, 'already gone')

  // Nothing to do is a normal answer, not a throw.
  assert.deepEqual(await host.shutdown(), { advert: 'none', server: 'none' })
})

test('closing the window is not the end of the app', () => {
  /*
   * A menu-bar app has no dock icon, so closing its window leaves nothing on
   * screen. macOS does not start a second copy when the app is clicked again;
   * it activates the running one and sends `activate`. With nothing listening
   * for that, the click did nothing and the app looked dead.
   */
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  assert.match(main, /app\.on\('activate', \(\) => \{\s*\n\s*if \(where\) openWindow\(\)/, 'clicking the app again opens nothing')
  assert.match(main, /tray\.on\('click', openWindow\)/, 'clicking the menu-bar icon opens nothing')
  // And the quit path no longer cancels a quit it might never re-ask for.
  assert.match(main, /let quitting = false/, 'the quit handler can cancel its own second quit again')
  assert.match(main, /shutdown\(\{ server, advert \}\)/, 'quitting does not go through the tested shutdown')
  assert.ok(!/await advert\.stop\(\)/.test(main), 'the un-caught teardown that could block a quit is back')
})

test('an installed app uses the server it shipped with', () => {
  /*
   * The packaged app hands findForgeFX the copy inside its own bundle. That has
   * to beat the developer locations, or an app installed on a machine that also
   * has a checkout would run the checkout — which is the kind of thing that
   * works on the machine it was built on and nowhere else.
   *
   * FORGEFX_PATH still wins over both: it is somebody deliberately saying where.
   */
  const exists = () => true
  const vendored = '/Applications/Fractal AI Builder.app/Contents/Resources/vendor/forgefx'
  assert.equal(host.findForgeFX({ env: { HOME: '/Users/x' }, exists, extra: [vendored] }), vendored)
  assert.equal(
    host.findForgeFX({ env: { HOME: '/Users/x', FORGEFX_PATH: '/opt/ff' }, exists, extra: [vendored] }),
    '/opt/ff',
    'pointing FORGEFX_PATH at a checkout no longer overrides the bundled copy'
  )
  // And with nothing bundled, the old behaviour is untouched.
  assert.equal(host.findForgeFX({ env: { HOME: '/Users/x' }, exists }), '/Users/x/src/forgefx')
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

test('ForgeFX is started already able to host a phone', async () => {
  /*
   * The three account variables used to be a `.env` edit on the Mac — the one
   * step that stopped anyone who was not a developer. Set by the launcher,
   * every launch, they are simply true. An operator's own values still win.
   */
  const { DEFAULT_PROJECT } = await import('../desktop/lib/project.mjs')
  const env = host.serverEnv({ env: { PATH: '/bin' }, port: 5056, dist: '/app/dist' })
  assert.equal(env.AXIS_CLOUD, '1', 'ForgeFX will not host a phone without this')
  assert.equal(env.SUPABASE_URL, DEFAULT_PROJECT.url)
  assert.equal(env.SUPABASE_ANON_KEY, DEFAULT_PROJECT.anonKey)

  const own = host.serverEnv({
    env: { SUPABASE_URL: 'https://mine.supabase.co', SUPABASE_ANON_KEY: 'k', AXIS_CLOUD: '0' },
    port: 5056,
    dist: '/d'
  })
  assert.equal(own.SUPABASE_URL, 'https://mine.supabase.co', "an operator's own project was overwritten")
  assert.equal(own.SUPABASE_ANON_KEY, 'k')
  assert.equal(own.AXIS_CLOUD, '0', 'an operator turning the cloud off was overruled')
})

test('the packaged app starts a device server, not a second copy of itself', () => {
  /*
   * `process.execPath` in a packaged Electron app is the Electron binary, so
   * spawning it with a script launches the app again rather than running the
   * script. The whole of the fix is one variable, and the failure it prevents
   * is the app opening perfectly and never finding the unit — which reads like
   * a cable problem and is not one.
   *
   * The terminal launcher is already Node and must not set it: Node exits on
   * an unknown flag it does not have, and more to the point it would be a lie.
   */
  const asNode = host.serverEnv({ env: {}, port: 5056, dist: '/d', asNode: true })
  assert.equal(asNode.ELECTRON_RUN_AS_NODE, '1')
  const plain = host.serverEnv({ env: {}, port: 5056, dist: '/d' })
  assert.equal(plain.ELECTRON_RUN_AS_NODE, undefined, 'the terminal launcher claims to be Electron')
})

test('the web app and the launchers name the same project', async () => {
  // Two copies of a URL and a key drift; the phone then signs into one
  // project and the Mac hosts on another, and neither ever hears the other.
  const { DEFAULT_PROJECT } = await import('../desktop/lib/project.mjs')
  const remote = await import('../src/lib/remote.js')
  assert.equal(remote.DEFAULT_PROJECT, DEFAULT_PROJECT, 'remote.js carries its own copy of the project again')
})

test('a hostname reads like a name', () => {
  assert.equal(host.prettyHostname('Justins-MacBook-Pro.local'), 'Justins MacBook Pro')
  assert.equal(host.prettyHostname('studio_mac'), 'studio mac')
  assert.equal(host.prettyHostname(''), 'your Mac')
})

/**
 * A ForgeFX to arm: answers the routes armHost calls, records what was asked,
 * and can be told to be slow to start, signed out, already on, or refusing.
 */
function fakeForgeFX({ healthzFails = 0, cloud = { enabled: true, user: { email: 'j@x.com' } }, enabled = false, doc = null, enableFails = 0 } = {}) {
  const calls = []
  let health = 0
  let enables = 0
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    const method = init.method || 'GET'
    calls.push(`${method} ${path}${init.body ? ' ' + init.body : ''}`)
    if (path === '/healthz') return health++ < healthzFails ? reply(503, {}) : reply(200, { ok: true })
    if (path === '/store/config/host.name' && method === 'PUT') return reply(200, {})
    if (path === '/cloud/status') return reply(200, cloud)
    if (path === '/remote/status') return reply(200, { enabled, connected: enabled, userId: 'u' })
    if (path === '/store/config/remote.host') return doc ? reply(200, { data: doc }) : reply(404, { error: 'not found' })
    if (path === '/remote/enable') {
      if (enables++ < enableFails) return reply(200, { enabled: true, connected: false, error: 'realtime TIMED_OUT' })
      return reply(200, { enabled: true, connected: true, userId: 'u' })
    }
    return reply(404, {})
  }
  return { fetch, calls }
}
const arm = (unit, extra = {}) =>
  host.armHost({ port: 5056, fetch: unit.fetch, hostname: 'Studio Mac', sleep: async () => {}, ...extra })

test('the launcher turns the phone remote on once the server is up', async () => {
  const unit = fakeForgeFX({ healthzFails: 2 })
  const result = await arm(unit)
  assert.deepEqual(result, { on: true, email: 'j@x.com' })
  assert.deepEqual(unit.calls, [
    'GET /healthz',
    'GET /healthz',
    'GET /healthz',
    'PUT /store/config/host.name {"data":{"name":"Studio Mac"},"origin":"fractal"}',
    'GET /cloud/status',
    'GET /remote/status',
    'GET /store/config/remote.host',
    'POST /remote/enable {"on":true}'
  ])
})

test('a switch turned off on purpose stays off', async () => {
  const unit = fakeForgeFX({ doc: { wanted: false, at: 1 } })
  const result = await arm(unit)
  assert.equal(result.on, false)
  assert.equal(result.reason, 'turned-off')
  assert.ok(!unit.calls.some((c) => c.startsWith('POST /remote/enable')), 'it overruled a person who turned it off')
})

test('nobody signed in means nothing to turn on, said plainly', async () => {
  const lines = []
  const unit = fakeForgeFX({ cloud: { enabled: true, user: null } })
  const result = await arm(unit, { log: (l) => lines.push(l) })
  assert.equal(result.reason, 'signed-out')
  assert.ok(!unit.calls.some((c) => c.startsWith('POST')), 'it tried to enable with nobody signed in')
  assert.match(lines.join('\n'), /sign in once/i)
})

test('already on is left alone', async () => {
  const unit = fakeForgeFX({ enabled: true })
  const result = await arm(unit)
  assert.equal(result.on, true)
  assert.ok(!unit.calls.some((c) => c.startsWith('POST')), 'it re-enabled a host that was already on, which drops the live channel')
})

test('a slow account service gets a few tries', async () => {
  const unit = fakeForgeFX({ enableFails: 2 })
  const result = await arm(unit)
  assert.equal(result.on, true)
  assert.equal(unit.calls.filter((c) => c.startsWith('POST /remote/enable')).length, 3)
})

test('a server that never comes up does not take the launcher with it', async () => {
  const unit = fakeForgeFX({ healthzFails: 999 })
  const result = await arm(unit, { attempts: 3 })
  assert.equal(result.reason, 'no-server')
  assert.equal(unit.calls.length, 3)
})

test('the name is written even when there is nobody to host for', async () => {
  // The phone shows this name; a Mac that is signed out today may be signed
  // in tomorrow, and the name should already be there.
  const unit = fakeForgeFX({ cloud: { enabled: true, user: null } })
  await arm(unit)
  assert.ok(unit.calls.some((c) => c.startsWith('PUT /store/config/host.name')))
})

test('publishing without mDNS available still gives a usable stop', async () => {
  // The desktop app treats bonjour as optional — without it the IP still
  // works and only the .local name is lost, so this must not throw.
  const ad = host.publish(null, { port: 5056 })
  await ad.stop()
})

console.log('\nkeeping the Mac app up to date')

const updates = await import('../desktop/lib/updates.mjs')

/** An updater that records what it was told and lets a test fire its events. */
function fakeUpdater() {
  const handlers = new Map()
  return {
    handlers,
    checked: 0,
    on(event, fn) {
      handlers.set(event, fn)
    },
    emit(event, payload) {
      handlers.get(event)?.(payload)
    },
    async checkForUpdates() {
      this.checked += 1
    }
  }
}

test('the update installs when you quit, and never before', () => {
  /*
   * The rule the whole feature is shaped around. This runs on a machine with a
   * guitar plugged into it, and the moment a restart is worst is exactly the
   * moment someone is using it — so it downloads quietly and swaps itself in
   * when the person quits, which they do when they are finished by definition.
   */
  const u = fakeUpdater()
  updates.wireUpdates({ updater: u, onState: () => {} })
  assert.equal(u.autoInstallOnAppQuit, true, 'the download would sit there forever')
  assert.equal(u.autoDownload, true, 'the update waits on a decision nobody was offered')
})

test('the menu follows the download', async () => {
  const seen = []
  const u = fakeUpdater()
  const { check } = updates.wireUpdates({ updater: u, onState: (s) => seen.push(s) })

  await check()
  assert.equal(u.checked, 1)

  u.emit('checking-for-update')
  u.emit('update-available', { version: '7.29.0' })
  u.emit('download-progress', { percent: 41.6 })
  u.emit('update-downloaded', { version: '7.29.0' })

  assert.deepEqual(
    seen.map((s) => s.kind),
    ['checking', 'found', 'downloading', 'ready']
  )
  assert.equal(seen[2].percent, 42, 'a percentage nobody asked for is at least a whole number')
  assert.match(updates.updateLine(seen[3]), /installs when you quit/i)
  assert.match(updates.updateLine(seen[3]), /7\.29\.0/)
})

test('a failed check is a line, not a problem', () => {
  /*
   * The network was down, or GitHub was slow. The app still serves the unit,
   * which is the whole job — so this is never a dialog and never throws.
   */
  const seen = []
  const u = fakeUpdater()
  updates.wireUpdates({ updater: u, onState: (s) => seen.push(s) })
  u.emit('error', new Error('getaddrinfo ENOTFOUND'))
  assert.deepEqual(seen, [{ kind: 'trouble' }])
  assert.match(updates.updateLine({ kind: 'trouble' }), /couldn.t check/i)
})

test('a check that throws does not leave the menu stuck', async () => {
  const seen = []
  const u = fakeUpdater()
  u.checkForUpdates = async () => {
    throw new Error('no network')
  }
  const { check } = updates.wireUpdates({ updater: u, onState: (s) => seen.push(s) })
  await check()
  assert.deepEqual(seen, [{ kind: 'trouble' }], 'the menu would say "Checking…" for ever')
})

test('nothing is said until there is something to say', () => {
  // A menu line of null means the item is not drawn at all.
  assert.equal(updates.updateLine(), null)
  assert.equal(updates.updateLine({ kind: 'idle' }), null)
  assert.equal(updates.updateLine({ kind: 'current' }), 'Up to date')
})

test('no updater at all is survivable', async () => {
  // A checkout has nothing to update from; the app must still run.
  const { check } = updates.wireUpdates({ updater: null, onState: () => {} })
  await check()
})

console.log('\nwhere this copy of the app is running')

const platform = await import('../src/lib/platform.js')

test('the phone app announces itself rather than being guessed at', () => {
  /*
   * Guessing the device from its user agent is forbidden elsewhere in this
   * codebase for good reasons — an iPad claims to be a Mac, and every WebView
   * claims to be Safari. The shell says what it is, so nothing has to guess.
   */
  const phone = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }
  assert.equal(platform.isCapacitor(phone), true)
  assert.equal(platform.nativePlatform(phone), 'ios')
  assert.equal(platform.platform(phone), 'ios')

  // A browser has no such global, which is the common case and not an error.
  const browser = { location: { hostname: 'fractal.newbold.cloud' } }
  assert.equal(platform.isCapacitor(browser), false)
  assert.equal(platform.nativePlatform(browser), null)
  assert.equal(platform.platform(browser), 'web')
})

test('a shell that answers nonsense is not believed', () => {
  // Present but not native: a browser with the library loaded is still a browser.
  const web = { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }
  assert.equal(platform.isCapacitor(web), false)
  assert.equal(platform.nativePlatform(web), null)

  // Native but naming a platform we do not ship: no answer beats a wrong one.
  const odd = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'electron' } }
  assert.equal(platform.nativePlatform(odd), null)

  // And a shell that throws is a browser as far as anything here is concerned.
  const angry = { Capacitor: { isNativePlatform: () => { throw new Error('no') } } }
  assert.equal(platform.isCapacitor(angry), false)
})

test('only the hosted site thinks it is the hosted site', () => {
  /*
   * What the service worker and the "add to home screen" nudge hang off. The
   * Mac serves this bundle too, and so does the phone app, and neither should
   * be offering to install itself or caching a shell it cannot update.
   */
  assert.equal(platform.isHostedOrigin({ location: { hostname: 'fractal.newbold.cloud' } }), true)
  assert.equal(platform.isHostedOrigin({ location: { hostname: '192.168.1.44' } }), false)
  assert.equal(platform.isHostedOrigin({ location: { hostname: 'localhost' } }), false)
  assert.equal(platform.isHostedOrigin(null), false)
})

test('nothing here needs a window', () => {
  // These modules load on a server and in this test runner, where there is none.
  assert.equal(platform.isCapacitor(null), false)
  assert.equal(platform.isStandalone(null), false)
  assert.equal(platform.platform(null), 'server')
})

test('the phone app counts as standalone without being asked twice', () => {
  const phone = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }
  assert.equal(platform.isStandalone(phone), true)

  // iOS says so on navigator; everyone else reports a display mode.
  assert.equal(platform.isStandalone({ navigator: { standalone: true } }), true)
  assert.equal(
    platform.isStandalone({ matchMedia: () => ({ matches: true }) }),
    true
  )
  assert.equal(
    platform.isStandalone({ matchMedia: () => ({ matches: false }) }),
    false
  )
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

test('the phone app is allowed, and only the phone app', () => {
  /*
   * A Capacitor shell serves this bundle to its own WebView from a scheme of
   * its own. Nothing on the internet can claim that origin — only a page
   * inside an app we signed — which is why it is allowed at all.
   *
   * Android serves over http://localhost and is covered by the private-network
   * rule above; it is asserted here so that stays true.
   */
  assert.equal(allowedOrigin('capacitor://localhost'), 'capacitor://localhost')
  assert.equal(allowedOrigin('http://localhost'), 'http://localhost')

  // The scheme is not a skeleton key: it buys nothing away from localhost.
  assert.equal(allowedOrigin('capacitor://evil.example'), null)
  assert.equal(allowedOrigin('capacitor://localhost.evil.example'), null)
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
  // The amp and the drive carry channels, as they do on the unit; the cab and
  // the delay here do not, which is the other half of what has to be checked.
  { eid: 58, name: 'Amp 1', slug: 'amp', channel: 'A', models: [], params: [] },
  { eid: 106, name: 'Cab 1', slug: 'cab', models: [], params: [] },
  { eid: 118, name: 'Drive 1', slug: 'drive', channel: 'A', models: [], params: [] },
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

/*
 * The half of a scene that had no way through the app at all.
 *
 * A scene remembers a channel per block as well as a bypass, and the device
 * layer has always been able to write one — setSceneBlock takes it. Nothing
 * ever passed it, because the generator was told scenes could not carry one.
 */
test('a scene carries the channel it plays, block by block', () => {
  const r = scened([
    { index: 0, name: 'Rhythm', engaged: [58, 106, 118], channels: [{ eid: 58, channel: 'A' }] },
    { index: 1, name: 'Lead', engaged: [58, 106, 118], channels: [{ eid: 58, channel: 'b' }] }
  ])
  assert.deepEqual(r.problems, [])
  const amp = (i) => r.scenes[i].blocks.find((b) => b.eid === 58)
  assert.equal(amp(0).channel, 'A')
  assert.equal(amp(1).channel, 'B', 'a lower-case letter is the same channel')
  assert.equal(
    r.scenes[1].blocks.find((b) => b.eid === 118).channel,
    undefined,
    'a block the scene said nothing about was moved anyway'
  )
})

test('a scene channel the unit cannot honour is dropped, not sent', () => {
  const r = scened([
    {
      index: 0,
      name: 'Odd',
      engaged: [58, 106, 132],
      channels: [
        { eid: 132, channel: 'B' },
        { eid: 58, channel: 'Q' }
      ]
    }
  ])
  assert.ok(!r.scenes[0].blocks.some((b) => b.channel), 'a channel that cannot be written was kept')
  assert.match(r.problems.join(' | '), /Delay 1 has no channels/)
  assert.match(r.problems.join(' | '), /no channel "Q"/)
})

test('a block spec carries the channel its values belong to', () => {
  const withChannel = validateSpec(
    { blocks: [{ eid: 58, channel: 'b', params: [] }] },
    sceneSchema
  )
  assert.equal(withChannel.changes.length, 1, 'a channel on its own is not a change worth writing')
  assert.equal(withChannel.changes[0].channel, 'B')

  // Two entries for one block: the lead sound on its own channel, which is the
  // whole point — one amp block, two sounds, a scene each.
  const two = validateSpec(
    {
      blocks: [
        { eid: 58, channel: 'A', params: [] },
        { eid: 58, channel: 'D', params: [] }
      ]
    },
    sceneSchema
  )
  assert.deepEqual(two.changes.map((c) => c.channel), ['A', 'D'])

  const none = validateSpec({ blocks: [{ eid: 132, channel: 'B', params: [] }] }, sceneSchema)
  assert.equal(none.changes.length, 0)
  assert.match(none.problems[0] || '', /no channels/)

  const bad = validateSpec({ blocks: [{ eid: 58, channel: 'Z', params: [] }] }, sceneSchema)
  assert.equal(bad.changes.length, 0)
  assert.match(bad.problems[0] || '', /no channel "Z"/)
})

test('a scene written without a name says so rather than keeping a stranger\u2019s', () => {
  /*
   * A blank name is not a blank scene: applyScenes skips setSceneName, so the
   * scene keeps whatever it was called. On a preset somebody laid out that
   * leaves a scene called "Lead" which is no longer the lead — the exact
   * confusion this whole round is about.
   */
  const r = scened([
    { index: 0, name: 'Rhythm', engaged: [58, 106] },
    { index: 1, name: '   ', engaged: [58, 106, 118] }
  ])
  assert.equal(r.scenes.length, 2, 'the unnamed scene was dropped instead of reported')
  assert.equal(r.scenes[1].name, '')
  assert.match(r.problems.join(' | '), /Scene 2 came back with no name/)
  assert.ok(!/Scene 1 came back with no name/.test(r.problems.join(' | ')), 'a named scene was reported too')
})

test('the cost of a scene plan is a switch plus a bypass each', () => {
  // Shown on the button before anything is written, because this is the half
  // that walks the unit through every scene.
  const r = scened([
    { index: 0, name: 'A', engaged: [58, 106] },
    { index: 1, name: 'B', engaged: [58, 106, 118] }
  ])
  assert.equal(countSceneWrites(r.scenes), 2 * (1 + 4))

  // A channel is a write of its own, and the count is what the button promises.
  const withChannels = scened([
    { index: 0, name: 'A', engaged: [58, 106], channels: [{ eid: 58, channel: 'A' }] },
    { index: 1, name: 'B', engaged: [58, 106, 118], channels: [{ eid: 58, channel: 'D' }] }
  ])
  assert.equal(countSceneWrites(withChannels.scenes), 2 * (1 + 4 + 1))
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

test('the chat can nudge a level but not walk it down', () => {
  // The same window the design route holds, on the route a player talks to.
  const down = validatePlan(
    { actions: [{ kind: 'setParam', eid: 58, paramId: 1, value: -40, why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(down.actions.length, 0)
  assert.match(down.problems[0], /nudged, not reset/)

  const up = validatePlan(
    { actions: [{ kind: 'setParam', eid: 58, paramId: 1, value: -2, why: '' }] },
    cmdBlocks,
    caps
  )
  assert.equal(up.actions.length, 1, 'a few dB of make-up gain is still refused')
  assert.match(up.actions[0].label, /Amp1 Level/)
})

test('the chat never touches balance or routing', () => {
  const blocks = [
    {
      eid: 58,
      name: 'Amp 1',
      slug: 'amp',
      row: 1,
      col: 4,
      models: [],
      params: [{ id: 2, name: 'Balance', value: 0, min: -100, max: 100 }]
    }
  ]
  const r = validatePlan(
    { actions: [{ kind: 'setParam', eid: 58, paramId: 2, value: 40, why: '' }] },
    blocks,
    caps
  )
  assert.equal(r.actions.length, 0)
  assert.match(r.problems[0], /yours to set/i)
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

/*
 * "Brighten scene 2" with scene 3 live used to nudge Amp Treble on scene 3.
 * A value belongs to the channel a block is on, not to a scene, so writing it
 * "for scene 2" reaches every scene playing that channel — and nothing refused
 * the ask or said where the write would land.
 */
const sceneCaps = { ...caps, activeScene: 2, sceneNames: ['Rhythm', 'Lead', 'Clean'] }

test('a parameter change aimed at another scene is refused, never written elsewhere', () => {
  const r = validatePlan(
    { actions: [{ kind: 'setParam', eid: 58, paramId: 7, value: 7.5, scene: 1, why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.equal(r.actions.length, 0, 'the write went to the live scene under a scene-2 label')
  assert.match(r.problems[0] || '', /belongs to the channel/, r.problems.join(' | '))
  assert.match(r.problems[0] || '', /own channel/, 'the refusal does not say what would actually work')
  assert.match(r.problems[0] || '', /scene 2 · Lead/, 'the refusal does not name the scene the player named')

  // The live scene, named or not, is fine: that is where the value lives anyway.
  for (const scene of [2, null, undefined]) {
    const ok = validatePlan(
      { actions: [{ kind: 'setParam', eid: 58, paramId: 7, value: 7.5, scene, why: '' }] },
      cmdBlocks,
      sceneCaps
    )
    assert.equal(ok.actions.length, 1, `scene ${scene} should be allowed`)
  }
})

test('a bypass aimed at another scene lands in that scene and says so', () => {
  const r = validatePlan(
    { actions: [{ kind: 'setBypass', eid: 118, flag: false, scene: 1, why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.equal(r.actions.length, 1)
  assert.match(r.actions[0].label, /Drive 1 on in scene 2 · Lead/, r.actions[0].label)
  assert.equal(r.actions[0].scene, 1)

  // No scene given: it lands where the unit is, and the label admits it.
  const live = validatePlan(
    { actions: [{ kind: 'setBypass', eid: 118, flag: true, why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.match(live.actions[0].label, /Drive 1 off in scene 3 · Clean/, live.actions[0].label)

  // A scene the unit does not have is refused, as it is for setSceneBlock.
  const none = validatePlan(
    { actions: [{ kind: 'setBypass', eid: 118, flag: true, scene: 9, why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.equal(none.actions.length, 0)
  assert.match(none.problems[0] || '', /no scene 10/)

  // And the routing itself: another scene goes through the switch-write-return path.
  const src = readSrc(new URL('../src/lib/actions.js', import.meta.url), 'utf8')
  const bypass = src.slice(src.indexOf("case 'setBypass'"), src.indexOf("case 'setChannel'"))
  assert.match(bypass, /setSceneBlock\((raw\.)?scene/, 'a scene-targeted bypass is written wherever the unit happens to be')
})

test('a channel aimed at another scene lands in that scene, like a bypass does', () => {
  /*
   * The pair is what a scene is. Bypass has been written into a named scene
   * for a while; a channel — the half that actually changes the sound — was
   * written wherever the unit happened to be standing, so "put the lead scene
   * on channel B" moved whichever scene the player was in.
   */
  const r = validatePlan(
    { actions: [{ kind: 'setChannel', eid: 58, text: 'B', scene: 1, why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.equal(r.actions.length, 1)
  assert.match(r.actions[0].label, /channel B in scene 2 · Lead/, r.actions[0].label)

  // No scene named: the live one, and the label says which that is.
  const live = validatePlan(
    { actions: [{ kind: 'setChannel', eid: 58, text: 'B', why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.match(live.actions[0].label, /channel B in scene 3 · Clean/, live.actions[0].label)

  // A scene the unit does not have is refused, as it is for a bypass.
  const none = validatePlan(
    { actions: [{ kind: 'setChannel', eid: 58, text: 'B', scene: 9, why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.equal(none.actions.length, 0)
  assert.match(none.problems[0] || '', /no scene 10/)

  // And the routing itself: another scene goes through the switch-write-return path.
  const src = readSrc(new URL('../src/lib/actions.js', import.meta.url), 'utf8')
  const chan = src.slice(src.indexOf("case 'setChannel'"), src.indexOf("case 'moveBlock'"))
  assert.match(chan, /setSceneBlock\(chanScene/, 'a scene-targeted channel is written wherever the unit happens to be')

  // A channel must be chosen before a model is set on it, or the model lands
  // on the channel being left behind.
  const order = src.slice(src.indexOf('const ORDER = {'), src.indexOf('export function validatePlan'))
  const at = (kind) => Number(order.match(new RegExp(`${kind}: (-?[0-9.]+)`))[1])
  assert.ok(at('setChannel') < at('setModel'), 'the model is set before the channel it belongs to')
  assert.ok(at('setChannel') < at('setParam'), 'values are written before the channel they belong to')
})

test('a scene can be named by saying so', () => {
  /*
   * "Change scene name to Dimebag" came back as "I don't have a way to rename
   * an individual scene — only the whole preset can be renamed". That was
   * true: renameScene was not in the list of actions the chat may return, so
   * the model correctly said it had no way. It is a different write from
   * renamePreset and lands somewhere else — the preset keeps its name.
   */
  const r = validatePlan(
    { actions: [{ kind: 'renameScene', text: 'Dimebag', scene: 1, why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.equal(r.actions.length, 1, r.problems.join(' | '))
  assert.match(r.actions[0].label, /Name scene 2 · Lead "Dimebag"/, r.actions[0].label)

  // No scene named: the one the unit is in, said out loud.
  const live = validatePlan(
    { actions: [{ kind: 'renameScene', text: 'Solo', why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.match(live.actions[0].label, /Name scene 3 · Clean "Solo"/, live.actions[0].label)

  // A scene the unit does not have, and a name that is not one, are refused.
  for (const [action, why] of [
    [{ kind: 'renameScene', text: 'Nope', scene: 9, why: '' }, /no scene 10/],
    [{ kind: 'renameScene', text: '   ', scene: 1, why: '' }, /No name given for the scene/]
  ]) {
    const bad = validatePlan({ actions: [action] }, cmdBlocks, sceneCaps)
    assert.equal(bad.actions.length, 0)
    assert.match(bad.problems[0] || '', why, bad.problems.join(' | '))
  }

  // And it is not the preset's name. Both exist, and they say which they are.
  const preset = validatePlan(
    { actions: [{ kind: 'renamePreset', text: 'Dimebag', why: '' }] },
    cmdBlocks,
    sceneCaps
  )
  assert.match(preset.actions[0].label, /Rename the preset to "Dimebag"/, preset.actions[0].label)

  const command = readSrc(new URL('../api/command.js', import.meta.url), 'utf8')
  assert.match(command, /'renameScene',/, 'the chat may not return a scene rename at all')
  assert.match(
    command,
    /must never be answered with renamePreset/,
    'nothing stops a scene rename being answered by renaming the preset'
  )
})

test('the chat is told the scene names, like the designer already is', () => {
  const command = readSrc(new URL('../api/command.js', import.meta.url), 'utf8')
  assert.match(command, /sceneNames/, 'the command route never sees the scene names — "it only has indexes"')
  assert.match(command, /sceneCount/)
  const handler = command.slice(command.indexOf('export default async function handler'))
  assert.match(handler, /const \{[^}]*sceneNames[^}]*\} =\s*\n?\s*req\.body/, 'sceneNames is not read from the request')
  assert.match(handler, /activeScene: scene,\s*\n\s*sceneNames/, 'the model state has the index and not the names')
  const scene = command.slice(command.indexOf('  scene: z'), command.indexOf('  scene: z') + 400)
  assert.match(scene, /setBypass/, 'the scene field is still scoped to setSceneBlock alone')
  assert.match(command, /\nSCENES AND CHANNELS\n/, 'the system prompt says nothing about scenes')
  assert.match(
    command,
    /belongs to the channel the block is on/,
    'the model is not told where a value actually lives'
  )
  assert.ok(
    !/shared by every scene/.test(command),
    'the model is still told parameter values are shared by every scene, which is not true of this hardware'
  )
})

test('the chat is told the player counts scenes from 1', () => {
  /*
   * Every layer here is 0-based and consistent — Play renders i+1, actions.js
   * labels index 1 "scene 2 · Lead" — but the model was handed a bare array
   * and never told the player counts from 1, so "brighten scene 2" was read
   * as sceneNames[2]: Clean. The designer route already says it (generate.js:
   * "0 is scene 1 on the unit front panel"); the chat route now does too, in
   * the schema, in the prompt, and as a numbered list in the state.
   */
  const command = readSrc(new URL('../api/command.js', import.meta.url), 'utf8')
  const scene = command.slice(command.indexOf('  scene: z'), command.indexOf('  scene: z') + 600)
  assert.match(scene, /0 is the scene the player calls scene 1/, 'the scene field does not say what index the player’s "scene 1" is')
  assert.match(command, /their "scene 2" is index 1/, 'the prompt does not bridge the player’s numbering to the index')
  assert.match(command, /Every scene number you return is an\s+index/)
  const handler = command.slice(command.indexOf('export default async function handler'))
  assert.match(handler, /scenes: Array\.isArray\(sceneNames\)/, 'the state carries no numbered scene list')
  assert.match(handler, /`scene \$\{i \+ 1\} = index \$\{i\}/, 'the numbered list does not pair the player’s number with the index')
  // The rendering itself, indexes 1–8, the way a player says them.
  const render = (names) => names.map((name, i) => `scene ${i + 1} = index ${i}${name ? ` (${name})` : ''}`)
  const out = render(['Rhythm', 'Lead', 'Clean', '', '', '', '', ''])
  assert.equal(out[1], 'scene 2 = index 1 (Lead)')
  assert.equal(out[7], 'scene 8 = index 7')
  assert.equal(out.length, 8)
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
  // Version moves are host-refused too; the mirror used to allow them, so the
  // request died as a raw relay error instead of an explanation.
  assert.ok(forbiddenRemotely('POST', '/version/3/restore'))
  assert.ok(forbiddenRemotely('DELETE', '/device/cache'))
})

test('live performance edits travel fine', () => {
  assert.equal(forbiddenRemotely('PUT', '/preset/blocks/58/params/17'), null)
  assert.equal(forbiddenRemotely('POST', '/scene'), null)
  assert.equal(forbiddenRemotely('POST', '/tempo'), null)
  assert.equal(forbiddenRemotely('POST', '/preset/select'), null)
  /*
   * Naming travels now. It was refused by the host — absent from the writes
   * remoteAllowed() permits and absent from the list of things it says are
   * never remotely reachable, which was an oversight rather than a boundary.
   * It is an edit-buffer write like every other one allowed here, and putting
   * anything in a slot is still /preset/store, which stays refused below.
   */
  assert.equal(forbiddenRemotely('POST', '/preset/name'), null)
  assert.equal(forbiddenRemotely('POST', '/scene/name'), null)
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
          '/mod/bind',
          // Added to the host in the pinned fork — see desktop/forgefx.lock.json.
          // Edit-buffer writes; putting anything in a slot is still refused.
          '/preset/name',
          '/scene/name'
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

test('an output level can be nudged but never reset to silence', () => {
  /*
   * Levels used to be withheld from the model entirely, and the reason was
   * sound: a Level sits in the same list as Bass and Treble, so a generation
   * that is otherwise musically right will set it to -60 dB and hand back a
   * preset that looks perfect and makes no sound.
   *
   * What that cost was worse. "I told the AI that the amp should be louder
   * when it's on compared to when it's off and it told me I was wrong." The
   * one control that does that was invisible, so the model argued rather than
   * refused. It is reachable now, within a window: a nudge, not a reset.
   */
  const silence = validateSpec(
    { blocks: [{ eid: 58, params: [{ id: 3, name: 'Amp 1 Level', value: -60 }] }] },
    ampSchema
  )
  assert.equal(silence.changes.length, 0, 'a level was walked to silence in one write')
  assert.match(silence.problems[0], /nudged, not reset/)

  /*
   * And the thing the player actually asked for goes through. Addressed by the
   * Level's own id here, where the case above deliberately arrives with the
   * wrong one so the name-matching path is covered too — both routes reach the
   * same control, and the window has to hold on either.
   */
  const louder = validateSpec(
    { blocks: [{ eid: 58, params: [{ id: 4, name: 'Amp 1 Level', value: 3 }] }] },
    ampSchema
  )
  assert.equal(louder.changes.length, 1, 'a few dB of make-up gain is still refused')
  assert.equal(louder.changes[0].params[0].to, 3)
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
  /*
   * Both, and the number first.
   *
   * "Can we also add the slot number in front of the A to Z bank numbers."
   * Everything else in this app talks in numbers — save to slot 5, the bar
   * says SLOT 99 — while the unit's front panel and this list talked in
   * letters. Reading one and typing the other meant doing the arithmetic, and
   * the arithmetic is only obvious once you know a bank holds four.
   */
  const { slotLabel } = await import('../src/lib/slots.js')
  assert.equal(slotLabel(0, 'bankLetter'), '000 A01')
  assert.equal(slotLabel(7, 'bankLetter'), '007 B04')
  assert.equal(slotLabel(103, 'bankLetter'), '103 Z04')
  // The number is the one you type, so it leads.
  assert.match(slotLabel(4, 'bankLetter'), /^004 /)
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


/* ------------------------------------------------------------------
   The first frame on a phone
   ------------------------------------------------------------------ */

const remoteMod = await import('../src/lib/remote.js')

test('a saved sign-in is known before the client is loaded', () => {
  const store = (items) => ({ getItem: (k) => (k in items ? items[k] : null) })
  const key = 'sb-biznwrqeckviawjuhvyg-auth-token'
  assert.equal(remoteMod.hasSavedSession({ storage: store({}) }), false)
  assert.equal(remoteMod.hasSavedSession({ storage: store({ [key]: JSON.stringify({ access_token: 'a.b.c' }) }) }), true)
  assert.equal(remoteMod.hasSavedSession({ storage: store({ [key]: 'not json' }) }), false, 'a corrupt token is not a session')
  assert.equal(
    remoteMod.hasSavedSession({ url: 'https://other.supabase.co', storage: store({ [key]: JSON.stringify({ access_token: 'x' }) }) }),
    false,
    'the key follows the project'
  )
  assert.equal(
    remoteMod.hasSavedSession({ storage: { getItem: () => { throw new Error('blocked') } } }),
    false,
    'blocked storage is no session, not a crash'
  )
})

test('the fault notice speaks to the end it is on', () => {
  const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const crios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1'
  const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

  assert.equal(link.faultCopy({ role: 'unknown' }), null, 'a notice was written before anyone knew which end this is')

  const mac = link.faultCopy({ role: 'mac', secure: true, userAgent: macSafari })
  assert.match(mac.body, /this Mac/)
  assert.match(mac.body, /Safari/, 'Safari on an https page at the Mac is the one case the advice is for')
  assert.ok(!/Safari/.test(link.faultCopy({ role: 'mac', secure: true, userAgent: chrome }).body), 'Chrome was told to try Chrome')
  assert.ok(!/Safari/.test(link.faultCopy({ role: 'mac', secure: false, userAgent: macSafari }).body), 'Safari over plain http can talk to the Mac fine')
  assert.equal(link.whySafari({ secure: true, userAgent: ios }), '', 'an iPhone was told to try Chrome, which is Safari underneath')
  assert.equal(link.whySafari({ secure: true, userAgent: crios }), '')

  const phone = link.faultCopy({ role: 'remote', secure: true, userAgent: ios })
  assert.ok(phone && !/this Mac|Safari/.test(phone.body), 'a phone was told to open an app on "this Mac"')
  assert.match(link.faultCopy({ role: 'wifi' }).title, /Lost the Mac/)
  /*
   * A unit that answered "not connected" wins over the role copy — but not
   * with the same words at every end. At the Mac the cable is an arm's length
   * away and worth checking. On a phone it is in another room, and by the time
   * this shows the unit has already been asked five times: "says it's
   * connected but says no unit... if I hit Try again like five or six times it
   * will actually connect."
   */
  for (const role of ['mac', 'wifi']) {
    assert.equal(link.faultCopy({ role, device: { connected: false } }).title, 'No unit found')
  }
  const noUnit = link.faultCopy({ role: 'remote', device: { connected: false } })
  assert.match(noUnit.title, /can’t see your unit/, 'a phone is still told to check a cable it cannot reach')
  assert.match(noUnit.body, /five times/, 'a phone is not told the asking already happened')
  assert.ok(
    !/tap Try again/.test(noUnit.body),
    'Try again is offered as the fix for the thing that just failed five times'
  )
})

test('a phone restoring its sign-in reads as connecting, never as signed out', () => {
  const linkSrc = readSrc(new URL('../src/lib/link.js', import.meta.url), 'utf8')
  const boot = linkSrc.slice(linkSrc.indexOf('export async function bootLink'))
  const published = boot.indexOf('refresh({ role })')
  const restored = boot.indexOf('await restoreSession(')
  assert.ok(
    published !== -1 && restored !== -1 && published < restored,
    'bootLink withholds the role until the session round-trip is done — a phone gets the Mac’s error in the meantime'
  )
  assert.match(linkSrc, /restoring = role === 'remote' && hasSavedSession\(/, 'a phone that signed in last time is asked to Connect while its session is picked up')
  assert.match(linkSrc, /hasSession: !!merged\.account \|\| restoring/)
  assert.match(linkSrc, /joining: joining \|\| restoring/)
})

/* ------------------------------------------------------------------
   Scenes in the simulated unit
   ------------------------------------------------------------------ */

const { createSceneState } = await import('../src/lib/sceneState.js')

test('a scene is its own pattern of what is off', () => {
  const scenes = createSceneState({ count: 8, seeds: { default: [46, 70], 1: [94], 2: [94, 118] } })
  assert.deepEqual(scenes.snapshot(0), [46, 70])
  assert.deepEqual(scenes.snapshot(1), [94], 'a seeded scene took the default')
  assert.deepEqual(scenes.snapshot(5), [46, 70], 'an unseeded scene starts as the default')
  assert.ok(scenes.isOff(0, 46) && !scenes.isOff(1, 46), 'the same block reads the same in every scene — that is the bug')

  // A bypass written in one scene is that scene's.
  scenes.set(1, 118, true)
  assert.ok(scenes.isOff(1, 118))
  assert.ok(!scenes.isOff(0, 118), 'switching a block off in scene 2 switched it off in scene 1')
  scenes.set(1, 118, false)
  assert.ok(!scenes.isOff(1, 118))

  // A block just placed is on everywhere; out-of-range scenes clamp rather than throw.
  scenes.set(3, 46, true)
  scenes.forget(46)
  for (let i = 0; i < 8; i++) assert.ok(!scenes.isOff(i, 46))
  assert.equal(scenes.isOff(99, 70), scenes.isOff(7, 70))
})

/*
 * The half that was missing. A scene remembers which channel each block plays,
 * and a channel holds its own model and its own values — which is why a lead
 * scene can have a genuinely hotter amp rather than the rhythm amp with a
 * boost in front of it. Everything above this line was true of the old file;
 * none of this was possible in it.
 */
test('a scene remembers which channel each block plays', () => {
  const scenes = createSceneState({ count: 8, seeds: {}, channels: { 1: { 58: 'D' } } })
  assert.equal(scenes.channelOf(1, 58), 'D', 'a seeded scene channel was lost')
  assert.equal(scenes.channelOf(0, 58), null, 'a scene that never chose a channel claims one anyway')

  scenes.setChannel(2, 58, 'B')
  assert.equal(scenes.channelOf(2, 58), 'B')
  assert.equal(scenes.channelOf(1, 58), 'D', 'a channel written in scene 3 followed the block into scene 2')
  assert.equal(scenes.channelOf(0, 58), null, 'a channel written in scene 3 leaked into scene 1')

  // A block just placed plays whatever channel it was placed on, everywhere.
  scenes.forget(58)
  for (let i = 0; i < 8; i++) assert.equal(scenes.channelOf(i, 58), null)
})

test('the simulated unit answers for the chain from the scene it is in', () => {
  const mock = readSrc(new URL('../src/lib/mockDevice.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.match(mock, /createSceneState\(/, 'the mock keeps one bypass flag per block again')
  const map = mock.slice(mock.indexOf('sceneStateNow:'), mock.indexOf('sceneStateNow:') + 700)
  assert.ok(!/% 3|state\.scene === 0 \?/.test(map), 'the scene map is a made-up pattern again, disagreeing with Play')
  assert.ok(!/b\.bypassed/.test(mock), 'something in the mock reads a per-block bypass flag, which no longer follows the scene')
  for (const answer of ['presetBlocks', 'meters', 'presetSummary', 'sceneStateNow']) {
    const body = mock.slice(mock.indexOf(`${answer}:`), mock.indexOf(`${answer}:`) + 700)
    assert.match(body, /off\(b\.effectId\)/, `${answer} does not ask the scene which blocks are off`)
  }
  const setBypass = mock.slice(mock.indexOf('setBypass:'), mock.indexOf('setBypass:') + 300)
  assert.match(setBypass, /state\.scenes\.set\(state\.scene/, 'a bypass write no longer lands in the scene the unit is in')
})

test('the simulated unit gives each scene its own channel, and each channel its own values', () => {
  /*
   * The demo used to keep one channel per block and one set of values per
   * block, so the tour's own claim — a scene can carry a different amp — was
   * untestable in the only unit most people will ever run this against.
   */
  const mock = readSrc(new URL('../src/lib/mockDevice.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  const setChannel = mock.slice(mock.indexOf('setChannel:'), mock.indexOf('setChannel:') + 300)
  assert.match(
    setChannel,
    /state\.scenes\.setChannel\(state\.scene/,
    'a channel write still lands on the block, so every scene shares it'
  )
  for (const answer of ['presetBlocks', 'sceneStateNow']) {
    const body = mock.slice(mock.indexOf(`${answer}:`), mock.indexOf(`${answer}:`) + 700)
    assert.match(body, /chan\(b\.effectId\)/, `${answer} reports a channel that does not follow the scene`)
  }
  assert.match(mock, /params\.set\(`\$\{eid\}:\$\{chan\(eid\)\}`/, 'a model swap writes over every channel of the block')
  assert.ok(
    !/state\.params\.get\(eid\)/.test(mock),
    'something reads a block\u2019s values without asking which channel it is playing'
  )
})

/* ------------------------------------------------------------------
   One history ledger for sheets and screens
   ------------------------------------------------------------------ */

const nav = await import('../src/lib/nav.js')

test('a closing sheet takes its own entry and owes a pop only to a sheet that is listening', () => {
  // A fake window: history entries, and popstate delivered to listeners.
  const entries = [{}]
  const handlers = new Set()
  const w = {
    history: {
      get state() { return entries[entries.length - 1] },
      pushState: (st) => entries.push(st),
      replaceState: (st) => { entries[entries.length - 1] = st },
      back: () => { entries.pop(); for (const h of [...handlers]) h({ state: w.history.state }) }
    },
    addEventListener: (_, h) => handlers.add(h),
    removeEventListener: (_, h) => handlers.delete(h)
  }
  globalThis.window = w
  nav._resetNav()
  const now = (fn) => fn()

  // The app's own screen entries.
  nav.replaceEntry({ view: 'play' })
  nav.pushEntry({ view: 'shape' })
  assert.deepEqual(entries, [{ view: 'play' }, { view: 'shape' }])

  // One sheet, closed by its button: the entry goes, nobody is owed a pop.
  let closedA = 0
  const backA = () => { if (nav.swallowedPop()) return; closedA++ }
  const stopA = nav.listen(backA)
  nav.pushEntry({ sheet: true })
  stopA()
  nav.popSelf(now)
  assert.deepEqual(entries, [{ view: 'play' }, { view: 'shape' }], 'the sheet did not take its entry with it')
  assert.equal(nav._ledger().selfPops, 0, 'a pop is owed with no sheet there to be owed it — the next real Back would be swallowed')
  assert.equal(closedA, 0)

  // A handoff: sheet A closes as sheet B opens. A's teardown pops B's entry; B must not take that for a Back gesture.
  let closedB = 0
  let remarked = 0
  const stopA2 = nav.listen(() => {})
  nav.pushEntry({ sheet: true })
  const backB = () => { if (nav.swallowedPop()) { remarked++; nav.pushEntry({ sheet: true }); return } closedB++ }
  const stopB = nav.listen(backB)
  nav.pushEntry({ sheet: true })
  stopA2()
  nav.popSelf(now)
  assert.equal(closedB, 0, 'the sheet that had just opened closed itself — the introduction bug')
  assert.equal(remarked, 1, 'the incoming sheet did not put its entry back')
  assert.equal(nav._ledger().selfPops, 0)
  // Now a real Back closes B, and the screen entry is what is left.
  w.history.back()
  assert.equal(closedB, 1)
  stopB()
  assert.equal(nav._ledger().listening, 0)
  delete globalThis.window
})

/* ------------------------------------------------------------------
   The model's first minute
   ------------------------------------------------------------------ */

const { streamSpec } = await import('../src/lib/stream.js')

/**
 * A fetch whose body arrives on a schedule: [{ at, chunk }] then done, or
 * silence forever (`end: false`). Reads reject when the caller aborts, as a
 * real body does.
 */
function scheduledFetch(scripts) {
  let calls = 0
  const fetch = (_url, init) => {
    const script = scripts[Math.min(calls, scripts.length - 1)]
    calls++
    const signal = init.signal
    let i = 0
    const t0 = Date.now()
    const reader = {
      read: () =>
        new Promise((resolve, reject) => {
          if (signal.aborted) return reject(new Error('aborted'))
          const onAbort = () => reject(new Error('aborted'))
          signal.addEventListener('abort', onAbort, { once: true })
          if (i < script.steps.length) {
            const step = script.steps[i++]
            setTimeout(() => {
              signal.removeEventListener('abort', onAbort)
              resolve({ value: new TextEncoder().encode(step.chunk), done: false })
            }, Math.max(0, step.at - (Date.now() - t0)))
          } else if (script.end !== false) {
            setTimeout(() => {
              signal.removeEventListener('abort', onAbort)
              resolve({ value: undefined, done: true })
            }, 0)
          }
          // else: silence forever — only an abort ends this read
        })
    }
    return Promise.resolve({ ok: true, status: 200, body: { getReader: () => reader } })
  }
  return { fetch, calls: () => calls }
}
const DONE = JSON.stringify({ type: 'done', object: { blocks: [] } }) + '\n'
const PARTIAL = JSON.stringify({ type: 'partial', object: { blocks: [{ slug: 'amp' }] } }) + '\n'
/** The server's hello, written before the model is asked anything. */
const OPEN = JSON.stringify({ type: 'open' }) + '\n'
const timing = { stallMs: 60, firstMs: 60, capMs: 400 }

test('a slow first byte is not a stall', async () => {
  // The old clock started at the request: 45 s of waiting for the first token read as the model going quiet.
  const f = scheduledFetch([{ steps: [{ at: 150, chunk: DONE }] }])
  globalThis.fetch = f.fetch
  const events = []
  const spec = await streamSpec({}, { timing, onEvent: (e) => events.push(e.kind) })
  assert.deepEqual(spec, { blocks: [] })
  assert.equal(f.calls(), 1)
  assert.ok(!events.includes('failed'), events.join(','))
})

test('silence mid-answer is a stall, and it is not retried once something arrived', async () => {
  const f = scheduledFetch([{ steps: [{ at: 5, chunk: PARTIAL }], end: false }])
  globalThis.fetch = f.fetch
  await assert.rejects(streamSpec({}, { timing }), (err) => err.generationFailure === 'stalled' && /stopped partway through/.test(err.message))
  assert.equal(f.calls(), 1, 'a stall after a partial was retried — a retry is only safe before anything arrived')
})

test('a stall before anything arrived is asked again, once', async () => {
  const f = scheduledFetch([{ steps: [{ at: 5, chunk: '\n' }], end: false }, { steps: [{ at: 5, chunk: DONE }] }])
  globalThis.fetch = f.fetch
  const events = []
  const spec = await streamSpec({}, { timing, onEvent: (e) => events.push(e.kind) })
  assert.deepEqual(spec, { blocks: [] })
  assert.equal(f.calls(), 2)
  assert.equal(events.filter((k) => k === 'retrying').length, 1)
})

test('nothing at all by the cap blames the connection, not the AI', async () => {
  // Not a distinction worth drawing until the server said hello first. Now it
  // is: no bytes whatsoever means the request never got anywhere near a model,
  // and telling someone the model was slow sends them to look in the wrong place.
  const f = scheduledFetch([{ steps: [], end: false }])
  globalThis.fetch = f.fetch
  await assert.rejects(
    streamSpec({}, { timing }),
    (err) => err.generationFailure === 'capped' && /get through at all/.test(err.message)
  )
  assert.equal(f.calls(), 1)
})

test('the hello is the server talking, not the model answering', async () => {
  /*
   * The bug this exists for: the opening frame is bytes, and a clock that
   * counts bytes would call it the model's first word and start the short
   * mid-answer stall clock against it. It is neither — it is proof the round
   * trip works and nothing more, and what follows it gets the long budget.
   */
  const f = scheduledFetch([
    { steps: [{ at: 5, chunk: OPEN }], end: false },
    { steps: [{ at: 5, chunk: OPEN }, { at: 10, chunk: DONE }] }
  ])
  globalThis.fetch = f.fetch
  const events = []
  const spec = await streamSpec({}, { timing, onEvent: (e) => events.push(e.kind) })
  assert.deepEqual(spec, { blocks: [] })
  assert.ok(events.includes('open'), `no open event: ${events.join(',')}`)
  // Quiet after the hello is idempotent — nothing was written anywhere — so it
  // is asked again rather than reported.
  assert.equal(f.calls(), 2)
  assert.equal(events.filter((k) => k === 'retrying').length, 1)
})

test('a hello with no answer behind it says so in those words', async () => {
  const f = scheduledFetch([{ steps: [{ at: 5, chunk: OPEN }], end: false }])
  globalThis.fetch = f.fetch
  await assert.rejects(
    // firstMs out of reach, so the cap is what fires: the server took it and
    // the model never began.
    streamSpec({}, { timing: { ...timing, firstMs: 10000 } }),
    (err) => err.generationFailure === 'capped' && /never started answering/.test(err.message)
  )
  assert.equal(f.calls(), 1)
})

test('quiet after the hello is the AI, and it says so without naming machines', async () => {
  const f = scheduledFetch([
    { steps: [{ at: 5, chunk: OPEN }], end: false },
    { steps: [{ at: 5, chunk: OPEN }], end: false }
  ])
  globalThis.fetch = f.fetch
  await assert.rejects(
    streamSpec({}, { timing }),
    (err) => err.generationFailure === 'stalled' && /sent nothing back/.test(err.message)
  )
  assert.equal(f.calls(), 2, 'a quiet start was not retried — nothing had been written, so it was free to ask again')
})

test('a wait of our own making is not blamed on what the player typed', async () => {
  /*
   * "Said working on tone for over 3 minutes then just disappeared and nothing
   * was generated." What it then said was "ask again, and a shorter
   * description starts sooner" — to someone whose description was five words.
   *
   * The wait before the model's first word is this app's own payload and the
   * model's own speed. Pointing a person at the one part they cannot usefully
   * change wastes their next attempt and blames them for our delay.
   */
  const f = scheduledFetch([
    { steps: [{ at: 5, chunk: OPEN }], end: false },
    { steps: [{ at: 5, chunk: OPEN }], end: false }
  ])
  globalThis.fetch = f.fetch
  await assert.rejects(streamSpec({}, { timing }), (err) => {
    assert.ok(
      !/shorter description|fewer words/i.test(err.message),
      `it still blames the description — ${err.message}`
    )
    assert.match(err.message, /twice/, 'three minutes of waiting is reported as one attempt')
    assert.match(err.message, /Nothing was written to your unit/)
    return true
  })
})

test('the second attempt announces itself and is not overwritten', async () => {
  /*
   * The retry said "asking again" and the new attempt's hello overwrote it a
   * second later, so two ninety-second waits looked like one that never
   * ended. The attempt number rides on the hello so the screen can keep
   * saying which try this is.
   */
  const f = scheduledFetch([
    { steps: [{ at: 5, chunk: OPEN }], end: false },
    { steps: [{ at: 5, chunk: OPEN }], end: false }
  ])
  globalThis.fetch = f.fetch
  const opens = []
  await assert.rejects(
    streamSpec({}, { timing, onEvent: (e) => e.kind === 'open' && opens.push(e.attempt) }),
    () => true
  )
  assert.deepEqual(opens, [0, 1], 'the hello does not say which attempt it belongs to')
})

test('the wait speaks to a guitarist, not to whoever wrote it', () => {
  /*
   * Photographed mid-generation on a phone:
   *
   *   ||| Sent to the model — waiting for the first line… · 6s
   *
   * Every word true, and none of it anybody's business but mine. It names
   * machines a player has no reason to know about, and it turns on a milestone
   * — the first line of the answer — that means nothing at all from outside.
   * The failure messages were worse: a server, a browser and a deployment, in
   * one sentence, to someone who wanted a rhythm tone.
   *
   * There is already a rule like this over the connection wording; it simply
   * never reached the part of the app that runs while somebody waits. The
   * words the model call actually uses stay exact in the generation log, which
   * is in Technical details, where a person goes to find out why rather than
   * what.
   */
  const jargon = /\bmodels?\b|\bservers?\b|\bbrowsers?\b|deployment|\bstream(ing)?\b|first line|\bpartials?\b|\btokens?\b|\bendpoint/i

  /** Sentences only: 'quiet-start' and the like are names, not words to read. */
  const sentences = (code) => {
    const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    return [...bare.matchAll(/'([^'\n]{12,})'|`([^`\n]{12,})`/g)]
      .map((m) => m[1] ?? m[2])
      // A quote-to-quote match can span the code between two literals, so
      // anything carrying punctuation prose never has is not prose.
      .filter((t) => t.includes(' ') && !/[{}<>[\]]|=>|\|\||\?\.|===/.test(t))
  }

  /*
   * Anchored on the call rather than sliced out of the file. A slice that
   * begins mid-expression starts counting quotes from the wrong one, and the
   * pairs come out shifted: the first draft of this test read ") setProgress("
   * as the sentence and never looked at the sentence itself — so it passed
   * with the photographed line put back.
   */
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const shown = [...app.matchAll(/setProgress\(\s*(?:'([^']*)'|`([^`]*)`)/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, 'N'))
    .filter((t) => t.includes(' '))
  assert.ok(shown.length >= 8, `only ${shown.length} progress lines found — the match is not finding them`)
  for (const said of shown) {
    assert.ok(!jargon.test(said), `shown while the app is working: "${said}"`)
  }

  const stream = readSrc(new URL('../src/lib/stream.js', import.meta.url), 'utf8')
  for (const said of sentences(stream)) {
    assert.ok(!jargon.test(said), `shown when a generation fails: "${said}"`)
  }

  // And the one thing a person actually wants to know when it goes wrong.
  const failures = sentences(stream).filter((t) => /ask again|try again/i.test(t))
  assert.ok(failures.length >= 4, `only ${failures.length} failure messages found — the slice missed some`)
  for (const said of failures) {
    assert.match(
      said,
      /written to your unit/,
      `a generation failed and never said whether the rig was touched: "${said}"`
    )
  }
})

test('the failure paths in App drop the half chain', () => {
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  for (const name of ['const generate = async', 'const refine = async']) {
    const at = app.indexOf(name)
    const c = app.indexOf('} catch (err) {', at)
    assert.match(app.slice(c, c + 160), /setPartial\(null\)/, `${name}'s catch leaves the partial chain on screen`)
  }
  assert.match(app, /e\.kind === 'retrying'/, 'the retry is invisible')
})

/* ------------------------------------------------------------------
   Names that read themselves
   ------------------------------------------------------------------ */

const { createNameScan } = await import('../src/lib/nameScan.js')

/** A scan over a fake unit: what was read, how it slept, and a hold you can set. */
function scanRig({ total = 8, known = [], failAt = [], onRead, sleep } = {}) {
  const cache = new Set(known)
  const reads = []
  const sleeps = []
  let held = false
  const scan = createNameScan({
    total,
    isKnown: (n) => cache.has(n),
    read: async (n) => {
      reads.push(n)
      onRead?.(n)
      if (failAt.includes(n)) throw new Error('no answer')
      cache.add(n)
    },
    sleep: async (ms) => {
      sleeps.push(ms)
      await sleep?.(ms)
    },
    quietGap: 600,
    holdPoll: 250,
    giveUpAfter: 3
  })
  scan.setHold(() => held)
  return { scan, reads, sleeps, cache, hold: (v) => (held = v) }
}

test('the quiet scan reads only what is unknown and leaves the port alone between slots', async () => {
  const r = scanRig({ known: [0, 2, 4] })
  assert.equal(await r.scan.run(), 'done')
  assert.deepEqual(r.reads, [1, 3, 5, 6, 7])
  assert.deepEqual(r.sleeps, [600, 600, 600, 600], 'a quiet scan slept somewhere other than between reads')
})

test('the quiet scan waits while the unit is in use; the eager one reads back to back', async () => {
  let polls = 0
  const r = scanRig({ total: 3, sleep: async (ms) => { if (ms === 250 && ++polls === 3) r.hold(false) } })
  r.hold(true)
  assert.equal(await r.scan.run(), 'done')
  assert.equal(polls, 3, 'the hold was not polled')
  assert.deepEqual(r.reads, [0, 1, 2])

  const e = scanRig({ total: 3 })
  e.hold(true)
  e.scan.setEager(true)
  assert.equal(await e.scan.run(), 'done')
  assert.deepEqual(e.reads, [0, 1, 2])
  assert.deepEqual(e.sleeps, [], 'an eager scan waited on the hold or slept between slots')
})

test('one slot failing is one slot; a run of them is a unit that has gone', async () => {
  const one = scanRig({ total: 6, failAt: [2] })
  assert.equal(await one.scan.run(), 'done')
  assert.deepEqual(one.reads, [0, 1, 2, 3, 4, 5])
  const gone = scanRig({ total: 10, failAt: [3, 4, 5, 6, 7] })
  assert.equal(await gone.scan.run(), 'failed')
  assert.deepEqual(gone.reads, [0, 1, 2, 3, 4, 5], 'three failures in a row and it kept asking')
})

test('stop ends the run after the read in flight, and the next run resumes from what is known', async () => {
  const r = scanRig({ total: 6, onRead: (n) => n === 2 && r.scan.stop() })
  assert.equal(await r.scan.run(), 'stopped')
  assert.deepEqual(r.reads, [0, 1, 2])
  assert.equal(r.scan.running, false)
  assert.equal(await r.scan.run(), 'done')
  assert.deepEqual(r.reads, [0, 1, 2, 3, 4, 5], 'the second run re-read what the first had learned')
})

test('a scan already running is not started twice', async () => {
  let release
  const r = scanRig({ total: 2, sleep: () => new Promise((res) => (release = res)) })
  const first = r.scan.run()
  await new Promise((res) => setTimeout(res, 0))
  assert.equal(r.scan.running, true)
  assert.equal(await r.scan.run(), 'running')
  release()
  assert.equal(await first, 'done')
})

/* ------------------------------------------------------------------
   The demo remembers its scene names, and its tuner holds a note
   ------------------------------------------------------------------ */

{
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  }
  const { storedSceneNames, keepSceneNames, DEFAULT_SCENE_NAMES, DEMO_SCENE_NAMES } = await import('../src/lib/demoMemory.js')
  const { createTunerStream } = await import('../src/lib/tunerStream.js')

  test('a demo scene name survives the mock being rebuilt', () => {
    // "Solo" was "4" again after a reload: the array came from a literal every time.
    assert.equal(storedSceneNames(), null, 'a fresh demo has kept names from nowhere')
    const names = DEFAULT_SCENE_NAMES.slice()
    names[3] = 'Solo'
    keepSceneNames(names)
    assert.deepEqual(storedSceneNames(), names)
    assert.ok(store.has(DEMO_SCENE_NAMES), 'the demo did not keep its own key')
    assert.ok(!store.has('fractal.sceneNames'), 'the demo wrote into the real-device cache')
    store.set(DEMO_SCENE_NAMES, '"not an array"')
    assert.equal(storedSceneNames(), null, 'a bad key is survived')
    store.set(DEMO_SCENE_NAMES, JSON.stringify(['a', 'b']))
    assert.equal(storedSceneNames(), null, 'the wrong number of names is survived')
    store.clear()
    // And the mock reads them: pinned by the structure guard on mockDevice.js.
  })

  test('the demo tuner holds a string, drifts a little and sometimes goes quiet', () => {
    // A seeded generator so the run is the same every time.
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const tuner = createTunerStream(random)
    const readings = Array.from({ length: 300 }, () => tuner.next())
    const sounding = readings.filter((r) => r.note)
    assert.ok(sounding.length >= 200, `the tuner was quiet ${300 - sounding.length} of 300 ticks`)
    assert.ok(readings.some((r) => r.note === '' && r.cents === null), 'the tuner never goes quiet, so the panel never shows "Play a string"')
    let changes = 0
    let jumps = 0
    for (let i = 1; i < readings.length; i++) {
      const a = readings[i - 1]
      const b = readings[i]
      if (!a.note || !b.note) continue
      if (a.note !== b.note || a.octave !== b.octave) changes++
      else if (Math.abs(a.cents - b.cents) > 4) jumps++
    }
    assert.ok(changes < sounding.length * 0.2, `the string changed on ${changes} of ${sounding.length} sounding ticks`)
    assert.equal(jumps, 0, `cents jumped by more than 4 between ticks ${jumps} times while the string held`)
    assert.ok(sounding.every((r) => Number.isInteger(r.cents) && Math.abs(r.cents) <= 50), 'a reading is not an integer within ±50 cents')
  })

  delete globalThis.localStorage
}

/* ------------------------------------------------------------------
   Leaving a popover
   ------------------------------------------------------------------ */

test('useDismiss: a tap outside or Escape closes, the trigger is ignored, focus goes back', async () => {
  // React's useEffect/useRef, driven by hand: run the effect, collect its cleanup.
  const listeners = new Map()
  let focused = null
  const trigger = { closest: (sel) => (sel === '.trigger' ? trigger : null) }
  const inside = { closest: () => null }
  const outside = { closest: () => null }
  const origin = { focus: () => (focused = origin) }
  globalThis.document = {
    activeElement: origin,
    contains: () => true,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type)
  }
  const React = await import('react')
  let cleanup = null
  const effects = []
  const fakeReact = {
    useRef: (v) => ({ current: v }),
    useEffect: (fn) => effects.push(fn)
  }
  // The hook imports React's hooks by name; run it against the fakes by re-binding.
  const src = readSrc(new URL('../src/lib/dismiss.js', import.meta.url), 'utf8')
    .replace("import { useEffect, useRef } from 'react'", '')
    .replace('export function useDismiss', 'function useDismiss')
  const useDismiss = new Function('useEffect', 'useRef', src + '\nreturn useDismiss')(fakeReact.useEffect, fakeReact.useRef)
  const closes = []
  const ref = { current: { contains: (el) => el === inside } }

  useDismiss(ref, () => closes.push('closed'), { open: true, ignore: '.trigger' })
  cleanup = effects.pop()()
  listeners.get('pointerdown')({ target: inside })
  assert.equal(closes.length, 0, 'a tap inside closed it')
  listeners.get('pointerdown')({ target: trigger })
  assert.equal(closes.length, 0, 'a tap on the trigger closed it (and would reopen it on the same tap)')
  listeners.get('pointerdown')({ target: outside })
  assert.equal(closes.length, 1, 'a tap outside did not close it')
  let stopped = false
  listeners.get('keydown')({ key: 'Escape', stopPropagation: () => (stopped = true) })
  assert.equal(closes.length, 2, 'Escape did not close it')
  assert.ok(stopped, 'Escape was let through to whatever else listens')
  listeners.get('keydown')({ key: 'Enter', stopPropagation: () => {} })
  assert.equal(closes.length, 2, 'a key other than Escape closed it')
  cleanup()
  assert.equal(listeners.size, 0, 'the listeners outlive the popover')
  assert.equal(focused, origin, 'focus did not go back to where it was')

  // Closed: nothing is listened for.
  effects.length = 0
  useDismiss(ref, () => closes.push('never'), { open: false })
  assert.equal(effects.pop()(), undefined)
  assert.equal(listeners.size, 0)
  delete globalThis.document
  void React
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

test('a unit that counts its chain from one is brought back to zero', () => {
  /*
   * "It shows five blocks when there's only four and it says add empty one —
   * if you add one, it actually saves it to the first block, but overwrites
   * the one that is listed as number two."
   *
   * The AM4 reports its four slots as 1..4 while the app counts from zero and
   * adds the wire's one back at the boundary. So every column arrived one too
   * high: four blocks drew five slots, the phantom one labelled 1, and filling
   * it wrote to wire slot 1 — on top of the block the screen was calling 2.
   */
  const linear = { slotModel: 'linear', slotCount: 4 }
  const am4 = [
    { name: 'Chorus', col: 1 },
    { name: 'Amp', col: 2 },
    { name: 'Delay', col: 3 },
    { name: 'Reverb', col: 4 }
  ]
  assert.deepEqual(
    slots.zeroBasedChain(am4, linear).map((b) => b.col),
    [0, 1, 2, 3],
    'the chain still starts at one, so the screen draws a slot that is not there'
  )

  // A grid unit already counts from zero and must be left exactly as it is.
  const grid = [{ name: 'Amp', col: 0 }, { name: 'Cab', col: 3 }]
  assert.deepEqual(slots.zeroBasedChain(grid, { slotModel: 'grid' }).map((b) => b.col), [0, 3])
  assert.equal(slots.zeroBasedChain(grid, { slotModel: 'grid' }), grid, 'a grid chain was needlessly rebuilt')

  /*
   * And the correction is not applied twice. A driver fixed upstream, or an
   * app that runs this on its own output, would otherwise shift a chain into
   * slot -1 — which the unit refuses outright.
   */
  const once = slots.zeroBasedChain(am4, linear)
  assert.deepEqual(slots.zeroBasedChain(once, linear).map((b) => b.col), [0, 1, 2, 3],
    'a chain already counting from zero was shifted below it')

  // Nothing to shift is not something to break on.
  assert.deepEqual(slots.zeroBasedChain([], linear), [])
  assert.equal(slots.zeroBasedChain(null, linear), null)
  assert.equal(slots.isLinearChain(linear), true)
  assert.equal(slots.isLinearChain({ slotModel: 'grid' }), false)
  assert.equal(slots.isLinearChain(undefined), false)
})

test('a hold is a press that stays put, and a right-click is not a middle-click', () => {
  /*
   * "If you can hold one of the effects for a few seconds... on the Mac
   * version, maybe we can do a right click."
   *
   * The two decisions a hold makes, held here because both are the kind that
   * fail quietly: a menu that opens while somebody is scrolling the stage
   * screen, and one that opens on a scroll-wheel click.
   */
  assert.equal(hold.holdStarts({ pointerType: 'touch' }), true)
  assert.equal(hold.holdStarts({ pointerType: 'pen' }), true)
  assert.equal(hold.holdStarts({ pointerType: 'mouse', button: 0 }), true)
  assert.equal(hold.holdStarts({ pointerType: 'mouse', button: 1 }), false, 'a middle-click opens a menu')
  assert.equal(hold.holdStarts({ pointerType: 'mouse', button: 2 }), false, 'a right-click would fire twice')

  const from = { x: 100, y: 100 }
  assert.equal(hold.movedOut(from, 100, 100), false)
  /* A thumb resting against a guitar moves a few pixels without anybody
     meaning it to; past the slop it is a scroll. */
  assert.equal(hold.movedOut(from, 106, 100), false, 'a resting thumb cancels the hold')
  assert.equal(hold.movedOut(from, 100, 118), true, 'a scroll still opens the menu')
  // Diagonal, so the distance is the hypotenuse rather than the larger axis.
  assert.equal(hold.movedOut(from, 108, 108), true, 'a diagonal drag is measured one axis at a time')
  assert.equal(hold.movedOut(null, 999, 999), false, 'a move with no press behind it counts as one')
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

/* ------------------------------------------------------------------
   Corrections — what the player fixes by hand, and what that is allowed
   to teach.

   Same quiet failure mode as taste, and a worse one: taste steers a
   generation, this one tells the model it has been getting something wrong.
   A pattern claimed from too little evidence is the app inventing a habit
   and then acting on it for good.
   ------------------------------------------------------------------ */

const fix = (param, from, to, extra = {}) => ({
  at: Date.now(),
  block: 'Amp 1',
  slug: 'amp',
  param,
  from,
  to,
  min: 0,
  max: 10,
  ...extra
})

console.log('\ncorrections')

test('one correction is an accident, not a habit', () => {
  assert.equal(corrections.patternsFrom([fix('Presence', 6, 4)]), null)
  assert.equal(corrections.patternsFrom([fix('Presence', 6, 4), fix('Presence', 7, 5)]), null)
})

test('the same fix, enough times, becomes something worth saying', () => {
  const p = corrections.patternsFrom([
    fix('Presence', 6, 4),
    fix('Presence', 7, 5),
    fix('Presence', 6, 4)
  ])
  assert.equal(p.controls.length, 1)
  assert.equal(p.controls[0].name, 'Presence')
  assert.equal(p.controls[0].way, 'down')
  assert.equal(p.controls[0].count, 3)
  assert.equal(p.controls[0].by, 2)
  assert.equal(p.controls[0].range, '0-10', 'the figure is quoted without the range it belongs to')
})

test('a control pushed both ways is being fiddled with, not corrected', () => {
  /*
   * The important negative. Someone who raises Presence as often as they lower
   * it has no habit here, and "this player usually turns Presence up" built
   * from a coin flip would steer every future generation on nothing.
   */
  const p = corrections.patternsFrom([
    fix('Presence', 5, 7),
    fix('Presence', 5, 3),
    fix('Presence', 5, 7),
    fix('Presence', 5, 3)
  ])
  assert.equal(p, null)
})

test('controls are grouped by name, because that is where the habit lives', () => {
  // Same control on three different amps is one habit, not three near-misses.
  const p = corrections.patternsFrom([
    fix('Presence', 6, 4, { block: 'Amp 1' }),
    fix('Presence', 6, 4, { block: 'Amp 2' }),
    fix('presence', 6, 4, { block: 'Amp 1' })
  ])
  assert.equal(p.controls.length, 1)
  assert.equal(p.controls[0].count, 3)
})

test('a figure is not quoted across ranges it does not belong to', () => {
  // 2 on a 0-10 control and 2 on a -80-20 one are not the same 2.
  const p = corrections.patternsFrom([
    fix('Presence', 6, 4),
    fix('Presence', 6, 4, { min: -80, max: 20 }),
    fix('Presence', 6, 4)
  ])
  assert.equal(p.controls[0].range, null)
})

test('what they say when it is wrong is counted, once it repeats', () => {
  const p = corrections.patternsFrom([
    { at: 1, note: 'darker' },
    { at: 2, note: 'Darker' },
    { at: 3, note: 'more gain' }
  ])
  assert.equal(p.words.length, 1, 'a phrase said once was treated as a habit')
  assert.equal(p.words[0].text, 'darker')
  assert.equal(p.words[0].count, 2)
})

test('the prose tells the model to start there, and not to repeat it back', () => {
  const prose = corrections.describeCorrections(
    corrections.patternsFrom([fix('Presence', 6, 4), fix('Presence', 7, 5), fix('Presence', 6, 4)])
  )
  assert.match(prose, /turn Presence down/)
  assert.match(prose, /first attempt/i, 'it reads as trivia rather than as an instruction')
  /*
   * The two guards that keep this from being worse than nothing: a player's
   * request now beats a habit, and the habit is never quoted back at them. A
   * model that opens with "I know you usually lower Presence" has turned a
   * quiet improvement into a boast about surveillance.
   */
  assert.match(prose, /do not mention them/i)
  assert.match(prose, /never let one override/i)
})

test('nothing to say is an empty string, not a paragraph saying so', () => {
  assert.equal(corrections.describeCorrections(null), '')
  assert.equal(corrections.describeCorrections({ controls: [], words: [], total: 0 }), '')
})

test('a correction that changes nothing is not a correction', () => {
  /*
   * Three of them, so this is decided by the rule rather than by the count
   * being too low to look at — which is how the first version of this test
   * passed while the code underneath built a habit out of "by NaN".
   */
  assert.equal(
    corrections.patternsFrom([fix('Presence', 5, 5), fix('Presence', 5, 5), fix('Presence', 5, 5)]),
    null
  )
})

/* ------------------------------------------------------------------
   The phone remote — which end this is, and whether the other end answers.

   The correction this whole module exists for: "connected" used to mean a
   channel had been joined, which is true with the Mac off and nothing
   answering. Nothing here may say connected unless the Mac answered.
   ------------------------------------------------------------------ */

/*
 * A marker is not a name.
 *
 * "Empty scene is still showing previous preset name" — slot 495, shown as
 * `<EMPTY>k Album Chug`. An empty gen-3 slot reports `<EMPTY>` written over the
 * front of a fixed run of characters rather than clearing it, so a short marker
 * on top of a longer old name leaves the old name's tail hanging off the end.
 * The app cannot fix that buffer; it can stop repeating it.
 */
console.log('\npreset names')

test('a marker with somebody else preset stuck to it is not a name', () => {
  assert.equal(names.isEmptySlotName('<EMPTY>k Album Chug'), true)
  assert.equal(names.cleanPresetName('<EMPTY>k Album Chug'), '', 'the rubble is kept')
  assert.equal(names.presetLabel({ name: '<EMPTY>k Album Chug' }), 'Empty')
})

test('the marker is recognised however the unit spaces it', () => {
  for (const raw of ['<EMPTY>', ' <EMPTY> ', '<empty>', '< Empty >'])
    assert.equal(names.isEmptySlotName(raw), true, raw)
})

test('a preset somebody named is left alone', () => {
  /*
   * The negative that matters. Matching anywhere in the string would rename
   * somebody's own preset, which is a worse failure than the one being fixed —
   * it is their work, and they chose the word.
   */
  for (const raw of ['Empty Room Verb', 'Nearly <EMPTY> Chug', 'JN Metal Zone'])
    assert.equal(names.isEmptySlotName(raw), false, raw)
  assert.equal(names.cleanPresetName('  JN Metal Zone  '), 'JN Metal Zone')
  assert.equal(names.presetLabel({ name: 'Empty Room Verb' }), 'Empty Room Verb')
})

test('an empty slot and an unnamed preset do not read the same', () => {
  // Untitled is something somebody made and did not name. Empty is nothing.
  assert.equal(names.presetLabel({ name: '' }), 'Untitled')
  assert.equal(names.presetLabel({ name: '   ' }), 'Untitled')
  assert.equal(names.presetLabel({ name: '', empty: true }), 'Empty')
  assert.equal(names.presetLabel(null), 'Untitled')
})

/*
 * Slots the unit does not have.
 *
 * "Tries switching scenes to slot 500 and it didn't work — Preset location
 * index must be integer 0..103, got 500."
 *
 * Not the scenes: a save parked from one machine and carried out on another,
 * aimed at a slot the attached unit has never had. It came from `?? 512` — the
 * gen-3 count, used as a default for every unit including the ones whose
 * driver reports no count at all — and it reappeared every six seconds,
 * because a parked save that fails is retried.
 */
console.log('\nslot ranges')

test('a unit that has not said how many it holds is not given a number', () => {
  assert.equal(slots.slotCount({}), null)
  assert.equal(slots.slotCount({ presets: {} }), null)
  assert.equal(slots.slotCount({ presets: { count: 0 } }), null)
  assert.equal(slots.slotCount({ presets: { count: 104 } }), 104)
})

test('a slot past the end is refused once the unit has said where the end is', () => {
  const am4 = { presets: { count: 104 } }
  assert.equal(slots.slotOutside(500, am4), true)
  assert.equal(slots.slotOutside(103, am4), false)
  assert.equal(slots.slotOutside(104, am4), true)
  assert.equal(slots.slotOutside(-1, am4), true)
})

test('a unit that has said nothing still gets the benefit of the doubt', () => {
  /*
   * The negative that keeps this from being worse than the bug. Refusing every
   * slot on a unit whose driver never reports a count would turn one wrong
   * save into a Save button that never works.
   */
  assert.equal(slots.slotOutside(500, {}), false)
  assert.equal(slots.slotOutside(5, undefined), false)
})

test('a unit that states its size while refusing is listened to', () => {
  assert.equal(
    slots.countFromRefusal('Preset location index must be integer 0..103, got 500.'),
    104,
    'the one place some units ever say how big they are'
  )
  assert.equal(slots.countFromRefusal('location (0..511) required'), 512)
})

test('a refusal that states no range teaches nothing', () => {
  // Narrow on purpose: a number in an unrelated message must not become the
  // unit's size, which would be a worse wrong answer than having none.
  assert.equal(slots.countFromRefusal('the port is busy, try again'), null)
  assert.equal(slots.countFromRefusal('slot 500 is empty'), null)
  assert.equal(slots.countFromRefusal(''), null)
  assert.equal(slots.countFromRefusal(null), null)
})

/*
 * A unit that is busy is not a unit that is gone.
 *
 * "I'm on the FM3. As soon as I hit next or select a scene, it goes to the
 * screen where it says not connected again."
 *
 * Next tells the unit to load a preset and then reads back what is loaded.
 * On hardware that read lands while the unit is still working, the answer is
 * "no unit", and the app believed it — a working rig replaced by a No unit
 * found screen with the guitar still plugged in.
 */
console.log('\nsettling')

const never = async () => {
  throw new Error('this should not have been asked')
}

test('a unit that answers on the second ask is not declared gone', async () => {
  const answers = [{ connected: false }, { connected: true, short: 'FM3' }]
  let waited = 0
  const info = await ds.confirmedDetect({
    detect: async () => answers.shift(),
    wait: async (ms) => {
      waited += ms
    },
    wasLive: true
  })
  assert.equal(info.short, 'FM3')
  assert.ok(waited > 0, 'it asked again with no pause at all, which asks the same busy port')
})

test('a unit that throws once is not declared gone either', async () => {
  // The likelier shape on a relay: the call does not answer false, it fails.
  let n = 0
  const info = await ds.confirmedDetect({
    detect: async () => {
      if (++n === 1) throw new Error('timed out')
      return { connected: true }
    },
    wait: async () => {},
    wasLive: true
  })
  assert.equal(info.connected, true)
  assert.equal(n, 2)
})

test('a unit that really is gone is still reported', async () => {
  let n = 0
  const info = await ds.confirmedDetect({
    detect: async () => {
      n++
      return { connected: false }
    },
    wait: async () => {},
    wasLive: true
  })
  assert.equal(info.connected, false, 'a missing unit was reported as present')
  assert.equal(n, ds.SETTLE_TRIES, 'it gave up early or kept asking for ever')
})

test('a failure every time is the caller own to report, not a quiet null', async () => {
  await assert.rejects(
    ds.confirmedDetect({
      detect: async () => {
        throw new Error('the Mac stopped answering')
      },
      wait: async () => {},
      wasLive: true
    }),
    /stopped answering/
  )
})

test('a phone does not take the first no from a busy port', async () => {
  /*
   * "Says it's connected but says no unit. The unit is connected — if I hit
   * Try again like five or six times it will actually connect."
   *
   * Nothing was live, so the wasLive rule does not apply and one no would have
   * stood. But a phone's ask is a handshake down a port the Mac's own page is
   * already polling, and a handshake that lands mid-poll misses. Five or six
   * taps by hand is the evidence; this is those taps.
   */
  let n = 0
  const info = await ds.confirmedDetect({
    detect: async () => ({ connected: ++n >= 4 }),
    wait: async () => {},
    wasLive: false,
    remote: true
  })
  assert.equal(info.connected, true, 'the phone believed the first no and showed "no unit"')
  assert.equal(n, 4, 'it kept asking after it had its answer')
})

test('a phone gives up eventually rather than asking for ever', async () => {
  let n = 0
  let waited = 0
  const info = await ds.confirmedDetect({
    detect: async () => ({ connected: false }),
    wait: async (ms) => {
      n++
      waited += ms
    },
    wasLive: false,
    remote: true
  })
  assert.equal(info.connected, false, 'an empty rig was reported as present')
  assert.equal(n, ds.RELAY_TRIES - 1, `it asked ${n + 1} times, not ${ds.RELAY_TRIES}`)
  assert.ok(waited > 0, 'it asked again with no pause, which asks the same busy port')
})

test('at the Mac the first no still stands', async () => {
  /*
   * The other half. There is no relay and no second client on the port, so a
   * no is a no — and putting several seconds in front of everybody who opens
   * the app with nothing plugged in is the cost this avoids.
   */
  let n = 0
  await ds.confirmedDetect({
    detect: async () => {
      n++
      return { connected: false }
    },
    wait: never,
    wasLive: false,
    remote: false
  })
  assert.equal(n, 1, 'the Mac now waits out a retry loop for an empty rig')
})

test('nothing was live, so the first answer stands', async () => {
  /*
   * The other half of the rule, and the reason this is not just a retry: an
   * empty rig at startup must still say so at once. Asking three times would
   * put a second and a half in front of every person who opens the app with
   * nothing plugged in.
   */
  let n = 0
  const info = await ds.confirmedDetect({
    detect: async () => {
      n++
      return { connected: false }
    },
    wait: never,
    wasLive: false
  })
  assert.equal(info.connected, false)
  assert.equal(n, 1, 'a rig that was never live was asked more than once')
})

/*
 * The bar, the chip and the notice have to tell one story.
 *
 * A real phone showed all three at once: "NOT CONNECTED" on the left, a chip
 * reading "connected", and a red notice explaining that the Mac was connected
 * and no unit was plugged into it. Every one of them was true about a
 * different thing, and together they were nonsense.
 */
test('a Mac that answered with no unit on it does not read as not connected', () => {
  const said = link.describeUnit({
    role: 'remote',
    link: 'connected',
    status: 'fault',
    device: { connected: false }
  })
  assert.equal(said.unit, 'No unit', 'the bar contradicts the chip beside it')
  assert.equal(said.lamp, 'fault', 'a cable the player can go and check is not a quiet state')
})

test('a phone that has not reached the Mac stays quiet about it', () => {
  // The reason the bar went quiet in the first place: red over a screen that
  // is calmly asking you to connect is the loud wrong answer.
  for (const state of ['off', 'joining', 'no-answer']) {
    const said = link.describeUnit({ role: 'remote', link: state, status: 'fault' })
    assert.equal(said.unit, 'Not connected', state)
    assert.equal(said.lamp, 'idle', state)
  }
})

test('a connected phone still reading the unit says so', () => {
  const said = link.describeUnit({ role: 'remote', link: 'connected', status: 'idle' })
  assert.equal(said.unit, 'Looking…')
})

test('a live unit is named, wherever the app is running', () => {
  assert.equal(
    link.describeUnit({ role: 'remote', link: 'connected', status: 'live', device: { short: 'AM4' } })
      .unit,
    'AM4'
  )
  assert.equal(
    link.describeUnit({ role: 'mac', link: 'connected', status: 'live', device: { short: 'FM3' } })
      .unit,
    'FM3'
  )
})

test('at the Mac, a missing unit is still a missing device', () => {
  // Nothing above changes the end with the cable in it.
  const said = link.describeUnit({ role: 'mac', link: 'connected', status: 'fault' })
  assert.equal(said.unit, 'No device')
  assert.equal(said.lamp, 'fault')
})

test('the demo lamp outranks whatever the unit is doing', () => {
  assert.equal(link.describeUnit({ demo: true, role: 'mac', status: 'live' }).lamp, 'demo')
  assert.equal(
    link.describeUnit({ demo: true, role: 'remote', link: 'connected', status: 'fault' }).lamp,
    'demo'
  )
})

test('connected means the Mac answered, never merely that a channel was joined', () => {
  const base = { role: 'remote', hasSession: true, joining: false, channelUp: true }
  assert.equal(
    link.deriveLink({ ...base, hostSeen: false }),
    'no-answer',
    'a joined channel with nothing answering on it was called connected — the exact lie this replaces'
  )
  assert.equal(link.deriveLink({ ...base, hostSeen: true }), 'connected')
  assert.equal(link.deriveLink({ ...base, channelUp: false, hostSeen: true }), 'no-answer', 'a dropped socket is not connected')
  assert.equal(link.deriveLink({ ...base, joining: true }), 'joining')
  assert.equal(link.deriveLink({ ...base, hasSession: false }), 'signed-out')
  assert.equal(
    link.deriveLink({ ...base, hostSeen: true, wantsAuto: false }),
    'off',
    'a deliberate Disconnect was reported as the Mac not answering'
  )
})

test('the Mac is connected when it is listening, and wifi always is', () => {
  assert.equal(link.deriveLink({ role: 'mac', cloudUser: null, hostOn: true }), 'signed-out')
  assert.equal(link.deriveLink({ role: 'mac', cloudUser: { email: 'j@x' }, hostOn: false }), 'off')
  assert.equal(link.deriveLink({ role: 'mac', cloudUser: { email: 'j@x' }, hostOn: true }), 'connected')
  assert.equal(link.deriveLink({ role: 'wifi', hasSession: false, hostSeen: false }), 'connected')
})

test('a wifi phone is not mistaken for the Mac', () => {
  /*
   * A page served from the Mac has the helper as its own origin, so the
   * "is the helper at localhost" probe answers yes on the phone too. Only
   * the hostname tells the Mac app's own window from a phone that scanned
   * the QR.
   */
  assert.equal(link.detectRole({ demo: false, served: true, hostname: 'localhost', helperAlive: true }), 'mac')
  assert.equal(link.detectRole({ demo: false, served: true, hostname: '10.0.0.5', helperAlive: true }), 'wifi', 'a phone on wifi was told it is the Mac')
  assert.equal(link.detectRole({ demo: false, served: false, hostname: 'fractal.newbold.cloud', helperAlive: true }), 'mac')
  assert.equal(link.detectRole({ demo: false, served: false, hostname: 'fractal.newbold.cloud', helperAlive: false }), 'remote')
  assert.equal(link.detectRole({ demo: true, served: false, hostname: 'x', helperAlive: false }), 'mac', 'demo simulates the Mac')
})

test('asking again backs off but never stops', () => {
  const seq = []
  let d = 0
  for (let i = 0; i < 7; i++) {
    d = link.nextDelay(d)
    seq.push(d)
  }
  assert.deepEqual(seq, [3000, 6000, 12000, 24000, 30000, 30000, 30000])
})

test('what the link says contains no plumbing', () => {
  const jargon = /supabase|relay|channel|helper|npm|\.env|uid|anon|realtime|forgefx/i
  const states = []
  for (const role of ['mac', 'wifi', 'remote']) {
    for (const l of ['off', 'signed-out', 'joining', 'no-answer', 'connected']) {
      states.push({ role, link: l, account: { email: 'j@x.com' }, macName: null })
      states.push({ role, link: l, account: null, macName: 'Studio Mac' })
    }
  }
  for (const st of states) {
    const said = link.describeLink(st)
    for (const key of ['word', 'sentence', 'note']) {
      assert.ok(!jargon.test(said[key]), `${st.role}/${st.link} ${key}: "${said[key]}"`)
    }
  }
  assert.match(link.describeLink({ role: 'remote', link: 'connected', macName: 'Studio Mac' }).sentence, /Connected to Studio Mac/)
  assert.equal(link.describeLink({ role: 'remote', link: 'connected' }).tone, 'good')
  assert.equal(link.describeLink({ role: 'remote', link: 'no-answer' }).tone, 'bad', 'no answer must read as a fault, not as connected')
  // The Mac's chip names the thing, not the chore: "set up" beside Save read as another verb.
  assert.equal(link.describeLink({ role: 'mac', link: 'signed-out', account: null }).word, 'remote')
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
