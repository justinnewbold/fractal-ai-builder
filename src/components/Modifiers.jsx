import { useEffect, useState } from 'react'
import {
  modifierModel,
  bindModifier,
  sceneState,
  getTempo,
  setTempo,
  tapTempo,
  setTuner,
  blockParams
} from '../lib/forgefx'
import { isSilencingParam } from '../lib/guardrails'

/**
 * Modifiers — what makes a preset respond instead of sit still.
 *
 * A modifier attaches a source to a parameter: an envelope follower on drive so
 * it cleans up when you back off, an LFO on a filter, an expression pedal on
 * delay mix. Everything else in this app writes static values. This is the part
 * that reacts to playing.
 */
export function Modifiers({ blocks, onError, onChanged, busy }) {
  const [model, setModel] = useState(null)
  const [slot, setSlot] = useState(1)
  const [eid, setEid] = useState('')
  const [paramId, setParamId] = useState('')
  const [source, setSource] = useState('')
  const [params, setParams] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let stop = false
    ;(async () => {
      try {
        const m = await modifierModel()
        if (!stop) setModel(m?.error ? null : m)
      } catch {
        if (!stop) setModel(null)
      }
    })()
    return () => {
      stop = true
    }
  }, [])

  useEffect(() => {
    if (!eid) return setParams([])
    let stop = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await blockParams(Number(eid))
        if (!stop) setParams((res?.named || []).filter((p) => !isSilencingParam(p.name)))
      } catch (err) {
        if (!stop) onError(err.message)
      } finally {
        if (!stop) setLoading(false)
      }
    })()
    return () => {
      stop = true
    }
  }, [eid, onError])

  if (!model) return null

  const bind = async () => {
    try {
      await bindModifier(Number(slot), Number(eid), Number(paramId), Number(source))
      const block = blocks.find((b) => b.effectId === Number(eid))
      const param = params.find((p) => p.id === Number(paramId))
      const src = model.sources?.find((s) => s.value === Number(source))
      onChanged(`${src?.name} → ${block?.name} · ${param?.name} (slot ${slot})`)
    } catch (err) {
      onError(err.message)
    }
  }

  const ready = eid && paramId && source !== ''

  return (
    <section className="modifiers">
      <p className="silk-label">Modifiers</p>
      <p className="hint">
        Attach a source to a control so it moves while you play — envelope on drive, LFO on a
        filter, expression pedal on delay mix.
      </p>

      <div className="mod-grid">
        <label className="mod-field">
          <span className="diff-label">Slot</span>
          <select value={slot} onChange={(e) => setSlot(e.target.value)}>
            {Array.from({ length: model.slots || 4 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>

        <label className="mod-field">
          <span className="diff-label">Block</span>
          <select value={eid} onChange={(e) => setEid(e.target.value)}>
            <option value="">Choose…</option>
            {blocks.map((b) => (
              <option key={b.effectId} value={b.effectId}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mod-field">
          <span className="diff-label">Control</span>
          <select value={paramId} onChange={(e) => setParamId(e.target.value)} disabled={!eid}>
            <option value="">{loading ? 'Reading…' : 'Choose…'}</option>
            {params.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mod-field">
          <span className="diff-label">Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Choose…</option>
            {(model.sources || []).map((s) => (
              <option key={s.value} value={s.value}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button className="primary mod-bind" onClick={bind} disabled={busy || !ready}>
        Attach
      </button>
    </section>
  )
}

/**
 * Which blocks are on in each scene.
 *
 * Scenes were switchable but opaque — you could jump to scene 4 without knowing
 * what it does. This is the grid that makes "one preset covers the whole set"
 * legible: eight columns, one row per block, engaged or not.
 */
export function SceneMatrix({ onError }) {
  const [state, setState] = useState(null)
  const [open, setOpen] = useState(false)

  const load = async () => {
    try {
      const res = await sceneState()
      setState(res?.error ? null : res)
      setOpen(true)
    } catch (err) {
      onError(err.message)
    }
  }

  const scenes = state?.scenes || []
  const blockRows = scenes[0]?.blocks || []

  return (
    <section className="scene-matrix">
      <div className="log-head">
        <button className="chip" onClick={() => (open ? setOpen(false) : load())}>
          {open ? 'Hide scene map' : 'Scene map'}
        </button>
      </div>

      {open && scenes.length ? (
        <div className="grid-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th className="silk-label">Block</th>
                {scenes.map((s) => (
                  <th key={s.index} className="silk-label" title={s.name}>
                    {s.index + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blockRows.map((row, i) => (
                <tr key={row.eid}>
                  <td className="matrix-name">{row.name}</td>
                  {scenes.map((s) => {
                    const cell = s.blocks[i]
                    return (
                      <td key={s.index}>
                        <span className={`dot ${cell?.bypassed ? '' : 'on'}`} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : open ? (
        <p className="hint">This unit didn&rsquo;t return per-scene state.</p>
      ) : null}
    </section>
  )
}

/** Tempo and tuner — the two things that are always needed and never designed. */
export function TempoTuner({ onError, onChanged, busy }) {
  const [bpm, setBpm] = useState(null)
  const [draft, setDraft] = useState('')
  const [tuner, setTunerOn] = useState(false)

  useEffect(() => {
    let stop = false
    ;(async () => {
      try {
        const res = await getTempo()
        if (!stop && typeof res?.bpm === 'number') {
          setBpm(res.bpm)
          setDraft(String(res.bpm))
        }
      } catch {
        /* unsupported on this unit */
      }
    })()
    return () => {
      stop = true
    }
  }, [])

  const commit = async () => {
    const value = Number(draft)
    if (!Number.isFinite(value) || value < 20 || value > 400) return
    try {
      await setTempo(value)
      setBpm(value)
      onChanged(`Tempo set to ${value} BPM`)
    } catch (err) {
      onError(err.message)
    }
  }

  const tap = async () => {
    try {
      const res = await tapTempo()
      if (typeof res?.bpm === 'number') {
        setBpm(res.bpm)
        setDraft(String(res.bpm))
      }
    } catch (err) {
      onError(err.message)
    }
  }

  const toggleTuner = async () => {
    try {
      await setTuner(!tuner)
      setTunerOn(!tuner)
    } catch (err) {
      onError(err.message)
    }
  }

  if (bpm === null) return null

  return (
    <section className="tempo">
      <p className="silk-label">Tempo &amp; tuner</p>
      <div className="tempo-row">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-label="Tempo in BPM"
        />
        <span className="hint mono">BPM</span>
        <button onClick={commit} disabled={busy || draft === String(bpm)}>
          Set
        </button>
        <button onClick={tap} disabled={busy}>
          Tap
        </button>
        <button className={tuner ? 'primary' : ''} onClick={toggleTuner} disabled={busy}>
          {tuner ? 'Tuner on' : 'Tuner'}
        </button>
      </div>
      <p className="hint">Delays and modulation sync to this.</p>
    </section>
  )
}
