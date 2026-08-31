import { useEffect, useRef, useState } from 'react'
import { cabState, listIrBanks, backupPreset, loadPresetBytes, liveMeters } from '../lib/forgefx'

/**
 * A device enum, as one readable word.
 *
 * ForgeFX serves its discrete selections as {value, label} — cab mode, cab
 * bank, DynaCab type. Handing one of those straight to React throws "objects
 * are not valid as a React child" and takes the whole view down with it, which
 * is what this panel did on hardware while rendering perfectly in demo.
 */
const label = (v) => (v && typeof v === 'object' ? (v.label ?? v.name ?? null) : (v ?? null))

/**
 * Cab and impulse response picker.
 *
 * The cab is doing more to the sound than most of the amp controls, and it's the
 * one thing the generator can't reason about well — an IR is a recording of a
 * specific speaker in a specific room, and the names don't carry that.
 */
export function CabPicker({ blocks, onError, onChanged, busy }) {
  const cab = blocks.find((b) => b.slug === 'cab')
  const [state, setState] = useState(null)
  const [banks, setBanks] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!cab) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [s, b] = await Promise.all([cabState(cab.effectId), listIrBanks()])
        if (cancelled) return
        setState(s?.error ? null : s)
        // GET /cab/irs is the bank→names map itself. Reaching for a `banks`
        // key that only the old mock ever had left this permanently null, so
        // the line below never rendered on a real unit.
        setBanks(b && typeof b === 'object' && !b.error ? (b.banks ?? b) : null)
      } catch (err) {
        if (!cancelled) onError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cab, onError])

  if (!cab) return null

  return (
    <section className="cab">
      <p className="silk-label">Cabinet</p>

      {loading ? <p className="progress mono">Reading cab state…</p> : null}

      {state?.slots?.length ? (
        <div className="cab-slots">
          {state.slots.map((slot) => (
            <div className="cab-slot" key={slot.slot}>
              <span className="silk-label">Slot {slot.slot}</span>
              <span className="cab-ir">{slot.irName || `IR ${slot.irIndex ?? '—'}`}</span>
              <span className="cab-bank mono">{label(slot.bank)}</span>
            </div>
          ))}
          {label(state.mode) ? <span className="cab-mode mono">{label(state.mode)}</span> : null}
        </div>
      ) : !loading ? (
        <p className="hint">
          This unit didn't return cab slot state. The cab model can still be changed from the
          editor.
        </p>
      ) : null}

      {banks ? (
        <p className="hint">
          {Object.entries(banks)
            .map(([name, list]) => `${name}: ${Array.isArray(list) ? list.length : 0}`)
            .join(' · ')}{' '}
          impulse responses available.
        </p>
      ) : null}
    </section>
  )
}

/**
 * Verbatim preset backup.
 *
 * Saved history stores generated specs, which describe an intent. This stores
 * the preset itself — the thing you'd want back if a write went somewhere
 * unexpected.
 */
export function Backup({ preset, onError, onChanged, busy }) {
  const [note, setNote] = useState(null)
  const fileInput = useRef(null)

  const download = async () => {
    try {
      const dump = await backupPreset(preset?.number)
      const bytes = dump?.bytes
      if (!Array.isArray(bytes) || !bytes.length) throw new Error('The unit returned no data.')

      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safe = (dump.name || preset?.name || 'preset').trim().replace(/[^\w-]+/g, '_')
      a.href = url
      a.download = `${String(preset?.number ?? 0).padStart(3, '0')}-${safe}.syx`
      a.click()
      URL.revokeObjectURL(url)
      onChanged(`Backed up slot ${preset?.number} to a file`)
    } catch (err) {
      onError(err.message)
    }
  }

  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const bytes = [...new Uint8Array(await file.arrayBuffer())]
      if (bytes[0] !== 0xf0 || bytes[bytes.length - 1] !== 0xf7) {
        throw new Error("That doesn't look like a Fractal preset file.")
      }
      await loadPresetBytes(bytes)
      setNote('Loaded into the edit buffer. Play it, then save it to a slot to keep it.')
      onChanged(`Loaded ${file.name} into the edit buffer`)
    } catch (err) {
      onError(err.message)
    } finally {
      event.target.value = ''
    }
  }

  return (
    <section className="backup">
      <p className="silk-label">Back up this preset</p>
      <div className="history-actions">
        <button className="chip" onClick={download} disabled={busy}>
          Back up slot {preset?.number ?? '--'} to a file
        </button>
        <button className="chip" onClick={() => fileInput.current?.click()} disabled={busy}>
          Restore a preset from a file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".syx,application/octet-stream"
          onChange={upload}
          style={{ display: 'none' }}
        />
      </div>
      <p className="hint">
        Saves the preset you have loaded as a file on your computer. To back up every slot at
        once, use the whole-unit backup in Library.
      </p>
      <p className="hint">
        A restored file lands in the edit buffer, not a slot — so you hear it before it overwrites
        anything. Save it from the bar at the top to keep it.
      </p>
      {note ? <p className="hint">{note}</p> : null}
    </section>
  )
}

/**
 * Live output meters.
 *
 * Polled rather than streamed: ForgeFX's browser runtime replaces the SSE
 * endpoint, and a poll every 400ms is enough to see where signal is without
 * saturating a serial port that writes also have to share.
 */
export function Meters({ active }) {
  const [rows, setRows] = useState([])
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (!on || !active) return
    let stop = false

    const tick = async () => {
      try {
        const data = await liveMeters()
        if (!stop) setRows(Array.isArray(data) ? data : data?.blocks || [])
      } catch {
        if (!stop) setOn(false) // unsupported on this unit; don't hammer it
      }
      if (!stop) setTimeout(tick, 400)
    }
    tick()

    return () => {
      stop = true
    }
  }, [on, active])

  return (
    <section className="meters">
      <div className="log-head">
        <button className="chip" onClick={() => setOn(!on)} disabled={!active}>
          {on ? 'Stop meters' : 'Live meters'}
        </button>
      </div>

      {on ? (
        rows.length ? (
          <div className="meter-list">
            {/*
              One row per monitored parameter — a block can expose several, so
              the key is the pair, not the block. The level is `norm`: `level`
              was invented by the old mock and is undefined on a real unit,
              which drew every bar at zero width under a blank label, with each
              row claiming the same undefined React key.
            */}
            {rows.map((row) => (
              <div className="meter-row" key={`${row.effectId}:${row.paramName}`}>
                <span className="diff-label">{row.paramName || `Block ${row.effectId}`}</span>
                <div className="meter-track">
                  <div
                    className="meter-fill"
                    style={{ width: `${Math.round(Math.min(1, Math.max(0, row.norm ?? 0)) * 100)}%` }}
                  />
                </div>
                {typeof row.db === 'number' ? (
                  <span className="mono meter-db">{row.db.toFixed(1)} dB</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">No meter data — this unit may not report per-block levels.</p>
        )
      ) : null}
    </section>
  )
}
