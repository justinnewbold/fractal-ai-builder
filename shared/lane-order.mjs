/**
 * Dragging a block up or down a lane: what that means in grid cells.
 *
 * "Make this where there's drag and drop with a little hamburger icon, where
 * you can just hold it and rearrange them by dragging them up or down where
 * you want them in the chain."
 *
 * A lane is the blocks of one grid row in column order, with the free cells
 * between them. A drag changes the ORDER of the blocks and nothing else: the
 * set of occupied columns stays exactly what it was, and the blocks are dealt
 * back into those columns in their new order. So a gap stays a gap where it
 * was, no block lands in a cell that was free, and a preset whose chain ran
 * 1, 2, 4, 5 still runs 1, 2, 4, 5 afterwards with the blocks in the order
 * the finger left them.
 *
 * Pure, so the arithmetic that decides what is written to the unit — which
 * writes STRUCTURE, and a wrong one mangles a preset rather than mis-setting a
 * knob — runs in a test with no unit and no screen.
 */

/**
 * The moves that turn `blocks` (column order, as `laneItems` gives them) into
 * the order with the block at `from` moved to position `to`. Each move is one
 * block from one column to another; a block that stays put is not in the list.
 */
export function reorderPlan(blocks, from, to) {
  const list = (blocks || []).filter((b) => b && Number.isInteger(b.col))
  const n = list.length
  if (n < 2 || !Number.isInteger(from) || !Number.isInteger(to)) return []
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return []
  const cols = list.map((b) => b.col)
  const order = list.slice()
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  const moves = []
  order.forEach((b, i) => {
    if (b.col !== cols[i]) moves.push({ block: b.block, from: b.col, to: cols[i] })
  })
  return moves
}

/**
 * The lane as it will look once the unit has the move, for the seconds in
 * between.
 *
 * A move is six writes to the unit and a re-read after them, which is about
 * three seconds on an FM3. The card used to be released, snap back to where it
 * came from, sit there for those three seconds, and then appear in its new
 * place when the read landed: "it jumps back to where the block was for a few
 * seconds before actually moving to its final spot".
 *
 * Nothing was wrong with the move. The lane is drawn from the last thing the
 * unit said, the finger lifting ends the drag, and until the re-read the last
 * thing the unit said is still the old order. So the new order is drawn from
 * here in the meantime, and it is not a guess: this deals the blocks back into
 * the same columns in their new order, which is exactly what reorderPlan
 * writes. If the unit does not keep it, the re-read puts the truth back on
 * screen and the panel says what happened.
 */
export function settledItems(items, fromPos, toPos) {
  const list = items || []
  const blocks = list.filter((it) => it.kind === 'block')
  const n = blocks.length
  if (!Number.isInteger(fromPos) || !Number.isInteger(toPos)) return list
  if (fromPos < 0 || fromPos >= n || toPos < 0 || toPos >= n || fromPos === toPos) return list
  const cols = blocks.map((it) => it.col)
  const order = blocks.slice()
  const [moved] = order.splice(fromPos, 1)
  order.splice(toPos, 0, moved)
  const dealt = order.map((it, i) => ({ ...it, col: cols[i], block: { ...it.block, col: cols[i] } }))
  return [...dealt, ...list.filter((it) => it.kind !== 'block')].sort((a, b) => a.col - b.col)
}

/**
 * Which item a finger is over, given the items' measured heights (top to
 * bottom, gaps between them included in `gap`) and how far the finger has
 * travelled from the top of the item it picked up.
 *
 * Measured rather than assumed: a card and a free space are different
 * heights, and a lane can hold both.
 */
export function landingIndex(heights, from, dy, gap = 0) {
  const n = (heights || []).length
  if (!n || !Number.isInteger(from) || from < 0 || from >= n) return from
  const tops = []
  let y = 0
  for (let i = 0; i < n; i++) {
    tops.push(y)
    y += (heights[i] || 0) + gap
  }
  /* The middle of the dragged item, where it is now. */
  const mid = tops[from] + (heights[from] || 0) / 2 + dy
  let at = 0
  for (let i = 0; i < n; i++) {
    const bottom = tops[i] + (heights[i] || 0) + gap / 2
    if (mid > bottom) at = Math.min(n - 1, i + 1)
  }
  return at
}

/**
 * The block-order positions of a drag that started on item `from` and ended
 * over item `to`, in a list that may hold gaps as well as blocks. Gaps do not
 * take part: a drop over a gap lands the block before the next block down.
 * Null when nothing would change.
 */
export function blockPositions(items, from, to) {
  const list = items || []
  if (list[from]?.kind !== 'block' || from === to) return null
  const blocks = list.filter((it) => it.kind === 'block')
  const fromPos = blocks.indexOf(list[from])
  const others = list.filter((it, i) => i !== from)
  const landing = Math.max(0, Math.min(others.length, to))
  let toPos = 0
  for (let i = 0; i < landing; i++) if (others[i].kind === 'block') toPos++
  return fromPos === toPos ? null : { from: fromPos, to: toPos }
}
