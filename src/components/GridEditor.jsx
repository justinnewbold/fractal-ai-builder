import { useEffect, useRef, useState } from 'react'
import { placeBlock, clearCell, readGrid, blockCatalog, wireRow, presetBlocks, clearDeviceCache } from '../lib/forgefx'
import { logDebug } from '../lib/debugLog'
import { blockPositions, landingIndex, reorderPlan } from '../../shared/lane-order.mjs'
import { chainPlan } from '../lib/actions'
import {
  colLabel,
  doubtfulWrite,
  gridShape,
  isSplitChain,
  laneItems,
  lanesShown,
  rowLabel
} from '../../shared/grid-plan.mjs'

/**
 * A workable starting chain, by block family rather than by number.
 *
 * Block type codes differ completely between an FM3 and an AM4, so the starter
 * resolves against the device's own palette. Anything the attached unit doesn't
 * offer is simply skipped.
 */
const STARTER_ORDER = ['drive', 'amp', 'cab', 'delay', 'reverb']

/**
 * The chain, as a chain.
 *
 * This was a 4x12 grid of cells 940px wide, laid out on a canvas that scrolled
 * sideways on every screen and needed drag-and-drop — which does nothing at all
 * on iOS — to move anything. On a 390px phone you saw three cells of forty-eight
 * and had to scroll to find the one you wanted, and every error printed at the
 * top of a long page, far above the fold, so a tap that failed looked like a tap
 * that did nothing. The report was blunt and correct: "the rest you can't really
 * add anything or change anything… let's rethink that whole thing."
 *
 * So: one lane per row of the grid, each lane a vertical list of what is
 * actually in it, in signal order, with the free cells between them shown as
 * gaps you can tap. Nothing is hidden — the column number is on every card, and
 * a preset with parallel rows shows a lane each — but nothing is drawn that
 * isn't there either, which is what turned forty-eight cells into five.
 *
 * Tap a block for what you can do to it; tap a gap to put something in it. Every
 * answer, and every failure, appears in that same row, under your thumb.
 *
 * Two things about writing here are worth knowing. Placement writes structure
 * rather than values, and that part of ForgeFX is worked out from the protocol
 * rather than confirmed on hardware — so a bad write mangles a preset rather
 * than mis-setting a knob. And this unit family answers `ok:false` to writes
 * that landed (documented twice in this repo), which is why nothing here treats
 * that answer as a failure: it re-reads the chain from the unit instead and
 * lets you look.
 */
export default function GridEditor({ blocks, capabilities, busy, onError, onChanged }) {
  // Which card's actions are open, as "row:col". One at a time.
  const [open, setOpen] = useState(null)
  const [moving, setMoving] = useState(null)
  const [choice, setChoice] = useState('')
  const [working, setWorking] = useState(null)
  // Said beside the control that caused it, never at the top of the page.
  const [issue, setIssue] = useState(null)
  const [palette, setPalette] = useState([])
  const [paletteFailed, setPaletteFailed] = useState(false)

  /* rows and cols were read here and never defined, so on a grid unit the
     panel threw "Can't find variable: rows" before it drew a thing. */
  const { linear, rows, cols } = gridShape(capabilities)

  /*
   * DRAG TO REORDER, AS ON THE PHONE. "How does moving the blocks in the chain
   * work on the web version? Can we set it up like the phone." Hold the ≡ grip
   * on a block and drag it up or down its lane; the other blocks shift out of
   * the way, and letting go deals the lane's blocks back into the same
   * columns in the new order. The maths is shared/lane-order, the same copy
   * the phone runs, so the two apps write the same block to the same column.
   */
  const [drag, setDrag] = useState(null)
  const slots = useRef({})
  const dragFrom = useRef({ y: 0, heights: [] })
  const GAP = 4

  /*
   * Columns are 0-indexed here, as /preset/blocks reports them and as
   * actions.js has always assumed; the wire's 1-indexing is added once, at the
   * boundary, by toWireCell. This panel used to add one of its own for a linear
   * unit and then add the wire's on top, so slot 1 on an AM4 was written to
   * column 2 — and the cells it drew could never match the blocks the device
   * reported, because those come back 0-indexed. The label is the only place
   * that counts from one, because that is how a person counts.
   */
  const label = colLabel

  const loadPalette = async () => {
    setPaletteFailed(false)
    try {
      const res = await blockCatalog()
      const list = Array.isArray(res) ? res : []
      setPalette(list)
      if (!list.length) setPaletteFailed(true)
    } catch {
      setPalette([])
      setPaletteFailed(true)
    }
  }

  useEffect(() => {
    let stop = false
    ;(async () => {
      try {
        const res = await blockCatalog()
        if (stop) return
        const list = Array.isArray(res) ? res : []
        setPalette(list)
        if (!list.length) setPaletteFailed(true)
      } catch {
        // Silently emptying the list left Place disabled with nothing to
        // explain it — a control that does nothing and says nothing.
        if (!stop) {
          setPalette([])
          setPaletteFailed(true)
        }
      }
    })()
    return () => {
      stop = true
    }
  }, [])

  /**
   * The rows of the grid, each as what is in it and where the gaps are.
   *
   * Only rows that hold something are shown, plus the first empty one so a bare
   * preset can be started and a parallel row can be begun. A gap is a real
   * empty cell — never drawn between two blocks that are already adjacent,
   * because there is nowhere there to put anything.
   */
  const shown = lanesShown(blocks, capabilities)

  /*
   * A SPLIT CHAIN, SAID OUT LOUD.
   *
   * Where every block sits is read from the unit. How the rows are JOINED is
   * not — there is no read for the cables anywhere in this app, only a write —
   * so on a preset running down two rows this editor can describe half of what
   * is there and cannot tell a deliberate split from two unrelated rows.
   *
   * Drawing that silently is the problem: two lanes with no comment read as an
   * editor that understands the routing and is showing it to you. Moving blocks
   * WITHIN a row stays available and stays safe — cells and cables are separate
   * writes, and shuffling a row cannot disturb what joins it to another.
   */
  const splitChain = isSplitChain(blocks, capabilities)

  const close = () => {
    setOpen(null)
    setChoice('')
    setIssue(null)
  }

  /*
   * A write is done when the unit has been asked and the chain re-read.
   *
   * `ok:false` is not a failure here. The AM4 answers it on writes that
   * actually landed — this repo documents that in two other places — and the
   * old editor took it at its word: a successful move was rolled straight back,
   * which is exactly why "delete works, the rest doesn't". So the answer is
   * reported as a note, the chain above is re-read from the unit, and the
   * person can see for themselves which it was.
   */
  const doubtful = doubtfulWrite

  const add = async (row, col) => {
    if (!choice) return
    setWorking(`add:${row}:${col}`)
    setIssue(null)
    try {
      const res = await placeBlock(row, col, Number(choice))
      const block = palette.find((b) => b.page === Number(choice))
      onChanged(
        linear
          ? `Placed ${block?.name} in slot ${label(col)}`
          : `Placed ${block?.name} at row ${rowLabel(row)}, column ${label(col)}`
      )
      const note = doubtful(res)
      if (note) setIssue(note)
      else close()
    } catch (err) {
      setIssue(err.message)
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /**
   * Move a block to another cell.
   *
   * Order matters and the safe order isn't obvious. A block instance exists once
   * — an FM3 has one Amp — so placing it in a second cell while it still
   * occupies the first may be refused or may do something undefined. Clearing
   * first avoids asking that question.
   *
   * The cost is a window where the block exists nowhere, so its id is held and
   * put back if the placement *throws*. It is not put back on `ok:false`: that
   * answer means nothing on this hardware, and undoing a move because of it is
   * the bug this panel was reported for.
   */
  const move = async (from, to) => {
    const block = from.block
    setWorking('moving')
    setIssue(null)
    try {
      await clearCell(from.row, from.col)
      let res
      try {
        res = await placeBlock(to.row, to.col, block.effectId)
      } catch (err) {
        await placeBlock(from.row, from.col, block.effectId).catch(() => {})
        throw err
      }
      onChanged(
        linear
          ? `Moved ${block.name} to slot ${label(to.col)}`
          : `Moved ${block.name} to row ${rowLabel(to.row)}, column ${label(to.col)}`
      )
      const note = doubtful(res)
      if (note) setIssue(note)
      else close()
      setMoving(null)
    } catch (err) {
      setIssue(err.message)
      onError(err.message)
      setMoving(null)
    } finally {
      setWorking(null)
    }
  }

  /*
   * A drag, landed: every moving block is cleared first, then every one is
   * placed, so no target is occupied when it is written to. Every answer is
   * logged, and the chain is re-read off the unit afterwards and each moved
   * block looked for where it was put -- a unit that quietly ignores a write
   * answers exactly like one that took it.
   */
  const reorder = async (lane, fromIndex, toIndex) => {
    const items = laneItems(lane)
    const pos = blockPositions(items, fromIndex, toIndex)
    if (!pos) return
    const moves = reorderPlan(
      items.filter((it) => it.kind === 'block').map((it) => ({ col: it.col, block: it.block })),
      pos.from,
      pos.to
    )
    if (!moves.length) return
    setWorking('moving')
    setIssue(null)
    const said = (r) => (r?.ok === false ? 'refused' : r?.ok === true ? 'ok' : 'no answer')
    const answers = []
    try {
      for (const m of moves) {
        const r = await clearCell(lane.row, m.from)
        answers.push(r)
        logDebug('chain', `clear ${m.block.name} from column ${m.from + 1}`, said(r))
      }
      try {
        for (const m of moves) {
          const r = await placeBlock(lane.row, m.to, m.block.effectId)
          answers.push(r)
          logDebug('chain', `place ${m.block.name} at column ${m.to + 1}`, said(r))
        }
      } catch (err) {
        for (const m of moves) await placeBlock(lane.row, m.from, m.block.effectId).catch(() => {})
        throw err
      }
      await clearDeviceCache().catch(() => {})
      const now = await presetBlocks().catch(() => null)
      if (now) {
        const at = (m) => now.find((b) => b.effectId === m.block.effectId)
        const astray = moves.filter((m) => at(m)?.row !== lane.row || at(m)?.col !== m.to)
        for (const m of moves) {
          const b = at(m)
          logDebug('chain', `${m.block.name}: column ${m.from} → ${m.to}`, astray.includes(m) ? (b ? `unit has it at row ${rowLabel(b.row)}, column ${label(b.col)}` : 'unit has it nowhere') : 'landed')
        }
        const refused = answers.filter((r) => r?.ok === false).length
        if (astray.length) {
          setIssue(
            `The unit did not keep the move: ${astray
              .map((m) => {
                const b = at(m)
                return `${m.block.name} is ${b ? `at row ${rowLabel(b.row)}, column ${label(b.col)}` : 'nowhere'}`
              })
              .join(', ')}. ${refused ? `The unit answered “refused” to ${refused} of the ${answers.length} steps.` : 'The unit answered every step without refusing it.'}`
          )
        } else {
          onChanged(`Moved ${moves.map((m) => m.block.name).join(', ')}`)
        }
      } else {
        onChanged(`Moved ${moves.map((m) => m.block.name).join(', ')} — could not re-read the chain to check`)
      }
    } catch (err) {
      setIssue(err.message)
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /* The grip reports; this decides. Pointer events, so a mouse and a finger
     are the same drag, and capture so the drag survives leaving the grip. */
  const gripDown = (e, lane, index) => {
    if (busy || working) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const n = laneItems(lane).length
    const heights = []
    for (let i = 0; i < n; i++) heights.push(slots.current[`${lane.row}:${i}`]?.getBoundingClientRect().height || 0)
    dragFrom.current = { y: e.clientY, heights }
    setDrag({ row: lane.row, index, dy: 0, to: index })
  }
  const gripMove = (e, lane, index) => {
    if (!drag || drag.row !== lane.row || drag.index !== index) return
    const dy = e.clientY - dragFrom.current.y
    const to = landingIndex(dragFrom.current.heights, index, dy, GAP)
    setDrag({ row: lane.row, index, dy, to })
  }
  const gripUp = (lane, index) => {
    if (!drag || drag.row !== lane.row || drag.index !== index) return
    const to = drag.to
    setDrag(null)
    if (to !== index) reorder(lane, index, to)
  }

  const remove = async (row, col, name) => {
    setWorking('clearing')
    setIssue(null)
    try {
      await clearCell(row, col)
      onChanged(linear ? `Cleared slot ${label(col)}` : `Cleared row ${rowLabel(row)}, column ${label(col)}`)
      close()
    } catch (err) {
      setIssue(err.message)
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  const buildStarter = async () => {
    setWorking('starter')
    setIssue(null)
    try {
      const chain = STARTER_ORDER.map((slug) => palette.find((b) => b.slug === slug)).filter(Boolean)
      /*
       * Between the input and the output, and putting them there when they are
       * missing — the same planner the assistant's own chain builder uses.
       *
       * This used to place from column 0 and count upwards, which wrote over
       * whichever of them was already on the row, and left a preset that had
       * neither with a drive that nothing feeds and nothing that reaches the
       * jack. Both are silent, and both look perfect on screen.
       */
      const onRow = (blocks || []).filter((b) => b.row === 1)
      const has = (slug) => palette.some((b) => b.slug === slug)
      const plan = chainPlan({
        onRow,
        width: cols || chain.length,
        count: chain.length,
        canInput: !linear && has('input') && !onRow.some((b) => b.slug === 'input'),
        canOutput: !linear && has('output') && !onRow.some((b) => b.slug === 'output')
      })
      const fits = linear ? chain.slice(0, cols) : chain.slice(0, plan.cols.length)

      if (plan.input !== null && !onRow.some((b) => b.slug === 'input')) {
        const into = palette.find((b) => b.slug === 'input')
        if (into) await placeBlock(1, plan.input, into.page)
      }
      for (const [i, block] of fits.entries()) {
        await placeBlock(1, linear ? i : plan.cols[i], block.page)
      }
      if (plan.output !== null && !onRow.some((b) => b.slug === 'output')) {
        const out = palette.find((b) => b.slug === 'output')
        if (out) await placeBlock(1, plan.output, out.page)
      }
      /*
       * And join the row up, or the starter chain is five blocks that make no
       * sound. Placing a block fills a cell; it does not connect that cell to
       * anything, and an empty preset has no cabling of its own to inherit.
       * A linear unit has no grid and nothing to wire.
       */
      const wiring = linear ? null : await wireRow(1, plan.wireTo)
      onChanged(`Built a starter chain — ${fits.map((b) => b.name).join(', ')}`)
      if (wiring?.refused) {
        setIssue(
          `The blocks are in, but the unit refused ${wiring.refused} of the ${wiring.cables} connections along the row — until that row is joined up this preset will be silent.`
        )
      }
      await readGrid().catch(() => {})
    } catch (err) {
      setIssue(err.message)
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /** The picker, or the reason there isn't one. */
  const picker = (onPick, verb, key) =>
    paletteFailed ? (
      <div className="chain-note">
        <p className="hint">Couldn&rsquo;t read the block list from your unit.</p>
        <button className="chip" onClick={loadPalette}>
          Try again
        </button>
      </div>
    ) : (
      <>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="Block to place"
        >
          <option value="">Choose a block…</option>
          {palette.map((b) => (
            <option key={`${b.slug}-${b.page}`} value={b.page}>
              {b.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={onPick} disabled={busy || !choice || !!working}>
          {working === key ? `${verb}…` : verb}
        </button>
      </>
    )

  const laneList = (editable) => (
    <div className="chain-lanes">
      {shown.map((lane) => (
        <div className="chain-lane" data-linear={linear ? 'yes' : undefined} key={lane.row}>
          {rows > 1 ? (
            <p className="silk-label chain-lane-head">
              {lane.blocks.length ? `Row ${rowLabel(lane.row)}` : `Row ${rowLabel(lane.row)} — empty`}
            </p>
          ) : null}

          {laneItems(lane).map((item, index) => {
            const at = `${lane.row}:${item.col}`
            const isOpen = open === at
            /* While a block is held, the others slide out of its way. */
            const dragging = drag && drag.row === lane.row ? drag : null
            const lift = dragging ? dragFrom.current.heights[dragging.index] || 0 : 0
            let shift = 0
            if (dragging) {
              if (index === dragging.index) shift = dragging.dy
              else if (dragging.to > dragging.index && index > dragging.index && index <= dragging.to) shift = -(lift + GAP)
              else if (dragging.to < dragging.index && index >= dragging.to && index < dragging.index) shift = lift + GAP
            }
            const slotStyle = {
              transform: shift ? `translateY(${shift}px)` : undefined,
              transition: dragging && index === dragging.index ? 'none' : 'transform 120ms ease',
              zIndex: dragging && index === dragging.index ? 2 : undefined,
              position: 'relative'
            }
            const slotRef = (el) => {
              slots.current[`${lane.row}:${index}`] = el
            }

            if (item.kind === 'gap') {
              const target = moving && moving.at !== at
              return (
                <div className={`chain-slot ${isOpen ? 'open' : ''}`} key={at} ref={slotRef} style={slotStyle}>
                  <button
                    className={`chain-gap ${isOpen ? 'open' : ''} ${target ? 'target' : ''}`}
                    onClick={() => {
                      if (!editable) return
                      if (target) return move(moving, { row: lane.row, col: item.col })
                      setIssue(null)
                      setOpen(isOpen ? null : at)
                    }}
                    disabled={!editable || busy || !!working}
                  >
                    <span className="chain-col mono">{label(item.col)}</span>
                    <span className="chain-gap-word">
                      {target ? `Move ${moving.block.name} here` : 'Empty — tap to add'}
                    </span>
                  </button>

                  {isOpen && editable && !moving ? (
                    <div className="chain-actions">
                      {picker(() => add(lane.row, item.col), 'Add', `add:${at}`)}
                      <button className="chip" onClick={close}>
                        Cancel
                      </button>
                      {issue ? <p className="chain-issue">{issue}</p> : null}
                    </div>
                  ) : null}
                </div>
              )
            }

            const b = item.block
            const lifted = !!dragging && index === dragging.index
            return (
              <div className={`chain-slot ${isOpen ? 'open' : ''} ${lifted ? 'lifted' : ''}`} key={at} ref={slotRef} style={slotStyle}>
                <div className="chain-row">
                  <button
                    className={`chain-block ${isOpen ? 'open' : ''} ${
                      moving?.at === at || lifted ? 'lifting' : ''
                    }`}
                    onClick={() => {
                      if (!editable) return
                      setIssue(null)
                      setOpen(isOpen ? null : at)
                      setMoving(null)
                    }}
                    disabled={!editable || busy || !!working}
                  >
                    <span className="chain-col mono">{label(item.col)}</span>
                    <span className="chain-block-name">{b.name}</span>
                  </button>
                  {editable && !linear ? (
                    <button
                      type="button"
                      className="chain-grip"
                      aria-label={`Move ${b.name} — hold and drag up or down`}
                      title="Hold and drag up or down to move it"
                      disabled={busy || !!working}
                      onPointerDown={(e) => gripDown(e, lane, index)}
                      onPointerMove={(e) => gripMove(e, lane, index)}
                      onPointerUp={() => gripUp(lane, index)}
                      onPointerCancel={() => gripUp(lane, index)}
                    >
                      ≡
                    </button>
                  ) : null}
                </div>

                {isOpen && editable ? (
                  <div className="chain-actions">
                    {moving?.at === at ? (
                      <>
                        <p className="hint">Tap an empty slot to move it there.</p>
                        <button className="chip" onClick={() => setMoving(null)}>
                          Cancel move
                        </button>
                      </>
                    ) : (
                      <>
                        {/*
                          Move, only where moving keeps the block.

                          "The move function doesn't work... if it's not
                          possible or too hard, let's just remove the move
                          button either way."

                          On a grid unit a block carries its own settings, so
                          putting it in another cell is a move. On the AM4 the
                          settings live in the slot: the write available is
                          "set this slot's block type", so a move is clear one
                          slot, create a fresh block in another — same name,
                          every knob back at its default. That is not a move,
                          and dressing it as one loses somebody's tone silently.
                          Cleared and re-added is what it always was, and Remove
                          and Replace already say so honestly.
                        */}
                        {linear ? null : (
                          <button
                            className="chip"
                            onClick={() => setMoving({ at, row: lane.row, col: item.col, block: b })}
                            disabled={busy || !!working || !shown.some((l) => l.gaps.length)}
                          >
                            Move
                          </button>
                        )}
                        {picker(() => add(lane.row, item.col), 'Replace', `add:${at}`)}
                        {/* Red, and asked first — the phone does the same. A block
                            taken out loses its settings and there is no undo. */}
                        <button
                          className="chip chip-remove"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${b.name || 'this block'}? Its settings go with it. Adding it again brings it back with every knob at its default.`
                              )
                            ) {
                              remove(lane.row, item.col, b.name)
                            }
                          }}
                          disabled={busy || !!working}
                        >
                          {working === 'clearing' ? 'Removing…' : 'Remove'}
                        </button>
                        <button className="chip" onClick={close}>
                          Cancel
                        </button>
                      </>
                    )}
                    {issue ? <p className="chain-issue">{issue}</p> : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )

  /*
   * Locked: the chain as it is, and no way to change it by accident. Editing
   * behind an explicit mode means you can always see the chain, and have to say
   * so before you can move anything in it.
   */
  /*
   * No gate any more. This used to draw the lanes read-only behind an "Edit
   * the chain" button, inside a section that started folded, so the grips
   * were three taps deep and nobody found them: "Where do I grab it? It's
   * not set up like the phone." The phone opens straight onto the cards and
   * their grips; so does this. The caution about structure writes stays, as
   * a sentence at the foot rather than a door at the top.
   */
  return (
    <section className="grid-editor">
      <div className="history-head">
        <p className="silk-label">Edit the chain</p>
        <div className="history-actions">
          <button className="chip" onClick={buildStarter} disabled={busy || !!working || paletteFailed}>
            {working === 'starter' ? 'Building…' : 'Starter chain'}
          </button>
        </div>
      </div>

      <p className="hint">
        Hold ≡ and drag a block up or down to move it. Tap a block for Add and Remove, or an empty
        slot to put something in it.
      </p>

      {splitChain ? (
        <p className="chain-issue">
          This preset uses more than one row. Moving blocks within a row is fine, but this app
          can&rsquo;t see or change how the rows are joined &mdash; do that on your unit.
        </p>
      ) : null}

      {laneList(true)}

      <p className="hint">
        Placing blocks writes the preset&rsquo;s structure, not just its settings. Work on a slot
        you don&rsquo;t care about until the move has proved itself on your unit.
      </p>
    </section>
  )
}
