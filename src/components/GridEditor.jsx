import { useEffect, useState, useRef } from 'react'
import { useOverflow } from '../lib/overflow'
import { pointAtCell, placeBlock, clearCell, readGrid, blockCatalog } from '../lib/forgefx'

/**
 * A workable starting chain, by block family rather than by number.
 *
 * Block type codes differ completely between an FM3 and an AM4, so the starter
 * resolves against the device's own palette. Anything the attached unit doesn't
 * offer is simply skipped.
 */
const STARTER_ORDER = ['drive', 'amp', 'cab', 'delay', 'reverb']

/**
 * Building a preset from an empty slot.
 *
 * This is the one part of ForgeFX flagged as spec-derived rather than
 * hardware-confirmed, and it writes structure rather than values — so the
 * failure mode is a mangled preset, not a wrong knob.
 *
 * Two things make that manageable. Placement writes are reject-watched, so a
 * refusal comes back rather than passing silently. And the cursor probe writes
 * nothing at all: it moves the unit's edit cursor, so you can confirm the app
 * and the hardware agree about which cell is which before trusting a placement.
 * Two indexing conventions are in play — reads are 0-indexed by column, writes
 * are 1-indexed — and that probe is what catches a mistake.
 */
export default function GridEditor({ blocks, capabilities, busy, onError, onChanged }) {
  const [armed, setArmed] = useState(false)
  const [target, setTarget] = useState(null)
  const [choice, setChoice] = useState('')
  const [working, setWorking] = useState(null)
  const [probe, setProbe] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)

  const [palette, setPalette] = useState([])

  const linear = capabilities?.slotModel === 'linear'
  const rows = linear ? 1 : capabilities?.grid?.rows ?? 4
  const cols = linear ? capabilities?.slotCount ?? 4 : capabilities?.grid?.cols ?? 12
  // Both grids scroll sideways at every width; the fade that says so needs the
  // fact. After `cols`: the observer re-looks when the column count changes.
  const lockedScroll = useRef(null)
  const editScroll = useRef(null)
  useOverflow(lockedScroll, [cols])
  useOverflow(editScroll, [cols])

  useEffect(() => {
    let stop = false
    ;(async () => {
      try {
        const res = await blockCatalog()
        if (!stop) setPalette(Array.isArray(res) ? res : [])
      } catch {
        if (!stop) setPalette([])
      }
    })()
    return () => {
      stop = true
    }
  }, [])

  const occupied = new Map(blocks.map((b) => [`${b.row}:${b.col}`, b]))

  const point = async (row, col) => {
    setProbe(`${row}:${col}`)
    try {
      await pointAtCell(row, col)
      onChanged(`Pointed the cursor at row ${row}, column ${col} — nothing written`)
    } catch (err) {
      onError(err.message)
    }
  }

  const place = async () => {
    if (!target || !choice) return
    setWorking('placing')
    try {
      const res = await placeBlock(target.row, target.col, Number(choice))
      if (res?.ok === false) throw new Error('The unit refused that placement.')
      const block = palette.find((b) => b.page === Number(choice))
      onChanged(
        linear
          ? `Placed ${block?.name} in slot ${target.col}`
          : `Placed ${block?.name} at row ${target.row}, column ${target.col}`
      )
      setTarget(null)
      setChoice('')
    } catch (err) {
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
   * put back if the placement fails. Losing a block to a half-finished move
   * would be a worse bug than refusing the move outright.
   */
  const move = async (from, to) => {
    const block = occupied.get(`${from.row}:${from.col}`)
    if (!block) return
    if (occupied.has(`${to.row}:${to.col}`)) {
      onError('That cell is taken — clear it first.')
      return
    }

    setWorking('moving')
    try {
      await clearCell(from.row, from.col)
      const res = await placeBlock(to.row, to.col, block.effectId)
      if (res?.ok === false) {
        await placeBlock(from.row, from.col, block.effectId)
        throw new Error('The unit refused that position — the block was put back.')
      }
      onChanged(
        linear
          ? `Moved ${block.name} to slot ${to.col}`
          : `Moved ${block.name} to row ${to.row}, column ${to.col}`
      )
      setTarget(null)
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
      setDragging(null)
      setOver(null)
    }
  }

  const remove = async (row, col) => {
    setWorking('clearing')
    try {
      await clearCell(row, col)
      onChanged(`Cleared row ${row}, column ${col}`)
      setTarget(null)
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  const buildStarter = async () => {
    setWorking('starter')
    try {
      const chain = STARTER_ORDER.map((slug) => palette.find((b) => b.slug === slug)).filter(
        Boolean
      )
      const fits = chain.slice(0, cols)
      for (const [i, block] of fits.entries()) {
        const res = await placeBlock(1, linear ? i + 1 : i + 1, block.page)
        if (res?.ok === false) throw new Error(`The unit refused ${block.name}.`)
      }
      onChanged(`Built a starter chain — ${fits.map((b) => b.name).join(', ')}`)
      await readGrid().catch(() => {})
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /*
   * Locked: the grid as it is, and no way to change it by accident.
   *
   * This used to be a separate read-only Grid component rendered above the
   * editor — the same picture drawn twice by two files, one of which could
   * write. Editing behind an explicit mode is the same idea and one component:
   * you can always see the chain, and you have to say so before you can move
   * anything in it.
   */
  if (!armed) {
    return (
      <section className="grid-editor">
        <div className="history-head">
          <p className="silk-label">The chain</p>
          <div className="history-actions">
            <button className="chip" onClick={() => setArmed(true)}>
              Edit the grid
            </button>
          </div>
        </div>

        <div className="grid-scroll" ref={lockedScroll}>
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(76px, 1fr))` }}
          >
            {Array.from({ length: rows * cols }, (_, i) => {
              const row = Math.floor(i / cols) + 1
              const col = linear ? (i % cols) + 1 : i % cols
              const here = occupied.get(`${row}:${col}`)
              return (
                <div
                  key={i}
                  className={`cell ${here ? 'filled' : ''}`}
                  title={`Row ${row}, column ${col}`}
                >
                  {here ? (
                    <span className="cell-name">{here.name}</span>
                  ) : (
                    <span className="cell-coord mono">{linear ? col : `${row}·${col}`}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

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
        <p className="silk-label">Build the chain</p>
        <div className="history-actions">
          <button className="chip" onClick={buildStarter} disabled={busy || !!working}>
            {working === 'starter' ? 'Building…' : 'Starter chain'}
          </button>
          <button className="chip" onClick={() => setArmed(false)}>
            Lock
          </button>
        </div>
      </div>

      <p className="hint">
        Click a cell to select it. <strong>Point</strong> moves the unit&rsquo;s cursor without
        writing anything — use it once to confirm the app and the hardware agree about which cell
        is which.
      </p>

      <div className="grid-scroll" ref={editScroll}>
        <div
          className="grid editable"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(76px, 1fr))` }}
        >
          {Array.from({ length: rows * cols }, (_, i) => {
            const row = Math.floor(i / cols) + 1
            // Linear devices address slots 1..n; matrix devices report columns
            // 0-indexed and the client shifts them at the wire boundary.
            const col = linear ? (i % cols) + 1 : i % cols
            const here = occupied.get(`${row}:${col}`)
            const selected = target?.row === row && target?.col === col
            const probed = probe === `${row}:${col}`

            return (
              <button
                key={i}
                className={`cell-btn ${here ? 'filled' : ''} ${selected ? 'selected' : ''} ${
                  probed ? 'probed' : ''
                } ${over === `${row}:${col}` ? 'over' : ''} ${
                  dragging?.row === row && dragging?.col === col ? 'lifting' : ''
                }`}
                onClick={() => setTarget({ row, col })}
                draggable={!!here && !working}
                onDragStart={(e) => {
                  setDragging({ row, col })
                  e.dataTransfer.effectAllowed = 'move'
                  // Firefox won't start a drag without payload, even unused.
                  e.dataTransfer.setData('text/plain', `${row}:${col}`)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setOver(null)
                }}
                onDragOver={(e) => {
                  if (!dragging || here) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOver(`${row}:${col}`)
                }}
                onDragLeave={() => setOver((o) => (o === `${row}:${col}` ? null : o))}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragging && !here) move(dragging, { row, col })
                }}
                title={`Row ${row}, column ${col}`}
              >
                {here ? (
                  <span className="cell-name">{here.name}</span>
                ) : (
                  <span className="cell-coord mono">{linear ? col : `${row}·${col}`}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {target ? (
        <div className="cell-actions">
          <span className="diff-label mono">
            {linear ? `slot ${target.col}` : `row ${target.row}, column ${target.col}`}
          </span>

          <button className="chip" onClick={() => point(target.row, target.col)} disabled={busy}>
            Point at it
          </button>

          {occupied.has(`${target.row}:${target.col}`) ? (
            <button
              className="chip"
              onClick={() => remove(target.row, target.col)}
              disabled={busy || !!working}
            >
              {working === 'clearing' ? 'Clearing…' : 'Clear cell'}
            </button>
          ) : (
            <>
              <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">
                  {palette.length ? 'Choose a block…' : 'No palette from this unit'}
                </option>
                {palette.map((b) => (
                  <option key={`${b.slug}-${b.page}`} value={b.page}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={place} disabled={busy || !choice || !!working}>
                {working === 'placing' ? 'Placing…' : 'Place'}
              </button>
            </>
          )}

          {occupied.has(`${target.row}:${target.col}`) ? (
            <button
              className="chip"
              onClick={() => setDragging(dragging ? null : { ...target })}
              disabled={busy || !!working}
            >
              {dragging ? 'Cancel move' : 'Move to…'}
            </button>
          ) : dragging ? (
            <button
              className="primary"
              onClick={() => move(dragging, target)}
              disabled={busy || !!working}
            >
              {working === 'moving' ? 'Moving…' : 'Move here'}
            </button>
          ) : null}

          <button
            className="chip"
            onClick={() => {
              setTarget(null)
              setDragging(null)
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  )
}
