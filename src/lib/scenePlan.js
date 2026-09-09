/**
 * What a scene's channel line says.
 *
 * The plan listed "Amp 1 on channel C" under a lead scene and nothing more,
 * and three scenes on channels A, B and C looked like the same amp three
 * times. "Does the AI check and replace different amps based on what it finds
 * out about the artist, or is it just copying the amps and changing the
 * settings?" It does pick — each channel carries its own model, and the plan
 * already holds which model went on which channel — but the row never said
 * so. This is the sentence that says so.
 */

/** The model the plan puts on this block's channel, or null if it writes none there. */
export function modelOnChannel(changes, eid, channel) {
  const want = String(channel || '').trim().toUpperCase()
  if (!want) return null
  const hit = (changes || []).find(
    (c) => c && c.eid === eid && c.typeName && String(c.channel || '').trim().toUpperCase() === want
  )
  if (!hit) return null
  return { name: hit.typeName, basedOn: hit.typeBasedOn || null }
}

/**
 * "Amp 1 on channel C · USA Lead+ (Mesa Mark IIC+)" — or just the channel
 * when the plan leaves whatever model is already there.
 */
export function channelLine(block, changes) {
  const base = `${block.name} on channel ${block.channel}`
  const model = modelOnChannel(changes, block.eid, block.channel)
  if (!model) return base
  return model.basedOn ? `${base} · ${model.name} (${model.basedOn})` : `${base} · ${model.name}`
}
