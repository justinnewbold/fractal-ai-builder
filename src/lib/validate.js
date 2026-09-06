/**
 * Nothing generated reaches the hardware without passing through here.
 *
 * The model is told the rules, but "told" isn't "guaranteed". Every id is checked
 * against what the device actually reported, and every value against that
 * parameter's own range. Anything that fails is dropped and reported, not sent.
 */

import { isForbiddenParam, levelLimits, matchParam } from './guardrails.js'

export function validateSpec(spec, schema, sceneCount = 8, channelNames = ['A', 'B', 'C', 'D']) {
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
      wanted: [],
      presetName: '',
      summary: ''
    }
  }

  const blocksByEid = new Map(schema.map((b) => [b.eid, b]))
  // When a lookup misses, the id the spec used is only half the story — what
  // ids the preset actually holds is the half that names the mismatch. A run
  // where every change was skipped and this line was absent cost a full
  // hardware round trip to learn four numbers.
  const inventory = () =>
    schema.length
      ? `This preset has: ${schema.map((b) => `${b.name || b.slug} (${b.eid})`).join(', ')}.`
      : 'This preset reports no blocks at all.'

  /*
   * Said once, however many there are.
   *
   * On an empty preset every id is wrong, so this used to print the same
   * sentence per rejected change — six of them, identical but for a number,
   * under a heading that made the run look like a catastrophe rather than a
   * preset with nothing in it yet. The reader learns nothing from the second
   * copy that the first did not tell them.
   *
   * The count stays, because "six changes were dropped" is the part that says
   * how much of the answer went missing.
   */
  const missing = (spec.blocks || []).map((b) => b.eid).filter((eid) => !blocksByEid.has(eid))
  if (missing.length) {
    const ids = [...new Set(missing)]
    problems.push(
      schema.length
        ? `${missing.length === 1 ? 'One change was' : `${missing.length} changes were`} dropped: ` +
          `effect ${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} not in this preset. ${inventory()}`
        : `This preset is empty, so all ${missing.length} changes were dropped — there is nothing in it to set yet.`
    )
    problems.push(
      schema.length
        ? 'If the tone needs a block the chain doesn\u2019t have, say "add a reverb" (or whichever block) and it will be placed in a free slot first.'
        : 'Say "add an amp and a cab" (or whichever blocks) to place them first, then ask for the tone.'
    )
  }

  for (const block of spec.blocks || []) {
    const known = blocksByEid.get(block.eid)

    // Already reported above, once, with a count.
    if (!known) continue

    const change = {
      eid: known.eid,
      name: known.name,
      slug: known.slug,
      wasBypassed: known.bypassed,
      params: []
    }

    /*
     * Which channel these values belong to.
     *
     * A block's values live on its channel, not on the block, so "the lead
     * amp" is the amp block written on a second channel — and the write has to
     * select that channel before it sets anything, or the lead settings land
     * on top of the rhythm ones. A block the unit reports no channel for has
     * none, and a letter it does not offer is dropped rather than sent.
     */
    if (block.channel !== undefined && block.channel !== null && block.channel !== '') {
      const wanted = String(block.channel).trim().toUpperCase()
      if (!known.channel) {
        problems.push(`${known.name}: this block has no channels — the channel was ignored.`)
      } else if (!channelNames.includes(wanted)) {
        problems.push(`${known.name}: no channel "${block.channel}" on this unit — ignored.`)
      } else {
        change.channel = wanted
      }
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
      // Backstop. Routing and muting are stripped before the generator sees
      // them; a preset that arrives hard-panned or muted is worth checking
      // twice for.
      if (isForbiddenParam(known_param.name)) {
        problems.push(`${known.name} / ${known_param.name}: that one is yours to set — skipped.`)
        continue
      }
      if (typeof param.value !== 'number' || Number.isNaN(param.value)) {
        problems.push(`${known.name} / ${known_param.name}: value wasn't a number — skipped.`)
        continue
      }
      /*
       * A level may be nudged, not reset. The cap is what keeps a generation
       * that is otherwise musically right from setting a block to -60 dB and
       * handing back a preset that looks perfect and makes no sound.
       */
      const window = levelLimits(known_param)
      if (window && (param.value < window.floor || param.value > window.ceiling)) {
        problems.push(
          `${known.name} / ${known_param.name}: levels can be nudged, not reset — ` +
            `${param.value} is outside ${Math.round(window.floor * 10) / 10} to ` +
            `${Math.round(window.ceiling * 10) / 10}, so it was skipped.`
        )
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
      change.type !== undefined ||
      change.bypassed !== undefined ||
      change.channel !== undefined ||
      change.params.length > 0

    if (touchesSomething) changes.push(change)
  }

  return {
    usage: spec._usage || null,
    presetName: sanitizeName(spec.presetName),
    summary: typeof spec.summary === 'string' ? spec.summary : '',
    notes: typeof spec.notes === 'string' ? spec.notes : '',
    changes,
    /*
     * Blocks the tone wanted and this preset does not have.
     *
     * Not a rejection — nothing was dropped for it, and it must not be shown
     * among the losses. It is the model saying what it could not reach, which
     * on a four-slot unit is the difference between "the tone missed" and "the
     * tone missed because this preset has no delay in it".
     */
    wanted: wantedBlocks(spec.wanted),
    scenes: validateScenes(spec.scenes, schema, problems, sceneCount, channelNames),
    problems,
    repairs
  }
}

/**
 * Names only, tidied, and deduplicated.
 *
 * Free text from a generator, rendered on a screen: capped in count and in
 * length so a runaway answer cannot turn into a wall of prose, and stripped of
 * anything that isn't a block name.
 */
function wantedBlocks(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  for (const item of list) {
    if (typeof item !== 'string') continue
    const clean = item.replace(/[^\w \-/]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24)
    if (clean) seen.add(clean.toLowerCase())
    if (seen.size >= 6) break
  }
  return [...seen]
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
function validateScenes(scenes, schema, problems, sceneCount = 8, channelNames = ['A', 'B', 'C', 'D']) {
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

    /*
     * The other half of a scene. A channel named for a block that has none, or
     * a letter the unit does not offer, is dropped here — the alternative is a
     * write the device ignores and a scene that quietly isn't what was
     * described.
     */
    const channelFor = new Map()
    for (const entry of Array.isArray(scene.channels) ? scene.channels : []) {
      const block = byEid.get(Number(entry?.eid))
      const wanted = String(entry?.channel || '').trim().toUpperCase()
      if (!block || !wanted) continue
      if (!block.channel) {
        problems.push(`Scene ${index + 1}: ${block.name || block.slug} has no channels — ignored.`)
        continue
      }
      if (!channelNames.includes(wanted)) {
        problems.push(`Scene ${index + 1}: no channel "${entry.channel}" on this unit — ignored.`)
        continue
      }
      channelFor.set(block.eid, wanted)
    }

    /*
     * A scene written without a name keeps the name it had, which on a preset
     * somebody else laid out is a scene called "Lead" that is no longer the
     * lead. Say so rather than leaving it to be discovered on stage.
     */
    const name = sanitizeSceneName(scene.name)
    if (!name) {
      problems.push(
        `Scene ${index + 1} came back with no name, so it keeps the one it has.`
      )
    }

    out.push({
      index,
      name,
      blocks: placed.map((eid) => ({
        eid,
        name: byEid.get(eid)?.name || byEid.get(eid)?.slug || `#${eid}`,
        bypassed: !engaged.has(eid),
        ...(channelFor.has(eid) ? { channel: channelFor.get(eid) } : {})
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

/**
 * How many hardware writes a scene plan costs: a switch into the scene, then a
 * bypass for every block, and a channel for each block the scene moves.
 */
export function countSceneWrites(scenes) {
  return (scenes || []).reduce(
    (n, s) => n + 1 + s.blocks.length + s.blocks.filter((b) => b.channel).length,
    0
  )
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
    (n, c) =>
      n +
      c.params.length +
      (c.channel !== undefined ? 1 : 0) +
      (c.type !== undefined ? 1 : 0) +
      (c.bypassed !== undefined ? 1 : 0),
    0
  )
}
