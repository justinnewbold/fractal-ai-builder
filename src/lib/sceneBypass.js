/**
 * Which blocks are off, per scene.
 *
 * On this hardware that is what a scene *is*: the same chain, a different
 * pattern of what is on. The simulated unit kept one bypass flag per block,
 * so tapping a scene moved the highlight and nothing else — and the demo
 * taught the tour's own sentence ("a scene is a saved pattern of which
 * blocks are on") to be a lie.
 *
 * Pure, so node can test it. The mock owns one of these and asks it every
 * time it answers for the chain, the meters, a summary or a scene map, so
 * all four agree by construction rather than by luck.
 */
export function createSceneBypass({ count = 8, seeds = {} } = {}) {
  const off = Array.from({ length: count }, (_, i) => new Set(seeds[i] || seeds.default || []))

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
    /** A block that has just been placed is on everywhere. */
    forget: (effectId) => {
      for (const s of off) s.delete(effectId)
    },
    /** The pattern for one scene, for a test or a scene map. */
    snapshot: (scene) => [...off[clamp(scene)]].sort((a, b) => a - b)
  }
}
