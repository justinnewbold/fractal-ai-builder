import { useEffect, useState } from 'react'
import { placeBlock, clearCell, readGrid, blockCatalog } from '../lib/forgefx'

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
  const [armed, setArmed] = useState(false)
  // Which card's actions are open, as "row:col". One at a time.
  const [open, setOpen] = useState(null)
  const [moving, setMoving] = useState(null)
  const [choice, setChoice] = useState('')
  const [working, setWorking] = useState(null)
  // Said beside the control that caused it, never at the top of the page.
  const [issue, setIssue] = useState(null)
  const [palette, setPalette] = useState([])
  const [paletteFailed, setPaletteFailed] = useState(false)

  const linear = capabilities?.slotModel === 'linear'
  const rows = linear ? 1 : capabilities?.grid?.rows ?? 4
  const cols = linear ? capabilities?.slotCount ?? 4 : capabilities?.grid?.cols ?? 12

  /*
   * Columns are 0-indexed here, as /preset/blocks reports them and as
   * actions.js has always assumed; the wire's 1-indexing is added once, at the
   * boundary, by toWireCell. This panel used to add one of its own for a linear
   * unit and then add the wire's on top, so slot 1 on an AM4 was written to
   * column 2 — and the cells it drew could never match the blocks the device
   * reported, because those come back 0-indexed. The label is the only place
   * that counts from one, because that is how a person counts.
   */
  const label = (col) => col + 1

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
  const lanes = []
  for (let row = 1; row <= rows; row++) {
    const inRow = blocks
      .filter((b) => b.row === row && typeof b.col === 'number')
      .sort((a, b) => a.col - b.col)
    const taken = new Set(inRow.map((b) => b.col))
    const gaps = []
    for (let col = 0; col < cols; col++) if (!taken.has(col)) gaps.push(col)
    lanes.push({ row, blocks: inRow, gaps })
  }
  const firstEmpty = lanes.findIndex((l) => !l.blocks.length)
  const shown = lanes.filter((l, i) => l.blocks.length || i === firstEmpty)

  /** Cards and gaps in one list, in column order, so a lane reads as a chain. */
  const laneItems = (lane) =>
    [
      ...lane.blocks.map((b) => ({ kind: 'block', col: b.col, block: b })),
      ...lane.gaps.map((col) => ({ kind: 'gap', col }))
    ].sort((a, b) => a.col - b.col)

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
  const doubtful = (res) =>
    res?.ok === false
      ? 'Your unit answered “refused”. Some units say that even when the write landed — the chain above has been re-read, so check it.'
      : null

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
          : `Placed ${block?.name} at row ${row}, column ${label(col)}`
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
          : `Moved ${block.name} to row ${to.row}, column ${label(to.col)}`
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

  const remove = async (row, col, name) => {
    setWorking('clearing')
    setIssue(null)
    try {
      await clearCell(row, col)
      onChanged(linear ? `Cleared slot ${label(col)}` : `Cleared row ${row}, column ${label(col)}`)
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
      const fits = chain.slice(0, cols)
      for (const [i, block] of fits.entries()) await placeBlock(1, i, block.page)
      onChanged(`Built a starter chain — ${fits.map((b) => b.name).join(', ')}`)
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
        <div className="chain-lane" key={lane.row}>
          {rows > 1 ? (
            <p className="silk-label chain-lane-head">
              {lane.blocks.length ? `Row ${lane.row}` : `Row ${lane.row} — empty`}
            </p>
          ) : null}

          {laneItems(lane).map((item) => {
            const at = `${lane.row}:${item.col}`
            const isOpen = open === at

            if (item.kind === 'gap') {
              const target = moving && moving.at !== at
              return (
                <div className="chain-slot" key={at}>
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
            return (
              <div className="chain-slot" key={at}>
                <button
                  className={`chain-block ${isOpen ? 'open' : ''} ${
                    moving?.at === at ? 'lifting' : ''
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
                        <button
                          className="chip"
                          onClick={() => setMoving({ at, row: lane.row, col: item.col, block: b })}
                          disabled={busy || !!working || !lanes.some((l) => l.gaps.length)}
                        >
                          Move
                        </button>
                        {picker(() => add(lane.row, item.col), 'Replace', `add:${at}`)}
                        <button
                          className="chip"
                          onClick={() => remove(lane.row, item.col, b.name)}
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
  if (!armed) {
    return (
      <section className="grid-editor">
        <div className="history-head">
          <p className="silk-label">The chain</p>
          <div className="history-actions">
            <button className="chip" onClick={() => setArmed(true)}>
              Edit the chain
            </button>
          </div>
        </div>

        {laneList(false)}

        <p className="hint">
          Placing blocks writes the preset&rsquo;s structure, not just its settings, and that part
          of the write is worked out from the protocol rather than confirmed on hardware &mdash; a
          bad write here mangles a preset rather than mis-setting a knob. Back up all slots first,
          and work on a slot you don&rsquo;t care about.
        </p>
      </section>
    )
  }

  return (
    <section className="grid-editor">
      <div className="history-head">
        <p className="silk-label">Edit the chain</p>
        <div className="history-actions">
          <button className="chip" onClick={buildStarter} disabled={busy || !!working || paletteFailed}>
            {working === 'starter' ? 'Building…' : 'Starter chain'}
          </button>
          <button
            className="chip"
            onClick={() => {
              setArmed(false)
              setMoving(null)
              close()
            }}
          >
            Done
          </button>
        </div>
      </div>

      <p className="hint">
        Tap a block for what you can do to it, or an empty slot to put something in it.
      </p>

      {laneList(true)}

    </section>
  )
}
