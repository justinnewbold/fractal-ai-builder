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
    return last?.name ? `Scene ${number} — ${last.name}` : `Laying out scene ${number}`
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
