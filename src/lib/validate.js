/**
 * Nothing generated reaches the hardware without passing through here.
 *
 * The model is told the rules, but "told" isn't "guaranteed". Every id is checked
 * against what the device actually reported, and every value against that
 * parameter's own range. Anything that fails is dropped and reported, not sent.
 */

import { isSilencingParam, matchParam } from './guardrails.js'

export function validateSpec(spec, schema, sceneCount = 8) {
  const problems = []
  // Not rejections: changes that were kept after being matched to the control
  // the model named rather than the id it gave. Shown separately, because a
  // correction listed under "rejected" reads as a loss.
  const repairs = []
  const changes = []

  if (!spec || typeof spec !== 'object') {
    return {
      changes,
      scenes: [],
      problems: ['The generator returned nothing usable.'],
      repairs,
      presetName: '',
      summary: ''
    }
  }

  const blocksByEid = new Map(schema.map((b) => [b.eid, b]))
  let hinted = false
  // When a lookup misses, the id the spec used is only half the story — what
  // ids the preset actually holds is the half that names the mismatch. A run
  // where every change was skipped and this line was absent cost a full
  // hardware round trip to learn four numbers.
  const inventory = () =>
    schema.length
      ? `This preset has: ${schema.map((b) => `${b.name || b.slug} (${b.eid})`).join(', ')}.`
      : 'This preset reports no blocks at all.'

  for (const block of spec.blocks || []) {
    const known = blocksByEid.get(block.eid)

    if (!known) {
      problems.push(`Skipped effect ${block.eid} — no such block in this preset. ${inventory()}`)
      if (!hinted) {
        hinted = true
        problems.push(
          'If the tone needs a block the chain doesn\u2019t have, say "add a reverb" (or whichever block) and it will be placed in a free slot first.'
        )
      }
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
      const { param: known_param, note } = matchParam(known.params, param)

      if (!known_param) {
        problems.push(
          `${known.name}: no parameter ${param.id}${
            param.name ? ` and nothing called "${param.name}"` : ''
          } — skipped.`
        )
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

      if (note) repairs.push(`${known.name} / ${known_param.name}: ${note} — matched by name.`)

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
    scenes: validateScenes(spec.scenes, schema, problems, sceneCount),
    problems,
    repairs
  }
}

/**
 * A scene plan, checked the same way the blocks are.
 *
 * Scenes are cheap to get wrong in ways that are expensive to hear: a scene
 * that forgets the amp is a silent scene, and a scene index past the end of
 * the unit's list writes over something else or fails halfway through eight
 * round trips. Both are caught here rather than at the serial port.
 *
 * Returns the plan as explicit per-block bypass, because "engaged" is a list
 * of what is on and the hardware is told what is off — the inversion is the
 * part worth doing once, here, rather than at every call site.
 */
function validateScenes(scenes, schema, problems, sceneCount = 8) {
  if (!Array.isArray(scenes) || !scenes.length) return []
  const placed = schema.map((b) => b.eid)
  const known = new Set(placed)
  const byEid = new Map(schema.map((b) => [b.eid, b]))
  const out = []
  const seen = new Set()

  for (const scene of scenes) {
    const index = Number(scene?.index)
    if (!Number.isInteger(index) || index < 0 || index >= sceneCount) {
      problems.push(`Scene ${scene?.name || index} is outside this unit's ${sceneCount} scenes.`)
      continue
    }
    if (seen.has(index)) {
      problems.push(`Scene ${index + 1} was described twice; the second was dropped.`)
      continue
    }
    seen.add(index)

    const engaged = new Set(
      (Array.isArray(scene.engaged) ? scene.engaged : []).filter((eid) => known.has(eid))
    )
    /*
     * A scene with no amp is a scene with no sound. The model is told this in
     * the prompt and can still forget it on the eighth scene of a long reply,
     * and the failure is silent until someone stands on the footswitch mid-set
     * — so the amp and cab are put back rather than reported.
     */
    const repaired = []
    for (const eid of placed) {
      const slug = byEid.get(eid)?.slug
      if ((slug === 'amp' || slug === 'cab') && !engaged.has(eid)) {
        engaged.add(eid)
        repaired.push(byEid.get(eid)?.name || slug)
      }
    }
    if (repaired.length) {
      problems.push(
        `Scene ${index + 1} left ${repaired.join(' and ')} off, which would have silenced it — switched back on.`
      )
    }

    out.push({
      index,
      name: sanitizeSceneName(scene.name),
      blocks: placed.map((eid) => ({
        eid,
        name: byEid.get(eid)?.name || byEid.get(eid)?.slug || `#${eid}`,
        bypassed: !engaged.has(eid)
      }))
    })
  }

  return out.sort((a, b) => a.index - b.index)
}

/** Scene names are short on the unit's own display. */
function sanitizeSceneName(name) {
  if (typeof name !== 'string') return ''
  return name.replace(/[^\w \-'&.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16)
}

/** How many hardware writes a scene plan costs: a switch, then a bypass each. */
export function countSceneWrites(scenes) {
  return (scenes || []).reduce((n, s) => n + 1 + s.blocks.length, 0)
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
