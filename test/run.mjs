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
import { validateSpec, countWrites } from '../src/lib/validate.js'
import { preferredEncoding, rememberEncoding, disambiguate } from '../src/lib/encoding.js'
import { forbiddenRemotely } from '../src/lib/remote.js'
import {
  patchSchemaValue,
  invalidateSchema,
  resetSchemaCache,
  seedSchemaCache,
  cachedSchema
} from '../src/lib/schemaCache.js'

let passed = 0
const test = (name, fn) => {
  try {
    fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

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

test('counts writes including model and bypass', () => {
  const r = validateSpec(
    { blocks: [{ eid: 58, type: 82, bypassed: true, params: [{ id: 7, value: 7 }] }] },
    schema
  )
  assert.equal(countWrites(r.changes), 3)
})



console.log('suggestions')

const { suggest, totalSuggestions } = await import('../src/lib/suggestions.js')

test('returns the requested number', () => assert.equal(suggest(4).length, 4))

test('returns a spread, not four of the same thing', () => {
  const picks = suggest(4)
  assert.equal(new Set(picks).size, 4)
})

test('avoids what has already been seen', () => {
  const first = suggest(4)
  const second = suggest(4, new Set(first))
  const overlap = second.filter((s) => first.includes(s))
  assert.equal(overlap.length, 0, `repeated: ${overlap.join(', ')}`)
})

test('has a pool worth shuffling', () => assert.ok(totalSuggestions >= 30))



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
  // Mirrors ForgeFX's own allowlist so the app can explain itself rather than
  // relaying a bare 403 mid-song.
  assert.ok(forbiddenRemotely('POST', '/preset/store'))
  assert.ok(forbiddenRemotely('POST', '/preset/backup'))
  assert.ok(forbiddenRemotely('GET', '/local/presets'))
  assert.ok(forbiddenRemotely('POST', '/ports/select'))
})

test('live performance edits travel fine', () => {
  assert.equal(forbiddenRemotely('PUT', '/preset/blocks/58/params/17'), null)
  assert.equal(forbiddenRemotely('POST', '/scene'), null)
  assert.equal(forbiddenRemotely('POST', '/tempo'), null)
  assert.equal(forbiddenRemotely('POST', '/preset/select'), null)
  // Trailing slashes and query strings must not sneak past the check.
  assert.ok(forbiddenRemotely('POST', '/preset/store/'))
  assert.ok(forbiddenRemotely('GET', '/local/presets?refresh=1'))
})

console.log(`\n${passed} passed\n`)
