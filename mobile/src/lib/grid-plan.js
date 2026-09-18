/* Generated from shared/grid-plan.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * Where a block sits, and how that becomes something the unit will accept.
 *
 * INDEXING IS THE TRAP, and it has already sprung once. `/preset/blocks`
 * reports a block's column counting from zero; the grid write routes take row
 * and column counting from one, to match FM-Edit. The old panel added one of
 * its own for a linear unit and then the wire added one on top, so slot 1 on an
 * AM4 was written to column 2 — and the cells it drew could never line up with
 * the blocks the unit reported, because those come back from zero.
 *
 * So the rule lives here, once, and everything above it deals in display
 * coordinates only: the ones `/preset/blocks` uses. The conversion happens at
 * the boundary, in `toWireCell`, and nowhere else.
 *
 * WHY BOTH APPS GET THIS FILE. A placement write changes a preset's STRUCTURE
 * rather than a value. A knob written to the wrong place sounds wrong and is
 * one drag from right; a block placed in the wrong cell is a preset somebody
 * has to rebuild. Two apps that counted columns differently would not disagree
 * out loud — one of them would simply put things one column along.
 *
 * Nothing here talks to a unit. It is all arithmetic about a grid, which is
 * what makes it testable without hardware.
 */

/**
 * The cell as the write routes want it.
 *
 * BOTH COUNT FROM ZERO IN A READ AND FROM ONE ON THE WIRE. This used to shift
 * only the column, on the belief that rows already counted from one on both
 * sides. They do not: the FM3's preset dump numbers its rows 0-3, exactly as
 * it numbers its columns 0-11, and the write routes take rows 1-4 the way
 * FM3-Edit shows them. So a chain read on row 1 -- the second row, where the
 * factory presets keep theirs -- was written back to row 1 on the wire, which
 * is the TOP row. Every clear landed on an empty cell and did nothing; every
 * placement tried to put a block on the top row while the same block still
 * sat one row down, and the unit quietly declined. The unit answered "ok" to
 * all of it, and a log from an FM3 read "unit has it at 5" after every move,
 * with not one step refused.
 *
 * Rows are shifted here for the same reason columns are: once, at the
 * boundary, so a wrong row cannot happen one screen at a time.
 */
export const toWireCell = (row, col) => ({ row: row + 1, col: col + 1 })

/**
 * A cable as the write route wants it: out of (srcRow, srcCol) into destRow
 * of the next column. The same shift, for the same reason.
 */
export const toWireCable = (srcRow, srcCol, destRow) => ({
  srcRow: srcRow + 1,
  srcCol: srcCol + 1,
  destRow: destRow + 1
})

/**
 * The last column a cable can start from.
 *
 * A cable joins a column to the NEXT one, and the FM3's grid is fourteen wide,
 * so the thirteenth is the last that has a next. In display columns, which
 * count from zero, that is twelve.
 */
export const LAST_CABLE_COL = 12

/**
 * Which columns to run a cable out of, to wire a row up to `lastCol`.
 *
 * FROM THE FIRST COLUMN, NOT FROM BEFORE IT. This used to ask for a cable out
 * of column -1 — the input — and the unit threw out every one: "srcCol out of
 * range (1..13): 0". There is no such cable to ask for. The unit stores
 * thirteen sets of links, one between each pair of columns; the input feeds the
 * first column on its own and nothing joins to it. The request was impossible
 * rather than refused, it cost a round trip on every chain built, and it left a
 * line in the log that read like the chain came out broken when it had not.
 */
export function cableColumns(lastCol) {
  const out = []
  for (let col = 0; col <= Math.min(lastCol, LAST_CABLE_COL); col++) out.push(col)
  return out
}

/** How many rows and columns this unit's grid has. */
export function gridShape(capabilities) {
  const linear = capabilities?.slotModel === 'linear'
  return {
    linear,
    rows: linear ? 1 : capabilities?.grid?.rows ?? 4,
    cols: linear ? capabilities?.slotCount ?? 4 : capabilities?.grid?.cols ?? 12
  }
}

/** What a person calls a column, and a row: the numbers FM3-Edit shows. */
export const colLabel = (col) => col + 1
export const rowLabel = (row) => row + 1

/**
 * The grid as lanes: what is in each row, and where the gaps are.
 *
 * A grid drawn as every cell is forty-eight boxes, of which five hold anything.
 * On a phone that is three cells visible out of forty-eight and a scroll to
 * find the one you want. A lane is the row as a CHAIN — what is actually in it,
 * in signal order, with the free cells between shown as gaps you can tap.
 *
 * Nothing is hidden: the column number is on every card and a preset with
 * parallel rows gets a lane each. But nothing is drawn that isn't there either,
 * which is what turns forty-eight cells into five.
 */
export function lanesFor(blocks, capabilities) {
  const { rows, cols } = gridShape(capabilities)
  const lanes = []
  /* Rows count from zero, like columns: a chain on the top row is row 0,
     and it used to be drawn nowhere at all. */
  for (let row = 0; row < rows; row++) {
    const inRow = (blocks || [])
      .filter((b) => b.row === row && typeof b.col === 'number')
      .sort((a, b) => a.col - b.col)
    const taken = new Set(inRow.map((b) => b.col))
    const gaps = []
    for (let col = 0; col < cols; col++) if (!taken.has(col)) gaps.push(col)
    lanes.push({ row, blocks: inRow, gaps })
  }
  return lanes
}

/**
 * The lanes worth drawing: the ones holding something, plus the first empty
 * one — so a bare preset can be started and a parallel row can be begun.
 */
export function lanesShown(blocks, capabilities) {
  const lanes = lanesFor(blocks, capabilities)
  const firstEmpty = lanes.findIndex((l) => !l.blocks.length)
  return lanes.filter((l, i) => l.blocks.length || i === firstEmpty)
}

/** Cards and gaps in one list, in column order, so a lane reads as a chain. */
export const laneItems = (lane) =>
  [
    ...(lane?.blocks || []).map((b) => ({ kind: 'block', col: b.col, block: b })),
    ...(lane?.gaps || []).map((col) => ({ kind: 'gap', col }))
  ].sort((a, b) => a.col - b.col)

/**
 * What to say about an answer of `ok: false`.
 *
 * THIS IS NOT A FAILURE, and treating it as one is the bug this panel was
 * reported for. The AM4 answers `ok:false` to writes that actually landed — the
 * repo documents that in two other places — and the old editor took it at its
 * word, so a move that worked was rolled straight back. "Delete works, the rest
 * doesn't."
 *
 * So it is reported as a note rather than acted on, the chain is re-read from
 * the unit, and the person looks. `null` when there is nothing to say.
 */
export const doubtfulWrite = (res) =>
  res?.ok === false
    ? 'Your unit answered “refused”. Some units say that even when the write landed — the chain has been re-read, so check it.'
    : null
