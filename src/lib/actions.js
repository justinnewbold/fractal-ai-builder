/**
 * Building a starting chain.
 *
 * This file was the model's command plan — validate what it proposed, order
 * the actions, run them against the unit. That went with the AI: the whole of
 * it is on the branch feature/ai-builder-preserved.
 *
 * What is left is the part that was never about the model. The Starter chain
 * button in the grid editor asks for drive into amp into cab with delay and
 * reverb after it, laid into the columns THIS unit actually has, and that is
 * a question about the grid rather than about anything anybody said.
 */
/**
 * The device functions are loaded when an action runs, not when this module
 * does.
 *
 * Checking a plan is pure — it compares ids and ranges — so it shouldn't drag in
 * the transport, the simulator and its captured rosters just to be imported.
 * Keeping it lazy means the validation logic can be tested on its own, which
 * for the layer that decides what reaches the hardware is worth the indirection.
 */

/**
 * Lower runs first.
 *
 * Loading replaces everything, so it goes before any edit; saving makes the
 * result permanent, so it goes after. Asking to "load 12, drop the gain and save
 * it back" in one breath then does those three things in the only order that
 * means anything, whatever order they were said in.
 */
/**
 * What goes into an empty preset when nobody says which blocks.
 *
 * Drive into amp into cab is the spine of almost every electric guitar sound;
 * delay and reverb are the two everyone reaches for next. A unit that lacks any
 * of them just gets fewer.
 */
const DEFAULT_CHAIN = ['drive', 'amp', 'cab', 'delay', 'reverb']

/**
 * Where a new block should land when nobody said.
 *
 * The first free column on the row the chain lives on. "Free" is judged
 * against every placed block including input and output rows — the same
 * raw-versus-editable distinction that bit the empty-slot detection, applied
 * in the opposite direction: for occupancy, everything counts.
 */
export function firstFreeCell(blocks, rows, cols) {
  const chainRow =
    [...(blocks || [])]
      .filter((b) => typeof b.row === 'number')
      .sort(
        (a, b) =>
          (blocks || []).filter((x) => x.row === b.row).length -
          (blocks || []).filter((x) => x.row === a.row).length
      )[0]?.row ?? 0
  const taken = new Set(
    (blocks || []).filter((b) => b.row === chainRow && typeof b.col === 'number').map((b) => b.col)
  )
  for (let col = 0; col < (cols || 4); col++) {
    if (!taken.has(col)) return { row: chainRow, col }
  }
  return null
}

/**
 * Where a chain, its input and its output go on a row that already has things
 * on it.
 *
 * Pure, and apart from the action that runs it, because getting this wrong is
 * silent: every value lands, the unit reads them back, the preset saves, and
 * the player hears nothing. That has happened twice — once by building over
 * the output block, and once by building a chain into a genuinely empty preset
 * with no Input block in it, so the guitar never reached the first pedal.
 *
 * Columns are 0-based, the convention the whole app uses inside itself; the
 * client adds the wire's +1 at the boundary.
 *
 * `onRow` is what is already there. `canInput` and `canOutput` say whether the
 * unit offers those as blocks to place at all — a unit that routes its signal
 * some other way gets neither invented for it.
 */
export function chainPlan({ onRow = [], width = 12, count = 0, canInput = false, canOutput = false } = {}) {
  const placed = onRow.filter((b) => Number.isInteger(b?.col))
  const columnOf = (slug) => {
    const found = placed.find((b) => b.slug === slug)
    return found ? found.col : null
  }
  const inputCol = columnOf('input')
  const outputCol = columnOf('output')
  const held = new Set(placed.map((b) => b.col))

  /* Between the two, never over either. */
  const free = []
  for (let col = 0; col < width; col++) {
    if (held.has(col)) continue
    if (inputCol !== null && col < inputCol) continue
    if (outputCol !== null && col > outputCol) continue
    free.push(col)
  }

  /* The input first, because the chain starts to its right. */
  let input = inputCol
  if (input === null && canInput && free.length) input = free.shift()

  const cols = free.slice(0, count)
  let output = outputCol
  if (output === null && canOutput && free.length > cols.length) output = free[cols.length]

  /* Where the cabling has to reach: the output where there is one, the end of
     what was placed where there isn't — the signal has to get there either way. */
  const last = cols.length ? cols[cols.length - 1] : input ?? 0
  return { input, cols, output, wireTo: output ?? Math.max(last, width - 1) }
}
