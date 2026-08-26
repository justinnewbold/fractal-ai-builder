import { useState } from 'react'
import { pointAtCell, placeBlock, clearCell, readGrid } from '../lib/forgefx'

/**
 * Blocks that make sense to place, with the effect ids ForgeFX addresses them
 * by. Instance limits are enforced server-side — an FM3 has one amp, and
 * placeCell refuses a second rather than wasting a doomed write.
 */
const PLACEABLE = [
  { eid: 46, name: 'Compressor', slug: 'comp' },
  { eid: 94, name: 'Wah', slug: 'wah' },
  { eid: 118, name: 'Drive 1', slug: 'drive' },
  { eid: 119, name: 'Drive 2', slug: 'drive' },
  { eid: 58, name: 'Amp', slug: 'amp' },
  { eid: 62, name: 'Cab', slug: 'cab' },
  { eid: 50, name: 'Graphic EQ', slug: 'geq' },
  { eid: 54, name: 'Parametric EQ', slug: 'peq' },
  { eid: 146, name: 'Gate', slug: 'gate' },
  { eid: 78, name: 'Chorus', slug: 'chorus' },
  { eid: 82, name: 'Flanger', slug: 'flanger' },
  { eid: 90, name: 'Phaser', slug: 'phaser' },
  { eid: 106, name: 'Tremolo', slug: 'tremolo' },
  { eid: 110, name: 'Pitch', slug: 'pitch' },
  { eid: 70, name: 'Delay 1', slug: 'delay' },
  { eid: 71, name: 'Delay 2', slug: 'delay' },
  { eid: 66, name: 'Reverb', slug: 'reverb' },
  { eid: 102, name: 'Volume/Pan', slug: 'volume' }
]

/** A workable starting chain for an empty preset, left to right. */
const STARTER = [118, 58, 62, 70, 66]

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

  const rows = capabilities?.grid?.rows ?? 4
  const cols = capabilities?.grid?.cols ?? 12
  const linear = capabilities?.slotModel === 'linear'

  if (linear) return null

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
      const block = PLACEABLE.find((b) => b.eid === Number(choice))
      onChanged(`Placed ${block?.name} at row ${target.row}, column ${target.col}`)
      setTarget(null)
      setChoice('')
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
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
      for (const [i, eid] of STARTER.entries()) {
        const res = await placeBlock(1, i + 1, eid)
        if (res?.ok === false) throw new Error(`The unit refused a block at column ${i + 1}.`)
      }
      onChanged('Built a starter chain — drive, amp, cab, delay, reverb')
      await readGrid().catch(() => {})
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  if (!armed) {
    return (
      <section className="grid-editor">
        <p className="silk-label">Build the chain</p>
        <div className="notice" data-kind="fault">
          <h2>Read this first</h2>
          <p>
            Placing blocks writes the preset&rsquo;s structure, not just its settings. ForgeFX
            marks this as derived from the protocol spec rather than confirmed on hardware, so a
            bad write here mangles a preset rather than mis-setting a knob.
          </p>
          <p>
            Back up all slots first &mdash; there&rsquo;s a button for it above &mdash; and work on
            a slot you don&rsquo;t care about.
          </p>
          <button className="chip" onClick={() => setArmed(true)}>
            I&rsquo;ve backed up — let me edit the grid
          </button>
        </div>
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

      <div className="grid-scroll">
        <div
          className="grid editable"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(76px, 1fr))` }}
        >
          {Array.from({ length: rows * cols }, (_, i) => {
            const row = Math.floor(i / cols) + 1
            const col = i % cols
            const here = occupied.get(`${row}:${col}`)
            const selected = target?.row === row && target?.col === col
            const probed = probe === `${row}:${col}`

            return (
              <button
                key={i}
                className={`cell-btn ${here ? 'filled' : ''} ${selected ? 'selected' : ''} ${
                  probed ? 'probed' : ''
                }`}
                onClick={() => setTarget({ row, col })}
                title={`Row ${row}, column ${col}`}
              >
                {here ? (
                  <span className="cell-name">{here.name}</span>
                ) : (
                  <span className="cell-coord mono">
                    {row}·{col}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {target ? (
        <div className="cell-actions">
          <span className="diff-label mono">
            row {target.row}, column {target.col}
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
                <option value="">Choose a block…</option>
                {PLACEABLE.map((b) => (
                  <option key={b.eid} value={b.eid}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={place} disabled={busy || !choice || !!working}>
                {working === 'placing' ? 'Placing…' : 'Place'}
              </button>
            </>
          )}

          <button className="chip" onClick={() => setTarget(null)}>
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  )
}
