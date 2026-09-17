import { blockParams, idOf, stageBlocks } from './device'
import { disambiguate } from './encoding'
import { isSilencingParam } from './guardrails'

/**
 * Every control in the preset, one flat list, so you can find one by name.
 *
 * "Where does the presence live" has one good answer per preset, and typing
 * three letters beats opening four blocks in turn to look — which is worse on a
 * phone than at a desk, because opening a block is a round trip to the Mac.
 *
 * WHY THIS IS A CACHE AND NOT A FUNCTION, which is the whole difference from
 * the browser's copy. Building the list means asking the unit for every block's
 * parameters, one block at a time, and `relay-rules` counts that read among the
 * slow ones: on an AM4 each one makes the unit dump its preset over serial. The
 * browser fires them down a local socket and nobody notices. Down a relay to a
 * Mac in the wings, a seven-block preset is seven of those — so it is built
 * once, kept, and reported on while it runs rather than freezing a search box
 * for ten seconds with no explanation.
 *
 * ONE AT A TIME, deliberately, like every other walk in this app. The relay is
 * a single channel to one Mac holding one serial port, and seven reads fired
 * together do not arrive sooner — they make the queue longer and the tuner, the
 * scene change and the knob you are turning wait behind them.
 *
 * LEVELS ARE NOT IN IT. The same rule the knob deck holds and for the same
 * reason: a level found in a search box and dragged by a finger is the silent
 * preset by another route.
 */

/** The last index built, and what chain it was built from. */
let cached = null

/** What makes this a different chain: the blocks in it, in order. */
export const chainKey = (blocks) =>
  stageBlocks(blocks)
    .map((b) => idOf(b))
    .join(',')

/**
 * Build it, or hand back the one already built for this chain.
 *
 * `onProgress` is called with how many blocks have been read and how many there
 * are, so a screen can say which one it is on. A search that reads seven blocks
 * in silence is indistinguishable from one that has crashed.
 *
 * A block that will not list its controls is simply not offered. One block
 * failing is one block, and the other six are still worth searching.
 */
export async function buildParamIndex(blocks, onProgress) {
  const key = chainKey(blocks)
  if (cached?.key === key) return cached.index

  const editable = stageBlocks(blocks)
  const out = []
  let done = 0
  onProgress?.(0, editable.length)
  for (const block of editable) {
    try {
      const res = await blockParams(idOf(block))
      for (const param of disambiguate(res?.named || []).filter((p) => !isSilencingParam(p.name))) {
        out.push({ block, param })
      }
    } catch {
      /* A block that won't list its controls just isn't offered. */
    }
    done += 1
    onProgress?.(done, editable.length)
  }

  cached = { key, index: out }
  return out
}

/** What is already known, without asking the unit for anything. */
export const indexFor = (blocks) => (cached?.key === chainKey(blocks) ? cached.index : null)

/**
 * Controls matching what was typed.
 *
 * Both the control's own name and the block's, because "delay mix" is how
 * somebody asks for it and "Mix" on its own matches five blocks. Capped: the
 * list is scrolled with a thumb.
 */
export function findControls(index, query, cap = 30) {
  const needle = String(query || '').trim().toLowerCase()
  if (needle.length < 2 || !Array.isArray(index)) return []
  return index
    .filter(
      ({ block, param }) =>
        param.name.toLowerCase().includes(needle) ||
        `${block.name} ${param.name}`.toLowerCase().includes(needle)
    )
    .slice(0, cap)
}

/** Forget it — a different preset is loaded, so none of it is about this one. */
export function forget() {
  cached = null
}
