import { blockParams, disambiguate } from './forgefx'
import { EXCLUDED_BLOCKS, isSilencingParam } from './guardrails'

/**
 * Every editable control in the preset, one flat list.
 *
 * Extracted from the search box the moment a second feature (the XY pad)
 * needed the same walk — two copies of "what controls exist" would disagree
 * the first time one of them learned something.
 */
export async function buildParamIndex(blocks) {
  const editable = (blocks || []).filter((b) => !EXCLUDED_BLOCKS.includes(b.slug))
  const out = []
  for (const block of editable) {
    try {
      const res = await blockParams(block.effectId)
      /*
       * The player's own list, so it holds the player's rule rather than the
       * model's: levels reach the model now, bounded, but a level found in a
       * search box and dragged by a finger is the silent preset by another
       * route. They stay where the knob list keeps them, off the quick surfaces.
       */
      for (const param of disambiguate(res?.named || []).filter((p) => !isSilencingParam(p.name))) {
        out.push({ block, param })
      }
    } catch {
      // A block that won't list its params just isn't offered.
    }
  }
  return out
}

/** A stable key for one control, fit for select values and storage. */
export const controlKey = (eid, paramId) => `${eid}:${paramId}`
