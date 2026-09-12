/**
 * Reading a half-built tone as it arrives.
 *
 * Apart from the component that draws it, because the test runner can import a
 * .js file and not a .jsx one — and this is the half worth testing.
 */

/** An effect id as the preset names it, or the unit's own word for it. */
export function blockName(eid, nameOf) {
  if (eid === undefined || eid === null) return '…'
  return nameOf?.(eid) || `eid ${eid}`
}

/**
 * What the model is doing right now, in a player's words.
 *
 * "Could it say which song it's creating that off of while it's doing it, or
 * something like that — just a little bit more information on what's happening,
 * like choosing an amp or deciding on delay."
 *
 * All of that is already in the stream and was being thrown away: the line said
 * "Building your chain — 4 blocks so far" while the answer arriving named the
 * amp model, the control being set and the scene being voiced. The fields come
 * out in the order the schema declares them — name, summary, blocks, scenes —
 * so the newest thing in the partial is the thing being decided, and that is
 * what this reads.
 *
 * Nothing here guesses. With an empty partial it returns null and the caller
 * keeps saying Thinking, which is the one honest thing to say before the model
 * has written a word.
 */
export function progressFor(partial, nameOf = null) {
  if (!partial) return null

  const scenes = (partial.scenes || []).filter(Boolean)
  if (scenes.length) {
    const last = scenes[scenes.length - 1]
    const number = (last?.index ?? scenes.length - 1) + 1
    /* The scene's name is the song, on a build like the one this was asked
       for — so it is said as it is, not translated into "scene 3". */
    return last?.name ? `Writing scene ${number} — ${last.name}` : `Writing scene ${number}`
  }

  const blocks = (partial.blocks || []).filter(Boolean)
  if (blocks.length) {
    const last = blocks[blocks.length - 1]
    const who = blockName(last?.eid, nameOf)
    if (last?.typeName) return `Choosing ${who} — ${last.typeName}`
    const params = (last.params || []).filter(Boolean)
    const newest = params[params.length - 1]
    if (newest?.name) return `Dialling ${who} — ${newest.name}`
    return `Dialling ${who}`
  }

  if (partial.summary) return 'Working out the chain…'
  if (partial.presetName) return `Naming it — ${partial.presetName}`
  return null
}

/**
 * Everything the model has decided so far, one line each, in the order it
 * decided them.
 *
 * progressFor above says the newest thing and replaces itself as the next one
 * lands, so a two-minute build reads as one line that keeps changing. "I like
 * how it shows it's writing each scene when it does it instead of just saying
 * writing" — the other app keeps every line: DEL off, REV on, Voice A · heavy,
 * then Writing scene 1 SCHISM · what it is and why, scene 2, scene 3, down the
 * screen as they happen. The record of the build is the reassurance, and a
 * line that vanishes is a record nobody can read.
 *
 * So this returns the whole list, from the same partial, and the component
 * draws it under the Thinking line while the run is live. A block is one line
 * that fills in as its fields arrive — its model, then off, then the controls
 * being set — so the list grows by lines, not by rewrites. A scene is the
 * line the other app has: its number, its name in capitals, and the one
 * sentence the designer wrote about it.
 *
 * Nothing here guesses either: a field that has not arrived is not said.
 */
export function stepsFor(partial, nameOf = null) {
  if (!partial) return []
  const steps = []

  if (partial.presetName) steps.push({ key: 'name', text: `Naming it — ${partial.presetName}` })

  for (const [i, block] of (partial.blocks || []).entries()) {
    if (!block) continue
    const who = blockName(block.eid, nameOf)
    const parts = [who]
    if (block.typeName) parts.push(block.typeName)
    if (block.bypassed === true) parts.push('off')
    else if (block.bypassed === false) parts.push('on')
    const params = (block.params || []).filter((p) => p?.name)
    if (params.length) parts.push(params.map((p) => p.name).join(', '))
    steps.push({ key: `block-${block.eid ?? i}`, text: parts.join(' · ') })
  }

  for (const [i, scene] of (partial.scenes || []).entries()) {
    if (!scene) continue
    const number = (scene.index ?? i) + 1
    const name = scene.name ? String(scene.name).toUpperCase() : ''
    const why = scene.why ? String(scene.why).trim() : ''
    steps.push({
      key: `scene-${scene.index ?? i}`,
      text: `Writing scene ${number}${name ? ` ${name}` : ''}${why ? ` · ${why}` : ''}`
    })
  }

  return steps
}
