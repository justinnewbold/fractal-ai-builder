/**
 * What a scene actually stores, per block: whether it is on, and which channel
 * it is using.
 *
 * Both halves matter, and for a long time this file only had the first. A
 * scene is not merely a pattern of what is switched on — each block also
 * remembers which of its channels (A to D) that scene plays, and a channel
 * holds its own model and its own values. That is why a lead scene can have a
 * genuinely hotter amp rather than the rhythm amp with a boost in front of it.
 *
 * The app's own device layer has said this all along ("bypass and channel are
 * per-scene on this hardware — that IS what a scene is", forgefx.js), while the
 * tour, the designer's instructions and the simulated unit all said the
 * opposite. This is the piece that lets the demo tell the truth.
 *
 * Pure, so node can test it. The mock owns one of these and asks it every time
 * it answers for the chain, the meters, a summary or a scene map, so they all
 * agree by construction rather than by luck.
 */
export function createSceneState({ count = 8, seeds = {}, channels = {} } = {}) {
  const off = Array.from({ length: count }, (_, i) => new Set(seeds[i] || seeds.default || []))
  // Which channel each block plays in each scene. Empty means "the one it was
  // placed on" — the caller supplies that default, because only it knows.
  const chan = Array.from({ length: count }, (_, i) => new Map(Object.entries(channels[i] || {})))

  const clamp = (scene) => Math.max(0, Math.min(count - 1, Number(scene) || 0))

  return {
    count,
    /** Is this block off in this scene. */
    isOff: (scene, effectId) => off[clamp(scene)].has(effectId),
    /** Switch a block off or on in one scene only. */
    set: (scene, effectId, bypassed) => {
      const s = off[clamp(scene)]
      if (bypassed) s.add(effectId)
      else s.delete(effectId)
    },
    /** Which channel this block plays in this scene, or null if never set. */
    channelOf: (scene, effectId) => chan[clamp(scene)].get(String(effectId)) ?? null,
    /** Point a block at a channel in one scene only. */
    setChannel: (scene, effectId, channel) => {
      if (channel) chan[clamp(scene)].set(String(effectId), channel)
    },
    /** A block that has just been placed is on everywhere, on no chosen channel. */
    forget: (effectId) => {
      for (const s of off) s.delete(effectId)
      for (const c of chan) c.delete(String(effectId))
    },
    /** The pattern for one scene, for a test or a scene map. */
    snapshot: (scene) => [...off[clamp(scene)]].sort((a, b) => a - b)
  }
}
