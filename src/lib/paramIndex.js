import { blockParams, disambiguate } from './forgefx'
import { EXCLUDED_BLOCKS, safeParams } from './guardrails'

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
      for (const param of safeParams(disambiguate(res?.named || []))) {
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
