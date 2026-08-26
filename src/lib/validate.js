/**
 * Nothing generated reaches the hardware without passing through here.
 *
 * The model is told the rules, but "told" isn't "guaranteed". Every id is checked
 * against what the device actually reported, and every value against that
 * parameter's own range. Anything that fails is dropped and reported, not sent.
 */

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
        unit: known_param.unit || ''
      })
    }

    const touchesSomething =
      change.type !== undefined || change.bypassed !== undefined || change.params.length > 0

    if (touchesSomething) changes.push(change)
  }

  return {
    presetName: sanitizeName(spec.presetName),
    summary: typeof spec.summary === 'string' ? spec.summary : '',
    notes: typeof spec.notes === 'string' ? spec.notes : '',
    changes,
    problems
  }
}

/** Fractal preset names are short and uppercase on the hardware display. */
function sanitizeName(name) {
  if (typeof name !== 'string') return ''
  return name.replace(/[^\w \-']/g, '').trim().slice(0, 12).toUpperCase()
}

/** How many individual hardware writes a validated spec will cost. */
export function countWrites(changes) {
  return changes.reduce(
    (n, c) => n + c.params.length + (c.type !== undefined ? 1 : 0) + (c.bypassed !== undefined ? 1 : 0),
    0
  )
}
