/**
 * Nothing generated reaches the hardware without passing through here.
 *
 * The model is told the rules, but "told" isn't "guaranteed". Every id is checked
 * against what the device actually reported, and every value against that
 * parameter's own range. Anything that fails is dropped and reported, not sent.
 */

import { isSilencingParam } from './guardrails.js'

export function validateSpec(spec, schema) {
  const problems = []
  const changes = []

  if (!spec || typeof spec !== 'object') {
    return { changes, problems: ['The generator returned nothing usable.'], presetName: '', summary: '' }
  }

  const blocksByEid = new Map(schema.map((b) => [b.eid, b]))

  for (const block of spec.blocks || []) {
    const known = blocksByEid.get(block.eid)

    if (!known) {
      problems.push(`Skipped effect ${block.eid} — no such block in this preset.`)
      continue
    }

    const change = {
      eid: known.eid,
      name: known.name,
      slug: known.slug,
      wasBypassed: known.bypassed,
      params: []
    }

    // model swap
    if (block.type !== undefined && block.type !== null) {
      const model = (known.models || []).find((m) => m.value === block.type)
      if (!model) {
        problems.push(`${known.name}: model ${block.type} isn't in this unit's list — left unchanged.`)
      } else {
        change.type = model.value
        change.typeName = model.name
        change.typeBasedOn = model.basedOn || null
      }
    }

    // bypass
    if (typeof block.bypassed === 'boolean' && block.bypassed !== known.bypassed) {
      change.bypassed = block.bypassed
    }

    // parameters
    for (const param of block.params || []) {
      const known_param = (known.params || []).find((p) => p.id === param.id)

      if (!known_param) {
        problems.push(`${known.name}: no parameter ${param.id} — skipped.`)
        continue
      }
      // Backstop. These are stripped before the generator ever sees them, but a
      // silent preset is bad enough to be worth checking twice.
      if (isSilencingParam(known_param.name)) {
        problems.push(`${known.name} / ${known_param.name}: output level is yours to set — skipped.`)
        continue
      }
      if (typeof param.value !== 'number' || Number.isNaN(param.value)) {
        problems.push(`${known.name} / ${known_param.name}: value wasn't a number — skipped.`)
        continue
      }

      const { min, max } = known_param
      if (typeof min === 'number' && typeof max === 'number' && (param.value < min || param.value > max)) {
        problems.push(
          `${known.name} / ${known_param.name}: ${param.value} is outside ${min}–${max} — skipped.`
        )
        continue
      }

      change.params.push({
        id: known_param.id,
        name: known_param.name,
        from: known_param.value,
        to: param.value,
        unit: known_param.unit || '',
        // carried through to the write, which needs the range to normalise
        range: { min: known_param.min, max: known_param.max, log: known_param.log }
      })
    }

    const touchesSomething =
      change.type !== undefined || change.bypassed !== undefined || change.params.length > 0

    if (touchesSomething) changes.push(change)
  }

  return {
    usage: spec._usage || null,
    presetName: sanitizeName(spec.presetName),
    summary: typeof spec.summary === 'string' ? spec.summary : '',
    notes: typeof spec.notes === 'string' ? spec.notes : '',
    changes,
    problems
  }
}

/**
 * Clean a generated preset name.
 *
 * Fractal preset names run to 31 characters and are mixed case — the units ship
 * with "Leon's Live AM4" and the like. An earlier 12-character uppercase limit
 * was taken from how the AM4's small display renders them, which is a display
 * convention rather than a constraint, and it mangled anything longer than two
 * words.
 */
function sanitizeName(name) {
  if (typeof name !== 'string') return ''
  return name.replace(/[^\w \-'&.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 31)
}

/** How many individual hardware writes a validated spec will cost. */
export function countWrites(changes) {
  return changes.reduce(
    (n, c) => n + c.params.length + (c.type !== undefined ? 1 : 0) + (c.bypassed !== undefined ? 1 : 0),
    0
  )
}
