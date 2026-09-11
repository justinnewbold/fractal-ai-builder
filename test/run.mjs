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
import { forbiddenRemotely, explainAuth, timeoutFor, hostNamesFrom, hostConflict } from '../src/lib/remote.js'
import * as taste from '../src/lib/taste.js'
import * as link from '../src/lib/link.js'
import * as corrections from '../src/lib/corrections.js'
import * as slots from '../src/lib/slots.js'
import * as names from '../src/lib/presetName.js'
import * as hold from '../src/lib/longPress.js'
import * as lineage from '../src/lib/lineage.js'
import * as gigSize from '../src/lib/gigSize.js'
import * as marks from '../src/lib/presetMarks.js'
import * as setlists from '../src/lib/setlists.js'
import { historyTurns, describeDesign } from '../api/command.js'
import * as palette from '../src/lib/palette.js'
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
  /*
   * In decibels, in decibels. A block Level runs -80 to +20 dB, and a fifth of
   * that range is -60 dB — silence, not a floor — while 15% of it is a 15 dB
   * step, which is not a nudge. Both ends are read in dB on a dB control: six
   * either way from where it sits.
   */
  const amp = levelLimits({ name: 'Amp 1 Level', value: 0, min: -80, max: 20 })
  assert.deepEqual(amp, { floor: -6, ceiling: 6 })

  const drive = levelLimits({ name: 'Drive Level', value: 5, min: 0, max: 10 })
  assert.deepEqual(drive, { floor: 3.5, ceiling: 6.5 })

  /*
   * Sitting below the floor already — the player's own doing. The window runs
   * from where it sits up to a nudge above, so the only move offered is a
   * raise. The app never drags a level back up on its own; it just will not go
   * down.
   */
  const low = levelLimits({ name: 'Amp 1 Level', value: -70, min: -80, max: 20 })
  assert.deepEqual(low, { floor: -70, ceiling: 0 })

  /*
   * "Amp 1 / Amp1 Level: levels can be nudged, not reset — 0 is outside -80 to
   * -60, so it was skipped." Five of those in one session, across two blocks.
   *
   * A level sitting at the very bottom of a dB range is a block that makes no
   * sound, and the only useful thing to do with it is bring it back to normal.
   * The old window let it climb to -60 dB, which is still silence, and refused
   * every value a tone would actually want. So unity is always in reach from
   * below: no raise towards it can make a preset quiet, which is the one thing
   * this rule exists to prevent.
   */
  for (const at of [-80, -70, -40, -12]) {
    const w = levelLimits({ name: 'Amp1 Level', value: at, min: -80, max: 20, unit: 'dB' })
    assert.ok(w.ceiling >= 0, `a level at ${at} dB cannot be brought back to unity: ${w.ceiling}`)
  }

  /* And it is still a one-way door out of the quiet end: nowhere in the range
     may a write be offered a step down past -20 dB, which is the point a block
     leaves the mix. Above that a level may still be trimmed, which is what the
     control is for. */
  for (const at of [20, 10, 0, -6, -20, -55, -80]) {
    const w = levelLimits({ name: 'Amp1 Level', value: at, min: -80, max: 20, unit: 'dB' })
    assert.ok(
      w.floor >= Math.min(at, -20),
      `a level at ${at} dB can be written down to ${w.floor}`
    )
  }

  /*
   * "Drive 1 / Level: levels can be nudged, not reset — 5 is outside 2 to 1.5,
   * so it was skipped."
   *
   * A range with no numbers in it, printed to a player mid-session. The two
   * ends were worked out independently, so a control already at the very bottom
   * got a floor above its own ceiling and nothing at all could be written —
   * which made a level sitting at zero the one value in the app that could
   * never be raised, on exactly the preset that needs it raised.
   */
  const floored = levelLimits({ name: 'Drive 1 Level', value: 0, min: 0, max: 10 })
  assert.deepEqual(floored, { floor: 0, ceiling: 2 })

  /*
   * And that is a property, not one repaired case: wherever a level sits, that
   * is a value the window admits. Any window that excludes it is a rejection
   * with no number that would have been accepted, printed as a range that reads
   * backwards.
   */
  for (const min of [-80, -20, 0, 1]) {
    for (const max of [-10, 0, 10, 20, 100]) {
      if (max <= min) continue
      for (const at of [0, 0.01, 0.05, 0.2, 0.5, 0.8, 1]) {
        const value = min + (max - min) * at
        const w = levelLimits({ name: 'Amp 1 Level', value, min, max })
        assert.ok(
          w.floor <= value && value <= w.ceiling,
          `${value} of ${min}-${max} is outside its own window ${w.floor} to ${w.ceiling}`
        )
        assert.ok(w.floor >= min && w.ceiling <= max, `the window leaves the parameter's range`)
      }
    }
  }

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

test('drops an unknown block, and says so once', () => {
  const r = validateSpec({ blocks: [{ eid: 999, params: [] }] }, schema)
  assert.equal(r.changes.length, 0)
  assert.match(r.problems[0], /not in this preset/)
  assert.match(r.problems[0], /Amp 1 \(58\)/, 'the ids the preset does hold are the half that names the mismatch')

  /*
   * The same sentence per rejected change turned a preset with nothing in it
   * into six identical lines under a heading reading REJECTED DURING CHECKING.
   * The reader learns nothing from the second copy. The count stays, because
   * how much of the answer went missing is the part worth knowing.
   */
  const many = validateSpec(
    { blocks: [94, 118, 58, 58, 66].map((eid) => ({ eid, params: [] })) },
    []
  )
  const dropped = many.problems.filter((p) => /dropped/.test(p))
  assert.equal(dropped.length, 1, `said ${dropped.length} times: ${dropped.join(' / ')}`)
  assert.match(dropped[0], /all 5 changes/, 'the number dropped is not said')
  assert.match(dropped[0], /empty/, 'an empty preset is not named as the reason')
  assert.ok(
    many.problems.some((p) => /add an amp and a cab/.test(p)),
    'nothing says how to get blocks into an empty preset'
  )
})

/*
 * A block the tone wanted and the preset does not have.
 *
 * "Skipped effect 70 — no such block in this preset." The AM4 run that reported
 * that was asking for three blocks its four slots never held, and every change
 * riding on them died at the check above. The ids are constrained at the schema
 * now; this is where the intent behind them is supposed to land instead.
 */
test('carries what the tone wanted but could not reach', () => {
  const r = validateSpec({ blocks: [], wanted: ['delay', 'Wah'] }, schema)
  assert.deepEqual(r.wanted, ['delay', 'wah'])
  assert.equal(r.problems.length, 0, 'a gap in the chain is not a rejection')
})

test('a wanted list is names only, capped and deduplicated', () => {
  const r = validateSpec(
    {
      blocks: [],
      wanted: ['delay', 'DELAY', '  pitch  ', 7, null, 'a'.repeat(80), 'b', 'c', 'd', 'e', 'f', 'g']
    },
    schema
  )
  assert.ok(r.wanted.length <= 6, `capped, got ${r.wanted.length}`)
  assert.equal(new Set(r.wanted).size, r.wanted.length, 'deduplicated')
  assert.ok(r.wanted.includes('pitch'), 'trimmed')
  assert.ok(
    r.wanted.every((w) => typeof w === 'string' && w.length <= 24),
    'every entry is a short string'
  )
})

test('no wanted list at all is an empty one, never undefined', () => {
  assert.deepEqual(validateSpec({ blocks: [] }, schema).wanted, [])
  assert.deepEqual(validateSpec(null, schema).wanted, [])
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

/*
 * Copying up, twice, and from the store the Mac actually uses.
 *
 * Both sides of the network are injected here, so what is under test is the
 * rule about what gets sent — which is the part that was wrong — rather than
 * Supabase.
 */
const tone = (name, description, spec = { blocks: [] }) => ({ name, description, spec })
const {
  signatureOf,
  newestFirst: newestFirstEntries,
  notOnAccount: notOnAccountCount
} = await import('../src/lib/history.js')

test('a preset already on the account is not sent again', async () => {
  /*
   * Every insert was unconditional. So the button was safe to press exactly
   * once, and doubled the account every time after — and nothing about a
   * button reading "copy your presets up" says it may only ever be pressed
   * once. Someone who pressed it twice had two of everything, for ever.
   */
  const sent = []
  const result = await cloud.pushLocalPresets(
    [tone('Black Album', 'tight and scooped'), tone('Bulls & Boxcars', 'open and ringing')],
    null,
    {
      existing: async () => [tone('Black Album', 'tight and scooped')],
      save: async (e) => sent.push(e.name)
    }
  )
  assert.deepEqual(sent, ['Bulls & Boxcars'])
  assert.equal(result.saved, 1)
  assert.equal(result.skipped, 1)
})

test('two takes on one prompt are two presets, not one', () => {
  // The signature is name plus description for exactly this reason: a
  // refinement carries the instruction that made it, so it is its own tone.
  assert.notEqual(
    signatureOf(tone('Lead', 'more gain')),
    signatureOf(tone('Lead', 'more gain, less fizz'))
  )
})

test("a design in the folder is copied up, not just the browser's", async () => {
  /*
   * The one that made this useless where it mattered. On a Mac with a folder
   * chosen, a design is written to disk INSTEAD of browser storage — so the
   * machine holding the whole stranded library had, by the old reckoning,
   * nothing to copy. A folder listing is a name and a time, so an item may be
   * a way to fetch a tone rather than the tone.
   */
  const sent = []
  const result = await cloud.pushLocalPresets(
    [{ name: 'From the folder', at: 1, load: async () => tone('From the folder', 'a file on disk') }],
    null,
    { existing: async () => [], save: async (e) => sent.push(e.description) }
  )
  assert.deepEqual(sent, ['a file on disk'])
  assert.equal(result.saved, 1)
})

test('a folder design already on the account is matched on what is inside it', async () => {
  // Its description lives in the file, so the signature before loading is not
  // the signature it will have. Resolved first, then checked — the other way
  // round skips the wrong things.
  const sent = []
  const result = await cloud.pushLocalPresets(
    [{ name: 'Bulls & Boxcars', load: async () => tone('Bulls & Boxcars', 'open and ringing') }],
    null,
    {
      existing: async () => [tone('Bulls & Boxcars', 'open and ringing')],
      save: async (e) => sent.push(e.name)
    }
  )
  assert.deepEqual(sent, [])
  assert.equal(result.skipped, 1)
})

test('the same tone in both stores is sent once', async () => {
  // Browser storage and the folder can both hold it — the set grows as the
  // batch runs so the second copy is skipped like any other duplicate.
  const sent = []
  await cloud.pushLocalPresets(
    [tone('Twice', 'here and there'), { name: 'Twice', load: async () => tone('Twice', 'here and there') }],
    null,
    { existing: async () => [], save: async (e) => sent.push(e.name) }
  )
  assert.deepEqual(sent, ['Twice'])
})

test('a file that cannot be read is reported, and the rest still go', async () => {
  const sent = []
  const result = await cloud.pushLocalPresets(
    [
      { name: 'Gone', load: async () => { throw new Error('The folder is not open.') } },
      tone('Fine', 'still here')
    ],
    null,
    { existing: async () => [], save: async (e) => sent.push(e.name) }
  )
  assert.deepEqual(sent, ['Fine'])
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0], /Gone — The folder is not open\./)
})

test('a folder listing shown beside its own account copy is one row, not two', () => {
  /*
   * Copying to the account is what creates this: the same tone is then a file
   * on disk AND a row on the account. A listing has no description, so it
   * matched nothing and survived every dedupe — which would have made the fix
   * above show every rescued preset twice.
   */
  const shown = newestFirstEntries(
    [{ name: 'Bulls & Boxcars', description: 'open and ringing', spec: {}, at: 2 }],
    [{ name: 'Bulls & Boxcars', at: 1, where: 'folder' }]
  )
  assert.equal(shown.length, 1)
  assert.equal(shown[0].where, undefined, 'the one that can be opened anywhere is the one kept')
})

test('the heading counts what is stranded, not what is kept', () => {
  /*
   * The number goes in a panel heading that is folded shut, which is the only
   * place someone learns there is anything to do without opening it first. So
   * it has to count what is missing, not what exists: "copy your 40 presets up"
   * over an account already holding 39 describes work nobody needs.
   */
  const local = [tone('One', 'a'), tone('Two', 'b'), tone('Three', 'c')]
  assert.equal(notOnAccountCount(local, []), 3, 'nothing on the account means all of it is stranded')
  assert.equal(notOnAccountCount(local, [tone('Two', 'b')]), 2)
  assert.equal(notOnAccountCount(local, local), 0)
})

test('a folder entry is counted on its name, because that is all a listing has', () => {
  /*
   * Its description is inside the file and this runs on every render. Exact for
   * browser storage, a good-faith estimate for a folder — and overstating is
   * the safe direction: the correction arrives as "3 were already there", not
   * as a library quietly left behind.
   */
  const stub = { name: 'Bulls & Boxcars', at: 1 }
  assert.equal(notOnAccountCount([stub], [tone('Bulls & Boxcars', 'open and ringing')]), 0)
  assert.equal(notOnAccountCount([stub], [tone('Something else', 'open and ringing')]), 1)
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

console.log('\nthe order a tone is written in')

const steps = await import('../shared/tone-steps.mjs')

const oneBlock = (extra) => [{ eid: 3, name: 'Amp 1', params: [], ...extra }]

test('a channel is set before the values that belong to it', () => {
  /*
   * A block's parameters belong to the channel it is on. Dial gain on A and
   * then move the block to B and you have dialled a channel nobody hears — and
   * nothing errors, which is what makes this worth pinning.
   */
  const order = steps
    .stepsFor(oneBlock({ channel: 1, params: [{ id: 1, name: 'Gain', to: 6 }] }))
    .map((s) => s.kind)
  assert.deepEqual(order, ['channel', 'reread', 'param'])
})

test('a model is swapped before anything is dialled on it', () => {
  /* Swapping a model replaces the whole parameter set. */
  const order = steps
    .stepsFor(oneBlock({ type: 42, typeName: 'Recto', params: [{ id: 1, name: 'Gain', to: 6 }] }))
    .map((s) => s.kind)
  assert.deepEqual(order, ['type', 'reread', 'param'])
})

test('ranges are re-read whenever the block moved, and never when it did not', () => {
  /*
   * Ranges belong to the model on the channel — a Plexi's gain and a Recto's
   * gain are the same word over a different span, so a value computed against
   * the old range lands somewhere else entirely.
   *
   * It is a STEP rather than something the executor is trusted to remember,
   * because leaving it out is silent: every value still writes.
   */
  const moved = steps.stepsFor(oneBlock({ channel: 2, params: [{ id: 1, name: 'Gain', to: 6 }] }))
  assert.ok(moved.some((s) => s.kind === 'reread'), 'a moved block is dialled against the ranges it used to have')

  const still = steps.stepsFor(oneBlock({ params: [{ id: 1, name: 'Gain', to: 6 }] }))
  assert.ok(!still.some((s) => s.kind === 'reread'), 'a block that did not move pays for a read it does not need')
})

test('bypass is last, so nothing is briefly audible half-dialled', () => {
  /*
   * A block switched on before its values land is a noise through the amp at
   * exactly the moment somebody is listening to hear whether the tone worked.
   */
  const order = steps
    .stepsFor(oneBlock({ bypassed: false, params: [{ id: 1, name: 'Gain', to: 6 }] }))
    .map((s) => s.kind)
  assert.deepEqual(order, ['param', 'bypass'])
})

test('the whole order, on a block that changes everything at once', () => {
  const order = steps
    .stepsFor(
      oneBlock({
        channel: 1,
        type: 42,
        typeName: 'Recto',
        bypassed: false,
        params: [{ id: 1, name: 'Gain', to: 6 }, { id: 2, name: 'Master', to: 5 }]
      })
    )
    .map((s) => s.kind)
  assert.deepEqual(order, ['channel', 'type', 'reread', 'param', 'param', 'bypass'])
})

test('the count a progress line shows includes the re-read', () => {
  /*
   * A bar that skips it stalls visibly on every block that changed model while
   * claiming nothing is happening.
   */
  assert.equal(steps.stepCount(oneBlock({ channel: 1, params: [{ id: 1, name: 'G', to: 1 }] })), 3)
  assert.equal(steps.stepCount([]), 0)
  assert.equal(steps.stepCount(null), 0)
})

test('a step says what it is doing in words both apps will use', () => {
  const [channel] = steps.stepsFor(oneBlock({ channel: 2 }))
  assert.equal(channel.label, 'Amp 1 → channel 2')
  const [, , param] = steps.stepsFor(
    oneBlock({ channel: 2, params: [{ id: 1, name: 'Gain', to: 6, unit: 'dB' }] })
  )
  assert.equal(param.label, 'Amp 1 · Gain → 6dB')
})

test('rubbish in the plan is skipped rather than written somewhere', () => {
  /* A change with no block id cannot name a target, and guessing one writes to
     whatever block happens to be there. */
  assert.deepEqual(steps.stepsFor([null, {}, { eid: 'two' }]), [])
})

test('scenes go after the rig, never with it', () => {
  /*
   * A scene records WHICH BLOCKS ARE ON, not what they sound like. Write them
   * the other way round and every scene is a pattern over a preset that has not
   * been dialled yet.
   */
  assert.equal(steps.rigBeforeScenes([{ eid: 1 }], [{ index: 0 }]), true)
  assert.equal(steps.rigBeforeScenes([], [{ index: 0 }]), false)
  assert.equal(steps.rigBeforeScenes([{ eid: 1 }], []), false)
})

test('the browser still writes in the order the phone does', () => {
  /*
   * The one place these can drift. forgefx.js has carried this order since
   * before it was written down, in numbered comments; the phone reads it off
   * shared/tone-steps.mjs. If somebody reorders the loop over there, the two
   * apps write different presets from the same plan and neither errors.
   */
  const src = readSrc(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export async function applyChanges'))
  const marks = [
    '1. the channel these values belong to',
    '2. the model on it',
    '3. re-read ranges if either moved',
    '4. parameters, then bypass'
  ]
  let at = -1
  for (const mark of marks) {
    const found = body.indexOf(mark)
    assert.ok(found > -1, `applyChanges no longer says "${mark}" — the order it writes in is unpinned`)
    assert.ok(found > at, `applyChanges moved "${mark}" out of order, so the two apps write differently`)
    at = found
  }
})

console.log('\nplay mode')

const play = await import('../src/lib/playMode.js')

/* A store that behaves like the real one, and one that throws like a private
   window does. */
const playStore = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v))
  }
}
const blockedStore = {
  getItem: () => {
    throw new Error('site data is blocked')
  },
  setItem: () => {
    throw new Error('site data is blocked')
  }
}

test('a phone that has never heard of play mode shows the Ask button', () => {
  /*
   * Off by default, because a switch that HIDES things has to be asked for.
   * Defaulting it on would restore the button and then hide it, which reads as
   * the button never having come back.
   */
  assert.equal(play.loadPlayMode(playStore()), false)
})

test('the switch is remembered on this phone', () => {
  const store = playStore()
  assert.equal(play.savePlayMode(true, store), true)
  assert.equal(play.loadPlayMode(store), true)
  play.savePlayMode(false, store)
  assert.equal(play.loadPlayMode(store), false)
})

test('a browser that will not store anything still renders a stage screen', () => {
  /*
   * A private window throws on read AND on write. The screen this switch sits
   * on is the one someone is looking at in the dark, so neither may be a
   * crash — the read falls back to showing the button, and the write reports
   * that it did not stick rather than throwing through the tap.
   */
  assert.equal(play.loadPlayMode(blockedStore), false)
  assert.equal(play.savePlayMode(true, blockedStore), false)
})

test('the Ask button waits for a unit, stays off its own screen, and goes when playing', () => {
  /*
   * Three parts, and the first two are the ones easy to lose. There is nothing
   * to ask about before a unit has answered, and offering to open the
   * conversation you are already reading is a button that does nothing.
   */
  assert.equal(play.askButtonShows({ status: 'live', view: 'play', playing: false }), true)
  assert.equal(play.askButtonShows({ status: 'idle', view: 'play', playing: false }), false)
  assert.equal(play.askButtonShows({ status: 'live', view: 'ask', playing: false }), false)
  assert.equal(play.askButtonShows({ status: 'live', view: 'play', playing: true }), false)
})

test('anything unreadable in the store is not playing', () => {
  /*
   * One-sided on purpose: a value nobody can parse must never come back as
   * "hide the button". A missing button reads as the feature being gone; an
   * extra one is a button somebody can ignore.
   */
  assert.equal(play.clampMode(null), false)
  assert.equal(play.clampMode(undefined), false)
  assert.equal(play.clampMode('0'), false)
  assert.equal(play.clampMode('nonsense'), false)
  assert.equal(play.clampMode('1'), true)
  assert.equal(play.clampMode('true'), true)
  assert.equal(play.clampMode(true), true)
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

test('npm can be started on Windows, where npm is not a program', () => {
  /*
   * "Do you actually have to have an app for Windows or is it just a script you
   * can paste into the Windows terminal?"
   *
   * A script, and one already existed — `npm run serve`. It died on its first
   * line on Windows and nowhere else, for a reason that has nothing to do with
   * this app: `npm` there is `npm.cmd`, a batch file, and Node will not spawn
   * one. It used to; the fix for a command-injection flaw (CVE-2024-27980)
   * made it refuse instead.
   *
   * The shell is only ever asked for on the platform that needs it, because
   * turning it on everywhere would change how arguments are parsed on the two
   * platforms this is known to work on.
   */
  assert.deepEqual(host.npmSpawn({ platform: 'win32' }), { shell: true })
  assert.deepEqual(host.npmSpawn({ platform: 'darwin' }), {})
  assert.deepEqual(host.npmSpawn({ platform: 'linux' }), {})
})

test('the serve script actually asks for that, at both places it starts npm', () => {
  /*
   * Two spawns, and missing either one is a Windows-only failure nobody here
   * can see: the build, and the device server itself.
   */
  const src = readSrc(new URL('../scripts/serve.mjs', import.meta.url), 'utf8')
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
  assert.match(code, /import \{[\s\S]*?npmSpawn[\s\S]*?\} from '\.\.\/desktop\/lib\/host\.mjs'/,
    'serve.mjs no longer imports npmSpawn, so npm cannot start on Windows')
  /* Balanced, not a regex. `spawn('npm', ['run','dev'], { cwd: join(a, b) })`
     ends at a bracket the naive pattern took for the end of the call. */
  const calls = []
  for (let i = code.indexOf('spawn('); i !== -1; i = code.indexOf('spawn(', i + 1)) {
    let depth = 0
    for (let j = i + 'spawn'.length; j < code.length; j++) {
      if (code[j] === '(') depth++
      else if (code[j] === ')' && --depth === 0) {
        calls.push(code.slice(i, j + 1))
        break
      }
    }
  }
  assert.ok(calls.length >= 2, `the serve script starts ${calls.length} things, not the build and the server`)
  for (const call of calls) {
    assert.match(call, /npmSpawn\(\)/, `a spawn in serve.mjs skips npmSpawn: ${call.slice(0, 60)}`)
  }
})

test('the Windows installer keeps the layout the server needs', () => {
  /*
   * The one-paste installer. It cannot be run from here — there is no
   * PowerShell in CI — so what is checked is the handful of decisions that are
   * silent when wrong.
   */
  const ps = readSrc(new URL('../public/windows.ps1', import.meta.url), 'utf8')

  /* Siblings. The server depends on the codec by relative path, so nesting the
     two makes that link dangle and the build fails somewhere unrelated. */
  assert.match(ps, /\$server = Join-Path \$Root 'forgefx'/, 'the server moved out of the shared root')
  assert.match(ps, /\$codec = Join-Path \$Root 'forgefx-midi'/, 'the codec moved out of the shared root')

  /* The pins come from the app's own lock file rather than being copied here,
     which is the only way this and the Mac build cannot drift. */
  assert.match(ps, /forgefx\.lock\.json/, 'the installer no longer reads the pinned versions')
  assert.ok(
    !/d7b17a305c1f|553d24b74093/.test(ps),
    'a commit is hard-coded in the installer — it will rot the moment the lock file moves'
  )

  /* The codec builds before the server, whose build reads its types. */
  assert.ok(
    ps.indexOf("'building the preset codec'") < ps.indexOf("'building the device server'"),
    'the server is built before the codec it compiles against'
  )

  /* The token never reaches a URL: one in a remote URL is written into
     .git/config and reprinted in every error git gives about that remote. */
  assert.ok(
    !/https:\/\/[^'"\s]*\$(Token|env:FORGEFX_TOKEN)/.test(ps),
    'the token is embedded in a git URL, where it persists in .git/config'
  )
  assert.match(ps, /credential\.helper=/, 'the credential helper is gone, so a private fetch cannot authenticate')

  /* `exit` in a script piped into iex closes the whole window, taking the
     message with it — which is every guard clause here. */
  assert.ok(!/^\s*exit\b/m.test(ps), 'an exit would close the terminal of anyone who piped this into iex')
  assert.match(ps, /^Install-FractalRemote$/m, 'nothing calls the installer, so pasting it does nothing')
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
    appPath: '/Applications/Fractal Remote.app',
    run: (_cmd, args) =>
      args[0] === '--getglobalstate'
        ? 'Firewall is enabled. (State = 1)'
        : 'ALF: Fractal Remote is set to allow incoming connections'
  })
  assert.deepEqual(allowed, { known: true, on: true, blocked: false })

  // On and blocking: the case worth a line in the menu.
  const blocked = host.readFirewall({
    appPath: '/Applications/Fractal Remote.app',
    run: (_cmd, args) =>
      args[0] === '--getglobalstate'
        ? 'Firewall is enabled. (State = 1)'
        : 'ALF: Fractal Remote is set to block all incoming connections'
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

test('what a generation usually takes is measured, not asserted', async () => {
  /*
   * "Every tone generator says it takes longer than usual. How long is usual?
   * If it takes longer than usual, why does it always say that?"
   *
   * Because "usual" was a literal 60 seconds that nobody had measured. It came
   * from a server ceiling that has since been RAISED — stream.js now calls
   * ninety seconds before the first token "slow, not broken" — so the warning
   * fired on runs the rest of the app considers ordinary, every time. A warning
   * that always fires is one nobody reads.
   *
   * A number the app made up cannot be corrected by the app. One it measures
   * can.
   */
  const { typicalMs, buildEntry } = await import('../src/lib/history.js')
  const runs = (...ms) => ms.map((m) => ({ ms: m }))

  // Silence until there is enough to mean anything. The honest answer to "is
  // this longer than usual" with one run of data is that we do not know.
  assert.equal(typicalMs(runs()), null)
  assert.equal(typicalMs(runs(40000)), null)
  assert.equal(typicalMs(runs(40000, 44000)), null, 'two runs is not a norm')
  assert.equal(typicalMs(runs(38000, 44000, 41000)), 41000)

  /*
   * A median, not a mean. One run that ran to the two-and-a-half-minute cap is
   * exactly the kind of outlier that would drag a mean up and make the app
   * stop warning about the next one.
   */
  assert.equal(typicalMs(runs(38000, 41000, 44000, 52000, 150000)), 44000)

  // Only real measurements count, and only the recent ones.
  assert.equal(typicalMs([{ ms: null }, { ms: 0 }, { ms: -5 }, ...runs(40000, 42000, 44000)]), 42000)
  assert.equal(typicalMs(runs(...Array(20).fill(30000), 999999), { over: 12 }), 30000)

  // And a kept generation carries the number, or there is nothing to measure.
  assert.equal(buildEntry({ name: 'x', ms: 41234 }).ms, 41234)
  assert.equal(buildEntry({ name: 'x', ms: 41234.7 }).ms, 41235, 'rounded')
  assert.equal(buildEntry({ name: 'x' }).ms, null, 'an unmeasured run is null, not zero')
  assert.equal(buildEntry({ name: 'x', ms: -1 }).ms, null)
})

test('the waiting line answers the question somebody actually has', () => {
  /*
   * Two questions, answered separately, because only one of them needs a norm.
   *
   * "Is my rig safe" is what somebody has while waiting, and the answer is the
   * same at forty seconds and at two minutes — so it is said on the clock alone
   * and states a fact rather than making a comparison.
   *
   * "Is this one slow" needs a norm, and is said only where there is a measured
   * one.
   */
  const live = readSrc(new URL('../src/components/LiveGeneration.jsx', import.meta.url), 'utf8')

  /*
   * `seconds >= 60` still appears once, formatting minutes — that is arithmetic
   * about a clock face, not a claim about speed. What must not come back is the
   * old pairing: the message hung off that same literal.
   */
  const aside = live.slice(live.indexOf('function aside('), live.indexOf('export function Thinking'))
  assert.ok(aside.length > 40, 'the aside is gone')
  assert.ok(
    !/\b60\b/.test(aside),
    'the waiting line is back on a literal sixty seconds, which is a server ceiling that moved'
  )
  assert.match(live, /const REASSURE_AT = \d+/, 'the reassurance has no named threshold')
  assert.match(
    live,
    /nothing has been sent to your unit yet/,
    'the one thing somebody waiting actually wants to know is gone'
  )
  // The comparison is made against the measurement, never against a constant.
  assert.match(
    live,
    /longer than your usual \$\{usual\}s/,
    'the app claims a run is longer than usual without saying what usual is'
  )
  assert.match(
    live,
    /const slow = usual !== null &&/,
    'a run can be called slow with no measurement to call it slow against'
  )
})

test('two Macs on one account cannot quietly write to two units', async () => {
  /*
   * "If I have one Mac connected to an AM4 and one Mac connected to an FM3 and
   * I try to do a remote connection on my phone, how does the app differentiate
   * which device is connected?"
   *
   * It did not. A request is a broadcast on one channel per ACCOUNT —
   * `remote:<uid>` — carrying an id and no address, so every Mac signed into
   * that account hears it and answers. ForgeFX's host agent handles every req
   * it sees without checking whether it was meant for it.
   *
   * A read was therefore a coin flip: two answers, the first resolves and the
   * second is dropped by a `waiting.delete` that runs before it. A write was
   * worse, because it is not a race — BOTH Macs carry it out. One tap, two
   * units.
   *
   * Nothing could detect it either, because every reply looks the same. So the
   * roll call keeps every answer instead of the first, and the read it sends is
   * each Mac's own name — the same round trip counts them and says which.
   */
  const answer = (name) => ({ id: 'x', status: 200, body: JSON.stringify({ data: { name } }) })
  const read = async (p) => p.body

  const two = await hostNamesFrom(
    [answer('Justins MacBook Pro'), answer('Studio Mac')],
    read
  )
  assert.deepEqual(two, ['Justins MacBook Pro', 'Studio Mac'])

  // A Mac that answered in a shape we did not expect is still a Mac that would
  // carry out the next write, so it counts. Dropping it turns the fault back
  // into the silence this whole thing exists to end.
  const odd = await hostNamesFrom([answer('Studio Mac'), { id: 'x', body: 'not json' }], read)
  assert.deepEqual(odd, ['Studio Mac', 'a Mac'], 'a Mac that answered was not counted')

  // The census still counts them. What it no longer does is refuse — see the
  // test below, and hostConflict in shared/relay-rules.mjs.
  assert.equal(hostConflict(['Justins MacBook Pro']), null)
  assert.equal(hostConflict([]), null)
})

test('more than one Mac answering is not a reason to refuse', () => {
  /*
   * This used to be the guard rail: two Macs answering meant a write might
   * land on two units, so the app refused until one was chosen and the choice
   * was proved to be honoured.
   *
   * The detection was never wrong — a host is anything signed into the account
   * that answers the census, so an old install or a stray tab answers exactly
   * like the Mac doing the work. The consequence was. What it guarded against
   * needs two hosts each with an amp plugged in; answering a broadcast is not
   * that, and conflating the two left a one-amp rig being asked to choose
   * between two Macs, over and over, with no choice that settled it.
   *
   * Removed by the owner's decision for a rig with one unit. The cost is real
   * and is not hidden: with two hosts each holding an amp, a write reaches
   * both and nothing here says so.
   *
   * Every shape that used to produce a sentence is checked, so restoring the
   * guard is a deliberate act rather than something that comes back by
   * accident on the next edit.
   */
  const two = ['Justins MacBook Pro', 'Studio Mac']

  assert.equal(hostConflict(two, null, false), null, 'two Macs still refuse a write')
  assert.equal(hostConflict(two, 'Studio Mac', false), null, 'an unproved choice still refuses')
  assert.equal(hostConflict(two, 'Studio Mac', true), null)
  assert.equal(hostConflict(['MacBook Pro', 'MacBook Pro'], null, false), null, 'a name clash still refuses')
  assert.equal(hostConflict(['MacBook Pro', 'MacBook Pro'], 'MacBook Pro', true), null)
  assert.equal(hostConflict(['a', 'b', 'c'], null, false), null, 'three Macs still refuse')
  assert.equal(hostConflict(['Studio Mac'], null, false), null)
  assert.equal(hostConflict([]), null)

  // The phone carries its own copy of this rule and the two must not drift:
  // a banner gone on one surface and still up on the other is the same bug
  // reported in half the places. test/mobile.mjs holds them to each other.
  assert.equal(typeof hostConflict, 'function', 'the signature callers rely on is gone')
})

test('nothing is written while two Macs are listening', () => {
  /*
   * The sentence above is the explanation; this is the guarantee. A write is
   * refused at the one place every write goes through, so it holds for the
   * chat, the knobs, the generator and anything added later — none of which
   * knows this problem exists.
   *
   * Reads are deliberately still allowed. They are a coin flip rather than a
   * hazard, and the screen that has to explain the fault is built out of them.
   */
  const src = readSrc(new URL('../src/lib/remote.js', import.meta.url), 'utf8')

  /*
   * Asked again at the gate, not remembered from the join. The roll call used
   * to be taken once and every refusal after it answered from that one moment,
   * so a second Mac that had since slept or quit went on blocking writes for
   * the rest of the session. See conflictNow.
   */
  assert.match(
    src,
    /if \(method !== 'GET'\) \{[\s\S]{0,80}const clash = await conflictNow\(\)/,
    'a write can travel again while two Macs are answering'
  )
  assert.match(src, /export async function conflictNow\(maxAgeMs = 4000\)/)
  assert.match(src, /if \(!clash\) return null/, 'the ordinary case pays for a roll call it does not need')
  assert.match(
    src,
    /if \(Date\.now\(\) - countedAt < maxAgeMs\) return clash/,
    'a burst of writes re-counts the Macs on every one of them'
  )
  // The collector has to run before the resolve, because `waiting.delete` is
  // what makes the second answer invisible.
  assert.match(
    src,
    /const census = payload\?\.id && censuses\.get\(payload\.id\)[\s\S]{0,120}const pending = payload\?\.id && waiting\.get/,
    'the second answer is dropped before anything counts it'
  )
  // Requests name the Mac they are meant for, but only once there is more than
  // one to name and only once that has been proved to work.
  assert.match(
    src,
    /if \(hosts\.length > 1 && chosen && targeted\) ask\.host = chosen/,
    'a request is sent to every Mac again, or to one that cannot understand being addressed'
  )
  assert.match(
    src,
    /targeted = answers\.length === 1/,
    'addressing a Mac is taken on trust instead of proved'
  )
  // The count, the choice and the proof all belong to the channel they were
  // taken on.
  assert.match(
    src,
    /hosts = \[\]\s*\n\s*chosen = null\s*\n\s*targeted = false\s*\n\s*censuses\.clear\(\)/,
    'a stale count outlives its connection'
  )

  const link = readSrc(new URL('../src/lib/link.js', import.meta.url), 'utf8')
  assert.match(link, /countHosts\(\)/, 'the roll call is never taken')
  assert.match(link, /clash: hostConflict\(\)/, 'the app is never told')
  assert.match(link, /export async function chooseHost/, 'there is no way to choose between them')
})

test('each Mac advertises itself under its own name', async () => {
  /*
   * The other half, and it bites even when the two Macs are on different
   * accounts. Every Mac asked to be `fractal.local`. bonjour-service probes
   * first, finds the name taken, quietly stops advertising and logs a line to a
   * console nobody reads — so the second Mac has no name, while its own menu
   * goes on offering `http://fractal.local:5056`, built from the name it asked
   * for rather than the one it got. Tapping it opens the other Mac.
   */
  assert.equal(host.mdnsName('Justins-MacBook-Pro.local'), 'fractal-justins-macbook-pro')
  assert.equal(host.mdnsName('Studio Mac'), 'fractal-studio-mac')
  // A DNS label carries letters, digits and hyphens, and nothing else.
  assert.equal(host.mdnsName('MacBook Air (2)'), 'fractal-macbook-air-2')
  assert.ok(!/[^a-z0-9-]/.test(host.mdnsName('Åsa’s Mac!!')), 'an illegal character reached a DNS label')
  assert.ok(!/-$/.test(host.mdnsName('x'.repeat(60))), 'a truncated name can end in a hyphen')
  // Nothing to go on is the one case where the old constant is still right.
  assert.equal(host.mdnsName(''), 'fractal')

  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  assert.match(main, /FRACTAL_MDNS_NAME \|\| mdnsName\(\)/, 'the Mac app still advertises a constant')
})

test('a model roster with no lineage on it gets one', () => {
  /*
   * The unit does not know what its own models are in real life. ForgeFX's AM4
   * driver returns `manufacturer: null, basedOn: null` for every one of them —
   * the catalog fields are gen-3-only — and even an FM3's ordinary read path
   * returns nulls. So the app has carried a lineage for 149 amps and 80 pedals
   * since the beginning and shown it to nobody: the demo read the data files,
   * every real unit got a blank line.
   *
   * This is that roster: names, and nothing else.
   */
  const fromTheUnit = [
    { value: 14, name: 'Brit 800 2204 High', manufacturer: null, basedOn: null },
    { value: 324, name: 'USA MK V Red XT', manufacturer: null, basedOn: null },
    { value: 22, name: 'USA MK IIC+ Bright', manufacturer: null, basedOn: null }
  ]
  const [brit, markV, iic] = lineage.withLineage('amp', fromTheUnit)

  assert.equal(brit.basedOn, '50W Marshall JCM 800 2204', 'the roster came back as bare as it went in')
  /*
   * This one used to answer "Mesa" and nothing more, which is true and is not
   * what anybody wanted to know from a menu of forty Mesas. The family catalog
   * names the amp. See "a family names the amp behind a whole run of models".
   */
  assert.equal(markV.basedOn, 'Mesa/Boogie Mark V')
  // A voicing of a model we know is that model.
  assert.equal(iic.basedOn, 'MESA/Boogie Mark IIC+')

  assert.equal(lineage.gearLine('drive', 'Rat Distortion'), 'Pro Co RAT', 'the pedals say nothing')
  assert.equal(lineage.gearLine('amp', 'USA MK V Red XT'), 'Mesa/Boogie Mark V')

  // The unit is the better authority on its own models: a roster that already
  // carries lineage keeps it.
  const [kept] = lineage.withLineage('amp', [
    { value: 14, name: 'Brit 800 2204 High', manufacturer: 'Marshall', basedOn: 'what the unit said' }
  ])
  assert.equal(kept.basedOn, 'what the unit said')

  // A family with no catalog says nothing rather than something plausible.
  assert.equal(lineage.gearLine('cab', '4x12 CITRUS'), null)
  assert.equal(lineage.gearLine('delay', 'Digital Mono'), null)
})

test('a model we cannot name is left unnamed', () => {
  /*
   * The guard that matters most here, because the failure it prevents is worse
   * than the gap it leaves. A wrong attribution in a guitar app is read by
   * somebody who knows the gear better than the app does.
   *
   * The tempting rule is to take the longest name prefix some sibling shares.
   * It resolves three times as many models and it is confidently wrong: "USA MK
   * IV Lead" becomes a Mark IIC+ because they share "USA MK", and "Mr Z Highway
   * 66" becomes a Dr. Z Maz 38 because they share "Mr Z". Neither is true.
   *
   * So the rule only crosses words that describe a voicing of the same amp —
   * the bright input, the deep switch, the jumpered jacks — and the rest of the
   * name has to match a model in the data exactly.
   */
  /*
   * Both of these are now named, and named CORRECTLY — which is the whole
   * point. The danger was never that they stayed blank; it was the two wrong
   * answers above. A written-down family cannot produce either, because "USA MK
   * IV" and "USA MK IIC+" are two entries and the longer match wins.
   */
  assert.equal(lineage.gearLine('amp', 'USA MK IV Lead'), 'Mesa/Boogie Mark IV')
  assert.equal(lineage.gearLine('amp', 'Mr Z Highway 66'), 'Dr. Z Route 66')
  assert.equal(lineage.gearLine('amp', 'USA MK IIC+ Deep'), 'MESA/Boogie Mark IIC+')

  // Still nothing invented: a name nobody sourced gets no answer at all.
  assert.equal(lineage.gearLine('drive', 'Nobelium OVD-1'), null, 'a pedal with no recorded lineage was given one')
  assert.equal(lineage.gearLine('amp', 'A Model That Does Not Exist'), null)
  assert.equal(lineage.gearLine('amp', ''), null)
  assert.equal(lineage.gearLine('amp', undefined), null)
})

test('the picker keeps what the native menu did for free', () => {
  /*
   * Replacing a <select> means inheriting its whole job, and the parts that
   * cost nothing to have are the parts easiest to lose: it opened at the model
   * you were on, closed on a tap outside and on Escape, took arrow keys, and
   * gave a row you could hit on a dark stage. Losing any of them to get a green
   * caption would be a bad trade.
   */
  const src = readSrc(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')

  // Outside tap and Escape, from the same helper every other popover uses.
  assert.match(src, /useDismiss\(picker, \(\) => setPicking\(false\), \{ open: picking, ignore: '\.type-open' \}\)/)
  // Opens where you already are, rather than at the top of three hundred names.
  assert.match(src, /querySelector\('\[aria-selected="true"\]'\)/)
  assert.match(src, /scrollIntoView\(\{ block: 'center' \}\)/)
  // Arrows, Home and End, wrapping at both ends.
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.ok(src.includes(`e.key === '${key}'`), `${key} does nothing in the model list`)
  }
  assert.match(src, /pickAt\(\(i - 1 \+ models\.length\) % models\.length\)/, 'arrowing up off the top does not wrap')

  // Announced as what it is, so it is a listbox to a screen reader too.
  assert.match(src, /aria-haspopup="listbox"/)
  assert.match(src, /aria-expanded=\{picking\}/)
  assert.match(src, /role="listbox" aria-label="Model"/)
  assert.match(src, /aria-selected=\{m\.value === chosenValue\}/)

  const css = readSrc(new URL('../src/styles.css', import.meta.url), 'utf8')
  const rule = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))
  // A stage-sized target. The blanket 44px floor is on `button`, and this is a
  // button, but the rule sets its own padding so it says the floor out loud.
  assert.match(rule('.type-row {'), /min-height: 44px/)
  // Three hundred rows scroll inside the list rather than running off the end.
  assert.match(rule('.type-list {'), /max-height: min\(55vh, 380px\)/)
  assert.match(rule('.type-list {'), /overflow-y: auto/)
  assert.match(rule('.type-list {'), /overscroll-behavior: contain/)
  /*
   * And it takes its own space rather than floating over the panel. The panel
   * sits inside a sheet whose body scrolls, and a scroll container clips
   * absolutely positioned children at its edge — the first build came out with
   * its last row sliced in half at the bottom of the sheet, and would have lost
   * more of itself on a shorter phone. No z-index fixes that; only not being
   * inside the clip does.
   */
  assert.ok(!/position: absolute/.test(rule('.type-list {')), 'the list floats again, so the sheet can clip it')
})

test('a family names the amp behind a whole run of models', async () => {
  /*
   * "Search for the real life names that each AMP and all other effects are
   * based off of and list them next to the name."
   *
   * Two thirds of the roster used to answer with a maker: "Mesa/Boogie", forty
   * times over, in a menu whose whole difficulty is telling forty Mesas apart.
   * The names are built family-then-voicing throughout — "Recto2" is the amp,
   * "Orange Vintage" is which channel in which mode — so the family is the part
   * worth translating and one line covers every model on it.
   */
  const amps = (await import('../src/data/amp-types.json', { with: { type: 'json' } })).default
  const named = amps.filter((m) => lineage.lineageFor('amp', m.name)?.basedOn)
  assert.equal(named.length, amps.length, `${amps.length - named.length} amp models still cannot say what they are`)

  assert.equal(lineage.gearLine('amp', 'Recto1 Orange Normal'), 'Mesa/Boogie two-channel Dual Rectifier')
  assert.equal(lineage.gearLine('amp', 'Recto2 Red Modern'), 'Mesa/Boogie three-channel Dual Rectifier')
  assert.equal(lineage.gearLine('amp', 'Archean Clean'), 'PRS Archon')
  assert.equal(lineage.gearLine('amp', 'Triple Crest 3'), 'Mesa/Boogie Triple Crown')
})

test('the longest family wins, so one amp never answers for another', () => {
  /*
   * The guard that makes a prefix rule safe at all. "USA MK IIC++" is a modded
   * IIC+ and its name begins with "USA MK IIC+"; "Plexi Studio 20" is a 20-watt
   * head and its name begins with "Plexi". Shortest-match would get both wrong
   * with total confidence.
   */
  assert.equal(lineage.familyFor('amp', 'USA MK IIC++').family, 'USA MK IIC++')
  assert.equal(lineage.familyFor('amp', 'USA MK IIC+ Deep').family, 'USA MK IIC+')
  assert.equal(lineage.familyFor('amp', 'Plexi Studio 20').family, 'Plexi Studio 20')
  assert.equal(lineage.familyFor('amp', 'Plexi 50W Jumped').family, 'Plexi')
  assert.equal(lineage.familyFor('amp', 'Euro Uber').family, 'Euro Uber')

  // Whole words only. Without that a family claims any name it merely begins.
  // A model named exactly for its family is that family: "Mr Z Highway 66" and
  // "5F1 Tweed" are both the whole name and the whole family.
  assert.equal(lineage.familyFor('amp', 'Recto1').family, 'Recto1')
  assert.equal(lineage.familyFor('amp', 'Rectofoo Bright'), null, '"Recto1" claimed a name it only spells the start of')
  assert.equal(lineage.familyFor('amp', 'Recto1x Red'), null, 'the match crossed the middle of a word')
  assert.equal(lineage.familyFor('amp', 'Nothing At All'), null)
  assert.equal(lineage.familyFor('amp', ''), null)
  assert.equal(lineage.familyFor('nosuchblock', 'Recto1 Orange Normal'), null)
})

test('a model the unit already named is never overruled by a family', () => {
  // The per-model catalog is the more specific of the two, and where the unit
  // itself supplies one it is the better authority still.
  assert.equal(
    lineage.gearLine('amp', 'Brit 800 2204 High'),
    '50W Marshall JCM 800 2204',
    'a family answered over a model that named itself more precisely'
  )
  const [kept] = lineage.withLineage('amp', [
    { value: 1, name: 'Recto1 Orange Normal', manufacturer: null, basedOn: 'what the unit said' }
  ])
  assert.equal(kept.basedOn, 'what the unit said')
})

test('the pedals and the wahs say what they are too', () => {
  /*
   * "…and all other effects." Drives already had a catalog; the wahs had none
   * and every one of them is a code word for a real pedal. Both come from
   * Fractal's own Blocks Guide, which names them outright.
   */
  assert.equal(lineage.gearLine('wah', 'Cry Babe'), 'Dunlop Cry Baby')
  assert.equal(lineage.gearLine('wah', 'Clyde'), 'Vox Clyde McCoy wah')
  assert.equal(lineage.gearLine('comp', 'DynamiComp'), 'MXR Dyna Comp')
  assert.equal(lineage.gearLine('delay', 'Graphite Copy Delay'), 'MXR Carbon Copy analog delay')
  assert.equal(lineage.gearLine('drive', "Box o' Crunch"), 'MI Audio Crunch Box')

  // withLineage guarded on the per-model catalog, which wah and comp do not
  // have — guarding on that alone skipped the new families whole.
  const [wah] = lineage.withLineage('wah', [{ value: 0, name: 'Cry Babe', manufacturer: null, basedOn: null }])
  assert.equal(wah.basedOn, 'Dunlop Cry Baby')

  /*
   * And the families that genuinely have nothing to translate keep saying
   * nothing. A Fractal reverb type is called "Medium Plate" — it is already in
   * plain English, and inventing a machine for it would be the one failure this
   * whole file exists to avoid.
   */
  assert.equal(lineage.gearLine('reverb', 'Medium Plate'), null)
  assert.equal(lineage.gearLine('chorus', 'Analog Stereo'), null)
  assert.equal(lineage.gearLine('cab', '4x12 CITRUS'), null)
})

test('the list itself says what each model is, not just the one already chosen', () => {
  /*
   * The line under the control describes the model already selected, which is
   * the one model nobody is wondering about. Two hundred code words in the menu
   * above it were the actual question.
   */
  const src = readSrc(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
  /*
   * Two elements, not one string. It WAS one string — "Name — Real Amp" inside
   * an <option> — and that is as far as a native menu goes: an option is a
   * single run of text, and on iOS the system draws it and ignores the rest.
   * There was no half of it to make smaller and no half to make green, so the
   * list is ours and the two halves are two spans.
   */
  assert.match(src, /<span className="type-row-name">\{m\.name\}<\/span>/)
  assert.match(src, /\{m\.basedOn \? <span className="type-row-gear">\{m\.basedOn\}<\/span> : null\}/)
  // The maker alone is not used here on purpose: "Mesa/Boogie" under forty rows
  // tells nobody which one is the Rectifier.
  assert.ok(!/type-row-gear">\{m\.manufacturer/.test(src), 'every row is being captioned with its maker')
  assert.ok(!/<option /.test(src), 'a native option is back, and cannot carry two sizes')

  const css = readSrc(new URL('../src/styles.css', import.meta.url), 'utf8')
  const rule = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))

  // Smaller, and green: --f-1 is the smallest step the app keeps and --ok is
  // the green it already says a sure thing in, tuned for both themes.
  assert.match(rule('.type-row-gear {'), /font-size: var\(--f-1\)/)
  assert.match(rule('.type-row-gear {'), /color: var\(--ok\)/)
  assert.match(rule('.type-row-name {'), /font-size: var\(--f-3\)/)

  // The name still leads on the closed control, so what cannot fit is trimmed
  // off the far end — the half spelled out underneath it anyway.
  assert.match(rule('.type-open-name {'), /text-overflow: ellipsis/)
})

test('what a model really is reaches the screen and the generator', () => {
  /*
   * Three places, because the catalog is worth nothing sitting in a file. The
   * roster read off the unit is where all three get it — the picker, the row
   * that asks you to accept a model change, and the roster the generator
   * chooses from, which until now listed 331 amps and knew none of them by a
   * name a person would use.
   */
  const src = (p) => readSrc(new URL(p, import.meta.url), 'utf8')

  assert.match(
    src('../src/lib/forgefx.js'),
    /withLineage\(\s*slug,/,
    'the roster is read straight off the unit again, so it carries no lineage'
  )
  // Two verbs on purpose: "Based on Mesa" is not English, and no article fixes
  // it for a maker called Custom Audio Amplifiers.
  assert.match(
    src('../src/components/Console.jsx'),
    /Modelled on \$\{chosen\.manufacturer\}/,
    'the picker says nothing for a model whose maker is all we know'
  )
  assert.match(
    src('../src/lib/actions.js'),
    /model\.basedOn \|\| model\.manufacturer/,
    'a model change is proposed in the unit’s words only'
  )
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

test('an advert that never answers cannot hold the app open', async () => {
  /*
   * The one that came back, on a real Mac, months later: "closing the app
   * doesn't close it all the way — the only way is to force close."
   *
   * Underneath advert.stop() is bonjour-service putting a goodbye packet on the
   * network and calling back when it has gone out. That callback is not
   * guaranteed to arrive: a wifi network that changed, a socket that errored, a
   * machine that slept. It was awaited with no deadline, so when it did not
   * come the promise never settled, app.quit() was never reached, and there was
   * no way out but Force Quit.
   *
   * Which by then cost more than a nuisance. An update installs when the app
   * quits; Force Quit is SIGKILL, so it never installs, and the same "an update
   * is ready" line is waiting the next time.
   *
   * Raced against a clock here rather than simply awaited, so that the old
   * behaviour fails this test instead of hanging the whole suite on it.
   */
  const answer = await Promise.race([
    host.shutdown({
      advert: { stop: () => new Promise(() => {}) },
      sleep: async () => {}
    }),
    new Promise((r) => setTimeout(() => r('never finished'), 500))
  ])

  assert.notEqual(answer, 'never finished', 'a teardown that never answers stops the app quitting')
  assert.equal(answer.advert, 'gave up')

  // And an advert that answers normally is still waited for, not abandoned.
  const polite = await host.shutdown({ advert: { stop: async () => {} }, sleep: async () => {} })
  assert.equal(polite.advert, 'stopped')
})

test('clicking the app again opens its window', () => {
  /*
   * macOS does not start a second copy when the app is clicked again; it
   * activates the running one and sends `activate`. With nothing listening for
   * that, the click did nothing and the app looked dead. (Closing the window
   * now quits — see the test below — but the tray icon still opens it.)
   */
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  assert.match(main, /app\.on\('activate', \(\) => \{\s*\n\s*if \(where\) openWindow\(\)/, 'clicking the app again opens nothing')
  assert.match(main, /tray\.on\('click', openWindow\)/, 'clicking the menu-bar icon opens nothing')
  // And the quit path no longer cancels a quit it might never re-ask for.
  assert.match(main, /let quitting = false/, 'the quit handler can cancel its own second quit again')
  assert.match(main, /shutdown\(\{ server, advert \}\)/, 'quitting does not go through the tested shutdown')
  assert.ok(!/await advert\.stop\(\)/.test(main), 'the un-caught teardown that could block a quit is back')
})

test('an update never depends on the quit working', () => {
  /*
   * The loop this breaks, seen on a real Mac and reported with a Force Quit
   * window open next to the notice:
   *
   *   the update installs when you quit
   *     -> quitting does not finish
   *       -> Force Quit, which is a hard kill and installs nothing
   *         -> the same version is offered at the next launch, for ever
   *
   * And the fix for the quit was inside the version that could not be
   * installed, so nothing in that loop could ever break it from the inside. It
   * had to be broken by hand, once, with a disk image.
   *
   * Installing on quit stays the default: nothing restarts itself on a machine
   * with a guitar plugged into it. What is added is a second way out that a
   * PERSON presses — which was never the thing the design was against.
   */
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  const preload = readSrc(new URL('../desktop/preload.js', import.meta.url), 'utf8')
  const updates = readSrc(new URL('../desktop/lib/updates.mjs', import.meta.url), 'utf8')
  const ui = readSrc(new URL('../src/components/Updates.jsx', import.meta.url), 'utf8')

  // The channel exists end to end, or the button is a button that does nothing.
  assert.match(updates, /install: \(\) => \{/, 'the updater cannot be told to install')
  assert.match(updates, /updater\.quitAndInstall\(\)/, 'installing does not install')
  assert.match(preload, /install: \(\) => ipcRenderer\.invoke\('updates:install'\)/, 'the page cannot ask')
  assert.match(main, /ipcMain\.handle\('updates:install'/, 'nothing answers the page')
  assert.match(ui, /bridge\.updates\.install\(\)/, 'the notice never offers it')

  // And only for an update that is actually sitting there, so this cannot
  // become a way to restart the app for any other reason.
  assert.match(
    main,
    /if \(update\?\.kind !== 'ready'\) return \{ ok: false, reason: 'nothing-ready' \}/,
    'the app can be restarted with no update to install'
  )

  // The server goes down first either way. A ForgeFX left holding port 5056
  // stops the next launch dead, and the next launch is the whole point here.
  assert.match(main, /await stopServing\(\)\s*\n/, 'installing leaves the device server running')
  assert.match(main, /async function stopServing\(\)/, 'the teardown is not shared with the quit')
})

test('the update offers a restart in the words every other Mac app uses', () => {
  /*
   * "On most Mac apps that update it usually says refresh app to update and
   * they click one button and it closes the app for them. Is it possible for
   * us to do that?" It already did — but the notice led with "installs when
   * you quit" and the button said "Install now", so the one-button restart
   * read as a technicality under a wait.
   */
  const ui = readSrc(new URL('../src/components/Updates.jsx', import.meta.url), 'utf8')
  const notice = ui.slice(ui.indexOf('export function UpdateReadyNotice'))
  assert.match(notice, /Restart to update/, 'the button does not say what it does')
  assert.match(notice, /closes and reopens/, 'nothing says the app comes back on its own')
  assert.match(notice, /className="primary"[\s\S]*?Restart to update/, 'the restart is a chip beside Later rather than the thing to press')
  assert.ok(!/'Install now'/.test(ui), 'the button still says Install now')
  // The quiet default is unchanged: Later still leaves it to install on quit.
  assert.match(notice, /installs the next time you quit/)
  assert.match(notice, /Later/)
  // And Setup offers the same button, so the notice being dismissed is not the end of it.
  const panel = ui.slice(ui.indexOf('export default function Updates'), ui.indexOf('export function UpdateReadyNotice'))
  assert.match(panel, /updateReady\(state\) && bridge\.updates\.install[\s\S]*?Restart to update/, 'Setup has no way to finish an update that is sitting there')
})

test('nothing can stop the app closing', () => {
  /*
   * Three separate ways the quit could stall, each of which read to the person
   * holding the Mac as "it will not close". The deadline inside shutdown is
   * tested above; these are the two in the shell, plus the backstop that covers
   * whatever turns out to be next.
   */
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')

  // A server dying because we just killed it is not news, and a modal box
  // during a quit is a box with no window and no dock icon to belong to.
  assert.match(
    main,
    /if \(code && !quitting\)/,
    'a server stopped by the quit still opens a dialog in the middle of it'
  )

  // The dock is not ours to touch on the way out.
  assert.match(main, /if \(quitting \|\| !app\.dock\) return/, 'the dock is still changed while quitting')

  // And the promise that outranks all of it.
  assert.match(main, /setTimeout\(\(\) => app\.exit\(0\), QUIT_DEADLINE_MS\)/, 'there is no backstop on the quit')
  assert.match(main, /const QUIT_DEADLINE_MS = \d+/, 'the quit deadline is not a named number')
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
  const vendored = '/Applications/Fractal Remote.app/Contents/Resources/vendor/forgefx'
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

test('a plan over the relay does not propose what the Mac alone can do', () => {
  /*
   * The host refuses a slot write and a backup from a distance — deliberately,
   * and REMOTE_FORBIDDEN in shared/relay-rules.mjs says so in words. The plan
   * used to propose them anyway: every other action applied, the unit made the
   * sound asked for, and the one step that would have kept it failed at the
   * end as a single line among the successes. A tone you can hear and did not
   * keep reads as "it worked" until the next preset change takes it away.
   *
   * So the refusal moves to where a plan is still a proposal. Said before
   * anything is written, not reported after everything else was.
   */
  const away = { ...caps, remote: true }

  const save = validatePlan(
    { actions: [{ kind: 'savePreset', value: 67, text: 'Dimebag', why: '' }] },
    cmdBlocks,
    away
  )
  assert.deepEqual(save.actions, [], 'a slot write was proposed over the relay')
  assert.match(save.problems[0] || '', /only works at the Mac/, save.problems.join(' | '))
  assert.match(save.problems[0] || '', /67/, 'the refusal does not say which slot was left alone')

  const backup = validatePlan(
    { actions: [{ kind: 'backupPreset', value: 3, why: '' }] },
    cmdBlocks,
    away
  )
  assert.deepEqual(backup.actions, [], 'a backup was proposed over the relay')
  assert.match(backup.problems[0] || '', /only works at the Mac/, backup.problems.join(' | '))

  // Everything else still travels: the tone is applied over the relay exactly
  // as it was, and only the two steps the host refuses are held back.
  const mixed = validatePlan(
    {
      actions: [
        { kind: 'setParam', eid: 58, paramId: 7, value: 6, why: '' },
        { kind: 'savePreset', value: 67, why: '' }
      ]
    },
    cmdBlocks,
    away
  )
  assert.deepEqual(
    mixed.actions.map((a) => a.kind),
    ['setParam'],
    'the relay plan lost an action it could have carried out'
  )

  // And at the Mac both are proposed as they always were.
  const home = validatePlan(
    {
      actions: [
        { kind: 'savePreset', value: 67, why: '' },
        { kind: 'backupPreset', value: 3, why: '' }
      ]
    },
    cmdBlocks,
    caps
  )
  assert.deepEqual(home.actions.map((a) => a.kind), ['backupPreset', 'savePreset'])
  assert.deepEqual(home.problems, [], home.problems.join(' | '))
})

test('the stage screen is sized by whoever is holding it', () => {
  /*
   * One size was chosen once, for a phone at arm's length in the dark. That is
   * the right default and the wrong rule: eight scenes and nine blocks do not
   * fit at it, and two scenes waste the screen at it. Which you have changes
   * with the preset, so it is a setting.
   *
   * The default used to be "the screen exactly as it shipped" -- 62px tiles in
   * 110px columns -- which was right while this control only resized what was
   * already there. It now also carries the LAYOUT he picked from a screenshot:
   * scenes two across in colour, effects four across in three letters. The
   * pixel figures are unchanged; the column counts are the new part, and they
   * are what a floor could never express, since a floor says "at least this
   * wide" and lets the viewport pick the rest.
   */
  const { SIZES, DEFAULT_SIZE, clampSize, sizeVars, loadSize, saveSize } = gigSize

  assert.deepEqual(sizeVars(DEFAULT_SIZE), {
    '--gig-tile': '62px',
    '--gig-col': '110px',
    '--gig-col-block': '130px',
    '--gig-scene-cols': '2',
    '--gig-fx-cols': '4'
  }, 'the default step no longer reproduces the screen as it shipped')

  // The ladder only ever gets roomier. A step that put MORE on a row than the
  // one below it would make the minus button add clutter.
  for (let i = 1; i < SIZES.length; i += 1) {
    assert.ok(SIZES[i].scenes <= SIZES[i - 1].scenes, `step ${i} fits more scenes per row than step ${i - 1}`)
    assert.ok(SIZES[i].fx <= SIZES[i - 1].fx, `step ${i} fits more effects per row than step ${i - 1}`)
    assert.ok(SIZES[i].tile > SIZES[i - 1].tile, `step ${i} is not taller than step ${i - 1}`)
  }
  /*
   * A scene is WIDER than an effect at every step — "try making them wider".
   * Two grids of identically sized tiles read as one grid however they are
   * coloured, and size is the difference you notice before looking at anything.
   */
  for (const [i, step] of SIZES.entries()) {
    assert.ok(
      step.scenes <= step.fx,
      `at ${step.name} a scene is NARROWER than an effect (${step.scenes} vs ${step.fx} per row)`
    )
    // Strictly wider at the three steps a phone is actually used at. The top
    // two are already tiles you could hit with a boot, and there the wash does
    // the telling apart on its own.
    if (i <= 2) {
      assert.ok(
        step.scenes < step.fx,
        `at ${step.name} a scene is no wider than an effect (${step.scenes} vs ${step.fx} per row)`
      )
    }
  }

  // Bigger is bigger and smaller is smaller, the whole way up.
  for (let i = 1; i < SIZES.length; i++) {
    assert.ok(SIZES[i].tile > SIZES[i - 1].tile, `step ${i} is not taller than ${i - 1}`)
    assert.ok(SIZES[i].col > SIZES[i - 1].col, `step ${i} is not wider than ${i - 1}`)
  }

  // Every step clears the floor for something pressed on a dark stage.
  for (const s of SIZES) assert.ok(s.tile >= 44, `${s.name} is under the tap floor at ${s.tile}px`)

  // Nothing out of storage can put the screen in a state with no buttons on it.
  assert.equal(clampSize(99), SIZES.length - 1)
  assert.equal(clampSize(-5), 0)
  assert.equal(clampSize('nonsense'), DEFAULT_SIZE)
  assert.equal(clampSize(null), DEFAULT_SIZE)

  // Kept across a reload, on this device.
  const mem = new Map()
  const store = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v)
  }
  assert.equal(loadSize(store), DEFAULT_SIZE, 'a device that has never chosen gets the default')
  saveSize(3, store)
  assert.equal(loadSize(store), 3)
  saveSize(99, store)
  assert.equal(loadSize(store), SIZES.length - 1, 'an out-of-range save was stored out of range')

  /*
   * A private window throws on both, and has done since the first iOS that
   * had one. The stage screen renders at the default rather than not at all.
   */
  const hostile = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    }
  }
  assert.equal(loadSize(hostile), DEFAULT_SIZE, 'a blocked read takes the screen down')
  assert.equal(saveSize(2, hostile), false, 'a blocked write is reported as a success')
})

test('the quick jumps fit the unit that is plugged in', async () => {
  /*
   * One rule, not a table of devices: about five stops, each on a round
   * number. The two he named are the two ends of it — a gen-3 unit's 512
   * presets want hundreds, an AM4's 104 want twenties — and a unit nobody has
   * plugged in yet gets whatever its own count deserves without this file
   * being edited again.
   */
  const { jumpStep, jumpsFor } = await import('../src/lib/presetJumps.js')

  assert.equal(jumpStep(512), 100, 'a 512-slot unit is not jumping in hundreds')
  assert.deepEqual(jumpsFor(512), [100, 200, 300, 400, 500])

  assert.equal(jumpStep(104), 20, 'an AM4 is not jumping in twenties')
  assert.deepEqual(jumpsFor(104), [20, 40, 60, 80, 100])

  // An Axe-Fx II holds 384. Nobody wrote that number down here; the rule
  // reaches it on its own.
  assert.equal(jumpStep(384), 50)
  assert.ok(jumpsFor(384).every((n) => n < 384), 'a jump points past the last slot')

  // Short lists get nothing. A VP4's handful of slots is already one flick
  // from top to bottom, and a row of buttons over it would be furniture.
  assert.deepEqual(jumpsFor(4), [])
  assert.deepEqual(jumpsFor(40), [])
  assert.deepEqual(jumpsFor(0), [])

  // A count that never arrived must not become a row of NaN.
  assert.deepEqual(jumpsFor(undefined), [])
  assert.deepEqual(jumpsFor(null), [])

  // Five stops is the shape, wherever the count lands.
  for (const total of [104, 128, 256, 384, 512, 1024]) {
    const n = jumpsFor(total).length
    assert.ok(n >= 3 && n <= 9, `${total} slots gave ${n} buttons, which is not a row you can read`)
  }
})

test('every unit the server can detect is addressed on its own terms', async () => {
  /*
   * Six units, one app. The shapes are not close to each other — 6x14 against
   * 1x4, 512 slots against 104 against a count nobody has ever taken — and
   * every one of them arrives as a capability payload rather than a branch in
   * this code. That is the whole design, so this is the test that says the
   * design holds rather than that one device works.
   *
   * The VP4 row is the one that matters most. It used to be handed the AM4's
   * 104 locations and its A01..Z04 bank letters, purely because both units run
   * a linear chain — see ForgeFX's driver capabilities. A null count has to
   * stay null all the way through: no jumps, no bound to refuse a save
   * against, and no bank letters on a unit that has no banks.
   */
  const { slotCount, slotLabel, slotOutside } = await import('../src/lib/slots.js')
  const { jumpsFor } = await import('../src/lib/presetJumps.js')

  const grid = (rows, cols, count) => ({
    slotModel: 'grid',
    grid: { rows, cols },
    sceneCount: 8,
    presets: { count, addressing: 'numeric' }
  })

  const units = {
    'Axe-Fx III': grid(6, 14, 512),
    FM3: grid(4, 12, 512),
    FM9: grid(6, 14, 512),
    'Axe-Fx II': grid(4, 12, 384),
    AM4: { slotModel: 'linear', slotCount: 4, sceneCount: 4, presets: { count: 104, addressing: 'bankLetter' } },
    VP4: { slotModel: 'linear', slotCount: 4, sceneCount: 4, presets: { count: null, addressing: 'numeric' } }
  }

  // The count each unit actually holds, taken from what it says rather than
  // from the gen-3 number the app used to assume.
  assert.equal(slotCount(units['Axe-Fx III']), 512)
  assert.equal(slotCount(units.FM9), 512)
  assert.equal(slotCount(units['Axe-Fx II']), 384)
  assert.equal(slotCount(units.AM4), 104)
  assert.equal(slotCount(units.VP4), null, 'a VP4 is being told how many presets it has')

  // Banks only where there are banks. A gen-3 unit numbers its slots and has
  // none; the AM4 shows A01..Z04 on its own display.
  assert.equal(slotLabel(0, units.FM9.presets.addressing), '000')
  assert.equal(slotLabel(103, units.AM4.presets.addressing), '103 Z04')
  assert.equal(slotLabel(0, units.VP4.presets.addressing), '000', 'a VP4 is being given bank letters')

  // The guard that stops a save being aimed at a slot the unit has not got.
  for (const [name, caps] of Object.entries(units)) {
    const count = slotCount(caps)
    if (count === null) {
      assert.equal(slotOutside(500, caps), false, `${name} refuses a slot on a count it never stated`)
      continue
    }
    assert.equal(slotOutside(count - 1, caps), false, `${name} refuses its own last slot`)
    assert.equal(slotOutside(count, caps), true, `${name} accepts one past its last slot`)
  }

  // And the jumps, per unit, from the same one rule.
  assert.deepEqual(jumpsFor(slotCount(units.FM9)), [100, 200, 300, 400, 500])
  assert.deepEqual(jumpsFor(slotCount(units.AM4)), [20, 40, 60, 80, 100])
  assert.deepEqual(jumpsFor(slotCount(units.VP4) ?? 0), [], 'a VP4 gets jump buttons over a list of four')
})

test('recent presets and favourites, per unit', () => {
  /*
   * A 512-slot unit is forty screens of list. Range jumps get you to a
   * neighbourhood; these get you to a preset.
   */
  const { pushRecent, toggleIn, MAX_RECENT, marksFor, remember, toggleFavourite } = marks

  // Most recent first, and playing something again moves it up rather than
  // listing it twice — the difference between eight presets and one preset
  // eight times.
  assert.deepEqual(pushRecent([], 5), [5])
  assert.deepEqual(pushRecent([3, 2, 1], 2), [2, 3, 1])
  assert.deepEqual(pushRecent([1, 2, 3], 4), [4, 1, 2, 3])

  // Eight, and the ninth pushes the oldest off the end.
  const many = [9, 8, 7, 6, 5, 4, 3, 2, 1].reduce((l, n) => pushRecent(l, n), [])
  assert.equal(many.length, MAX_RECENT)
  assert.equal(many[0], 1, 'the newest is not first')
  assert.ok(!many.includes(9), 'the ninth-oldest survived the cap')

  // Slot 0 is a real slot. Anything that is not a slot number is not one.
  assert.deepEqual(pushRecent([], 0), [0])
  assert.deepEqual(pushRecent([1], null), [1])
  assert.deepEqual(pushRecent([1], -2), [1])
  assert.deepEqual(pushRecent([1], 1.5), [1])

  // Stars go on and off, and read back in slot order.
  assert.deepEqual(toggleIn([1, 5], 3), [1, 3, 5])
  assert.deepEqual(toggleIn([1, 3, 5], 3), [1, 5])
  assert.deepEqual(toggleIn([], 0), [0])

  /*
   * Kept per unit. Slot 4 on an FM3 and slot 4 on an AM4 are different
   * sounds, and this was got wrong once already: the marks were keyed on a
   * field the device object does not carry, so every unit shared one bucket.
   */
  const mem = new Map()
  const store = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v)
  }
  remember('fm3', 7, store)
  remember('fm3', 4, store)
  toggleFavourite('fm3', 4, store)
  remember('am4', 1, store)

  assert.deepEqual(marksFor('fm3', store).recent, [4, 7])
  assert.deepEqual(marksFor('fm3', store).favourites, [4])
  assert.deepEqual(marksFor('am4', store).recent, [1], 'one unit is reading another unit\'s history')
  assert.deepEqual(marksFor('am4', store).favourites, [], 'a star crossed between two units')

  // A unit that has never been seen is empty, not a crash.
  assert.deepEqual(marksFor('vp4', store), { recent: [], favourites: [] })

  /*
   * A private window throws on both reads and writes, and has since the first
   * iOS that had one. An empty list is the right answer; a broken picker is
   * not.
   */
  const hostile = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    }
  }
  assert.deepEqual(marksFor('fm3', hostile), { recent: [], favourites: [] })
  assert.deepEqual(remember('fm3', 3, hostile), [3], 'a blocked write loses the list it just built')

  // And nonsense in storage reads as empty rather than throwing.
  const junk = { getItem: () => '{"fm3":{"recent":"nope","favourites":[2,"x",2]}}', setItem: () => {} }
  assert.deepEqual(marksFor('fm3', junk), { recent: [], favourites: [2] })
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
  /*
   * The cache clear travels now — the pinned fork gives remoteAllowed() a
   * DELETE branch for this one path. Without it nothing a phone wrote could be
   * verified, because verifying means clearing this cache and reading back.
   */
  assert.equal(forbiddenRemotely('DELETE', '/device/cache'), null)
  // And DELETE opened for that path and nothing else.
  assert.ok(forbiddenRemotely('DELETE', '/store/config/layouts'))
  assert.ok(forbiddenRemotely('DELETE', '/preset/blocks/58/params/1'))
  assert.ok(forbiddenRemotely('DELETE', '/device'))
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
    // Added to the host on the pinned fork — see desktop/forgefx.lock.json.
    // A read-side hint: it stores no value and reaches no slot, and without it
    // a remote client cannot verify a single write.
    if (method === 'DELETE') return p === '/device/cache'
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

test('a request that could not travel is told apart from one the unit refused', async () => {
  /*
   * "Disconnected from phone remote when sending presets to FM3."
   *
   * A send is hundreds of writes down one serial port over minutes, and the
   * phone locks part-way through. Every remaining write then failed instantly
   * with a message about the link, and applyChanges recorded each as a
   * refusal — ninety failure lines for writes that never left the handset.
   * The flag is what lets the write loop stop instead.
   */
  const src = readSrc(new URL('../src/lib/remote.js', import.meta.url), 'utf8')
  assert.match(src, /function linkDown\(message\)[\s\S]*err\.linkDown = true/, 'the relay has no way to say "this never left the phone"')
  assert.match(src, /failWaiting\(message\) \{[\s\S]*pending\.reject\(linkDown\(message\)\)/, 'requests killed by a closing socket arrive as ordinary failures')

  const forge = readSrc(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
  assert.match(forge, /if \(cause\?\.linkDown\) this\.linkDown = true/, 'the flag is flattened away crossing into ForgeError')
  // The same crossing used to drop remoteBlocked, so the one branch that reads
  // it — the rename a phone is not allowed to make — could never be true.
  assert.match(forge, /if \(cause\?\.remoteBlocked\) this\.remoteBlocked = true/)
})

test('everything the relay carries may be sent twice, except a tap', async () => {
  const { repeatable } = await import('../src/lib/remote.js')
  /*
   * Retrying is only safe because these say where something should END UP.
   * Arriving twice leaves the unit exactly where arriving once did.
   */
  for (const path of [
    '/preset/blocks/58/params',
    '/preset/blocks/58/channel',
    '/preset/blocks/58/type',
    '/preset/blocks/58/bypass',
    '/preset/select',
    '/scene',
    '/tempo',
    '/healthz'
  ]) {
    assert.equal(repeatable(path), true, `${path} is a value, not an event`)
  }
  // A beat is not a destination: a resent tap is a beat that never happened.
  assert.equal(repeatable('/tempo/tap'), false)
  assert.equal(repeatable('/tempo/tap?x=1'), false, 'a query string is not a different route')
  assert.equal(repeatable('/tempo/tap/'), false, 'nor is a trailing slash')
})

test('a request waits for the relay to come back rather than failing into the gap', async () => {
  const { waitForRelay } = await import('../src/lib/remote.js')
  /*
   * realtime-js reopens the socket a second or two after it closes. For that
   * second or two every request failed outright, which is survivable under a
   * finger and fatal in the middle of a send.
   */
  let slept = 0
  const sleep = async (ms) => {
    slept += ms
  }
  // No session at all: nothing is coming back, and the wait ends rather than
  // hanging on for ever.
  assert.equal(await waitForRelay(600, 150, sleep), false)
  assert.ok(slept >= 600, 'the grace period was not actually waited out')
})

test('the health probe asks for no grace, because it is what decides the grace', async () => {
  const src = readSrc(new URL('../src/lib/remote.js', import.meta.url), 'utf8')
  const probe = src.slice(src.indexOf('export async function hostResponds'))
  assert.match(probe.slice(0, 900), /graceMs: 0/, 'the probe that tests the link would wait out the link’s own grace period')
})

test('a run is never billed for the same token twice', async () => {
  /*
   * `usage.inputTokens` is the TOTAL. The AI SDK's Anthropic provider builds
   * it as `input_tokens + cacheCreationTokens + cacheReadTokens`, so the
   * tokens written to the cache are already inside it. Reads were taken back
   * out and writes were not, which billed every written token twice — once at
   * full price inside the total, and again at the write premium on top.
   *
   * The numbers here are a real run off a phone: 48.6k total, 30.2k of it the
   * write, 3.2k out, on Sonnet 5. It was reported as 20.5¢ and cost 14.4¢.
   */
  const { costOf, uncachedCostOf, splitUsage } = await import('../src/lib/cost.js')
  const run = {
    inputTokens: 48600,
    outputTokens: 3200,
    cachedInputTokens: 0,
    cacheWriteTokens: 30200,
    model: 'claude-sonnet-5'
  }

  const split = splitUsage(run)
  assert.equal(split.fresh, 18400, 'the written tokens are still counted as fresh')
  assert.equal(
    split.fresh + split.cached + split.written,
    split.total,
    'the buckets do not add up to the total, so one of them is being double counted'
  )

  // 18.4k × $2 + 30.2k × $2.50 + 3.2k × $10, per million.
  const cents = (n) => Math.round(n * 1000) / 10
  assert.equal(cents(costOf(run, run.model)), 14.4, 'the old 20.5¢ is back')

  /*
   * And "what this would have cost with no cache" is the total at full price —
   * not the total plus the cached buckets, which counted them a third time.
   * On a first run it is genuinely LESS than the cached price: priming costs a
   * premium, which the panel already explains rather than printing a negative
   * saving.
   */
  assert.equal(cents(uncachedCostOf(run, run.model)), 12.9)
  assert.ok(uncachedCostOf(run, run.model) < costOf(run, run.model), 'priming is no longer a premium')

  // A warm run: the same prefix read back at a tenth, and a real saving.
  const warm = { ...run, cachedInputTokens: 30200, cacheWriteTokens: 0 }
  assert.equal(splitUsage(warm).fresh, 18400)
  assert.equal(cents(costOf(warm, warm.model)), 7.5)
  assert.ok(
    uncachedCostOf(warm, warm.model) > costOf(warm, warm.model),
    'a warm run does not come out cheaper than sending it uncached'
  )

  // Nothing reported is nothing charged, rather than NaN on screen.
  assert.equal(costOf({ model: 'claude-sonnet-5' }, 'claude-sonnet-5'), 0)
  assert.equal(splitUsage(null), null)
})

test('the plain requests never needed a model, and the rest still do', async () => {
  /*
   * "Scene 3." "Bypass the delay." "Tempo 120." Every one of those went to
   * Sonnet 5, cost real money and took a round trip, for a sentence with one
   * reading and no judgement in it.
   *
   * The cost of the two mistakes is not symmetric, and the whole design turns
   * on that: a miss costs nothing — the request goes to the model exactly as
   * it does today — and a wrong match writes something to a unit somebody is
   * about to play. So most of what is asserted here is what must NOT match.
   */
  const { matchLocal, matchRename } = await import('../src/lib/localCommands.js')

  const amp = { eid: 100, name: 'Amp 1', slug: 'amp' }
  const delay1 = { eid: 101, name: 'Delay 1', slug: 'delay' }
  const reverb = { eid: 102, name: 'Reverb 1', slug: 'reverb' }
  const drive = { eid: 103, name: 'Drive 1', slug: 'drive' }
  const delay2 = { eid: 104, name: 'Delay 2', slug: 'delay' }

  const ctl = (block, id, name, value, min, max, unit) => ({
    block,
    param: { id, name, value, min, max, ...(unit ? { unit } : {}) }
  })
  const simple = {
    sceneCount: 8,
    blocks: [amp, delay1, reverb, drive],
    controls: [
      ctl(amp, 1, 'Gain 1', 5, 0, 10),
      ctl(amp, 2, 'Treble 1', 5, 0, 10),
      ctl(delay1, 3, 'Mix', 20, 0, 100),
      ctl(amp, 4, 'Master Volume', 5, 0, 10)
    ]
  }

  const hit = (text, ctx = simple) => matchLocal(text, ctx)

  // ── the ones worth catching ───────────────────────────────────────────
  assert.deepEqual(hit('scene 3'), { kind: 'setScene', value: 2, why: 'Scene 3.' })
  assert.equal(hit('go to scene 2 please')?.value, 1, 'politeness sent it to the model')
  assert.equal(hit('tempo 120')?.value, 120)
  assert.equal(hit('set the tempo to 88')?.value, 88)
  assert.equal(hit('140 bpm')?.value, 140)
  assert.equal(hit('bypass the delay')?.eid, delay1.eid)
  assert.equal(hit('turn the reverb off')?.flag, true)
  assert.equal(hit('can you turn the delay on')?.flag, false)
  assert.equal(hit('amp to channel B')?.text, 'B')
  assert.equal(hit('set the treble to 7')?.value, 7)
  assert.equal(hit('master volume to 6')?.paramId, 4, 'a two-word control name')
  assert.equal(matchRename('name it Black Album')?.text, 'Black Album', 'the capitals were lost')

  // A nudge lands on the control, in the right direction, from where it is.
  const up = hit('more treble')
  assert.equal(up?.paramId, 2)
  assert.ok(up.value > 5, 'more went down')
  assert.equal(hit('turn the treble down a bit')?.value, 5 - (10 - 0) * 0.08)

  /*
   * The player's own habit beats the fallback fraction. corrections.js has
   * been watching which controls get reached for after a generation and by how
   * much, and a median of somebody's own past moves is a better answer to "a
   * bit more treble" than a share of the range.
   */
  const learned = hit('more treble', { ...simple, learnedStep: (n) => (n === 'Treble 1' ? 1.5 : null) })
  assert.equal(learned.value, 6.5, 'the learned step was ignored')

  // ── the ones that must fall through ───────────────────────────────────
  const through = [
    'make it brighter',                      // judgement: which control?
    'give me a black album tone',            // a design, not a change
    'bypass the delay and make it brighter', // half a request is worse than none
    'why did you pick that amp',             // a question
    'scene 9',                               // no such scene
    'tempo 5000',                            // not a tempo
    'set the treble to 40',                  // outside the control's range
    'channel b',                             // which block?
    'turn it off',                           // which block?
    'a bit more of that thing'               // nothing named
  ]
  for (const text of through) {
    assert.equal(hit(text), null, `matched "${text}", which needs the model`)
  }

  // ── ambiguity is a miss, however it arises ────────────────────────────
  const crowded = {
    sceneCount: 8,
    blocks: [amp, delay1, delay2, drive],
    controls: [ctl(amp, 1, 'Gain 1', 5, 0, 10), ctl(drive, 9, 'Gain', 4, 0, 10)]
  }
  for (const text of ['bypass the delay', 'gain to 8', 'more gain']) {
    assert.equal(hit(text, crowded), null, `"${text}" was answered on a preset where it is ambiguous`)
  }
  /*
   * And the instance number is the player's to supply. With one, it IS the
   * disambiguation; without one, "Gain 1" and "Gain" are the same word in two
   * places and picking the unsuffixed one would be a confident wrong answer.
   */
  assert.equal(hit('bypass delay 2', crowded)?.eid, delay2.eid)
  assert.equal(hit('amp gain to 8', crowded)?.eid, amp.eid)
  assert.equal(hit('drive gain to 8', crowded)?.eid, drive.eid)
  // A preset holding only Delay 1 must not answer "delay 2" with it.
  assert.equal(hit('bypass delay 2'), null, 'a block that is not there was bypassed anyway')

  /*
   * The two a watch-only run actually caught going to the model, and the
   * reasons they did: "change" was not among the verbs the channel rule knew,
   * and renaming a scene was never implemented at all. Both are here so the
   * same six lines of regex cannot go missing twice.
   */
  assert.equal(hit('Change amp to channel b')?.text, 'B', 'a change of channel went to the model again')
  const renamed = matchRename('Rename scene 2 to Lithium', { sceneCount: 8 })
  assert.deepEqual(renamed, {
    kind: 'renameScene',
    scene: 1,
    text: 'Lithium',
    why: 'Scene 2 renamed to Lithium.'
  })
  assert.equal(matchRename('call scene 1 Clean', { sceneCount: 8 })?.scene, 0)
  assert.equal(matchRename('rename scene 3 as Solo', { sceneCount: 8 })?.text, 'Solo')
  // A scene the unit does not have is the model's to explain, not ours to write.
  assert.equal(matchRename('rename scene 99 to Nope', { sceneCount: 8 }), null)
  /*
   * And the scene shape is tried first on purpose: the preset rule would read
   * "rename scene 2 to Lithium" as a request to call the PRESET
   * "scene 2 to Lithium", which is a confidently wrong name on a saved slot.
   */
  assert.notEqual(matchRename('rename scene 2 to Lithium', { sceneCount: 8 })?.kind, 'renamePreset')

  // Nothing at all, and something far too long, are both misses rather than throws.
  assert.equal(hit(''), null)
  assert.equal(hit('   '), null)
  assert.equal(hit('x'.repeat(400)), null)
  assert.equal(matchRename('call it ' + 'x'.repeat(40)), null, 'a name the unit cannot hold')
})

test('every model on the unit can be looked up by what it really is', async () => {
  /*
   * "Add an info page like this to settings listing the real life equivalents
   * of each amp and effects pedals."
   *
   * The catalog has been in the repo since the model picker learned to print a
   * lineage; what it could not do was answer "what have I got", because every
   * route into lineage.js needs a model name you already know.
   */
  const { GEAR_GROUPS, GEAR_TOTAL, searchGear } = await import('../src/lib/gearCatalog.js')

  const byKey = Object.fromEntries(GEAR_GROUPS.map((g) => [g.key, g]))
  assert.ok(byKey.amp && byKey.drive, 'the two lists anybody came here for are missing')

  /*
   * Cabinets are the absence that has to stay an absence. All 45 carry a blank
   * lineage, so a Cabs tab would be 45 rows of nothing — and the rule this
   * inherits from lineage.js is silence over a plausible guess.
   */
  assert.ok(!byKey.cab, 'a cab list is offered, and every row of it would be blank')

  // Every amp names a real amp. That is the state of the data and the thing
  // most worth noticing if it ever stops being true.
  const ampsNamed = byKey.amp.entries.filter((e) => e.gear).length
  assert.equal(ampsNamed, byKey.amp.entries.length, ampsNamed + ' of ' + byKey.amp.entries.length + ' amps name their real amp')
  assert.ok(byKey.amp.entries.length > 300, 'the amp list came back short: ' + byKey.amp.entries.length)
  assert.ok(GEAR_TOTAL > 400, 'only ' + GEAR_TOTAL + ' models can be named')

  // Fractal's own designs say so rather than borrowing somebody's amp.
  const fas = byKey.amp.entries.find((e) => e.name === 'FAS Modern')
  assert.match(fas?.gear || '', /custom model/i, 'a FAS original claims a real amp')

  // No model is listed twice — the same amp sits at more than one value on
  // some units, and a reference sheet that repeats itself reads as a bug.
  const names = byKey.amp.entries.map((e) => e.name)
  assert.equal(names.length, new Set(names).size, 'the amp list repeats itself')

  // Sorted, because 331 rows in catalog order is a list you scroll past.
  const sorted = [...names].sort((a, b) => a.localeCompare(b))
  assert.deepEqual(names, sorted, 'the list is not in an order anybody can scan')
  /*
   * Plain alphabetical, not numeric collation: that reads "5F1 Tweed" as 5 and
   * "59 Bassguy" as 59, and files every 5F, 5E and 5C amp ahead of the Bassman.
   */
  assert.ok(
    names.indexOf('59 Bassguy Bright') < names.indexOf('5F1 Tweed'),
    'the Bassman is filed after the amps whose names merely start with 5'
  )

  /*
   * The search has to read BOTH columns. What a person types is the REAL name
   * — "tube screamer" — which appears nowhere in the unit's own "T808 OD". A
   * search over the model names alone answers nothing for every query anyone
   * actually has, which is the whole reason the sheet exists.
   */
  const ts = searchGear(byKey.drive.entries, 'tube screamer')
  assert.ok(ts.length >= 2, 'searching the real name found ' + ts.length + ' of the Tube Screamers')
  assert.ok(ts.every((e) => !/tube screamer/i.test(e.name)), 'that search matched on the model name, so it proves nothing')

  // And still by the unit's own word for it.
  assert.ok(searchGear(byKey.amp.entries, 'brit 800').length, 'the unit’s own name finds nothing')

  // Every word has to match, so a second word narrows rather than widens.
  const marshall = searchGear(byKey.amp.entries, 'marshall')
  const plexi = searchGear(byKey.amp.entries, 'marshall plexi')
  assert.ok(plexi.length && plexi.length < marshall.length, 'a second word did not narrow the search')

  // An empty query is the whole list, not nothing.
  assert.equal(searchGear(byKey.amp.entries, '  ').length, byKey.amp.entries.length)

  /*
   * And a search says where its answers are. Somebody types "tube screamer"
   * with Amps open — the tab they land on by default — and every hit is in
   * Drives. Tabs still reading their full contents give no hint of that, so
   * the counts follow the search and the empty state names the tab.
   */
  const { searchAll } = await import('../src/lib/gearCatalog.js')
  const steer = searchAll('tube screamer')
  assert.equal(steer.find((g) => g.key === 'amp').hits.length, 0, 'the amps claim to hold a Tube Screamer')
  assert.ok(steer.find((g) => g.key === 'drive').hits.length >= 2, 'the drives lost them')
  assert.equal(steer.length, GEAR_GROUPS.length, 'searching all of them skipped one')
})

test('a write nobody could check is not written again on a guess', async () => {
  /*
   * From a debug log off an iPhone: Drive 1, Tone, Level, Mix and Treble each
   * written twice, the second time in the opposite encoding, every one of them
   * reported "NOT CHECKED".
   *
   * The retry is for one fault — the device silently ignoring an encoding it
   * does not take — and the evidence for it is a read that came back wrong. A
   * read that could not be MADE is not that evidence. Clearing the unit's
   * cache is a local-only route, so from a phone every check goes stale, and
   * every write was being followed by a second write to the hardware chosen on
   * the strength of nothing at all.
   *
   * Three things are asserted, and each one was costing a round trip over the
   * relay on every parameter of every send.
   */
  const store = { 'forgefx.host': 'http://unit.test' }
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => {
      delete store[k]
    }
  }
  const seen = []
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'
    const path = String(url).replace('http://unit.test', '')
    seen.push(method + ' ' + path)
    // What a phone gets: the cache clear refused, everything else fine.
    if (path === '/device/cache') {
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => JSON.stringify({ error: "You can't do that from a distance" })
      }
    }
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ ok: true }) }
  }

  try {
    const fx = await import('../src/lib/forgefx.js')
    fx.resetCacheClear()
    const res = await fx.setParamConfirmed(9, 3, 5, { name: 'Tone', min: 0, max: 10 })

    assert.equal(res.ok, false, 'a check that proved nothing was reported as a success')
    assert.equal(res.unverified, true, 'the caller cannot tell "unchecked" from "the unit ignored it"')
    assert.equal(res.retried, false, 'it retried on a check that proved nothing')

    const writes = seen.filter((c) => c.startsWith('PUT '))
    assert.equal(writes.length, 1, 'the value went to the hardware ' + writes.length + ' times')

    const reads = seen.filter((c) => c.startsWith('GET ') && c.includes('/params'))
    assert.deepEqual(reads, [], 'a read whose answer may not be believed still cost a round trip')

    /*
     * And a Mac that refuses it is asked once, not once per write.
     *
     * The clear travels the relay now — the pinned fork allows it — but a Mac
     * that has not taken that update refuses every time, and this runs before
     * every verified write. One iPhone log carried thirty copies of the same
     * refusal with six real errors from the unit buried among them. So the
     * answer is learned and kept until the link changes.
     */
    const askedFirst = seen.filter((c) => c === 'DELETE /device/cache').length
    assert.equal(askedFirst, 1, 'the first write asked ' + askedFirst + ' times')
    seen.length = 0
    await fx.setParamConfirmed(9, 4, 5, { name: 'Level', min: 0, max: 10 })
    assert.deepEqual(
      seen.filter((c) => c === 'DELETE /device/cache'),
      [],
      'a refusal it had already been given was asked for again'
    )

    // Until the link changes, which is the one thing that can change the answer.
    fx.resetCacheClear()
    seen.length = 0
    await fx.setParamConfirmed(9, 5, 5, { name: 'Mix', min: 0, max: 100 })
    assert.equal(
      seen.filter((c) => c === 'DELETE /device/cache').length,
      1,
      'reconnecting to a Mac that may have been updated still never asks it'
    )
  } finally {
    const fx = await import('../src/lib/forgefx.js')
    fx.resetCacheClear()
    delete globalThis.fetch
    delete globalThis.localStorage
  }
})

test('“port not open” becomes something a guitarist can act on', async () => {
  /*
   * Eighty lines of one debug log, all of them this:
   *
   *   POST /preset/blocks/58/bypass failed — port not open
   *
   * That is the device server saying it has no serial port to the unit any
   * more. What reached the screen was those four words, and only when the
   * screen showing them was not covered by a sheet — so tapping a block's On
   * button did nothing, said nothing, and put the button back the way it was.
   *
   * Two things are fixed here and both are asserted: the sentence a player
   * reads, and the flag the app needs to know the difference between "that
   * write was refused" and "nothing reaches the unit any more".
   */
  const store = { 'forgefx.host': 'http://unit.test' }
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => {
      delete store[k]
    }
  }
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    text: async () => JSON.stringify({ error: 'port not open' })
  })

  try {
    const fx = await import('../src/lib/forgefx.js')
    const err = await fx.setBypass(58, true).then(
      () => null,
      (e) => e
    )
    assert.ok(err, 'a write to a unit that is not there came back a success')
    assert.equal(err.unitGone, true, 'the app cannot tell this from a write the unit refused')
    assert.ok(!/port/i.test(err.message), 'the server’s own words went to the screen: ' + err.message)
    assert.match(err.message, /lost its connection to the unit/)
    assert.match(err.message, /Try again/, 'it says what is wrong and not what to do about it')
    assert.equal(err.detail, 'port not open', 'the debug log lost what the server actually said')

    // A refusal is not this. The old state still stands and the screen must
    // keep it rather than tearing itself down.
    assert.equal(fx.unitUnreachable("You can't do that from a distance"), false)
    assert.equal(fx.unitUnreachable('Port is not open'), true, 'the same fault in the serial layer’s words')
  } finally {
    delete globalThis.fetch
    delete globalThis.localStorage
  }
})

test('a dropped link stops the send instead of failing every write after it', () => {
  const forge = readSrc(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
  assert.match(forge, /function relayGone\(err, done, total, what\)/)
  assert.match(forge, /if \(!err\?\.linkDown\) return null/, 'a unit that refused a write must not stop the send')
  assert.match(forge, /dropped after \$\{done\} of \$\{total\}/, 'how far it got is the number that decides what to do next')

  // Every loop that talks to the unit over the relay: the write pass, the
  // scene pass, the read-back, and the schema read the generator designs from.
  const uses = forge.match(/relayGone\(/g) || []
  assert.ok(uses.length >= 10, `only ${uses.length} call sites — a loop was left grinding through a dead link`)

  // The schema read is the subtle one: its catch was empty, so a relay that
  // went away produced blocks with no parameters and the generator designed a
  // tone against a preset nobody could read.
  const schema = forge.slice(forge.indexOf('export async function readSchema'), forge.indexOf('export async function applyChanges'))
  assert.match(schema, /const stop = relayGone\(err, i, editable\.length, 'blocks read'\)/)
})

test('Try again rejoins before it reads, which is all a reload ever did', () => {
  /*
   * "Hitting try again did nothing. Refreshing browser reconnect."
   *
   * pokeLink schedules a timer; it does not connect. So the read ran first,
   * over a socket that had already closed, failed instantly, and put the same
   * fault screen straight back up — while the rejoin it had asked for landed
   * seconds later with nothing looking at it.
   */
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const fn = app.slice(app.indexOf('const reconnect = useCallback'), app.indexOf('const linkAction = useCallback'))
  assert.match(fn, /await reconnectPhone\(\{ fresh: true \}\)/, 'the button asks for a rejoin it does not wait for')
  assert.ok(
    fn.indexOf('await reconnectPhone({ fresh: true })') < fn.indexOf('await read()'),
    'the read still runs before the rejoin'
  )
  assert.ok(!/pokeLink\(\)/.test(fn), 'a scheduled poke is not a reconnection')
})

test('Try again asks for a new socket, which is the rest of what a force-quit did', async () => {
  /*
   * "I have to force close the app completely and then reopen it for it to
   * connect again." Rejoining before the read fixed the case where the socket
   * had visibly closed. This is the other one: a socket realtime-js still
   * calls joined that the server let go of long ago. Nothing in here can tell
   * that from a working link — the phone sends into it and simply hears
   * nothing — so a reconnect that reuses "a channel that looks fine" reads
   * down the same dead line every time, and only killing the app ever helped.
   *
   * The keepalive still reuses a good channel: it runs every few seconds and
   * a teardown on each turn would be a link that never settles.
   */
  const remoteMod = await import('../src/lib/remote.js')
  const chan = { state: 'joined' }
  const client = {}
  assert.equal(remoteMod.canReuseChannel(chan, { client }, client), true, 'a joined channel stopped being reusable')

  const remoteSrc = readSrc(new URL('../src/lib/remote.js', import.meta.url), 'utf8')
  assert.match(
    remoteSrc,
    /export async function remoteConnect\(\{ fresh = false \} = \{\}\)/,
    'connect cannot be asked for a new socket'
  )
  assert.match(
    remoteSrc,
    /if \(!fresh && canReuseChannel\(channel, session, client\)\) return userId/,
    'a forced rejoin is still handed the channel it was trying to replace'
  )

  const linkSrc = readSrc(new URL('../src/lib/link.js', import.meta.url), 'utf8')
  assert.match(linkSrc, /async function join\(\{ fresh = false \} = \{\}\)/)
  assert.match(linkSrc, /await remoteConnect\(\{ fresh \}\)/, 'the flag stops at the door')
  /*
   * Both Try agains, not just the one on the fault screen. The connect screen
   * is where someone lands when the Mac has stopped answering, which is
   * exactly when the channel is most likely to be the zombie this is about.
   */
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.equal(
    (app.match(/reconnectPhone\(\{ fresh: true \}\)/g) || []).length,
    2,
    'one of the two Try agains still reuses the socket it is trying to replace'
  )

  const at = linkSrc.indexOf('async function tick()')
  assert.notEqual(at, -1, 'the keepalive loop is gone, so nothing here is being checked')
  const loop = linkSrc.slice(at, at + 900)
  assert.match(loop, /await join\(\)/, 'the loop no longer joins at all')
  assert.ok(!/join\(\{/.test(loop), 'the keepalive tears the link down every few seconds')
})

test('a poke asks now, not in three seconds', () => {
  const src = readSrc(new URL('../src/lib/link.js', import.meta.url), 'utf8')
  const poke = src.slice(src.indexOf('export function pokeLink'), src.indexOf('export function pokeLink') + 200)
  assert.match(poke, /schedule\(0\)/, 'a screen just unlocked waits three seconds before anything happens')
  // And a socket that closed is chased at once rather than at the next turn of
  // the loop — up to thirty seconds while backed off, never while hidden.
  assert.match(src, /if \(!up && state\.role === 'remote'[\s\S]{0,120}pokeLink\(\)/)
})

test('the screen is held awake for as long as the unit is being written to', async () => {
  const { keepAwake } = await import('../src/lib/awake.js')

  let taken = 0
  let released = 0
  const listeners = {}
  let onRelease = null
  const nav = {
    wakeLock: {
      request: async () => {
        taken++
        return {
          addEventListener: (name, fn) => {
            if (name === 'release') onRelease = fn
          },
          release: async () => {
            released++
          }
        }
      }
    }
  }
  const doc = {
    hidden: false,
    addEventListener: (name, fn) => {
      listeners[name] = fn
    },
    removeEventListener: (name) => {
      delete listeners[name]
    }
  }

  const release = keepAwake({ nav, doc })
  await Promise.resolve()
  assert.equal(taken, 1, 'a send runs for minutes with nobody touching the screen; auto-lock ends it')

  /*
   * The system drops the lock whenever the page is hidden and does NOT hand it
   * back. One glance at a notification would otherwise end the protection for
   * the rest of the send, silently — so it is re-taken on the way back.
   */
  doc.hidden = true
  onRelease()
  listeners.visibilitychange()
  await Promise.resolve()
  assert.equal(taken, 1, 'a hidden page asked for a lock it cannot hold')

  doc.hidden = false
  listeners.visibilitychange()
  await Promise.resolve()
  assert.equal(taken, 2, 'the lock the system took back was never asked for again')

  // A lock we still hold is not asked for twice.
  listeners.visibilitychange()
  await Promise.resolve()
  assert.equal(taken, 2)

  release()
  assert.equal(released, 1, 'a finished send leaves the screen on for the rest of the night')
  assert.equal(listeners.visibilitychange, undefined, 'the listener outlives the send')
})

test('a request caught between one channel and the next waits for the next one', () => {
  /*
   * The rejoin the drop itself triggers tears the old session down before it
   * registers the new one. A request landing in that window would have been
   * told "not connected" and given up — over a link that was a second from
   * coming back, and coming back because of the very drop it was reacting to.
   */
  const src = readSrc(new URL('../src/lib/remote.js', import.meta.url), 'utf8')
  assert.match(src, /if \(!session && !connecting\) throw linkDown\('Not connected to your Mac\.'\)/)
  assert.match(src, /connecting = true\n  try \{\n    return await joinChannel\(\)\n  \} finally \{\n    connecting = false\n  \}/)
})

test('the grace period is one budget for the request, not one per attempt', () => {
  /*
   * The screen that decides whether a unit is really gone asks five reads in a
   * row. A retry that could double each one's wait would turn a flapping link
   * into eighty seconds of nothing.
   */
  const src = readSrc(new URL('../src/lib/remote.js', import.meta.url), 'utf8')
  assert.match(src, /const graceUntil = Date\.now\(\) \+ \(options\.graceMs \?\? RELAY_GRACE\)/)
  assert.match(src, /await relayReady\(graceUntil - Date\.now\(\)\)/, 'each attempt starts its own grace period')
})

test('the screen is held awake for the send and for the read, and let go after both', () => {
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  for (const [name, start, end] of [
    ['apply', 'const apply = async () => {', 'const revert'],
    ['generate', 'const generate = async (description', 'const apply = async () => {']
  ]) {
    const slice = app.slice(app.indexOf(start), app.indexOf(end))
    assert.ok(slice.length > 200, `could not find ${name}`)
    assert.match(slice, /const release = keepAwake\(\)/, `${name} runs for minutes and lets the phone lock itself`)
    assert.match(slice, /\} finally \{\n(?:      pending\.current = null\n)?      release\(\)/, `${name} leaves the screen on after it finishes`)
  }
})

test('a send cut off part-way is not recorded as a preset that was written', () => {
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const apply = app.slice(app.indexOf('const apply = async () => {'), app.indexOf('const revert'))
  assert.match(apply, /if \(err\.linkDown\)/)
  // The plan must stay unsent, so the button still offers to write it: sending
  // again after reconnecting rewrites what landed to the same values.
  const sent = apply.indexOf('setSentPlan(')
  const caught = apply.indexOf('} catch (err) {\n      setError(err.message)')
  assert.ok(sent !== -1 && caught !== -1 && sent < caught, 'a half-written preset is marked as sent')
  assert.match(apply, /setDirty\(true\)\n        record\('write', `Send stopped early/, 'the unit really was changed, and the app forgot')
})

test('a browser with no wake lock is not a browser that cannot send', async () => {
  const { keepAwake } = await import('../src/lib/awake.js')
  // Older Safari, and any context that refuses. The relay's own patience
  // covers the lock that then happens anyway.
  const release = keepAwake({ nav: {}, doc: { addEventListener: () => {} } })
  assert.equal(typeof release, 'function')
  release()
})

test('the save guard asks the unit which preset is loaded, not the screen', () => {
  /*
   * "I keep seeing the 'Mac has moved to slot 7' but it had never moved."
   *
   * It hadn't. What had moved was the Mac page's idea of it, in the opposite
   * direction — the unit was on 501 and the page still remembered 7.
   *
   * `preset.number` is React state, filled by read() and by nothing else. The
   * device event stream carries scene, tempo and tuner and has never carried a
   * preset change, so selecting a preset from the phone — or turning the knob
   * on the unit — moves the hardware and leaves the page's number where it was,
   * indefinitely. The guard compared a phone that knew the truth against a Mac
   * that did not, and refused a save that was perfectly good.
   */
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const guard = app.slice(app.indexOf('const req = await takeParkedSave()'))
  const scope = guard.slice(0, guard.indexOf('const timer = setInterval(look'))

  // One live read, and the decision made on its answer.
  assert.match(scope, /const now = await currentPreset\(\)/)
  assert.match(scope, /loaded = now\.number/)
  assert.match(
    scope,
    /const sameBuffer = req\.fromSlot == null \|\| req\.fromSlot === loaded/,
    'the decision is still made against the page state'
  )
  // And the sentence names what is actually loaded, rather than the stale
  // number it used to accuse the Mac of having moved to.
  assert.match(scope, /The Mac had moved to slot \$\{loaded \?\? 'another preset'\}/)
  assert.ok(
    !/moved to slot \$\{preset\?\.number/.test(scope),
    'the message still reports the number that was wrong in the first place'
  )

  // The screen was wrong too, so it is corrected rather than left disagreeing
  // with the decision just made from it.
  assert.match(scope, /if \(now\.number !== preset\?\.number\) setPreset\(now\)/)
  // A unit that will not answer falls back to what the page has, which is what
  // this used for everything before.
  assert.match(scope, /let loaded = preset\?\.number \?\? null/)
  // Nothing acted on after the component has gone.
  assert.match(scope, /\}\n\s*if \(stop\) return/)
})

test('nothing in the event stream keeps the preset number current', () => {
  /*
   * The reason the guard has to ask. If a preset-change event is ever added to
   * handleEvent, this test is the thing that should be revisited — until then
   * the live read is not belt-and-braces, it is the only source of truth.
   */
  const ds = readSrc(new URL('../src/lib/deviceState.js', import.meta.url), 'utf8')
  const handler = ds.slice(ds.indexOf('export function handleEvent'), ds.indexOf('export function listen'))
  for (const known of ['scene', 'tempo', 'tuner']) {
    assert.ok(handler.includes(`'${known}'`) || handler.includes(known), `${known} stopped being handled`)
  }
  assert.ok(
    !/set\(\{ preset/.test(handler),
    'the event stream sets the preset now — the guard can stop reading it live'
  )
})

console.log('\nscene names surviving the phone')

test('a scene name is written down, not forgotten, by the hand that set it', async () => {
  /*
   * "After writing a scene, saving a scene and the unit confirmed it was saved,
   * when I go back on the phone and then forward again it's not there anymore."
   *
   * Renaming called forgetSceneNames — sound reasoning where a name changed
   * somewhere else, and exactly wrong where we are the one who changed it. On a
   * phone those caches are the ONLY copy: scene names live in a preset dump,
   * dumps are refused over the relay, and the summary does not carry them. So
   * the name reached the hardware and became unreadable from the handset that
   * had just written it.
   */
  const store = {}
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => {
      delete store[k]
    }
  }
  const fx = await import('../src/lib/forgefx.js')
  try {
    // What the panel had on screen, and the one being changed.
    fx.noteSceneName(501, 2, 'Lead', ['Clean', 'Rhythm', '', '', '', '', '', ''])

    const cache = JSON.parse(store['fractal.sceneNames'] || '{}')
    const kept = Object.values(cache)[0]
    assert.ok(Array.isArray(kept), 'nothing was written down at all')
    assert.equal(kept[2], 'Lead', 'the name just set was not kept')
    assert.equal(kept[0], 'Clean', 'the names already known were thrown away')
    assert.equal(kept[1], 'Rhythm')

    // A slot with nothing on screen still keeps what it was told.
    fx.noteSceneName(502, 0, 'Verse', [])
    const second = JSON.parse(store['fractal.sceneNames'] || '{}')
    assert.equal(Object.values(second).find((v) => v[0] === 'Verse')?.[0], 'Verse')

    // Past the end of what was known, rather than dropped.
    fx.noteSceneName(503, 5, 'Solo', ['One'])
    const third = Object.values(JSON.parse(store['fractal.sceneNames'] || '{}')).find((v) => v[5] === 'Solo')
    assert.equal(third[5], 'Solo')
    assert.equal(third[0], 'One')
    assert.equal(third[3], '', 'the gap was filled with something other than a blank')

    // Nothing to say, nothing written: a plan that named no scene must not
    // stamp an empty list over names a previous session managed to read.
    const before = store['fractal.sceneNames']
    fx.noteSceneNames(501, new Map())
    fx.noteSceneNames(null, new Map([[0, 'Nope']]))
    assert.equal(store['fractal.sceneNames'], before, 'an empty rename overwrote what was known')
  } finally {
    delete globalThis.localStorage
  }
})

test('a generated scene plan writes its names down too', () => {
  /*
   * The bigger path, and the one the report came from: a plan names all eight
   * scenes at once and none of them were kept. The unit had them; the handset
   * that asked for them could not see one.
   */
  const src = readSrc(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
  const apply = src.slice(src.indexOf('export async function applyScenes'), src.indexOf('/** Load a preset by slot'))

  assert.match(apply, /export async function applyScenes\(scenes, onProgress, presetNumber = null\)/)
  // Recorded only where the write actually landed — a refused rename must not
  // leave a name on screen the unit does not have.
  assert.match(apply, /await setSceneName\(scene\.index, scene\.name\)\s*\n\s*named\.set\(scene\.index, scene\.name\)/)
  // One merge at the end rather than a host round trip per scene.
  assert.match(apply, /noteSceneNames\(presetNumber, named\)/)

  // And the slot reaches it from the apply flow.
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const call = app.slice(app.indexOf('await applyScenes('), app.indexOf('failures.push(...sceneFailures)'))
  assert.match(call, /result\.scenes,/)
  assert.match(call, /preset\?\.number \?\? null/, 'the slot never reaches the thing that writes the names down')

  // And a save records them under the slot the buffer just became — the one
  // moment the answer is certain, and the moment the report was about.
  const saveAt = app.indexOf('await storePreset(number)')
  const save = app.slice(saveAt, app.indexOf('setApplied((prev) => ({ ...prev, savedTo: number })', saveAt))
  assert.match(save, /keepSavedScenes\(number, sceneNames\)/)

  /* One helper now, because three routes end in a save and each one wrote its
     own version of this — see "a save writes down what the slot is called". */
  const helper = app.slice(app.indexOf('function keepSavedScenes('), app.indexOf('function designMemory('))
  assert.match(helper, /noteSceneNames\(number, new Map\(names\.map\(\(n, i\) => \[i, \(n \|\| ''\)\.trim\(\)\]\)\)\)/)
  assert.match(helper, /names\.some\(\(n\) => \(n \|\| ''\)\.trim\(\)\)/, 'an unnamed buffer stamps blanks over what the slot had')

  // The rename path no longer throws the names away.
  const scenes = readSrc(new URL('../src/components/Scenes.jsx', import.meta.url), 'utf8')
  assert.match(scenes, /noteSceneName\(preset\?\.number, index, name, names\)/)
  assert.ok(!/forgetSceneNames\(/.test(scenes), 'the rename still forgets the name it just set')
})

test('a save writes down what the slot is called, on every route to one', () => {
  /*
   * "The preset screens keep showing the wrong preset. It says TIGHT MODERN on
   * 98 when it's Three Days Grace. Even if I force close the app and reopen
   * it, it shows the wrong preset on the phone, even though the Mac is loaded
   * on the correct preset."
   *
   * Three routes end in a preset landing in a slot — a save at the Mac, the
   * Mac carrying out one the phone asked for, and the phone hearing back that
   * it landed — and every one of them answered it the same way: forget that
   * slot's name, and let somebody read it again. On a phone nobody can. An AM4
   * will not dump a preset over the relay, so the name the phone already had
   * was the name it kept, through a restart and for good.
   */
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const fx = readSrc(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')

  // The name that just went into the slot is written down rather than dropped.
  assert.match(fx, /export function notePresetName\(number, name\)/)
  const note = fx.slice(fx.indexOf('export function notePresetName('), fx.indexOf('export function forgetPresetName('))
  assert.match(note, /nameCache\.set\(number, kept\)/)
  assert.match(note, /persistNames\(\)/, 'the name is gone again on the next launch')
  assert.match(note, /publishNames\(\)/, 'the Mac keeps the new name to itself')

  // All three routes, and each one says which name it is asserting.
  assert.equal(
    (app.match(/keepSavedName\(/g) || []).length,
    4,
    'one of the three saves still forgets the slot instead of naming it — or the helper went'
  )
  for (const route of [
    /await storePreset\(number\)[\s\S]{0,400}?keepSavedName\(number, name \|\| preset\?\.name\)/,
    /await storePreset\(req\.slot\)[\s\S]{0,400}?keepSavedName\(req\.slot, name \|\| preset\?\.name\)/,
    /keepSavedName\(res\.slot, queuedSave\.name\)[\s\S]{0,300}?The Mac saved it to slot/
  ]) {
    assert.match(app, route)
  }

  /*
   * A buffer with no name of its own is the one case with nothing to state,
   * and asserting an empty name would be worse than forgetting.
   */
  const helper = app.slice(app.indexOf('function keepSavedName('), app.indexOf('function keepSavedScenes('))
  assert.match(helper, /if \(kept\) notePresetName\(number, kept\)/)
  assert.match(helper, /else forgetPresetName\(number\)/)

  /*
   * And the phone carries the name and the scenes with the request, because
   * when the Mac says it landed, that is the only description of the slot the
   * phone will ever have.
   */
  const park = app.slice(app.indexOf('setQueuedSave({'), app.indexOf('record(\'save\', `Asked the Mac to save'))
  assert.match(park, /name: saveName\.trim\(\) \|\| preset\?\.name \|\| ''/)
  assert.match(park, /scenes: Array\.isArray\(sceneNames\) \? \[\.\.\.sceneNames\] : \[\]/)

  // The list on screen is rebuilt from the cache, so the new name shows now
  // rather than after the next scan.
  assert.ok(
    !/setSlots\(\(prev\) => prev\.filter\(\(s\) => s\.number !== (number|req\.slot)\)\)/.test(app),
    'a saved slot is still dropped from the list instead of renamed in it'
  )
})

test('the Mac wins where the two disagree about a slot', () => {
  /*
   * The other half, and what heals a phone that already has a wrong name in
   * it. The Mac is the end with the cable; the phone only ever knows what the
   * Mac told it. Importing used to skip any slot this browser already had a
   * name for, so a name that went wrong stayed wrong — the phone had TIGHT
   * MODERN for 98, the Mac had the name that overwrote it, and the two never
   * met.
   *
   * Only a slot the host actually names is touched: a partial host copy — the
   * Mac has not scanned that far — must not empty the list on the phone.
   */
  const fx = readSrc(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
  const imp = fx.slice(fx.indexOf('export async function importHostNames'), fx.indexOf('/** One slot\'s name'))
  assert.ok(!/nameCache\.has\(number\)/.test(imp), 'a name this browser already has still wins over the Mac\'s')
  assert.match(imp, /if \(nameCache\.get\(number\) === name\) continue/, 'every import counts every slot as changed')
  assert.match(imp, /if \(!doc \|\| typeof doc !== 'object'\) return 0/, 'a missing host copy is treated as an answer')
})

console.log('\nwriting one amp on three channels')

test('a value checked on the wrong channel is not a value that did not stick', async () => {
  /*
   * "15 values read back different from what was sent" — and the list named
   * Amp 1 Gain 1 three times, wanting 6.5, then 3, then 8.5, and reading 8
   * every time. One readout, held up against three different intentions.
   *
   * A preset that dials a rhythm and a lead out of one amp lists that block
   * once per channel, which is the documented way to do it: values belong to a
   * channel, not to a block. applyChanges honours that. verifyChanges did not —
   * it read whichever channel the write pass finished on and compared it
   * against every change for that block, so every channel but the last was
   * reported wrong, in full, with real-looking numbers. Nothing had failed to
   * stick; the checking was looking in one place for three answers.
   *
   * Run against the demo device rather than asserted about the source, because
   * the demo keeps its values keyed by "effectId:channel" — which is the very
   * thing the bug ignored.
   */
  const store = {}
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => {
      delete store[k]
    }
  }
  const fx = await import('../src/lib/forgefx.js')
  fx.setDemo(true)
  try {
    const blocks = await fx.presetBlocks()
    const amp = blocks.find((b) => b.slug === 'amp')
    assert.ok(amp, 'the demo has no amp to dial')
    const read = async () => (await fx.blockParams(amp.effectId))?.named || []
    const gain = (await read()).find((p) => /gain/i.test(p.name))
    assert.ok(gain, 'the demo amp has no gain control')

    // One block, two channels, deliberately far apart — the shape the report
    // came from.
    const changes = [
      {
        eid: amp.effectId,
        name: amp.name,
        channel: 'A',
        params: [{ id: gain.id, name: gain.name, to: 3, unit: '', range: { min: gain.min, max: gain.max } }]
      },
      {
        eid: amp.effectId,
        name: amp.name,
        channel: 'B',
        params: [{ id: gain.id, name: gain.name, to: 9, unit: '', range: { min: gain.min, max: gain.max } }]
      }
    ]

    const failures = await fx.applyChanges(changes)
    assert.deepEqual(failures, [], 'the write pass could not dial two channels')

    const mismatches = await fx.verifyChanges(changes)
    assert.deepEqual(
      mismatches,
      [],
      `channel A was checked against channel B's readout — ${JSON.stringify(mismatches)}`
    )

    // And checking did not move the rig: the block is left where the write
    // pass left it, which is the last channel the plan named.
    const after = await fx.blockParams(amp.effectId)
    const nowGain = (after?.named || []).find((p) => p.id === gain.id)
    assert.equal(Math.round(nowGain.value), 9, 'verifying left the amp on a different channel than the write did')
  } finally {
    fx.setDemo(false)
    delete globalThis.localStorage
  }
})

test('the demo can be turned off where there is no browser to remember it', async () => {
  /*
   * setDemo wrote the demo flag to localStorage without checking there was
   * one. In a browser there always is; in the tests there is not, except where
   * a test installs a fake — and the tests drive the mock device through this
   * very function to check the write and verify paths without hardware.
   *
   * So turning the demo ON worked (the caller had installed a fake by then)
   * and turning it OFF threw, in a `finally`, after the real assertions had
   * passed. It read as the code under test failing. It surfaced only on Node
   * 20, which is what CI runs and which drains the test queue in a different
   * order from Node 22, so it passed on the machine it was written on and was
   * red on main from the commit that added it.
   *
   * Run with the global genuinely absent, which is the condition that broke
   * it, and put back whatever was there for whoever runs next.
   */
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage')
  const saved = had ? globalThis.localStorage : undefined
  delete globalThis.localStorage
  try {
    const fx = await import('../src/lib/forgefx.js')
    fx.setDemo(true)
    assert.equal(fx.isDemo(), true, 'the demo will not start without somewhere to write it down')
    fx.setDemo(false)
    assert.equal(fx.isDemo(), false, 'the demo cannot be turned off without somewhere to write it down')
  } finally {
    if (had) globalThis.localStorage = saved
  }
})

test('a value that really did not stick is still reported, and says which channel', async () => {
  /*
   * The other half. Silencing the false alarms must not silence a real one —
   * a write the unit clamps is exactly what this check exists to catch.
   */
  const src = readSrc(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
  const verify = src.slice(src.indexOf('export async function verifyChanges'))

  // Selected before reading, the same move applyChanges makes.
  assert.match(verify, /if \(change\.channel !== undefined\) \{\s*\n\s*try \{\s*\n\s*await setChannel\(change\.eid, change\.channel\)/)
  // The channel travels with the finding, so three lines about one control can
  // be told apart rather than reading as one control failing three times.
  assert.match(verify, /channel: change\.channel \?\? null/)
  // Put back where the write pass left it: checking a preset must not change it.
  assert.match(verify, /for \(const \[eid, channel\] of leftOn\)/)
  assert.match(verify, /if \(change\.channel !== undefined\) leftOn\.set\(change\.eid, change\.channel\)/)

  // And the report says the channel out loud.
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /\$\{m\.block\}\$\{m\.channel \? ` ch \$\{m\.channel\}` : ''\}/)
})

console.log('\nthe conversation surviving the phone')

const sessionMod = await import('../src/lib/session.js')
const cloudChatMod = await import('../src/lib/cloudChat.js')

const fakeStore = (seed = {}) => {
  const items = { ...seed }
  return {
    items,
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => {
      items[k] = String(v)
    },
    removeItem: (k) => {
      delete items[k]
    }
  }
}

test('the chat and the tone come back after the phone drops the page', () => {
  /*
   * "I was also in the middle of generating a tone and the chat and tone
   * disappeared." iOS evicts a backgrounded web page whenever it wants the
   * memory, and what comes back is a fresh load. Ten seconds in another app
   * was enough to lose a whole conversation.
   */
  const { saveSession, loadSession } = sessionMod
  const store = fakeStore()
  const turns = [
    { role: 'user', text: 'warmer' },
    { role: 'assistant', text: 'Dropped the presence.' }
  ]
  assert.equal(saveSession({ turns, result: { presetName: 'Lead' }, saveName: 'Lead', lastPrompt: 'warmer' }, store), true)

  const back = loadSession(store)
  assert.deepEqual(back.turns, turns, 'the conversation did not survive')
  assert.equal(back.result.presetName, 'Lead', 'the tone on screen did not survive')
  assert.equal(back.saveName, 'Lead')
  assert.equal(back.lastPrompt, 'warmer')
  // renamePreset defaults ON, so absent must not read as off.
  assert.equal(loadSession(fakeStore({ 'fab.session.v1': JSON.stringify({ v: 1, turns: [] }) })).renamePreset, true)
})

test('a transcript that cannot be read is no transcript, not a crash', () => {
  const { loadSession, saveSession } = sessionMod
  assert.equal(loadSession(fakeStore()), null, 'nothing saved is not an error')
  assert.equal(loadSession(fakeStore({ 'fab.session.v1': 'not json' })), null)
  // A record from a future shape is ignored rather than half-read.
  assert.equal(loadSession(fakeStore({ 'fab.session.v1': JSON.stringify({ v: 9, turns: [] }) })), null)
  assert.equal(loadSession(fakeStore({ 'fab.session.v1': JSON.stringify({ v: 1, turns: 'nope' }) })), null)
  // A private window throws on the accessor, not on use. Saving must not fail
  // a render over it.
  const hostile = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {}
  }
  assert.equal(saveSession({ turns: [] }, hostile), false)
  assert.equal(loadSession(hostile), null)
  assert.doesNotThrow(() => sessionMod.clearSession(hostile))
})

test('a long conversation is trimmed from the old end, not the new', () => {
  const { saveSession, loadSession, MAX_TURNS } = sessionMod
  const store = fakeStore()
  const many = Array.from({ length: MAX_TURNS + 20 }, (_, i) => ({ role: 'user', text: `turn ${i}` }))
  saveSession({ turns: many }, store)
  const back = loadSession(store)
  assert.equal(back.turns.length, MAX_TURNS)
  // The newest survive: an old turn has already been acted on.
  assert.equal(back.turns.at(-1).text, `turn ${MAX_TURNS + 19}`)
  assert.equal(back.turns[0].text, 'turn 20')
})

test('a generation cut off by the phone says so instead of waiting for ever', () => {
  /*
   * The request died with the page and cannot be resumed — it was an HTTP
   * request held open by a page that no longer exists. What can be saved is
   * the knowledge that an answer was owed, so the app does not come back
   * looking as though nothing had been happening.
   */
  const { interrupted } = sessionMod
  assert.equal(interrupted(null), null, 'a session that ended between thoughts apologises for nothing')
  assert.equal(interrupted({}), null)
  assert.equal(interrupted({ description: '   ' }), null)
  const turn = interrupted({ description: 'a doom tone' })
  assert.equal(turn.role, 'system')
  assert.match(turn.text, /background/)
  assert.match(turn.text, /Nothing reached the unit/, 'somebody has to be told their unit was not half-written')
})

test('the later transcript wins, and an empty one never wins', () => {
  const { pickChat } = cloudChatMod
  const here = [{ role: 'user', text: 'local' }]
  const there = [{ role: 'user', text: 'cloud' }]

  // An account that has never synced must not wipe the conversation somebody
  // is in the middle of.
  assert.deepEqual(pickChat({ turns: here, at: 5 }, null), { turns: here, from: 'here' })
  assert.deepEqual(pickChat({ turns: here, at: 5 }, { turns: [], at: 9 }), { turns: here, from: 'here' })
  // A fresh browser picks up what the account holds.
  assert.deepEqual(pickChat({ turns: [], at: 0 }, { turns: there, at: 9 }), { turns: there, from: 'cloud' })
  // Both real: the newer write, which for an append-only transcript is the one
  // that contains the other.
  assert.equal(pickChat({ turns: here, at: 5 }, { turns: there, at: 9 }).from, 'cloud')
  assert.equal(pickChat({ turns: here, at: 9 }, { turns: there, at: 5 }).from, 'here')
  // A tie keeps what is on screen rather than replacing it with the same thing.
  assert.equal(pickChat({ turns: here, at: 5 }, { turns: there, at: 5 }).from, 'here')
  assert.deepEqual(pickChat(null, null), { turns: [], from: 'here' })
})

test('the other device is named in words, not in a user agent', () => {
  const { deviceName } = cloudChatMod
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari'), 'iPhone')
  assert.equal(deviceName('Mozilla/5.0 (iPad; CPU OS 17_5) Safari'), 'iPad')
  assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari'), 'Mac')
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14) Chrome'), 'Android')
  assert.equal(deviceName(''), 'a browser')
  assert.equal(deviceName(undefined), 'a browser')
})

test('the conversation is restored before the first frame, and written on every change', () => {
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')

  // Read synchronously into a ref, so a phone coming back from the background
  // never flashes an empty conversation on its way to the real one.
  assert.match(app, /const restored = useRef\(loadSession\(\)\)\.current/)
  assert.ok(
    app.indexOf('const restored = useRef(loadSession())') < app.indexOf('const [result, setResult]'),
    'the state it seeds is declared before the thing that seeds it'
  )
  assert.match(app, /useState\(restored\?\.result \?\? null\)/)
  assert.match(app, /const cut = interrupted\(restored\?\.pending\)/)

  // Written on change rather than on a timer: a timer loses whatever happened
  // in the last tick, which on iOS is exactly when the page is taken away.
  const save = app.slice(app.indexOf('    saveSession({\n      turns,'))
  assert.match(
    save.slice(0, 460),
    /\}, \[turns, chatId, result, withScenes, renamePreset, saveName, lastPrompt, thinking\]\)/
  )
  // Which conversation this is goes down with it. Without that, a phone coming
  // back from the background would shelve the chat it was in as a new one.
  assert.match(save.slice(0, 460), /^\s+chatId,$/m)

  // The in-flight ask is on disk before the first round trip and cleared when
  // it settles, so finding it set on load is the signal the page died.
  assert.match(app, /pending\.current = \{ description, at: Date\.now\(\) \}/)
  assert.match(app, /pending\.current = null/)
})

test('the account copy is pulled once and pushed on a debounce', () => {
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  // A reply lands as several state changes in a row; each would otherwise be
  // its own round trip.
  assert.match(app, /if \(!turns\.length\) return undefined/, 'an empty chat is pushed over the one on the Mac')
  // Signed out the same debounce still runs — it is what puts the conversation
  // on the browser's own shelf — so the cloud write carries its own guard
  // rather than the effect returning early for everyone.
  assert.match(app, /if \(chatCloudReady\(\)\) \{\s*\n\s*saveCloudChat\(turns\)/)
  assert.match(app, /saveCloudChat\(turns\)[\s\S]{0,900}\}, 2000\)/)
  // And onto the shelf under this conversation's own id, so a tab that is
  // closed without anyone pressing New chat still leaves the chat behind.
  assert.match(app, /archiveChat\(turns, chatId\)[\s\S]{0,300}\}, 2000\)/)
  // Pulled after the link has an account: supabaseClient() is null until
  // restoreSession has run, so asking on mount would always answer signed out.
  assert.match(app, /if \(pulledChat\.current \|\| !link\.account \|\| !chatCloudReady\(\)\) return/)
  // Only when it really is the other copy — setting the same turns again would
  // push them back up and restart this on the other device.
  assert.match(app, /if \(winner\.from !== 'cloud'\) return/)
})

test('a conversation is named by the first thing the player actually said', async () => {
  const { titleFor, worthKeeping } = await import('../src/lib/chatLog.js')

  // App notes and hand edits are true sentences about a chat that say nothing
  // about which chat it was — "Chain in: Amp (3), Cab (4)" is not a title.
  assert.equal(
    titleFor([
      { role: 'system', text: 'Chain in: Amp (3), Cab (4)' },
      { role: 'hand', text: 'Named scene 4 Solo' },
      { role: 'user', text: 'tight modern metal rhythm in drop A' },
      { role: 'user', text: 'brighter' }
    ]),
    'tight modern metal rhythm in drop A'
  )
  assert.equal(titleFor([]), 'Untitled chat')
  assert.equal(titleFor([{ role: 'assistant', text: 'Done.' }]), 'Untitled chat')
  assert.equal(titleFor(null), 'Untitled chat')
  // Long enough to recognise, short enough for one line.
  const long = titleFor([{ role: 'user', text: 'x'.repeat(200) }])
  assert.ok(long.length <= 70, `a title ${long.length} characters long is not a list row`)
  assert.ok(long.endsWith('\u2026'), 'a trimmed title does not say it was trimmed')
  // Whitespace is not a sentence.
  assert.equal(titleFor([{ role: 'user', text: '   \n  ' }]), 'Untitled chat')

  /* A conversation worth shelving is one somebody said something in. Pressing
     New chat on an empty box must not leave a row behind. */
  assert.equal(worthKeeping([]), false)
  assert.equal(worthKeeping([{ role: 'system', text: 'Reconnected' }]), false)
  assert.equal(worthKeeping([{ role: 'user', text: 'hello' }]), true)
})

test('both shelves of chats read as one list, newest first, each one once', async () => {
  const { mergeChats } = await import('../src/lib/chatLog.js')

  /*
   * Signing in lifts this browser's chats to the account, so for a while the
   * same conversation really is in both places. It is one row in the list, and
   * the account's copy is the one that survives — it is the copy that follows
   * you to the next machine.
   */
  const cloud = [
    { id: 'b', title: 'from the account', at: 20, where: 'cloud' },
    { id: 'a', title: 'also on the account', at: 5, where: 'cloud' }
  ]
  const local = [
    { id: 'a', title: 'the browser copy', at: 5, where: 'browser' },
    { id: 'c', title: 'only here', at: 10, where: 'browser' }
  ]
  const merged = mergeChats(cloud, local)
  assert.deepEqual(merged.map((c) => c.id), ['b', 'c', 'a'], 'the list is not newest first')
  assert.equal(merged.find((c) => c.id === 'a').where, 'cloud', 'the browser copy won a tie')
  assert.equal(merged.length, 3, 'one conversation is listed twice')

  // Signed out, or an account with nothing on it, is not an error.
  assert.deepEqual(mergeChats([], local).map((c) => c.id), ['c', 'a'])
  assert.deepEqual(mergeChats(), [])
  // A row with no id cannot be opened or deleted, so it is not listed.
  assert.deepEqual(mergeChats([{ title: 'nameless', at: 99 }], []), [])
})

test('the account chat is readable only by the account that wrote it', () => {
  const sql = readSrc(new URL('../supabase/migrations/20260906_chats.sql', import.meta.url), 'utf8')
  assert.match(sql, /alter table public\.chats enable row level security/)
  // Every policy keyed to auth.uid(), matching presets and scene_names.
  assert.match(sql, /for select using \(user_id = auth\.uid\(\)\)/, 'reads are not keyed to the signed-in user')
  assert.match(sql, /for insert with check \(user_id = auth\.uid\(\)\)/, 'writes are not keyed to the signed-in user')
  assert.match(sql, /for update using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/, 'updates are not keyed to the signed-in user')
  // One row per person: the app has one running conversation, and a table
  // shaped that way cannot drift into meaning a filing system.
  assert.match(sql, /user_id uuid primary key/)
})

test('a shelved conversation is readable only by the account that wrote it', () => {
  const sql = readSrc(new URL('../supabase/migrations/20260911_chat_logs.sql', import.meta.url), 'utf8')
  assert.match(sql, /alter table public\.chat_logs enable row level security/)
  assert.match(sql, /for select using \(user_id = auth\.uid\(\)\)/, 'reads are not keyed to the signed-in user')
  assert.match(sql, /for insert with check \(user_id = auth\.uid\(\)\)/, 'writes are not keyed to the signed-in user')
  assert.match(sql, /for update using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/)
  /* Unlike `chats`, this one deletes: it is a list somebody browses, and a
     list you cannot throw anything out of fills up. */
  assert.match(sql, /for delete using \(user_id = auth\.uid\(\)\)/, 'a past chat cannot be thrown away')
  /* One row per conversation, not one per person — the opposite of `chats`,
     deliberately, and the id comes from the client so a chat keeps its
     identity when it moves from this browser to the account. */
  assert.match(sql, /id text primary key/)
})

console.log('\nhow many scenes')

const scenesMod = await import('../api/_scenes.js')

test('the choices come from the unit, not from a number in the source', () => {
  const { sceneChoices } = scenesMod
  // An FM3 has eight and the difference between a few and all of them is real.
  assert.deepEqual(
    sceneChoices(8).map((c) => [c.key, c.budget]),
    [['one', 0], ['few', null], ['all', 8]]
  )
  assert.match(sceneChoices(8).find((c) => c.key === 'all').label, /All 8/)

  /*
   * An AM4 has four, where "a few" and "all four" are the same answer with two
   * labels — a third button that changes nothing is worse than no button.
   */
  assert.deepEqual(
    sceneChoices(4).map((c) => c.key),
    ['one', 'few']
  )
  // A unit that never reported its count is assumed to be the common one.
  assert.equal(sceneChoices().length, 3)
  assert.equal(sceneChoices(undefined).find((c) => c.key === 'all').budget, 8)
})

test('a number asked for is clamped to the scenes the unit actually has', () => {
  const { sceneBudgetFor } = scenesMod
  assert.equal(sceneBudgetFor(8, 8), 8)
  // Writing past the count is refused by the validator anyway; asking for it
  // only spends a generation on scenes that cannot exist.
  assert.equal(sceneBudgetFor(8, 4), 4, 'an AM4 was asked for eight scenes')
  assert.equal(sceneBudgetFor(3, 8), 3)
  // A set of one is not a set — that answer is the other button.
  assert.equal(sceneBudgetFor(1, 8), null)
  assert.equal(sceneBudgetFor(0, 8), null)
  assert.equal(sceneBudgetFor(-2, 8), null)
  assert.equal(sceneBudgetFor(null, 8), null)
  assert.equal(sceneBudgetFor(undefined, 8), null)
  assert.equal(sceneBudgetFor(2.5, 8), null, 'half a scene')
  assert.equal(sceneBudgetFor('4', 8), 4, 'a number that arrived over JSON as a string')
})

test('a number the player chose overrides the rule that says three or four', () => {
  const { sceneInstruction } = scenesMod

  /*
   * Rule 11 — "three or four well-judged scenes beat eight" — is a good
   * default and was also a ceiling. Left to fight an explicit eight it wins,
   * and somebody who asked for a full set gets four with no explanation.
   */
  const all = sceneInstruction({ wantScenes: true, sceneBudget: 8, sceneCount: 8 })
  assert.match(all, /EXACTLY 8 SCENES/)
  assert.match(all, /rule 11 does not apply/, 'the instruction and the rule are left to fight')
  assert.match(all, /numbered 0 to 7/, 'nothing says the indices must be contiguous')
  // The real failure of asking for a full set: eight near-copies of one tone.
  assert.match(all, /never 8 near-copies/)

  // Asked for a set but not for a number: exactly what it always said.
  const few = sceneInstruction({ wantScenes: true, sceneCount: 8 })
  assert.match(few, /SET OF SCENES/)
  assert.match(few, /three or four/)
  assert.ok(!/EXACTLY/.test(few), 'a default became a demand')

  // One sound, and no question asked, are both unchanged.
  assert.match(sceneInstruction({ wantScenes: false }), /ONE SOUND/)
  assert.equal(sceneInstruction({}), '')
  assert.equal(sceneInstruction(), '')
  assert.equal(sceneInstruction({ wantScenes: undefined, sceneBudget: 8 }), '', 'a budget without an answer is not an answer')

  // And a budget past the unit's count is spoken in the unit's terms.
  assert.match(sceneInstruction({ wantScenes: true, sceneBudget: 8, sceneCount: 4 }), /EXACTLY 4 SCENES/)
})

test('a band asked for gets its own songs on the scenes, not Clean / Rhythm / Lead', () => {
  /*
   * "This generation should've created song names for each scene and it did
   * not, it created generic names." The ask was a full Three Days Grace preset
   * and the scenes came back Verse, Rhythm, Lead — a preset that could have
   * been anybody's, with the band's name reaching the model and none of it
   * reaching the footswitch.
   *
   * Three places decided that between them, so all three are checked here: the
   * rule, the field the name is written into, and the sentence the scene count
   * adds on top of both.
   */
  const { sceneInstruction } = scenesMod
  const api = readSrc(new URL('../api/generate.js', import.meta.url), 'utf8')

  // The rule itself: band means their songs, one song means its parts, and a
  // plain description keeps the job names it always had.
  assert.match(api, /13\. Name scenes after the music/, 'the naming rule is gone')
  assert.match(api, /every scene is one of THEIR songs/)
  assert.match(api, /ONE SONG: every scene is a part of THAT song/)
  assert.match(api, /"Clean", "Rhythm", "Lead" say what they are/, 'a plain tone lost its job names')
  // And the cut the unit makes, so a title is shortened on purpose rather than
  // chopped mid-word at 16 characters by the validator.
  assert.match(api, /cut to 16 characters/)

  // The field the model writes the name into no longer suggests the generic
  // three by itself — it was the last thing read before the name was chosen.
  const nameField = api.slice(api.indexOf('name: z'), api.indexOf('engaged: onlyWhenPlaced'))
  assert.match(nameField, /this is the SONG this scene is voiced for/)
  assert.ok(
    !/Short name for this scene — "Clean", "Rhythm", "Lead"/.test(api),
    'the scene name field still opens by naming the three generic ones'
  )

  // Both scene answers carry it: a set of the model's judging, and a number.
  assert.match(sceneInstruction({ wantScenes: true, sceneCount: 4 }), /one of THEIR songs per scene/)
  const eight = sceneInstruction({ wantScenes: true, sceneBudget: 8, sceneCount: 8 })
  assert.match(eight, /8 of THEIR songs/, 'eight scenes off a band is eight of their songs')
  assert.match(eight, /8 parts of it/, 'eight scenes off one song is eight parts of it')

  // The preset's own name is the same failure one size up: "3DG
  // Verse-Rhythm-Lead" for a band anybody could name.
  assert.match(api, /When the request names a band, a record or a song, the name says so/)
})

test('the chat hands the band name on instead of paraphrasing it away', () => {
  /*
   * The designer can only name scenes after a band's songs if the band's name
   * reaches it. This one arrived as "modern alt-metal rhythm crunch, cleaner
   * verse tone, and a cutting lead" — the chat's own words, which describe
   * nobody in particular and ask for exactly the three scene names that came
   * back.
   */
  const command = readSrc(new URL('../api/command.js', import.meta.url), 'utf8')
  assert.match(command, /carried through ' \+\n\s*'word for word/, 'the description may still lose the band')
  assert.match(command, /Do not invent a verse \/ rhythm \/ lead\nbreakdown the player did not ask for/)
})

test('the question and the instruction share one idea of "all of them"', () => {
  /*
   * Two files decide this — the sheet that asks and the route that prompts —
   * and if they disagree the player taps "All 8" and gets four. One module,
   * imported by both.
   */
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /import \{ sceneChoices \} from '\.\.\/api\/_scenes\.js'/)
  assert.match(app, /sceneChoices\(sceneCount\)\.map/, 'the sheet hardcodes its own options again')
  assert.ok(
    !/A set of scenes/.test(app),
    'the old binary question is still in the sheet'
  )
  const api = readSrc(new URL('../api/generate.js', import.meta.url), 'utf8')
  assert.match(api, /import \{ sceneInstruction \} from '\.\/_scenes\.js'/)
})

test('the answer names a budget only when a budget was chosen', () => {
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const sheet = app.slice(app.indexOf('sceneChoices(sceneCount).map'))
  // budget 0 is one sound; null is the model's judgement, and must arrive as
  // absent rather than as a zero the route would read as a number.
  assert.match(sheet, /wantScenes: choice\.budget !== 0/)
  assert.match(sheet, /sceneBudget: choice\.budget \|\| undefined/)
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
  const noUnit = link.faultCopy({ role: 'remote', device: { connected: false }, asks: 5 })
  assert.match(noUnit.title, /can’t see your unit/, 'a phone is still told to check a cable it cannot reach')
  assert.match(noUnit.body, /asked five times/, 'a phone is not told the asking already happened')
  /*
   * And the number is the number it actually asked. Five is what a phone that
   * was not already live does; a unit that WAS answering a moment ago gets
   * three, and a screen at the Mac gets one — so the same "five times" was
   * being shown over two asks that never happened.
   */
  assert.match(
    link.faultCopy({ role: 'remote', device: { connected: false }, asks: 3 }).body,
    /asked three times/
  )
  assert.match(link.faultCopy({ role: 'remote', device: { connected: false }, asks: 1 }).body, /asked once/)
  assert.ok(
    !/times/.test(link.faultCopy({ role: 'remote', device: { connected: false } }).body),
    'a count nobody counted is still stated as fact'
  )
  assert.ok(
    !/tap Try again/.test(noUnit.body),
    'Try again is offered as the fix for the thing that just failed five times'
  )
})

test('a Mac that answered and has no port to the unit says exactly that', () => {
  /*
   * "When I tap one of the buttons it will turn it off on the unit, but
   * there's no way to turn it back on, and the buttons always say on." The
   * Mac was answering fine — every call came back, and what came back was
   * `port not open`. So it is neither a Mac that went quiet nor a read that
   * lost a race: there is nothing at the end of the cable to read, and it is
   * the one fault that means what is on screen can no longer be trusted.
   */
  const phone = link.faultCopy({ role: 'remote', reason: 'unit-gone' })
  assert.match(phone.title, /lost the unit/i)
  assert.match(phone.body, /At the Mac/, 'the phone was not told which end to go to')
  assert.ok(
    !/stopped answering|hasn’t gone to sleep/i.test(phone.body),
    'the Mac answering is what raised this — it cannot also be the thing to fix'
  )

  const here = link.faultCopy({ role: 'mac', reason: 'unit-gone' })
  assert.match(here.title, /Lost the unit/)
  assert.ok(!/At the Mac/.test(here.body), 'the Mac was told to go to the Mac it is already at')

  // It wins over a stale device, the same way every other reason does.
  assert.match(
    link.faultCopy({ role: 'remote', reason: 'unit-gone', device: { connected: true, short: 'AM4' } }).title,
    /lost the unit/i
  )
})

/*
 * "This keeps saying I'm not connected, but yet the Mac app says I am
 * connected to the remote." Both screens were drawn from one fault with three
 * quite different things behind it, and only one of them is about the rig.
 */
test('a question that never came back is not blamed on the unit', () => {
  const gone = link.faultCopy({ role: 'remote', reason: 'no-answer' })
  assert.match(gone.title, /stopped answering/, 'a silent Mac is still described as a Mac that answered')
  assert.ok(
    !/plugged in|cable|unit is on/i.test(gone.body),
    'a phone is sent to check a cable when it was the Mac that went quiet'
  )

  const unread = link.faultCopy({ role: 'remote', reason: 'unreadable' })
  assert.match(unread.title, /wouldn’t read/)
  assert.match(unread.body, /holding the port|another editor/, 'the likely cause is not named')

  /*
   * The reason wins over a stale `device`, which is the whole bug: the object
   * left over from the last good answer said "connected", and the notice read
   * it as proof this answer had happened too.
   */
  const stale = link.faultCopy({ role: 'remote', reason: 'no-answer', device: { connected: true, short: 'AM4' } })
  assert.match(stale.title, /stopped answering/)

  // And a Mac that really did answer "nothing here" still says so.
  assert.match(
    link.faultCopy({ role: 'remote', reason: 'no-unit', device: { connected: false } }).title,
    /can’t see your unit/
  )
})

test('the bar names what is missing, not always the unit', () => {
  const bar = (reason) =>
    link.describeUnit({ role: 'remote', link: 'connected', status: 'fault', reason }).unit
  assert.equal(bar('no-answer'), 'No answer', 'a silent Mac reads as an empty rig')
  assert.equal(bar('unreadable'), 'Can’t read')
  assert.equal(bar('no-unit'), 'No unit')
  assert.equal(bar(null), 'No unit', 'the old reading stands where no reason was given')
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

const WAITING = (ms) => JSON.stringify({ type: 'waiting', ms }) + '\n'

test('a heartbeat keeps the long clock, and does not start the short one', async () => {
  /*
   * "The AI accepted the request and then sent nothing back for 90 seconds,
   * twice." Sonnet 5 runs adaptive thinking whether or not it is asked to, and
   * none of that thinking produces an object partial — so the browser saw
   * silence and called it dead.
   *
   * The heartbeat is the proof of life. It must extend the first-token budget
   * rather than flip to the shorter dead-stream one: a request that is thinking
   * hard is exactly the case that needs the LONGER clock, and treating a
   * keepalive as an answer would halve the wait instead.
   */
  /*
   * Its own budget, and a roomy one, because this test is real wall-clock
   * timers rather than fake ones. On the shared 60ms budget the beats were
   * scheduled 50ms apart — ten milliseconds of headroom, three times in a row —
   * and a macOS runner under load slipped past it: one beat arrived late, the
   * stream was called dead, and it retried through a connection that was alive.
   *
   * A hundred milliseconds between beats against a 300ms budget says the same
   * thing with two hundred to spare. What is being proved is unchanged and
   * still cannot pass by accident: 400ms of silence separates the hello from
   * the answer, so without the beats extending it this aborts.
   */
  const patient = { stallMs: 300, firstMs: 300, capMs: 2000 }
  const f = scheduledFetch([
    {
      steps: [
        { at: 20, chunk: OPEN },
        { at: 120, chunk: WAITING(120) },
        { at: 220, chunk: WAITING(220) },
        { at: 320, chunk: WAITING(320) },
        { at: 420, chunk: DONE }
      ]
    }
  ])
  globalThis.fetch = f.fetch
  const events = []
  const spec = await streamSpec({}, { timing: patient, onEvent: (e) => events.push(e) })
  assert.deepEqual(spec, { blocks: [] })
  assert.equal(f.calls(), 1, 'it gave up and retried through a live connection')
  const beats = events.filter((e) => e.kind === 'waiting')
  assert.equal(beats.length, 3)
  assert.equal(beats[2].thinkingMs, 320, 'the wait is not carried to the screen')
})

test('a heartbeat does not keep the wait alive for ever', async () => {
  /*
   * "Stuck thinking for almost 4 minutes, finally had to stop it."
   *
   * Every beat restarts the first-word clock, so once beats were arriving
   * that clock never ran out and the only thing left was the hard cap — per
   * attempt, and the retry doubled it. The thinking budget counts from the
   * hello and ignores beats: a model that is alive and still has not begun
   * is stopped there and told to the player in those words. And it is NOT
   * asked again unasked, because it was plainly working — asking the same
   * thing again in silence is what made one long wait into two.
   */
  const beats = []
  for (let at = 40; at <= 400; at += 30) beats.push({ at, chunk: WAITING(at) })
  const f = scheduledFetch([{ steps: [{ at: 10, chunk: OPEN }, ...beats], end: false }])
  globalThis.fetch = f.fetch
  const events = []
  const t0 = Date.now()
  await assert.rejects(
    streamSpec({}, { timing: { stallMs: 60, firstMs: 60, thinkMs: 150, capMs: 2000 }, onEvent: (e) => events.push(e.kind) }),
    (err) =>
      err.generationFailure === 'stalled' &&
      err.alive === true &&
      /thought about it for \d+ seconds without starting/.test(err.message) &&
      /Nothing was written to your unit/.test(err.message)
  )
  assert.ok(Date.now() - t0 < 1000, 'the wait ran to the hard cap — the thinking budget did nothing')
  assert.equal(f.calls(), 1, 'a live, thinking model was asked again in silence')
  assert.ok(!events.includes('retrying'))
})

test('a heartbeat is not mistaken for the model answering', async () => {
  /*
   * The distinction that matters: after a beat, silence still gets the first-
   * token budget. Here the stall budget is a tenth of the first-token one, so a
   * gap that only the long clock survives proves which one is running.
   */
  const slow = { stallMs: 20, firstMs: 200, capMs: 900 }
  const f = scheduledFetch([
    { steps: [{ at: 10, chunk: OPEN }, { at: 40, chunk: WAITING(40) }, { at: 150, chunk: DONE }] }
  ])
  globalThis.fetch = f.fetch
  const spec = await streamSpec({}, { timing: slow })
  assert.deepEqual(spec, { blocks: [] }, 'a beat switched the watchdog to the dead-stream clock')
})

test('a real partial still switches to the short clock', async () => {
  // The other half: once tokens flow, a long gap IS a dead pipe and must not
  // inherit the thinking budget.
  const slow = { stallMs: 20, firstMs: 400, capMs: 900 }
  const f = scheduledFetch([
    { steps: [{ at: 10, chunk: OPEN }, { at: 30, chunk: PARTIAL }], end: false },
    { steps: [{ at: 10, chunk: DONE }] }
  ])
  globalThis.fetch = f.fetch
  await assert.rejects(() => streamSpec({}, { timing: slow }), /stopped partway|dropped/)
})

test('a wait that ends in nothing says which kind of nothing it was', () => {
  /*
   * It used to guess — "that wait is the AI being slow" — because there was
   * nothing to go on. Beats settle it: frames with no answer behind them means
   * the model was alive and thinking; no frames at all means the pipe was dead.
   */
  const src = readSrc(new URL('../src/lib/stream.js', import.meta.url), 'utf8')
  assert.match(src, /beats\s*\n?\s*\? `The AI thought for/, 'both silences get one sentence again')
  assert.match(src, /not even a heartbeat/)
  // A beat must never count as the model answering.
  assert.ok(
    src.indexOf("frame.type === 'waiting'") < src.indexOf('answering = true'),
    'the heartbeat falls through to the branch that starts the short clock'
  )
})

test('the model is told how hard to think, and says so while it does', () => {
  const api = readSrc(new URL('../api/generate.js', import.meta.url), 'utf8')
  /*
   * Sonnet 5 runs adaptive thinking with or without a `thinking` block, at
   * effort `high` when none is named. This call is nearer extraction than open
   * reasoning — the judgement is all in the system prompt — so the top of the
   * range bought minutes of latency and nothing else.
   */
  assert.match(api, /providerOptions: \{ anthropic: \{ effort: process\.env\.GENERATOR_EFFORT \|\| 'medium' \} \}/)
  // The heartbeat, and the cleanup that keeps a timer from writing into a
  // response that has already ended.
  assert.match(api, /send\(\{ type: 'waiting', ms: Date\.now\(\) - startedAt \}\)/)
  assert.match(api, /\}, 10000\)/)
  assert.match(api, /\} finally \{[\s\S]{0,400}stopBeating\(\)/)
  assert.match(api, /stopBeating\(\)\n\s*send\(\{ type: 'partial'/, 'the beat carries on after the model has started')
})

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
    // No beats in this script, so this is the dead-pipe half of the sentence:
    // nothing came back at all, which is the connection rather than the ask.
    (err) => err.generationFailure === 'stalled' && /went quiet for/.test(err.message)
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
    /*
     * Still true where it was written: this script sends no heartbeat, so
     * nothing came back at all and the description cannot be the cause. The
     * other branch — beats arrived, the model thought and did not finish — may
     * suggest a shorter one, because there it is the honest advice.
     */
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

  test('the demo tuner never changes note while a string is still ringing', () => {
    /*
     * "The note hops randomly, E2 → D3 → E4; looks broken."
     *
     * The stream held a string and drifted toward pitch, which was most of the
     * way there — but it could also swap strings at any poll, on a 4% roll,
     * mid-note. Rare enough to look like a glitch rather than a design, which
     * is worse than doing it constantly.
     *
     * A real tuner cannot do that: while a string is ringing there is one pitch
     * to detect and the detector holds it. The note changes after the note
     * STOPS. So between any two consecutive readings that both have a note, the
     * note is the same one — not usually, always.
     */
    let seed = 11
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const tuner = createTunerStream(random)
    const readings = Array.from({ length: 600 }, () => tuner.next())
    let midNote = 0
    for (let i = 1; i < readings.length; i++) {
      const [a, b] = [readings[i - 1], readings[i]]
      if (!a.note || !b.note) continue
      if (a.note !== b.note || a.octave !== b.octave) midNote++
    }
    assert.equal(midNote, 0, `the note changed ${midNote} times with the string still sounding`)

    // And it is not simply frozen on one string for ever: a new one is picked
    // coming out of a quiet gap, which is what re-detection looks like.
    const played = new Set(readings.filter((r) => r.note).map((r) => `${r.note}${r.octave}`))
    assert.ok(played.size > 1, `only ${[...played]} was ever shown — the demo never re-detects`)
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

console.log('\nthe volume slider on Play')
/*
 * "Add volume slider to the play screen to quickly turn volume up or down."
 * The slider moves the Output block's Level. What is checked here is the part
 * that does not need a browser: which parameter it picks, what it says, and
 * how a stream of drag values becomes writes a serial port can keep up with.
 */
const volume = await import('../src/lib/volume.js')

test('the slider drives the Output block\u2019s Level and nothing else', () => {
  const named = [
    { id: 3, name: 'Balance', value: 0, min: -100, max: 100, unit: '%' },
    { id: 1, name: 'Level', value: -3, min: -80, max: 20, unit: 'dB' },
    { id: 9, name: 'Boost Level', value: 0, min: 0, max: 10 }
  ]
  assert.equal(volume.outputLevelParam(named)?.id, 1, 'the Level is not the one picked')
  // A driver that says "Out Level" still gets a slider.
  assert.equal(volume.outputLevelParam([{ id: 4, name: 'Out Level', min: -80, max: 20 }])?.id, 4)
  // "Boost Level" and "Input Level" are gain, not volume — never the slider's.
  assert.equal(volume.outputLevelParam([{ id: 9, name: 'Boost Level', min: 0, max: 10 }]), null)
  assert.equal(volume.outputLevelParam([{ id: 5, name: 'Input Level', min: 0, max: 10 }]), null)
  // No range, no slider: a write without a range is a guessed value, and setParam refuses those.
  assert.equal(volume.outputLevelParam([{ id: 1, name: 'Level' }]), null)
  assert.equal(volume.outputLevelParam(null), null)
  assert.equal(volume.outputLevelParam(undefined), null)
})

test('the figure beside the slider carries a sign and a unit', () => {
  const p = { min: -80, max: 20, unit: 'dB' }
  assert.equal(volume.volumeLabel(-6.5, p), '\u22126.5 dB')
  assert.equal(volume.volumeLabel(2, p), '+2.0 dB')
  assert.equal(volume.volumeLabel(0, p), '0.0 dB')
  assert.equal(volume.volumeLabel(undefined, p), '\u2014')
  assert.equal(volume.volumeStep(p), 0.5, 'a dB slider moves in half-dB notches')
  assert.equal(volume.volumeStep({ min: 0, max: 10 }), 0.1)
  assert.equal(volume.volumePercent(-30, p), 50)
  assert.equal(volume.volumePercent(-80, p), 0)
  assert.equal(volume.volumePercent(20, p), 100)
  assert.equal(volume.volumePercent(99, p), 100, 'a value past the end is not past the end')
})

test('the buttons either side of the slider move it one dB, and stop at the ends', () => {
  const p = { min: -80, max: 20, unit: 'dB' }
  assert.equal(volume.volumeNudge(p), 1, 'a press is not one dB')
  assert.equal(volume.nudged(-6.5, p, 1), -5.5)
  assert.equal(volume.nudged(-6.5, p, -1), -7.5)
  assert.equal(volume.nudged(19.5, p, 1), 20, 'a press past the top is not held at the top')
  assert.equal(volume.nudged(-79.5, p, -1), -80, 'a press past the bottom is not held at the bottom')
  assert.equal(volume.nudged(undefined, p, 1), -79, 'with no value known a press counts from the bottom')
  // A control that is not in dB: ten notches, the same idea.
  assert.equal(volume.volumeNudge({ min: 0, max: 10 }), 1)
  assert.equal(volume.nudged(0.37, { min: 0, max: 10 }, 1), 1.4, 'the landing is not on a notch')
})

test('a drag sends one write at a time and the newest value wins', async () => {
  const sent = []
  let release = null
  const write = (v) => {
    sent.push(v)
    return new Promise((done) => {
      release = done
    })
  }
  const w = volume.latestWriter(write)
  w.send(1)
  w.send(2)
  w.send(3)
  assert.deepEqual(sent, [1], 'a second write went out while the first was still on the wire')
  assert.ok(w.busy)
  const settled = w.settled()
  release()
  await new Promise((go) => setTimeout(go, 0))
  assert.deepEqual(sent, [1, 3], 'the value in the middle of the drag was written; only the newest should be')
  release()
  const err = await settled
  assert.equal(err, null)
  assert.deepEqual(sent, [1, 3])
  assert.ok(!w.busy)
  // Nothing in flight: settled answers at once.
  assert.equal(await w.settled(), null)
})

test('a write that fails mid-drag does not stop the next one, and is reported once at the release', async () => {
  const sent = []
  const write = async (v) => {
    sent.push(v)
    if (v === 1) throw new Error('port busy')
  }
  const w = volume.latestWriter(write)
  w.send(1)
  w.send(2)
  const err = await w.settled()
  assert.deepEqual(sent, [1, 2], 'the failure stopped the value behind it')
  assert.match(err?.message || '', /port busy/, 'the failure was swallowed rather than handed to the release')
  assert.equal(await w.settled(), null, 'the same failure was reported twice')
})

console.log('\na garbled preset dump is asked for again')
/*
 * "PRESET_DUMP_HEADER: expected func 0x77 at offset 0, got 0x78" on switching
 * presets. The read came while the unit was still loading; asking again gets
 * the dump. lib/retry.js holds the rule, forgefx.js applies it at the one
 * place every request passes through.
 */
const retry = await import('../src/lib/retry.js')

test('the words the codec uses for a garbled dump are recognised, and nothing else is', () => {
  assert.ok(retry.isGarbledDump('PRESET_DUMP_HEADER: expected func 0x77 at offset 0, got 0x78'))
  assert.ok(retry.isGarbledDump('expected func 0x77 at offset 0, got 0x78'))
  assert.ok(!retry.isGarbledDump('Can’t reach the Fractal app on your Mac.'))
  assert.ok(!retry.isGarbledDump('No unit'))
  assert.ok(!retry.isGarbledDump(undefined))
})

test('reads and selects may be asked twice; writes may not', () => {
  assert.ok(retry.canAskAgain('GET', '/preset/blocks'))
  assert.ok(retry.canAskAgain('GET', '/preset/blocks/42/params?x=1'))
  assert.ok(retry.canAskAgain('POST', '/preset/select'))
  assert.ok(retry.canAskAgain('POST', '/scene'))
  assert.ok(!retry.canAskAgain('POST', '/preset/store'), 'a save was re-sent')
  assert.ok(!retry.canAskAgain('PUT', '/preset/blocks/42/params/1'), 'a parameter write was re-sent')
  assert.ok(!retry.canAskAgain('POST', '/tempo/tap'), 'a tap was re-sent')
  assert.ok(!retry.canAskAgain('DELETE', '/device/cache'))
})

test('a read that garbles twice and lands the third time is one answer, not an error', async () => {
  const waits = []
  let calls = 0
  const out = await retry.withRetry(
    async () => {
      calls++
      if (calls < 3) throw new Error('PRESET_DUMP_HEADER: expected func 0x77 at offset 0, got 0x78')
      return { ok: true, calls }
    },
    { method: 'GET', path: '/preset/blocks', wait: async (ms) => waits.push(ms) }
  )
  assert.deepEqual(out, { ok: true, calls: 3 })
  assert.deepEqual(waits, [400, 800], 'the waits do not grow while the unit loads')
})

test('a read that garbles every time is still reported, in the codec’s own words, after the last try', async () => {
  let calls = 0
  await assert.rejects(
    retry.withRetry(
      async () => {
        calls++
        throw new Error('PRESET_DUMP_HEADER: expected func 0x77 at offset 0, got 0x78')
      },
      { method: 'GET', path: '/preset/blocks', wait: async () => {} }
    ),
    /PRESET_DUMP_HEADER/
  )
  assert.equal(calls, 1 + retry.RETRIES)
})

test('a different failure, or a write, is not asked again', async () => {
  let calls = 0
  await assert.rejects(
    retry.withRetry(async () => { calls++; throw new Error('No unit') }, { method: 'GET', path: '/x', wait: async () => {} }),
    /No unit/
  )
  assert.equal(calls, 1, 'an unrelated failure was retried')
  calls = 0
  await assert.rejects(
    retry.withRetry(
      async () => { calls++; throw new Error('PRESET_DUMP_HEADER: expected func 0x77 at offset 0, got 0x78') },
      { method: 'PUT', path: '/preset/blocks/42/params/1', wait: async () => {} }
    ),
    /PRESET_DUMP_HEADER/
  )
  assert.equal(calls, 1, 'a write was re-sent on a garbled read-back')
})

test('every request the app makes passes through the retry, at the Mac and over the relay', () => {
  const src = readSrc(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
  assert.match(src, /import \{ withRetry \} from '\.\/retry\.js'/, 'forgefx.js does not import the retry')
  assert.match(
    src,
    /async function request\(path, options = \{\}\) \{[\s\S]*?return withRetry\(\(\) => requestOnce\(path, options\), \{ method: options\.method \|\| 'GET', path \}\)/,
    'request() no longer asks again on a garbled dump'
  )
  const once = src.slice(src.indexOf('async function requestOnce('))
  assert.match(once, /remoteRequest\(path, options\)/, 'the relay path is outside the retry')
  assert.match(once, /return directRequest\(path, options\)/, 'the local path is outside the retry')
  // And the slider reads the level on a new preset, not on every re-read of it.
  const vol = readSrc(new URL('../src/components/Volume.jsx', import.meta.url), 'utf8')
  assert.match(vol, /const slot = preset\?\.number/, 'the slider no longer keys its read on the preset number')
  assert.match(vol, /\}, \[eid, slot\]\)/, 'the slider re-reads the output block on every preset re-read again')
})

console.log('\nthe scene plan names the amp on each channel')
const scenePlan = await import('../src/lib/scenePlan.js')

test('a channel the plan puts a model on says which, with the real amp behind it', () => {
  const changes = [
    { eid: 4, name: 'Amp 1', channel: 'A', typeName: 'USA Clean', typeBasedOn: 'Mesa Mark IV' },
    { eid: 4, name: 'Amp 1', channel: 'C', typeName: 'USA Lead+', typeBasedOn: 'Mesa Mark IIC+' },
    { eid: 9, name: 'Drive 1', channel: 'B', typeName: 'TS808 Mod' }
  ]
  assert.deepEqual(scenePlan.modelOnChannel(changes, 4, 'C'), { name: 'USA Lead+', basedOn: 'Mesa Mark IIC+' })
  assert.equal(scenePlan.channelLine({ eid: 4, name: 'Amp 1', channel: 'C' }, changes), 'Amp 1 on channel C · USA Lead+ (Mesa Mark IIC+)')
  assert.equal(scenePlan.channelLine({ eid: 4, name: 'Amp 1', channel: 'a' }, changes), 'Amp 1 on channel a · USA Clean (Mesa Mark IV)', 'a lower-case letter does not match')
  // No lineage on the model: the name alone, no empty brackets.
  assert.equal(scenePlan.channelLine({ eid: 9, name: 'Drive 1', channel: 'B' }, changes), 'Drive 1 on channel B · TS808 Mod')
  // The plan writes nothing on that channel: the row keeps its old shape, and says nothing it does not know.
  assert.equal(scenePlan.channelLine({ eid: 4, name: 'Amp 1', channel: 'B' }, changes), 'Amp 1 on channel B')
  assert.equal(scenePlan.modelOnChannel(changes, 4, 'B'), null)
  assert.equal(scenePlan.modelOnChannel(undefined, 4, 'A'), null)
  // The plan is what feeds the row.
  const gen = readSrc(new URL('../src/components/Generate.jsx', import.meta.url), 'utf8')
  assert.match(gen, /moved\.map\(\(b\) => channelLine\(b, changes\)\)/, 'the scene row no longer names the model on the channel')
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

console.log('\nthe phone apps')
const { run: mobile } = await import('./mobile.mjs')
mobile(test)

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
  //
  // The column is now chosen rather than counted — the chain goes in the free
  // cells between the input and the output instead of over the top of them —
  // so what is held here is that the column handed to the client is the one
  // the grid uses, with nothing added to it on the way.
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/lib/actions.js', import.meta.url), 'utf8')
  assert.ok(src.includes('d.placeBlock(1, col, block.page'), 'the builder no longer places by column')
  const build = src.slice(src.indexOf("case 'buildChain'"), src.indexOf('default:\n'))
  assert.ok(!/placeBlock\(1, (?:i|col) \+ 1/.test(build), 'the builder is 1-basing columns again')
  assert.ok(
    build.includes('plan.cols[i]'),
    'the chain is placed from column 0 again, over whatever is there'
  )
})

test('a chain built into an empty preset gets an input and an output', async () => {
  const { chainPlan } = await import('../src/lib/actions.js')

  /*
   * The whole of "what happens when you create a new preset on an empty
   * preset". Nothing on the row at all: the input takes column 0, the chain
   * follows it, and the output lands after the chain — so the guitar reaches
   * the first pedal and the last one reaches the jack.
   *
   * Getting this wrong is silent. Every value lands, the unit reads them back,
   * the preset saves, and the player hears nothing.
   */
  const empty = chainPlan({ onRow: [], width: 12, count: 3, canInput: true, canOutput: true })
  assert.equal(empty.input, 0)
  assert.deepEqual(empty.cols, [1, 2, 3])
  assert.equal(empty.output, 4)
  assert.equal(empty.wireTo, 4, 'the cabling stops short of the output block')

  // A preset that already has both is not given a second of either, and the
  // chain goes in the free cells BETWEEN them rather than over the top.
  const furnished = chainPlan({
    onRow: [
      { slug: 'input', col: 0 },
      { slug: 'output', col: 5 }
    ],
    width: 12,
    count: 2,
    canInput: false,
    canOutput: false
  })
  assert.equal(furnished.input, 0)
  assert.deepEqual(furnished.cols, [1, 2])
  assert.equal(furnished.output, 5)

  // Half furnished: the output is there, the input is not — which is exactly
  // the shape that made a built chain silent.
  const noIn = chainPlan({
    onRow: [{ slug: 'output', col: 6 }],
    width: 12,
    count: 2,
    canInput: true,
    canOutput: false
  })
  assert.equal(noIn.input, 0)
  assert.deepEqual(noIn.cols, [1, 2])
  assert.equal(noIn.output, 6)

  // A unit that offers neither as a block routes its signal some other way and
  // has nothing invented for it — and the cabling then runs to the end of the
  // row, because that is where the signal has to get to either way.
  const linearish = chainPlan({ onRow: [], width: 4, count: 4, canInput: false, canOutput: false })
  assert.equal(linearish.input, null)
  assert.equal(linearish.output, null)
  assert.deepEqual(linearish.cols, [0, 1, 2, 3])
  assert.equal(linearish.wireTo, 3)

  // An existing block that is neither is stepped around, not written over.
  const occupied = chainPlan({
    onRow: [{ slug: 'amp', col: 2 }],
    width: 6,
    count: 2,
    canInput: true,
    canOutput: true
  })
  assert.equal(occupied.input, 0)
  assert.deepEqual(occupied.cols, [1, 3])
  assert.equal(occupied.output, 4)
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

  /*
   * What the player calls it against what the unit calls it. "Whammy" is a
   * Pitch block; a design that wanted a "pitch shifter / whammy" and a chat
   * asked to "add a whammy" both have to land on it, or the answer is "this
   * unit has no block called whammy" — false, and said.
   */
  const fm3 = [
    { slug: 'pitch', name: 'Pitch', page: 110 },
    { slug: 'drive', name: 'Drive', page: 118 },
    { slug: 'gate', name: 'Gate', page: 50 },
    { slug: 'geq', name: 'Graphic EQ', page: 90 },
    ...palette
  ]
  assert.equal(resolvePlaceable(fm3, 'whammy').slug, 'pitch')
  assert.equal(resolvePlaceable(fm3, 'pitch shifter').slug, 'pitch')
  assert.equal(resolvePlaceable(fm3, 'pitch shifter / whammy').slug, 'pitch')
  assert.equal(resolvePlaceable(fm3, 'octaver').slug, 'pitch')
  assert.equal(resolvePlaceable(fm3, 'overdrive').slug, 'drive')
  assert.equal(resolvePlaceable(fm3, 'a distortion pedal'), null, 'a sentence matched a block')
  assert.equal(resolvePlaceable(fm3, 'noise gate').slug, 'gate')
  assert.equal(resolvePlaceable(fm3, 'graphic eq').slug, 'geq')
  assert.equal(resolvePlaceable(fm3, 'echo').slug, 'delay')
  assert.equal(resolvePlaceable(fm3, 'Pitch 1').slug, 'pitch')
  assert.equal(resolvePlaceable(fm3, 'flanger'), null, 'a block the unit lacks was invented')
})

test('the block list is remembered per unit, and a failed read says so', async () => {
  /*
   * GET /blocks is a fixed list on the server and cannot be empty on an FM3.
   * The chat was handed an empty one anyway — App called blockCatalog()
   * without importing it, the catch swallowed "not defined", and every
   * request from every device went out with nothing placeable. Now the read
   * is remembered once it works, and a failure with nothing remembered is a
   * failure, with words, not an empty unit.
   */
  const { normalizePalette, cachedPalette, rememberPalette, paletteFor } = palette
  assert.deepEqual(normalizePalette(null), [])
  assert.deepEqual(normalizePalette({ error: 'x' }), [])
  assert.equal(normalizePalette([{ slug: 'amp', name: 'Amp', page: 58 }, { name: 'no slug' }, null]).length, 1)
  assert.equal(normalizePalette({ blocks: [{ slug: 'cab' }] })[0].slug, 'cab')

  const mem = new Map()
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) }
  assert.equal(cachedPalette('fm3', store), null)
  assert.equal(rememberPalette('fm3', [], store), false, 'an empty list was kept as a list')
  assert.equal(rememberPalette('fm3', [{ slug: 'pitch', name: 'Pitch', page: 110 }], store), true)
  assert.equal(cachedPalette('fm3', store)[0].slug, 'pitch')
  assert.equal(cachedPalette('am4', store), null, 'one unit reads another unit’s list')

  // A good read is kept and served; a bad read serves what was kept.
  const good = await paletteFor('am4', async () => [{ slug: 'amp', name: 'Amp', page: 1 }], store)
  assert.equal(good.fromCache, false)
  assert.equal(cachedPalette('am4', store)[0].slug, 'amp')
  const bad = await paletteFor('am4', async () => { throw new Error('Your Mac didn’t answer.') }, store)
  assert.equal(bad.fromCache, true)
  assert.equal(bad.list[0].slug, 'amp')
  assert.match(bad.error, /didn’t answer/)
  const empty = await paletteFor('am4', async () => [], store)
  assert.equal(empty.fromCache, true, 'an empty answer replaced the remembered list')
  // Nothing remembered: the failure is the answer.
  await assert.rejects(paletteFor('vp4', async () => { throw new Error('no answer') }, store), /no answer/)
  await assert.rejects(paletteFor('vp4', async () => [], store), /empty block list/)
  // Unreadable storage is no storage, never a throw.
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(cachedPalette('fm3', broken), null)
  assert.equal((await paletteFor('fm3', async () => [{ slug: 'amp' }], broken)).list.length, 1)
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

test('a chain read that fails because the unit has gone is asked once, not five times', async () => {
  /*
   * From an iPhone log on a Mac whose port had shut: one tap on a block's On
   * button, and then "GET /preset/blocks failed — port not open" five times
   * over four seconds, every one of them a round trip down the relay to a Mac
   * that had already said there was no port. Seventy-nine lines of the log are
   * that, over and over, and the screen never said a word.
   *
   * Asking again is for a port that was busy for a moment. A port that is gone
   * gives the same answer instantly, so the first one is the answer.
   */
  const gone = Object.assign(new Error('The Mac has lost the unit'), { unitGone: true })
  fresh(fakeUnit({ presetBlocks: () => Promise.reject(gone) }))
  let asks = 0
  const list = await ds.confirmedChain({
    read: async () => {
      asks++
      return ds.refreshBlocks()
    },
    wait: async () => {},
    remote: true
  })
  assert.equal(list, null, 'a unit that cannot be reached was passed off as read')
  assert.equal(asks, 1, 'a dead link was asked ' + asks + ' times')
  assert.equal(ds.chainReadFailure(), gone, 'why the read failed was thrown away')

  // And an ordinary busy port still gets every ask it ever did.
  fresh(fakeUnit({ presetBlocks: () => Promise.reject(new Error('timeout')) }))
  let busy = 0
  await ds.confirmedChain({
    read: async () => {
      busy++
      return ds.refreshBlocks()
    },
    wait: async () => {},
    remote: true
  })
  assert.equal(busy, ds.RELAY_TRIES, 'a busy port lost the retries it needs')
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

test('names that came back for another preset are not believed, or kept', () => {
  /*
   * "On the Cowboys From Hell rig it's still showing the Distortion Rigs
   * scenes."
   *
   * Slot 97 showed 96's scene names and kept showing them. The app asked for
   * 97, was answered about 96, believed it, and cached it under 97 — and on a
   * phone the cache is the only source there is, because an AM4 cannot be
   * dumped over the relay. So one bad answer outlived the read that made it.
   *
   * The rule is one-sided on purpose. Only a stated, disagreeing identity
   * counts; a driver that does not say which slot it read says nothing either
   * way, and treating silence as a mismatch would throw away every name on
   * every unit that does not report it.
   */
  assert.equal(slots.wrongSlot(97, 96), true, 'an answer about another preset was believed')
  assert.equal(slots.wrongSlot(97, 97), false)

  /* An AM4 stored dump reports its location; null means it dumped the active
     buffer instead, which is not the slot that was asked for either. */
  assert.equal(slots.wrongSlot(97, null), true, 'an active-buffer dump passed as slot 97')

  /* Silence is not disagreement. */
  assert.equal(slots.wrongSlot(97, undefined), false, 'a driver that reports no location lost its names')

  /* And nothing to compare against cannot disagree: asking for the loaded
     preset with no number is the active-buffer read, which is correct. */
  assert.equal(slots.wrongSlot(undefined, null), false)
  assert.equal(slots.wrongSlot(undefined, 96), false)
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

test('a phone that was live gets the relay asks, not the fewest of the two', async () => {
  /*
   * The two reasons to keep asking were written as alternatives — wasLive OR
   * remote — so the case with both reasons got the smaller budget. A phone
   * whose unit was answering a moment ago asked three times over a second and
   * a half, while a phone that had never seen the unit asked five. Backwards,
   * and it is the live one that is mid-gig.
   */
  let n = 0
  const info = await ds.confirmedDetect({
    detect: async () => ({ connected: ++n >= ds.RELAY_TRIES }),
    wait: async () => {},
    wasLive: true,
    remote: true
  })
  assert.equal(info.connected, true, 'a live phone gave up before the relay budget was spent')
  assert.equal(n, ds.RELAY_TRIES)
})

test('a read that follows an order this app gave keeps asking through it', async () => {
  /*
   * "The screen popped up while it was saving a preset" — THE MAC CAN'T SEE
   * YOUR UNIT, over a save that was going through. A save takes the unit away
   * for seconds while the preset goes to flash, and both ends re-read the
   * moment it reports done: that read is aimed at a port still busy with the
   * very thing it was asked to do.
   */
  let n = 0
  let waited = 0
  const info = await ds.confirmedDetect({
    detect: async () => ({ connected: ++n >= ds.SETTLING_TRIES }),
    wait: async (ms) => {
      waited += ms
    },
    wasLive: true,
    remote: true,
    least: ds.SETTLING_TRIES,
    gap: ds.SETTLING_MS
  })
  assert.equal(info.connected, true, 'the save still ended on a "no unit" screen')
  assert.equal(n, ds.SETTLING_TRIES)
  assert.equal(waited, ds.SETTLING_MS * (ds.SETTLING_TRIES - 1), 'the asks are not spread across the save')
  // Long enough to cover a save, and no longer than that.
  assert.ok(ds.SETTLING_MS * (ds.SETTLING_TRIES - 1) >= 4000)
  assert.ok(ds.SETTLING_MS * (ds.SETTLING_TRIES - 1) <= 8000)
})

test('a unit that really is gone is still reported after a save', async () => {
  // The other half: the patience is bounded, so an unplugged unit is still
  // named as one rather than asked about for ever.
  let n = 0
  const info = await ds.confirmedDetect({
    detect: async () => {
      n++
      return { connected: false }
    },
    wait: async () => {},
    wasLive: true,
    remote: true,
    least: ds.SETTLING_TRIES
  })
  assert.equal(info.connected, false)
  assert.equal(n, ds.SETTLING_TRIES)
})

test('every read after a save asks with the longer patience', () => {
  /*
   * Three places re-read the moment a save lands — the Mac from its own
   * write, the Mac carrying out a save the phone asked for, and the phone
   * hearing back that it landed — and any one of them left on the short
   * budget is the same red screen on a different route.
   */
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /const settling = opts\?\.settling === true/, 'read() has no settling read again')
  assert.match(
    app,
    /\.\.\.\(settling \? \{ least: SETTLING_TRIES, gap: SETTLING_MS \} : \{\}\)/,
    'the flag no longer reaches confirmedDetect'
  )
  assert.equal(
    (app.match(/read\(\{ settling: true \}\)/g) || []).length,
    3,
    'one of the three reads that follow a save is back on the short budget'
  )
  // Each of the three sits under the record() line for the save it follows.
  for (const after of [
    /Saved "\$\{name \|\| preset\?\.name\}" to slot \$\{req\.slot\}[\s\S]{0,200}?read\(\{ settling: true \}\)/,
    /The Mac saved it to slot \$\{res\.slot\}[\s\S]{0,200}?read\(\{ settling: true \}\)/,
    /Saved "\$\{name \|\| preset\?\.name\}" to slot \$\{number\}[\s\S]{0,300}?read\(\{ settling: true \}\)/
  ]) {
    assert.match(app, after)
  }
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

/*
 * The same fault, on the chain read.
 *
 * "Now I'm switching seems I keep getting this error message. Couldn't read
 * the chain from the phone, so there's nothing to switch here yet. Hitting the
 * try again button always fixes it, but it really shouldn't happen."
 *
 * Right on both counts. The presence check was hardened against a busy port
 * and this read never was, so it kept the old behaviour: one ask, one verdict,
 * an error on the screen and a button whose only job was to ask again.
 */
test('a chain that comes back on the second ask is not an error on screen', async () => {
  const answers = [null, [{ id: 1 }]]
  let waited = 0
  const list = await ds.confirmedChain({
    read: async () => answers.shift(),
    wait: async (ms) => {
      waited += ms
    }
  })
  assert.deepEqual(list, [{ id: 1 }], 'the first empty answer was taken as the verdict')
  assert.ok(waited > 0, 'it asked again with no pause at all, which asks the same busy port')
})

test('a chain read that works costs nothing extra', async () => {
  /*
   * Retries are only allowed to spend time on the case that used to show an
   * error. Every preset change runs this, so a pause on the good path would be
   * a pause on every preset change.
   */
  let n = 0
  const list = await ds.confirmedChain({
    read: async () => {
      n++
      return []
    },
    wait: never
  })
  assert.deepEqual(list, [], 'an empty preset is a real answer, not a failed read')
  assert.equal(n, 1, 'a good read was asked for more than once')
})

test('a chain that never reads still reports it, rather than asking for ever', async () => {
  let n = 0
  const list = await ds.confirmedChain({
    read: async () => {
      n++
      return null
    },
    wait: async () => {}
  })
  assert.equal(list, null, 'a unit that will not report its chain was passed off as read')
  assert.equal(n, ds.SETTLE_TRIES, 'it gave up early or kept asking for ever')
})

test('from a phone the chain read gets the relay allowance', async () => {
  /*
   * The read travels a relay to a Mac whose port is already busy with its own
   * polling — the same reason the presence check asks more times from a phone.
   */
  let n = 0
  const list = await ds.confirmedChain({
    read: async () => (++n >= 4 ? [] : null),
    wait: async () => {},
    remote: true
  })
  assert.deepEqual(list, [], 'the phone gave up before the Mac was free to answer')
  assert.equal(n, 4)
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


console.log('\npairing')
/*
 * The phone was asked for an email and a password before it would do
 * anything. "User shouldn't be required to sign in unless they want to save
 * and sync across the cloud. It's requiring a login to connect." The relay
 * still needs an account at both ends; the code stands for one nobody sees.
 */
import * as pairing from '../shared/pairing.mjs'

test('a code is 16 symbols nobody misreads, shown in fours', () => {
  const bytes = (arr) => arr.map((_, i) => i * 7)
  const code = pairing.makePairCode(bytes)
  assert.equal(code.length, 16)
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/, 'the alphabet has a 0, 1, I or O in it')
  assert.equal(pairing.formatPairCode(code), `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12)}`)
  // Two calls with real randomness never agree.
  assert.notEqual(pairing.makePairCode(), pairing.makePairCode())
})

test('a code typed carelessly is still the code', () => {
  const code = 'ABCDEFGHJKLMNPQR'
  for (const typed of ['abcd-efgh-jklm-npqr', 'ABCD EFGH JKLM NPQR', ' abcdefghjklmnpqr ', 'ABCD-EFGH-JKLM-NPQR']) {
    assert.equal(pairing.normalizePairCode(typed), code, typed)
    assert.ok(pairing.isPairCode(typed), typed)
  }
  assert.equal(pairing.normalizePairCode('ABCD-EFGH-JKLM-NPQ'), null, 'fifteen symbols passed as a code')
  assert.equal(pairing.normalizePairCode('ABCD-EFGH-JKLM-NPQ0'), null, 'a zero passed, and no code has one')
  assert.equal(pairing.normalizePairCode(''), null)
  assert.equal(pairing.normalizePairCode(null), null)
})

test('the same code is the same account at both ends, and the address gives half of it away at most', () => {
  const a = pairing.pairCredentials('abcd-efgh-jklm-npqr')
  const b = pairing.pairCredentials('ABCDEFGHJKLMNPQR')
  assert.deepEqual(a, b, 'a typed code and a scanned one sign in as different people')
  assert.equal(a.email, 'pair-abcdefgh@pair.fractal.newbold.cloud')
  assert.equal(a.password, 'pair-ABCDEFGHJKLMNPQR')
  assert.ok(a.password.length >= 6, 'the account service refuses passwords under six')
  assert.ok(!a.email.toUpperCase().includes('JKLMNPQR'), 'the address, which screens show, carries the whole code')
  assert.throws(() => pairing.pairCredentials('nope'), /isn’t a pairing code/)
})

test('a paired account is told apart from a person’s, so no screen shows it as an email', () => {
  assert.ok(pairing.isPairAccount('pair-abcdefgh@pair.fractal.newbold.cloud'))
  assert.ok(!pairing.isPairAccount('justin@example.com'))
  assert.ok(!pairing.isPairAccount('pair-abcdefgh@example.com'), 'anyone with a pair- address would be shown as paired')
  assert.ok(!pairing.isPairAccount(null))
  const paired = { email: 'pair-abcdefgh@pair.fractal.newbold.cloud' }
  for (const l of ['connected', 'off']) {
    const said = link.describeLink({ role: 'mac', link: l, account: paired })
    assert.ok(!/pair-abcdefgh|@/.test(said.sentence + said.note), `${l}: ${said.sentence} / ${said.note}`)
  }
  assert.match(link.describeLink({ role: 'mac', link: 'connected', account: paired }).sentence, /paired/i)
  assert.match(link.describeLink({ role: 'mac', link: 'connected', account: { email: 'j@x.com' } }).sentence, /for j@x.com/)
})

test('the QR opens the hosted app with the code in the fragment, and the phone reads it back', () => {
  const url = pairing.pairLink('abcd-efgh-jklm-npqr')
  assert.equal(url, 'https://fractal.newbold.cloud/#pair=ABCDEFGHJKLMNPQR')
  assert.equal(pairing.pairLink('bad'), null)
  assert.equal(pairing.pairCodeFromUrl({ hash: '#pair=ABCDEFGHJKLMNPQR' }), 'ABCDEFGHJKLMNPQR')
  assert.equal(pairing.pairCodeFromUrl({ hash: '#pair=abcd-efgh-jklm-npqr' }), 'ABCDEFGHJKLMNPQR', 'a code typed into a link is not read')
  assert.equal(pairing.pairCodeFromUrl({ search: '?x=1&pair=ABCDEFGHJKLMNPQR' }), 'ABCDEFGHJKLMNPQR')
  assert.equal(pairing.pairCodeFromUrl({ hash: '#other', search: '' }), null)
  assert.equal(pairing.pairCodeFromUrl({}), null)
  // The hosted origin the QR points at is the one the app already knows itself by.
  const platform = readSrc(new URL('../src/lib/platform.js', import.meta.url), 'utf8')
  assert.match(platform, new RegExp(`HOSTED = '${new URL(pairing.HOSTED_ORIGIN).hostname}'`), 'the QR points somewhere other than the hosted app')
})

test('a scanned code pairs before the connect screen can ask for anything', () => {
  const src = readSrc(new URL('../src/lib/link.js', import.meta.url), 'utf8')
  const boot = src.slice(src.indexOf('export async function bootLink'))
  assert.match(boot, /pairCodeFromUrl\(\{ hash: window\.location\.hash/, 'bootLink never looks for a code in the address')
  assert.match(boot, /replaceState\(null, '', window\.location\.pathname\)/, 'the code stays in the address, so a reload pairs again')
  assert.match(boot, /await pairPhone\(scanned\)/, 'a scanned code is found and not acted on')
  assert.match(src, /set\(\{ pairError: err\.message \}\)/, 'a bad scanned code fails silently')
  // The Mac's pairing and a person's sign-in are the same three steps after the account.
  assert.match(src, /export async function pairMac\(\)[\s\S]*?await turnOnMac\(/, 'pairing the Mac does not turn the host on')
  assert.match(src, /export async function setUpMac\([\s\S]*?await turnOnMac\(/, 'signing the Mac in no longer turns the host on')
  assert.match(src, /needsConfirmation[\s\S]*?Confirm email/, 'a project that confirms every account fails pairing with no words about why')
})


console.log('\ntyping a tempo')
/*
 * "On the tap button, let's do where they hold the tap button they can
 * manually enter in the beats per minute they want. On the Mac let them right
 * click to pull up the text box to enter the BPM." The check on what was typed
 * is shared with the phone apps, so both refuse the same things in the same
 * words.
 */
import * as tempo from '../shared/tempo.mjs'

test('a typed tempo is a whole number inside the unit’s range', () => {
  assert.deepEqual(tempo.checkBpm('120'), { bpm: 120 })
  assert.deepEqual(tempo.checkBpm(' 132 '), { bpm: 132 })
  assert.deepEqual(tempo.checkBpm('99.6'), { bpm: 100 }, 'a decimal is rounded, not refused')
  assert.deepEqual(tempo.checkBpm(''), { empty: true }, 'nothing typed is not an error')
  assert.deepEqual(tempo.checkBpm(null), { empty: true })
  assert.equal(tempo.BPM_MIN, 20)
  assert.equal(tempo.BPM_MAX, 400)
})

test('an impossible tempo is refused in words, never clamped', () => {
  for (const bad of ['19', '401', '0', '9999']) {
    const out = tempo.checkBpm(bad)
    assert.ok(out.error, `${bad} was accepted`)
    assert.match(out.error, /20 to 400/, `${bad}: the range is not named`)
    assert.equal(out.bpm, undefined, `${bad} was clamped into a tempo nobody typed`)
  }
  assert.match(tempo.checkBpm('fast').error, /number/i)
  assert.match(tempo.checkBpm('1x0').error, /number/i)
})

test('the Tap button opens the tempo box on a hold or a right-click, at both ends', () => {
  const gig = readSrc(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
  assert.match(gig, /const holdTap = useLongPress\(/, 'Tap cannot be held')
  assert.match(gig, /className="gig-bar-btn gig-tap"[^>]*\{\.\.\.holdTap\}/, 'the hold is not on the Tap button')
  assert.match(gig, /clearTimeout\(reread\.current\)\s*\n\s*setTyping\(true\)/, 'a hold leaves the tap’s re-read pending under the box')
  assert.match(gig, /<BpmBox bpm=\{bpm\} autoFocus onSet=\{typeTempo\}/, 'the box does not open with the tempo selected')
  assert.match(gig, /await setTempo\(n\)\s*\n\s*await refreshTempo\(\)/, 'a typed tempo is sent but the number on the button is not re-read')
  assert.match(gig, /useDismiss\(tapCell, \(\) => setTyping\(false\), \{ open: typing \}\)/, 'nothing closes the box on a tap elsewhere or Escape')
  // The box itself refuses with the shared words, and no longer sits unused in App.
  const box = readSrc(new URL('../src/components/BpmBox.jsx', import.meta.url), 'utf8')
  assert.match(box, /checkBpm\(typed\)/, 'the box has its own idea of a valid tempo')
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.ok(!/function BpmBox/.test(app), 'the tempo box is still defined in App.jsx, where nothing renders it')
  // The phone app: the same hold, the same check, from the same source.
  const press = readSrc(new URL('../mobile/src/components/Press.js', import.meta.url), 'utf8')
  assert.match(press, /onLongPress=\{\s*onLongPress/, 'the phone’s button cannot be held')
  const stage = readSrc(new URL('../mobile/src/screens/Stage.js', import.meta.url), 'utf8')
  assert.match(stage, /label="Tap"[^>]*onLongPress=\{\(\) => setTyping\(true\)\}/, 'holding Tap on the phone does nothing')
  assert.match(stage, /checkBpm\(typed\)/, 'the phone checks a typed tempo by its own rule')
  assert.match(stage, /await writeTempo\(checked\.bpm\)/, 'a typed tempo on the phone goes nowhere')
  const sync = readSrc(new URL('../scripts/sync-relay-rules.mjs', import.meta.url), 'utf8')
  assert.match(sync, /shared\/tempo\.mjs.*mobile\/src\/lib\/tempo\.js/, 'the phone’s copy of the tempo rule is not generated')
})


console.log('\nthe Mac app closes, updates, and reopens')
/*
 * "It does say that there's an update available and then it says install.
 * After installing it says to close the app or you clicked the button and it
 * closes the app and restarts and then it still says the same update is
 * available. … It said that ForgeFX was currently using the port. The only way
 * to get around it was to restart the Mac completely. … The app does not close
 * out all the way when you click the close button."
 */

test('closing the window quits the app, through the same shutdown as ⌘Q', () => {
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  assert.match(main, /app\.on\('window-all-closed', \(\) => \{\s*\n\s*if \(!quitting\) app\.quit\(\)/, 'closing the window leaves the app running with nothing on screen')
  assert.ok(!/app\.on\('window-all-closed', \(\) => \{\}\)/.test(main), 'the window-close no-op is back')
})

test('a device server this app left behind is stopped, not reported', async () => {
  const bundle = '/Applications/Fractal Remote.app/Contents/Resources/vendor/forgefx/server/dist/index.js'
  const exe = '/Applications/Fractal Remote.app/Contents/MacOS/Fractal Remote'
  assert.ok(host.isOurServer(`${exe} ${bundle}`), 'the server inside our own bundle is not recognised as ours')
  assert.ok(host.isOurServer(`${exe} /Applications/Fractal Remote.app/Contents/Resources/app/lib/child.cjs ${bundle}`), 'the server run through our wrapper is not recognised')
  assert.ok(!host.isOurServer('node /Users/j/src/forgefx/server/dist/index.js'), 'somebody’s own ForgeFX in a Terminal would be killed')
  assert.ok(!host.isOurServer(`${exe} something-else.js`), 'a process of ours that is not the server would be killed')
  assert.ok(!host.isOurServer(''))

  // lsof says who listens; ps says what they are. Only ours are touched.
  const ps = { 4242: `${exe} ${bundle}`, 5151: 'node /Users/j/src/forgefx/server/dist/index.js' }
  const run = (cmd, args) => {
    if (cmd === 'lsof') return '4242\n5151\n'
    if (cmd === 'ps') return ps[args[args.length - 1]] || ''
    throw new Error(`unexpected ${cmd}`)
  }
  assert.deepEqual(host.listeners({ port: 5056, run }).map((p) => p.pid), [4242, 5151])
  assert.deepEqual(host.listeners({ port: 5056, run: () => { throw new Error('no lsof') } }), [], 'a Mac without lsof is a crash instead of a no-op')

  const signals = []
  let living = new Set([4242, 5151])
  const polite = await host.reclaimPort({
    port: 5056,
    run,
    kill: (pid, sig) => {
      signals.push([pid, sig])
      if (sig === 'SIGTERM') living.delete(pid)
    },
    alive: (pid) => living.has(pid),
    sleep: async () => {}
  })
  assert.equal(polite, 'reclaimed')
  assert.deepEqual(signals, [[4242, 'SIGTERM']], 'the stranger’s ForgeFX was signalled, or ours was killed without being asked first')

  // One that ignores SIGTERM is killed; one that survives even that is reported, never waited on for ever.
  signals.length = 0
  living = new Set([4242])
  const forced = await host.reclaimPort({
    port: 5056,
    run,
    kill: (pid, sig) => {
      signals.push([pid, sig])
      if (sig === 'SIGKILL') living.delete(pid)
    },
    alive: (pid) => living.has(pid),
    sleep: async () => {}
  })
  assert.equal(forced, 'reclaimed')
  assert.deepEqual(signals, [[4242, 'SIGTERM'], [4242, 'SIGKILL']])
  const immortal = await host.reclaimPort({ port: 5056, run, kill: () => {}, alive: () => true, sleep: async () => {} })
  assert.equal(immortal, 'failed')
  assert.equal(await host.reclaimPort({ port: 5056, run: () => '' }), 'none')

  // And the app tries this before it gives up and shows the box.
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  const check = main.slice(main.indexOf('if (held.forgefx)'), main.indexOf('const forgefx = findForgeFX'))
  assert.match(check, /await reclaimPort\(/, 'a stray server of ours still stops the app opening')
  assert.ok(check.indexOf('reclaimPort(') < check.indexOf("showErrorBox('ForgeFX is already running'"), 'the box is shown before the sweep')
})

test('the device server leaves when the app does, however the app goes', () => {
  const wrapper = readSrc(new URL('../desktop/lib/child.cjs', import.meta.url), 'utf8')
  assert.match(wrapper, /process\.ppid !== parent\) process\.exit\(0\)/, 'the wrapper never notices its parent has gone')
  assert.match(wrapper, /import\(pathToFileURL\(entry\)\.href\)/, 'the wrapper does not start the server')
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  assert.match(main, /spawn\(process\.execPath, \[wrapperPath\(\), join\(forgefx, 'server', 'dist', 'index\.js'\)\]/, 'the server is started bare, so a Force Quit orphans it')
  // It has to ship as a real file: the shell is packed into app.asar, and a
  // script run by the Electron binary as Node needs a plain path.
  const builder = readSrc(new URL('../desktop/electron-builder.yml', import.meta.url), 'utf8')
  assert.match(builder, /- lib\/\*\*/, 'lib/ is not packaged, so the wrapper is missing from the installed app')
  assert.match(builder, /asarUnpack:\s*\n\s*- lib\/child\.cjs/, 'the wrapper is inside app.asar, where a Node child cannot be started from')
  assert.match(main, /app\.asar\.unpacked/, 'the spawn points into app.asar rather than at the unpacked file')
})

test('an install that did not take is said so, with why', async () => {
  assert.equal(updates.installOutcome({ marker: { version: '7.113.0' }, version: '7.82.0' }), 'stuck')
  assert.equal(updates.installOutcome({ marker: { version: '7.113.0' }, version: '7.113.0' }), 'installed')
  assert.equal(updates.installOutcome({ marker: { version: '7.113.0' }, version: '7.114.0' }), 'installed', 'a newer version than expected reads as a failure')
  assert.equal(updates.installOutcome({ marker: null, version: '7.113.0' }), null)
  assert.equal(updates.installOutcome({ marker: { version: null }, version: '7.113.0' }), null)
  assert.equal(updates.compareVersions('7.9.0', '7.10.0'), -1, 'versions are compared as text, so 7.9 beats 7.10')
  assert.equal(updates.compareVersions('7.10.0', '7.10'), 0)
  assert.match(updates.updateLine({ kind: 'stuck', version: '7.113.0' }), /7\.113\.0 didn’t install/)
  assert.match(updates.updateLine({ kind: 'misplaced' }), /Applications/)
  assert.match(updates.updateLine({ kind: 'staging', version: '7.113.0' }), /Preparing 7\.113\.0/)
  assert.match(updates.updateLine({ kind: 'trouble', message: 'Code signature did not pass validation' }), /Code signature/, 'macOS’s reason is dropped from the menu')

  // The note is written before the app starts shutting anything down.
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  const install = main.slice(main.indexOf("ipcMain.handle('updates:install'"), main.indexOf('updates.install()'))
  assert.match(install, /writeMarker\(\{ version: update\.version/, 'nothing records which version the install was meant to reach')
  assert.ok(install.indexOf('writeMarker(') < install.indexOf('await stopServing()'), 'the note is written after the server is already going down')
  // And read back on the way in, before any new download is started.
  const begin = main.slice(main.indexOf('async function beginUpdates'), main.indexOf('app.whenReady'))
  assert.match(begin, /installOutcome\(\{ marker, version: app\.getVersion\(\) \}\)/, 'the note is never read back')
  assert.match(begin, /if \(outcome === 'stuck'\) \{[\s\S]*?shipItLog\(\)\.then[\s\S]*?return/, 'a stuck install is followed by the same download again')
  assert.ok(!/detail: await shipItLog/.test(begin), 'reading the system log holds the window up')
  assert.match(begin, /if \(misplaced\) \{\s*\n\s*publish\(\{ kind: 'misplaced' \}\)\s*\n\s*return/, 'an app macOS cannot replace still downloads updates it cannot install')
})

test('ready means macOS has the update, not merely that we downloaded it', async () => {
  /*
   * The library downloads the file and says "downloaded"; then macOS's own
   * updater takes a copy and checks it, and only then can anything install.
   * The app called the first one ready, so Restart pressed in between did
   * nothing but close the app.
   */
  const seen = []
  const u = fakeUpdater()
  const n = fakeUpdater()
  updates.wireUpdates({ updater: u, native: n, onState: (s) => seen.push(s) })
  u.emit('update-available', { version: '7.113.0' })
  u.emit('update-downloaded', { version: '7.113.0' })
  assert.equal(seen.at(-1).kind, 'staging', 'the library’s download is called ready before macOS has it')
  assert.equal(seen.at(-1).version, '7.113.0')
  n.emit('update-downloaded')
  assert.deepEqual(seen.at(-1), { kind: 'ready', version: '7.113.0' })
  n.emit('error', new Error('Code signature at URL file:///x did not pass validation\nmore'))
  assert.equal(seen.at(-1).kind, 'trouble')
  assert.equal(seen.at(-1).message, 'Code signature at URL file:///x did not pass validation', 'macOS’s reason is not carried to the screen')
  // Without the native updater (tests, other platforms) the library's word is the only one.
  const plain = []
  const p = fakeUpdater()
  updates.wireUpdates({ updater: p, onState: (s) => plain.push(s) })
  p.emit('update-downloaded', { version: '7.113.0' })
  assert.equal(plain.at(-1).kind, 'ready')
  // main.js hands the native updater in.
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  assert.match(main, /const \{ autoUpdater: native \} = require\('electron'\)/, 'the native updater is never listened to')
  assert.match(main, /wireUpdates\(\{\s*\n\s*updater: autoUpdater,\s*\n\s*native,/, 'the native updater is not handed to wireUpdates')
})

test('an app run from Downloads is offered a home in Applications first', () => {
  assert.deepEqual(updates.installPlace({ exePath: '/private/var/folders/zz/T/AppTranslocation/ABC/d/Fractal Remote.app/Contents/MacOS/Fractal Remote', inApplications: false }), { ok: false, reason: 'translocated' })
  assert.deepEqual(updates.installPlace({ exePath: '/Users/j/Downloads/Fractal Remote.app/Contents/MacOS/Fractal Remote', inApplications: false }), { ok: false, reason: 'not-applications' })
  assert.deepEqual(updates.installPlace({ exePath: '/Applications/Fractal Remote.app/Contents/MacOS/Fractal Remote', inApplications: true }), { ok: true })
  const main = readSrc(new URL('../desktop/main.js', import.meta.url), 'utf8')
  assert.match(main, /if \(!\(await settleInPlace\(\)\)\) return/, 'the app starts serving before asking where it lives')
  assert.ok(main.indexOf('await settleInPlace()') < main.indexOf('const answering = await start()'), 'the move is offered after the server is already running from the wrong place')
  assert.match(main, /app\.moveToApplicationsFolder\(\{ conflictHandler: \(\) => true \}\)/, 'moving never replaces the older copy already in Applications')
  assert.match(main, /buttons: \['Move to Applications', 'Not now'\]/, 'the move is done without asking, or asked in other words')
  const ui = readSrc(new URL('../src/components/Updates.jsx', import.meta.url), 'utf8')
  assert.match(ui, /moveToApplications/, 'Setup offers no way to move the app once the launch-time offer was declined')
  assert.match(ui, /Download from GitHub/, 'a stuck install offers no other way to the new version')
  assert.match(ui, /state\?\.detail[\s\S]*?Technical details/, 'what macOS wrote about the failed install is not shown anywhere')
})


console.log('\nasking for less volume')
/*
 * "I asked to turn the volume down a little and it said nothing to change."
 * The model returned no actions and no words; the app's default for a silence
 * was a verdict on the request. Two halves: the model is told what volume
 * means here and never to answer with silence, and the app never says
 * "nothing to change" on its own.
 */
import { replyFor } from '../src/lib/actions.js'

test('a reply with nothing in it says so, and says what would work', () => {
  assert.equal(replyFor({ understood: 'Amp level down a touch.', actions: [] }), 'Amp level down a touch.')
  assert.equal(replyFor({ understood: '', refused: 'No amp on the grid.', actions: [] }), 'No amp on the grid.')
  assert.match(replyFor({ understood: '', refused: '', actions: [{}, {}] }), /2 changes ready/)
  assert.match(replyFor({ understood: '', refused: '', actions: [], problems: ['Amp / Level: levels can be nudged, not reset'] }), /couldn’t make that change/)
  const empty = replyFor({ understood: '', refused: '', actions: [], problems: [] })
  assert.ok(!/nothing to change/i.test(empty), 'a silent plan is still read back as "nothing to change"')
  assert.match(empty, /amp level down a little/i, 'the fallback does not show what to say instead')
  assert.equal(replyFor(), replyFor({}), 'a missing plan is not the same reply as an empty one')
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.ok(!/'Nothing to change\.'/.test(app), 'the app still says "Nothing to change." on its own')
  assert.match(app, /text: replyFor\(checked\)/, 'the reply is not built by the one tested place')
})

import { progressFor } from '../src/lib/liveProgress.js'

test('the working line says what the model is deciding, not how much of it there is', () => {
  /*
   * "Could it say which song it's designing that off of while it's doing it,
   * or something like that — just a little bit more information on what's
   * happening, like choosing an amp or deciding on delay."
   *
   * All of it was already arriving and being counted instead of read: the line
   * said "Building your chain — 4 blocks so far" while the partial in hand
   * named the amp model, the control being set and the scene being voiced. The
   * fields stream in the order the schema declares them, so the last thing in
   * the partial is the thing being decided now.
   */
  const named = (eid) => ({ 58: 'Amp 1', 118: 'Drive 1', 70: 'Delay 1' })[eid] || null

  assert.equal(progressFor(null), null, 'an empty run claims to be doing something')
  assert.equal(progressFor({}), null, 'a partial with nothing in it claims to be doing something')
  assert.match(progressFor({ presetName: 'Last Resort' }), /Last Resort/)
  assert.equal(progressFor({ presetName: 'x', summary: 'drop D' }), 'Working out the chain…')

  assert.equal(
    progressFor({ blocks: [{ eid: 58, typeName: '5153 100W Blue' }] }, named),
    'Choosing Amp 1 — 5153 100W Blue'
  )
  assert.equal(
    progressFor({ blocks: [{ eid: 58, params: [{ id: 1, name: 'Bass' }, { id: 2, name: 'Presence' }] }] }, named),
    'Dialling Amp 1 — Presence'
  )

  /* And the scenes, which on the build this came from are the songs: "eight
     scenes, choose eight of their most popular songs to model each scene on". */
  assert.equal(
    progressFor({ blocks: [{ eid: 58 }], scenes: [{ index: 0, name: 'Last Resort' }, { index: 1, name: 'Scars' }] }, named),
    'Scene 2 — Scars'
  )

  /* Without the preset's own names it still says something true rather than
     the unit's word for it, which nobody outside the app speaks. */
  assert.match(progressFor({ blocks: [{ eid: 58, typeName: 'Brit 800' }] }), /eid 58/)

  /* And App reads it rather than counting blocks. */
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /progressFor\(p, blockNameFor\)/, 'the partial is stored and never read for what it says')
  assert.ok(
    !/block\$\{e\.blocks === 1/.test(app),
    'the working line still counts blocks over the top of what the model is doing'
  )
})

import { recordUsage, readLedger, byDay, clearLedger, ledgerText, utcDay, MAX_ROWS } from '../src/lib/ledger.js'

test('every call to the model is written down, and kept', () => {
  /*
   * "It's actually spending a lot more than what the app says."
   *
   * Two holes, and only one of them was arithmetic. The session total counted
   * DESIGNS: every message on the Ask screen came back with its own token count
   * and the app read it into a field nothing looked at — and those are the
   * expensive ones, carrying the model roster AND the whole transcript, growing
   * as the conversation runs. The other hole is a run that failed: the model
   * was asked, it thought, and the error replaced the count along with
   * everything else.
   *
   * So one row per call, kept across sessions, totalled by UTC day because that
   * is how the console groups it — two columns that can be read straight
   * across is the only way to find out whether the app's arithmetic is right,
   * and it has been wrong twice already.
   */
  const store = fakeStore()
  const sonnet = { inputTokens: 10000, outputTokens: 2000, cachedInputTokens: 6000, cacheWriteTokens: 1000, model: 'claude-sonnet-5' }

  recordUsage('design', sonnet, {}, store)
  recordUsage('chat', { ...sonnet, inputTokens: 4000, cachedInputTokens: 0, cacheWriteTokens: 0 }, {}, store)
  const rows = readLedger(store)
  assert.equal(rows.length, 2, 'a call went unrecorded')
  assert.equal(rows[0].kind, 'design')
  assert.equal(rows[1].kind, 'chat')
  /* The buckets add up, same as the panel: fresh + cached + written is total. */
  assert.equal(rows[0].fresh + rows[0].cached + rows[0].written, rows[0].total)
  assert.ok(rows[0].cost > 0, 'a recorded call has no cost against it')

  /*
   * A failed call is still a row, with nothing where the numbers should be.
   * It spent something; what it cannot say is how much, and a row saying so is
   * what turns a gap against the bill into an explanation rather than a
   * mystery.
   */
  recordUsage('design', null, { failed: 'Load failed' }, store)
  const [day] = byDay(readLedger(store))
  assert.equal(day.calls, 3)
  assert.equal(day.unknown, 1, 'a call that reported nothing is counted as if it were free')
  assert.equal(day.day, utcDay(), 'the day is not the UTC day the console groups by')
  assert.deepEqual(day.kinds, { design: 2, chat: 1 })
  assert.ok(day.models['claude-sonnet-5'].calls === 2, 'the per-model split is wrong')

  /* And the day's totals never count the uncounted call as zero tokens. */
  assert.equal(day.fresh, 3000 + 4000)
  assert.equal(day.output, 4000)

  /* Kept across sessions: a fresh read of the same store has all of it. */
  assert.equal(readLedger(store).length, 3, 'the ledger does not survive a reload')
  clearLedger(store)
  assert.deepEqual(readLedger(store), [], 'clearing leaves rows behind')

  /* Bounded, because localStorage is a few megabytes for the whole origin. */
  for (let i = 0; i < MAX_ROWS + 40; i++) recordUsage('chat', sonnet, {}, store)
  assert.equal(readLedger(store).length, MAX_ROWS, 'the ledger grows without limit')

  /* Storage that says no is not worth failing a generation over. */
  const refuses = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
  assert.deepEqual(readLedger(refuses), [])
  assert.ok(recordUsage('design', sonnet, {}, refuses).cost > 0, 'a blocked store loses the row entirely')

  /* Copyable, and it says which clock the days are on. */
  const text = ledgerText([
    { at: Date.parse('2026-09-10T12:00:00Z'), kind: 'design', model: 'claude-sonnet-5', fresh: 1, cached: 2, written: 3, output: 4, total: 6, cost: 0.01 }
  ])
  assert.match(text, /UTC/, 'the copied usage does not say which day boundary it uses')
  assert.match(text, /2026-09-10/)

  /* And the app counts all three kinds, not designs alone. */
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  for (const kind of ['design', 'refine', 'chat']) {
    assert.ok(
      app.includes(`noteSpend('${kind}'`),
      `${kind} calls are spent and never counted, which is how the app came in under the bill`
    )
  }
  assert.ok(
    !/setSpend\(\(prev\) => \(\{ total: prev\.total \+ runCost/.test(app),
    'a run is still added to the total somewhere other than the one place that records it'
  )
  /* A chat turn that throws after the answer landed must not be written twice. */
  assert.match(app, /if \(!counted\) noteSpend\('chat', null/, 'a failed chat turn is double-counted or not counted')
})

import { landedOf } from '../src/lib/actions.js'

test('the log says what happened, not everything attempted plus everything refused', () => {
  /*
   * "[app] edit: Did 2 things — Amp 1 · Treble 1 6 → 5, Amp 1 · Presence 1 5 →
   * 4, Amp 1 · Treble 1 6 → 5 — the unit refused it., Amp 1 · Presence 1 5 → 4
   * — the unit refused it."
   *
   * Both changes reported as done and then the same two reported as refused,
   * in the debug log — which is the one place a session is read back when
   * something went wrong. Nothing was wrong on the unit; the line was the
   * whole plan with the failures stapled to the end of it.
   */
  const actions = [
    { label: 'Amp 1 · Treble 1 6 → 5' },
    { label: 'Amp 1 · Presence 1 5 → 4' },
    { label: 'Amp 1 · Bass 1 5 → 6' }
  ]
  const failures = [
    'Amp 1 · Treble 1 6 → 5 — the unit refused it.',
    'Amp 1 · Presence 1 5 → 4 — the link dropped.'
  ]
  assert.deepEqual(
    landedOf(actions, failures).map((a) => a.label),
    ['Amp 1 · Bass 1 5 → 6']
  )
  assert.deepEqual(landedOf(actions, []), actions, 'a clean run loses changes that took')
  assert.deepEqual(
    landedOf(actions, actions.map((a) => `${a.label} — the unit refused it.`)),
    [],
    'a run where nothing took still claims changes'
  )

  /* And a label that merely starts the same way is a different change. */
  assert.deepEqual(
    landedOf([{ label: 'Amp 1 · Bass 1' }], ['Amp 1 · Bass 11 — the unit refused it.']).length,
    1
  )

  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /landedOf\(actions, failures\)/, 'the log line is not built from what landed')
  assert.ok(
    !/\[\.\.\.actions\.map\(\(a\) => a\.label\), \.\.\.failures\]/.test(app),
    'the log still lists every attempt next to every refusal'
  )
})

test('Previous and Next step through the slots, the stars, or a setlist', () => {
  /*
   * "Hitting next or previous cycles through songs on the favorites or
   * setlists." The two buttons walked the slots one at a time, which is the
   * unit's order and never the night's.
   */
  const { nextIn, stepTarget, positionIn, orderFor, sourceLabel, ALL, STARRED } = setlists

  // A list is walked in its own order, and it wraps: the encore is followed
  // by the opener, not by a dead button.
  assert.equal(nextIn([40, 7, 200], 40, 1), 7)
  assert.equal(nextIn([40, 7, 200], 7, 1), 200)
  assert.equal(nextIn([40, 7, 200], 200, 1), 40, 'the last song does not wrap to the first')
  assert.equal(nextIn([40, 7, 200], 40, -1), 200, 'the first song does not wrap back to the last')
  assert.equal(nextIn([40, 7, 200], 7, -1), 40)

  // Off the list, Next goes to the first song and Previous to the last —
  // what choosing a setlist mid-song on a stray preset should do.
  assert.equal(nextIn([40, 7, 200], 99, 1), 40)
  assert.equal(nextIn([40, 7, 200], 99, -1), 200)
  assert.equal(nextIn([40, 7, 200], undefined, 1), 40)
  assert.equal(nextIn([], 5, 1), null, 'an empty list has somewhere to go')
  assert.equal(nextIn([5], 5, 1), 5, 'a list of one goes nowhere but itself')

  assert.equal(positionIn([40, 7, 200], 7), 2)
  assert.equal(positionIn([40, 7, 200], 99), 0)

  // The slots view is what it always was: one step, no wrap, never below 0.
  assert.equal(stepTarget({ source: ALL, current: 44, delta: 1 }), 45)
  assert.equal(stepTarget({ source: ALL, current: 44, delta: -1 }), 43)
  assert.equal(stepTarget({ source: ALL, current: 0, delta: -1 }), null, 'Previous goes below slot 0')
  assert.equal(stepTarget({ source: ALL, current: undefined, delta: 1 }), 1)

  // Starred steps the stars in slot order, however they were starred.
  const favourites = [300, 12, 45]
  assert.deepEqual(orderFor(STARRED, { favourites }), [300, 12, 45])
  assert.equal(stepTarget({ source: STARRED, current: 12, delta: 1, favourites, lists: [] }), 45)
  assert.equal(stepTarget({ source: STARRED, current: 45, delta: 1, favourites, lists: [] }), 300)
  assert.equal(stepTarget({ source: STARRED, current: 12, delta: 1, favourites: [], lists: [] }), null, 'nothing starred, and Next still has somewhere to go')

  // A setlist steps in its own order, and a deleted one falls back to the slots.
  const lists = [{ id: 'sat', name: 'Saturday', presets: [45, 12, 300] }]
  assert.equal(stepTarget({ source: 'sat', current: 45, delta: 1, favourites, lists }), 12)
  assert.equal(stepTarget({ source: 'sat', current: 45, delta: -1, favourites, lists }), 300)
  assert.equal(stepTarget({ source: 'gone', current: 45, delta: 1, favourites, lists }), 46, 'a missing setlist killed the buttons')
  assert.equal(orderFor(ALL, { favourites, lists }), null)

  assert.equal(sourceLabel(ALL, { lists }), 'All presets')
  assert.equal(sourceLabel(STARRED, { lists }), 'Starred')
  assert.equal(sourceLabel('sat', { lists }), 'Saturday')
  assert.equal(sourceLabel('gone', { lists }), 'All presets')
})

test('a setlist is built, reordered and kept per unit', () => {
  const { addTo, removeFrom, moveIn, createList, updateList, deleteList, listsFor, sourceFor, setSource, ALL, STARRED } = setlists

  // Building: no song twice, and the order is the order it was built in.
  assert.deepEqual(addTo([], 45), [45])
  assert.deepEqual(addTo([45], 12), [45, 12])
  assert.deepEqual(addTo([45, 12], 45), [45, 12], 'the same song was added twice')
  assert.deepEqual(addTo([45], -1), [45])
  assert.deepEqual(addTo([45], 1.5), [45])
  assert.deepEqual(removeFrom([45, 12, 300], 12), [45, 300])

  // Nudging: up, down, and nowhere past the ends.
  assert.deepEqual(moveIn([1, 2, 3], 0, 1), [2, 1, 3])
  assert.deepEqual(moveIn([1, 2, 3], 2, 1), [1, 3, 2])
  assert.deepEqual(moveIn([1, 2, 3], 0, -1), [1, 2, 3], 'the first song moved above the top')
  assert.deepEqual(moveIn([1, 2, 3], 2, 3), [1, 2, 3], 'the last song moved below the bottom')

  // Stored per unit, like the stars, and read back clean.
  const mem = new Map()
  const store = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v)
  }
  assert.deepEqual(listsFor('fm3', store), [])
  assert.equal(sourceFor('fm3', store), ALL, 'a fresh unit does not step the slots')

  const sat = createList('fm3', 'Saturday', store)
  assert.equal(sat.name, 'Saturday')
  assert.deepEqual(sat.presets, [])
  const untitled = createList('fm3', '   ', store)
  assert.equal(untitled.name, 'Setlist 2', 'a blank name is not given a name')
  assert.notEqual(sat.id, untitled.id)

  updateList('fm3', sat.id, { presets: [45, 12, 45, -3, 'x', 300] }, store)
  assert.deepEqual(listsFor('fm3', store).find((l) => l.id === sat.id).presets, [45, 12, 300], 'junk in a stored list survived the read')
  updateList('fm3', sat.id, { name: 'Sat night' }, store)
  assert.equal(listsFor('fm3', store)[0].name, 'Sat night')

  assert.deepEqual(listsFor('am4', store), [], 'one unit is reading another unit\'s setlists')

  // The chosen source sticks, and a setlist that goes takes its choice with it.
  assert.equal(setSource('fm3', sat.id, store), sat.id)
  assert.equal(sourceFor('fm3', store), sat.id)
  assert.equal(sourceFor('am4', store), ALL, 'a choice crossed between two units')
  assert.equal(setSource('fm3', STARRED, store), STARRED)
  assert.equal(setSource('fm3', 'nonsense', store), ALL, 'an unknown setlist id was kept as the source')
  setSource('fm3', sat.id, store)
  deleteList('fm3', sat.id, store)
  assert.equal(listsFor('fm3', store).length, 1)
  assert.equal(sourceFor('fm3', store), ALL, 'the buttons still follow a deleted setlist')

  // Nothing readable is nothing, never a throw.
  assert.deepEqual(listsFor('fm3', { getItem: () => '{not json', setItem: () => {} }), [])
  assert.equal(sourceFor('fm3', { getItem: () => '[]', setItem: () => {} }), ALL)
  assert.deepEqual(listsFor('fm3', { getItem: () => { throw new Error('blocked') }, setItem: () => {} }), [])
})

test('the chat is the player’s Fractal agent, not a command parser', () => {
  /*
   * "Why did you choose the tones that you did? Where did you get your
   * information from?" — answered with "That question isn't about the
   * Fractal preset or your rig". The instructions said it was a parser; a
   * player who has just had a preset built and asks why is asking the most
   * reasonable question there is.
   */
  const command = readSrc(new URL('../api/command.js', import.meta.url), 'utf8')
  assert.match(command, /`WHO YOU ARE\n/, 'the model is not told who it is')
  assert.match(command, /the real amplifiers and speakers each is modelled on/, 'the model is not told it knows the amps')
  assert.match(command, /Bands, players, their rigs and their records/, 'the model is not told it knows the music')
  assert.match(command, /Never tell the player a question is not about the preset or the rig/, 'the refusal that started this is still allowed')
  assert.match(command, /A question is\s+never a failure and is never off topic/)
  assert.match(command, /\nEXPLAINING WHAT YOU DO\n/, 'nothing asks the model to explain itself')
  assert.match(command, /dictated on a phone/, 'the model is not told to read past dictation typos')
  // The answer field is allowed to be an answer.
  const understood = command.slice(command.indexOf('  understood: z'), command.indexOf('  actions: z'))
  assert.match(understood, /paragraphs as it deserves/, 'the reply is still capped at two sentences')
  assert.ok(!/one or two plain sentences\. This is read/.test(understood))

  // It is given what it needs to answer: the design and its reasoning, and
  // the taste profile the designer already gets.
  const handler = command.slice(command.indexOf('export default async function handler'))
  assert.match(handler, /design,\s*\n\s*taste,\s*\n\s*corrections[\s\S]{0,40}\} = req\.body/, 'the route does not read the design, taste or corrections')
  assert.match(handler, /design: describeDesign\(design\)/, 'the design never reaches the model state')
  assert.match(command, /That\s+summary IS the reasoning behind the choices/, 'the model is not told where the why lives')
  assert.match(handler, /historyTurns\(history\)/, 'the transcript is not passed through the one labelled reader')

  /*
   * Its own model setting, defaulting to the one this app runs on.
   *
   * It defaulted to Opus for a while, on the reasoning that the chat makes the
   * harder judgements and costs less per call. The first half is arguable and
   * the second half is wrong: a chat turn carries the model roster AND the
   * whole transcript, so it grows as the conversation does, and Opus is two and
   * a half times the price either way. It was found on the bill rather than in
   * the app — "it should only be using Sonnet 5" — on a day the chat cost twice
   * what every tone built that day did.
   */
  assert.match(command, /process\.env\.CHAT_MODEL \|\| process\.env\.GENERATOR_MODEL \|\| 'claude-sonnet-5'/, 'the chat has no model of its own')

  /*
   * And nothing else reaches for a pricier one by default.
   *
   * An env var nobody sets is the default, so a default is what the app runs
   * on — this is the check that every route agrees on which model that is.
   */
  for (const route of ['api/command.js', 'api/generate.js']) {
    const code = readSrc(new URL(`../${route}`, import.meta.url), 'utf8')
    for (const m of code.matchAll(/process\.env\.\w+\s*\|\|\s*'([^']*claude[^']*)'/g)) {
      assert.ok(
        !/opus/i.test(m[1]),
        `${route} falls back to ${m[1]} when nothing is configured — the app is meant to run on Sonnet, and a default is what it runs on`
      )
    }
  }
  assert.ok(!/claude-sonnet-4\.5/.test(command), 'the gateway fallback still names a retired model')
  assert.match(handler, /thinking: \{ type: 'adaptive' \}/, 'the model is given no room to think')
  // Internal names stay internal, and a change is said in the future tense.
  assert.match(command, /Never say\s+"designTone", "placeBlock"/, 'the model may still name its own action kinds to the player')
  assert.match(command, /Your\s+actions run AFTER your words are shown/, 'the model is not told its actions have not run yet')
  // A band is known, not looked up; "what would you do" gets a plan.
  assert.match(command, /Never\s+hedge that you "don't have preset details" for a band/, 'the hedge that answered "Eva Under Fire" is still allowed')
  assert.match(command, /a plan is an answer, not a permission/, 'the model is not told to answer "what would you do" with a plan')
  // And an empty reply is asked again before the app's fallback line shows.
  assert.match(handler, /if \(silent\(object\)\) \{/, 'an empty reply reaches the app')
  assert.match(handler, /await ask\(attempt, NUDGE\)/, 'the retry does not tell the model what was wrong')
  // And a refused model is not a dead chat: one retry on the designer's model.
  assert.match(command, /const FALLBACK_MODEL = process\.env\.GENERATOR_MODEL \|\| 'claude-sonnet-5'/, 'no fallback model')
  /* With both on Sonnet by default there is nothing to fall back TO, and the
     guard says so rather than asking the same refused model twice. The branch
     still matters: CHAT_MODEL can put something else in front of it. */
  assert.match(handler, /if \(FALLBACK_MODEL !== MODEL_NAME\) attempts\.push\(\{ model: resolveModel\(FALLBACK_MODEL\) \}\)/, 'the fallback is never tried')
  assert.match(handler, /for \(const attempt of attempts\)/, 'the attempts are not walked')

  // And the app sends them.
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const send = app.slice(app.indexOf('await askPlan('), app.indexOf('await askPlan(') + 1600)
  assert.match(send, /design: lastDesign/, 'the app never sends the last design')
  assert.match(send, /taste: describeProfile\(taste\)/, 'the chat gets no taste profile')
  assert.match(send, /corrections: tasteOn \? describeCorrections\(corrections\)/, 'the chat gets no corrections')
  assert.match(send, /history: turns\.map\(\(t\) => \(\{ role: t\.role, text: t\.text \}\)\)/, 'the roles are rewritten before the route can label them')
  // The design is remembered at every landing and marked when written.
  assert.equal((app.match(/setLastDesign\(designMemory\(validated\)\)/g) || []).length, 3, 'a design landing is not remembered')
  assert.match(app, /setLastDesign\(\(prev\) => \(prev \? \{ \.\.\.prev, applied: true \}/, 'writing the design never marks it applied')
})

test('the chat reads the transcript with the notes labelled, and the design said small', () => {
  const turns = historyTurns([
    { role: 'user', text: 'warm clean' },
    { role: 'assistant', text: 'Designing that.' },
    { role: 'system', text: 'Chain in: Amp (3), Cab (4)' },
    { role: 'hand', text: 'Named scene 4 Solo' },
    { role: 'user', text: '   ' },
    null,
    { role: 'user', text: 'x'.repeat(5000) }
  ])
  assert.deepEqual(turns.slice(0, 4), [
    { role: 'user', content: 'warm clean' },
    { role: 'assistant', content: 'Designing that.' },
    { role: 'user', content: '(App note: Chain in: Amp (3), Cab (4))' },
    { role: 'user', content: '(Hand edit, by me: Named scene 4 Solo)' }
  ])
  assert.equal(turns.length, 5, 'blank and missing turns reached the model')
  assert.equal(turns[4].content.length, 2400, 'a turn is sent whole however long')
  // Deeper than eight: "why did you do that" needs the that.
  const many = historyTurns(Array.from({ length: 40 }, (_, i) => ({ role: 'user', text: `t${i}` })))
  assert.equal(many.length, 24)
  assert.equal(many[0].content, 't16')

  assert.equal(describeDesign(null), undefined)
  assert.equal(describeDesign('x'), undefined)
  const d = describeDesign({
    name: 'Back In Black 2204',
    description: 'AC/DC rhythm',
    summary: 'Rebuilt around Brit 800 2204 High — the JCM800 Angus and Malcolm ran.',
    notes: '',
    applied: true,
    changes: [
      { name: 'Amp 1', typeName: 'Brit 800 2204 High', params: Array.from({ length: 15 }, (_, i) => ({ name: `p${i}`, to: i, unit: '' })) },
      { name: 'Drive 1', typeName: null, bypassed: true, params: [{ name: 'Drive', to: 3.5, unit: '' }] }
    ]
  })
  assert.equal(d.name, 'Back In Black 2204')
  assert.equal(d.askedFor, 'AC/DC rhythm')
  assert.match(d.summary, /JCM800/)
  assert.equal(d.applied, 'written to the unit')
  assert.equal(d.changes[0].model, 'Brit 800 2204 High')
  assert.equal(d.changes[0].settings.length, 12)
  assert.equal(d.changes[0].more, 3)
  assert.equal(d.changes[1].bypassed, true)
  assert.equal(d.changes[1].model, undefined)
  assert.equal(describeDesign({ changes: [] }).applied, 'designed, not yet written')
})

test('the chat can add blocks: the list reaches it, a failed read is said, a design gets what it wanted', () => {
  const app = readSrc(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const command = readSrc(new URL('../api/command.js', import.meta.url), 'utf8')
  const forge = readSrc(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
  const actions = readSrc(new URL('../src/lib/actions.js', import.meta.url), 'utf8')

  // The read that was called and never imported.
  const imports = app.slice(0, app.indexOf('export default function App'))
  assert.match(imports, /\bplaceableBlocks\b/, 'the block list is still not imported into App')
  assert.ok(!/await blockCatalog\(\)/.test(app), 'App still calls the raw catalogue, which it never imported')
  assert.match(forge, /export const placeableBlocks = \(\) =>\s*\n?\s*paletteFor\(currentDeviceSlug\(\), blockCatalog\)/, 'the remembered list is not served from forgefx')
  assert.equal((actions.match(/await d\.placeableBlocks\(\)/g) || []).length, 2, 'placing and building do not read the remembered list')

  // A failure is said, not emptied.
  const askFor = app.slice(app.indexOf('const askFor = async'), app.indexOf('await askPlan('))
  assert.match(askFor, /placeableProblem = `The block list could not be read/, 'a failed block list is still an empty list')
  const send = app.slice(app.indexOf('await askPlan('), app.indexOf('await askPlan(') + 1800)
  assert.match(send, /placeableProblem,/, 'the reason never reaches the route')
  assert.match(command, /placeableProblem: typeof placeableProblem === 'string'/, 'the route drops the reason')
  assert.match(command, /\nADDING BLOCKS\n/, 'the model is not told how adding works')
  assert.match(command, /Never tell the player to add a\s+block by hand/, 'the model may still send the player to the grid')
  assert.match(command, /never conclude the unit has no such block/)

  // A design that wanted a block gets it, once.
  const gen = app.slice(app.indexOf('const generate = async'), app.indexOf('const generate = async') + 6000)
  assert.match(gen, /if \(!opts\.placedWanted && validated\.wanted\?\.length\)/, 'a design that wanted blocks is shown as it is')
  assert.match(gen, /const added = await placeWanted\(validated\.wanted, against \|\| blocks\)/)
  assert.match(gen, /return await generate\(description, fresh, \{ \.\.\.opts, placedWanted: true \}\)/, 'the redesign is not capped at one round')
  const pw = app.slice(app.indexOf('const placeWanted = async'), app.indexOf('const generate = async'))
  assert.match(pw, /resolvePlaceable\(list, name\)/, 'wanted names are not resolved against the unit’s list')
  assert.match(pw, /kind: 'placeBlock'/)
  assert.match(pw, /backupPreset\(preset\.number\)/, 'the first structural write takes no safety copy')
})

test('the model is told what volume means, and never to answer with silence', () => {
  const command = readSrc(new URL('../api/command.js', import.meta.url), 'utf8')
  assert.match(command, /\nVOLUME\n/, 'the prompt says nothing about volume')
  assert.match(command, /amp\s+block's Level/, 'volume is not tied to the amp’s Level')
  assert.match(command, /never answer a volume request by touching them, and never\s+refuse one because of them/, 'the model may still refuse "volume" because Output is off limits')
  assert.match(command, /\nNEVER ANSWER WITH SILENCE\n/, 'nothing tells the model an empty reply is wrong')
  assert.match(command, /"refused" says\s+why not and what would work instead/)
})

console.log('\nwhy a preset makes no sound')

test('the report names what would keep a preset quiet, in a player\'s words', async () => {
  const { silenceFaults, atMinimum } = await import('../src/lib/presetReport.js')

  // A preset with no output block: the fault Justin's built presets had, and
  // the reason the volume slider had nothing to move.
  const noOut = silenceFaults({
    blocks: [
      { slug: 'input', name: 'Input 1', effectId: 37, col: 0, fromRows: [] },
      { slug: 'drive', name: 'Drive 1', effectId: 100, col: 1, fromRows: [1] },
      { slug: 'amp', name: 'Amp 1', effectId: 106, col: 2, fromRows: [1] }
    ]
  })
  assert.equal(noOut.length, 1)
  assert.match(noOut[0], /no Output block/i)

  // And the same fault from the other end, which is the one a chain built into
  // a genuinely empty preset used to have: every block there, every value set,
  // and the guitar never reaching the first of them.
  const noIn = silenceFaults({
    blocks: [
      { slug: 'drive', name: 'Drive 1', effectId: 100, col: 0, fromRows: [] },
      { slug: 'amp', name: 'Amp 1', effectId: 106, col: 1, fromRows: [1] },
      { slug: 'output', name: 'Out 1', effectId: 2, col: 2, fromRows: [1] }
    ]
  })
  assert.equal(noIn.length, 1)
  assert.match(noIn[0], /no Input block/i)

  // A unit with no grid takes its signal in some other way; a four-slot block
  // list with no Input in it is not a broken preset.
  assert.deepEqual(
    silenceFaults({
      blocks: [
        { slug: 'amp', name: 'Amp 1', effectId: 106 },
        { slug: 'output', name: 'Out 1', effectId: 2 }
      ]
    }),
    []
  )

  // A block nothing is wired into. The leftmost is fed by the input, not by a
  // row, so it is never accused; a driver that reports no rows at all is not
  // either.
  const orphan = silenceFaults({
    blocks: [
      { slug: 'input', name: 'Input 1', effectId: 37, col: 0, fromRows: [] },
      { slug: 'amp', name: 'Amp 1', effectId: 106, col: 1, fromRows: [1] },
      { slug: 'cab', name: 'Cab 1', effectId: 111, col: 2, fromRows: [] },
      { slug: 'output', name: 'Out 1', effectId: 2, col: 3, fromRows: [1] }
    ]
  })
  assert.equal(orphan.length, 1)
  assert.match(orphan[0], /Cab 1/)
  assert.ok(!/Amp 1/.test(orphan[0]), 'the first block in the row is accused of having nothing before it')
  assert.deepEqual(
    silenceFaults({
      blocks: [
        { slug: 'input', name: 'Input 1', effectId: 37, col: 0 },
        { slug: 'amp', name: 'Amp 1', effectId: 106, col: 1 },
        { slug: 'output', name: 'Out 1', effectId: 2, col: 2 }
      ]
    }),
    [],
    'a unit that does not report its wiring is told it has none'
  )

  // Everything off in this scene, said with the scene's own name.
  const off = silenceFaults({
    blocks: [
      { slug: 'input', name: 'Input 1', effectId: 37, col: 0, fromRows: [] },
      { slug: 'amp', name: 'Amp 1', effectId: 106, col: 1, fromRows: [1], bypassed: true },
      { slug: 'cab', name: 'Cab 1', effectId: 111, col: 2, fromRows: [1], bypassed: true },
      { slug: 'output', name: 'Out 1', effectId: 2, col: 3, fromRows: [1] }
    ],
    sceneName: 'KILLING'
  })
  assert.equal(off.length, 1)
  assert.match(off[0], /Every block is off in KILLING/)

  // A level sitting on its floor — a preset that is perfect and inaudible.
  const down = silenceFaults({
    blocks: [
      { slug: 'input', name: 'Input 1', effectId: 37, col: 0, fromRows: [] },
      { slug: 'amp', name: 'Amp 1', effectId: 106, col: 1, fromRows: [1] },
      { slug: 'output', name: 'Out 1', effectId: 2, col: 2, fromRows: [1] }
    ],
    params: {
      2: [{ id: 1, name: 'Level', value: -80, min: -80, max: 20, unit: 'dB' }],
      106: [{ id: 2, name: 'Gain 1', value: 0, min: 0, max: 10 }]
    }
  })
  assert.equal(down.length, 1, 'a gain at zero is not silence and a level at -80 is')
  assert.match(down[0], /Out 1 — Level is all the way down at -80dB/)

  assert.equal(atMinimum({ value: -80, min: -80, max: 20 }), true)
  assert.equal(atMinimum({ value: -79, min: -80, max: 20 }), false)
  assert.equal(atMinimum({ value: 5, min: 5, max: 5 }), false, 'a range of nothing is a minimum of nothing')

  // And a preset with nothing wrong says so by saying nothing.
  assert.deepEqual(
    silenceFaults({
      blocks: [
        { slug: 'input', name: 'Input 1', effectId: 37, col: 0, fromRows: [] },
        { slug: 'amp', name: 'Amp 1', effectId: 106, col: 1, fromRows: [1] },
        { slug: 'output', name: 'Out 1', effectId: 2, col: 2, fromRows: [1] }
      ],
      params: { 2: [{ id: 1, name: 'Level', value: 0, min: -80, max: 20, unit: 'dB' }] }
    }),
    []
  )
})

test('the report carries the grid in the unit\'s own words', async () => {
  const { formatPresetReport } = await import('../src/lib/presetReport.js')
  const text = formatPresetReport({
    header: { app: 'test' },
    preset: { number: 492, name: 'RATM Morello Rig' },
    sceneIndex: 0,
    sceneName: 'KILLING',
    blocks: [{ slug: 'amp', name: 'Amp 1', effectId: 106, row: 1, col: 0, channel: 'D', fromRows: [] }],
    params: { 106: [{ id: 2, name: 'Gain 1', value: 8.5, min: 0, max: 10 }] },
    grid: { rows: 4, cols: 12, cells: [{ row: 1, col: 0, effectId: 106 }] },
    faults: ['There is no Output block in this preset.']
  })
  assert.match(text, /preset: 492 RATM Morello Rig/)
  assert.match(text, /scene: 1 KILLING/)
  assert.match(text, /- There is no Output block/)
  assert.match(text, /Amp 1 \| row 1 col 0 \| on \| D \| nothing/, 'the blocks table lost where a block is or what feeds it')
  assert.match(text, /Amp 1 \| Gain 1 \| 8\.5 \| 0–10/, 'the values table lost a value or its range')
  // Raw, not paraphrased: the shape of this is the thing being investigated.
  assert.match(text, /\{"rows":4,"cols":12/, 'the grid is summarised instead of quoted')
  // And a preset with nothing wrong still says that out loud.
  assert.match(
    formatPresetReport({ blocks: [], faults: [] }),
    /Nothing this read can see/
  )
})

console.log('\nsetlists that follow the account')

test('two devices merge per setlist and per star, not per device', async () => {
  const { mergeUnit, mergeUnits, gained } = await import('../src/lib/cloudSetlists.js')

  // A list built on each device: both survive meeting each other. The device
  // asking keeps its own order and the other's are appended.
  const mine = { lists: [{ id: 'a', name: 'Friday', presets: [1, 2], at: 100 }], at: 100 }
  const theirs = { lists: [{ id: 'b', name: 'Saturday', presets: [7], at: 90 }], at: 90 }
  const both = mergeUnit(mine, theirs)
  assert.deepEqual(both.lists.map((l) => l.id), ['a', 'b'], 'a setlist built on the other device was dropped')

  // The same list edited on both: the later edit wins, whole.
  const edited = mergeUnit(
    { lists: [{ id: 'a', name: 'Friday', presets: [1], at: 100 }] },
    { lists: [{ id: 'a', name: 'Friday night', presets: [1, 2, 3], at: 200 }] }
  )
  assert.deepEqual(edited.lists[0].presets, [1, 2, 3])
  assert.equal(edited.lists[0].name, 'Friday night')

  /* A delete travels, and does not resurrect. Real times, because a tombstone
     is kept for sixty days and then dropped — see TOMBSTONE_MS. */
  const now = Date.now()
  const deleted = mergeUnit(
    { lists: [], removed: [{ id: 'a', at: now - 1000 }] },
    { lists: [{ id: 'a', name: 'Friday', presets: [1], at: now - 2000 }] }
  )
  assert.deepEqual(deleted.lists, [], 'a setlist deleted here came back from the account')
  assert.equal(deleted.removed.length, 1, 'the delete was forgotten immediately')

  // Unless it was edited on the other device AFTER the delete: then it is a
  // list somebody is using, not a list somebody threw away.
  const revived = mergeUnit(
    { lists: [], removed: [{ id: 'a', at: now - 2000 }] },
    { lists: [{ id: 'a', name: 'Friday', presets: [1], at: now - 1000 }] }
  )
  assert.equal(revived.lists.length, 1, 'an edit made after the delete was thrown away')

  // A delete nobody has thought about in months stops being carried, and stops
  // holding a setlist off a device that still has it.
  const old = mergeUnit(
    { lists: [], removed: [{ id: 'a', at: now - 61 * 24 * 60 * 60 * 1000 }] },
    { lists: [{ id: 'a', name: 'Friday', presets: [1], at: now - 62 * 24 * 60 * 60 * 1000 }] },
    now
  )
  assert.deepEqual(old.removed, [], 'a two-month-old delete is still being carried')

  // Stars are a toggle, so the later tap wins whole — an unstar has to travel.
  const stars = mergeUnit(
    { favourites: [1, 2], starredAt: 500 },
    { favourites: [1, 2, 3], starredAt: 400 }
  )
  assert.deepEqual(stars.favourites, [1, 2], 'an unstar here was undone by the account')
  const later = mergeUnit(
    { favourites: [1, 2], starredAt: 400 },
    { favourites: [9], starredAt: 500 }
  )
  assert.deepEqual(later.favourites, [9])

  // Before either side has ever stamped a tap there is nothing to compare, and
  // both sets of stars should survive their first meeting.
  const first = mergeUnit({ favourites: [3, 1] }, { favourites: [2] })
  assert.deepEqual(first.favourites, [1, 2, 3], 'a first sync picked one device\'s stars by a coin toss')

  // The chosen source is a preference: the later choice.
  assert.equal(mergeUnit({ source: 'a', at: 10 }, { source: 'starred', at: 20 }).source, 'starred')
  assert.equal(mergeUnit({ source: 'a', at: 30 }, { source: 'starred', at: 20 }).source, 'a')

  // Units are merged one at a time and never mixed: an FM3's setlists are not
  // an AM4's.
  const units = mergeUnits(
    { fm3: { lists: [{ id: 'a', name: 'F', presets: [1], at: 1 }] } },
    { am4: { lists: [{ id: 'b', name: 'A', presets: [2], at: 1 }] } }
  )
  assert.deepEqual(Object.keys(units).sort(), ['am4', 'fm3'])
  assert.deepEqual(units.fm3.lists.map((l) => l.id), ['a'])
  assert.deepEqual(units.am4.lists.map((l) => l.id), ['b'])

  // And what arrived is countable, so the app can say what it picked up.
  assert.deepEqual(gained({ fm3: { lists: [], favourites: [] } }, units.fm3 ? { fm3: units.fm3 } : {}), {
    lists: 1,
    stars: 0
  })
})

test('a setlist knows when it changed, and a delete leaves a mark', async () => {
  const {
    createList,
    updateList,
    deleteList,
    listsFor,
    goneFor,
    unitFor,
    putUnit
  } = await import('../src/lib/setlists.js')

  // A Map is enough of a storage for this: getItem/setItem and nothing else.
  const store = {
    data: new Map(),
    getItem(k) { return this.data.has(k) ? this.data.get(k) : null },
    setItem(k, v) { this.data.set(k, v) }
  }

  const made = createList('fm3', 'Friday', store)
  assert.ok(made.at > 0, 'a new setlist carries no time, so a merge cannot place it')
  const before = listsFor('fm3', store)[0].at
  await new Promise((r) => setTimeout(r, 2))
  updateList('fm3', made.id, { presets: [4, 5] }, store)
  assert.ok(listsFor('fm3', store)[0].at > before, 'editing a setlist does not move its time')

  deleteList('fm3', made.id, store)
  assert.deepEqual(listsFor('fm3', store), [], 'the setlist is still there after a delete')
  assert.deepEqual(goneFor('fm3', store).map((g) => g.id), [made.id], 'the delete left no mark to travel')

  // And a merged copy can be written back without being re-stamped, or two
  // devices would keep handing the same lists back and forth for ever.
  const settled = { lists: [{ id: 'z', name: 'Sunday', presets: [1], at: 42 }], removed: [], source: 'all', at: 42 }
  putUnit('fm3', settled, store)
  assert.equal(unitFor('fm3', store).at, 42, 'writing a merged copy back stamped it as new work')
  assert.deepEqual(listsFor('fm3', store).map((l) => l.name), ['Sunday'])
})

console.log('\na tone with more scenes than the unit holds')

test('a tone made on the unit it is loaded onto is never asked about', async () => {
  const { scenesOverflowing } = await import('../src/lib/sceneFit.js')
  const fm3 = { scenes: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }] }
  assert.equal(scenesOverflowing(fm3, 8), 0, 'a four-scene tone on an eight-scene unit stops the load')
  assert.equal(scenesOverflowing(fm3, 4), 0, 'a four-scene tone on a four-scene unit stops the load')
  assert.equal(scenesOverflowing({ scenes: [] }, 4), 0, 'a tone with no scene plan stops the load')
  assert.equal(scenesOverflowing(null, 4), 0, 'a tone with no spec at all throws instead of answering')
})

test('an eight-scene tone on a four-scene unit is four scenes over', async () => {
  const { scenesOverflowing } = await import('../src/lib/sceneFit.js')
  const eight = { scenes: Array.from({ length: 8 }, (_, i) => ({ index: i })) }
  assert.equal(scenesOverflowing(eight, 4), 4)
})

test('the scenes picked are renumbered into the ones the unit has', async () => {
  const { fitScenes } = await import('../src/lib/sceneFit.js')
  /*
   * The case the whole thing exists for: a set laid out across an FM3, four of
   * which are wanted on an AM4 — and not the first four. Scene 6 has to arrive
   * as scene 2 or the footswitch under it plays nothing.
   */
  const spec = {
    presetName: 'Black Album Rig',
    blocks: [{ eid: 106 }],
    scenes: [
      { index: 0, name: 'Clean', engaged: [106] },
      { index: 2, name: 'Verse', engaged: [106] },
      { index: 5, name: 'Chorus', engaged: [106] },
      { index: 7, name: 'Solo', engaged: [106] }
    ]
  }
  const fit = fitScenes(spec, [0, 2, 5, 7], 4)
  assert.deepEqual(fit.spec.scenes.map((s) => s.index), [0, 1, 2, 3])
  assert.deepEqual(fit.spec.scenes.map((s) => s.name), ['Clean', 'Verse', 'Chorus', 'Solo'])
  assert.deepEqual(fit.spec.scenes[3].engaged, [106], 'the scene arrived without what it switches on')
  assert.deepEqual(fit.spec.blocks, spec.blocks, 'the blocks were touched — only the scenes did not fit')
  assert.equal(fit.dropped.length, 0)
  assert.deepEqual(fit.moved.map((m) => `${m.name}→${m.to + 1}`), ['Verse→2', 'Chorus→3', 'Solo→4'])
})

test('what was left behind is named, by its own name', async () => {
  const { fitScenes, describeFit } = await import('../src/lib/sceneFit.js')
  const spec = {
    scenes: [
      { index: 0, name: 'Clean' },
      { index: 1, name: 'Crunch' },
      { index: 2, name: 'Lead' },
      { index: 3, name: 'Ambient' },
      { index: 4, name: 'Outro' }
    ]
  }
  const fit = fitScenes(spec, [0, 1, 2, 3], 4)
  assert.deepEqual(fit.dropped, ['Outro'])
  assert.match(describeFit(fit, 4), /Kept 4 of 5 scenes/)
  assert.match(describeFit(fit, 4), /left behind Outro/)
  assert.match(describeFit(fit, 4), /This unit has 4\./)
})

test('a scene with no name of its own is still something you can point at', async () => {
  const { sceneLabel, sceneRows } = await import('../src/lib/sceneFit.js')
  const rows = sceneRows({ scenes: [{ index: 3 }] })
  assert.equal(sceneLabel(rows[0]), 'Scene 4', 'an unnamed scene reads as undefined in the picker')
})

test('picking more than the unit holds cannot be smuggled past the fit', async () => {
  const { fitScenes } = await import('../src/lib/sceneFit.js')
  const spec = { scenes: Array.from({ length: 8 }, (_, i) => ({ index: i, name: `S${i + 1}` })) }
  const fit = fitScenes(spec, [0, 1, 2, 3, 4, 5], 4)
  assert.equal(fit.spec.scenes.length, 4, 'six scenes went to a unit with four')
  assert.deepEqual(fit.dropped, ['S5', 'S6', 'S7', 'S8'])
})

test('the sound with no scene plan at all is a real answer', async () => {
  const { fitScenes } = await import('../src/lib/sceneFit.js')
  /* "Load the sound only" — every block and every setting, no scenes written.
     The spec still has to be a spec, not a spec missing its scenes key. */
  const spec = { blocks: [{ eid: 106 }], scenes: [{ index: 0, name: 'Clean' }] }
  const fit = fitScenes(spec, [], 4)
  assert.deepEqual(fit.spec.scenes, [])
  assert.deepEqual(fit.spec.blocks, spec.blocks)
  assert.deepEqual(fit.dropped, ['Clean'])
})

test('the picker opens on the ones that already fit', async () => {
  const { defaultKeep } = await import('../src/lib/sceneFit.js')
  const spec = { scenes: Array.from({ length: 8 }, (_, i) => ({ index: i })) }
  assert.deepEqual(defaultKeep(spec, 4), [0, 1, 2, 3])
  assert.deepEqual(defaultKeep(spec, 8), [0, 1, 2, 3, 4, 5, 6, 7])
})

test('a spec that lists its scenes out of order still fits in playing order', async () => {
  const { fitScenes, defaultKeep } = await import('../src/lib/sceneFit.js')
  const spec = {
    scenes: [
      { index: 5, name: 'Solo' },
      { index: 0, name: 'Clean' },
      { index: 2, name: 'Verse' }
    ]
  }
  assert.deepEqual(defaultKeep(spec, 4), [0, 2, 5], 'the picker offers them in the order the spec happened to write them')
  const fit = fitScenes(spec, [0, 2, 5], 4)
  assert.deepEqual(fit.spec.scenes.map((s) => s.name), ['Clean', 'Verse', 'Solo'])
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
