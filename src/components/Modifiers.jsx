import { useEffect, useRef, useState } from 'react'
import { beatFlash } from '../lib/feedback'
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

  // The AM4 exposes a modifier model but reports modBind false: the data is
  // there, the wire binding isn't. Showing an Attach button that cannot attach
  // would be worse than showing nothing.
  if (!model || model.bindable === false) return null

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
 * Per-scene editing.
 *
 * A scene isn't a saved set of values — it's which blocks are engaged and which
 * channel each is on. Eight of those per preset is how one preset covers a
 * whole set, and until now they were switchable but not editable.
 *
 * Reading them means visiting each scene, because there's no query for a scene
 * you aren't in. That's audible, so it happens on request rather than on load.
 */
export function SceneMatrix({ blocks, count = 8, names = [], onError, onChanged, busy }) {
  const [scenes, setScenes] = useState(null)
  const [reading, setReading] = useState(null)
  const [writing, setWriting] = useState(null)

  const editable = blocks.filter((b) => !['input', 'output'].includes(b.slug))

  const load = async () => {
    setReading({ done: 0, total: count })
    try {
      const { readAllScenes } = await import('../lib/forgefx')
      const res = await readAllScenes(count, (done, total) => setReading({ done, total }))
      setScenes(res.scenes)
    } catch (err) {
      onError(err.message)
    } finally {
      setReading(null)
    }
  }

  const toggle = async (sceneIndex, block, currentlyBypassed) => {
    const key = `${sceneIndex}:${block.effectId}`
    setWriting(key)
    try {
      const { setSceneBlock } = await import('../lib/forgefx')
      await setSceneBlock(sceneIndex, block.effectId, { bypassed: !currentlyBypassed })

      setScenes((prev) =>
        prev.map((scene) =>
          scene.index !== sceneIndex
            ? scene
            : {
                ...scene,
                blocks: scene.blocks.map((b) =>
                  b.effectId === block.effectId ? { ...b, bypassed: !currentlyBypassed } : b
                )
              }
        )
      )
      onChanged(
        `${block.name} ${!currentlyBypassed ? 'off' : 'on'} in scene ${sceneIndex + 1}`
      )
    } catch (err) {
      onError(err.message)
    } finally {
      setWriting(null)
    }
  }

  const stateFor = (sceneIndex, eid) =>
    scenes?.find((s) => s.index === sceneIndex)?.blocks.find((b) => b.effectId === eid)

  return (
    <section className="scene-matrix">
      <div className="history-head">
        <p className="silk-label">Scene map</p>
        <div className="history-actions">
          <button className="chip" onClick={load} disabled={busy || !!reading}>
            {reading ? `Reading scene ${reading.done} of ${reading.total}…` : scenes ? 'Re-read' : 'Read scenes'}
          </button>
        </div>
      </div>

      {!scenes && !reading ? (
        <p className="hint">
          Reading the map visits each scene in turn — there&rsquo;s no way to ask about a scene
          you&rsquo;re not in, so you&rsquo;ll hear it switch. It returns to where you started.
        </p>
      ) : null}

      {scenes ? (
        <>
          <div className="grid-scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="silk-label">Block</th>
                  {scenes.map((s) => (
                    <th key={s.index} className="silk-label" title={names[s.index] || ''}>
                      {s.index + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {editable.map((block) => (
                  <tr key={block.effectId}>
                    <td className="matrix-name">{block.name}</td>
                    {scenes.map((s) => {
                      const cell = stateFor(s.index, block.effectId)
                      const on = cell ? !cell.bypassed : false
                      const key = `${s.index}:${block.effectId}`
                      return (
                        <td key={s.index}>
                          <button
                            className={`dot-btn ${on ? 'on' : ''} ${writing === key ? 'busy' : ''}`}
                            onClick={() => toggle(s.index, block, !on)}
                            disabled={busy || !!writing || !cell}
                            aria-label={`${block.name} in scene ${s.index + 1}: ${
                              on ? 'engaged' : 'bypassed'
                            }`}
                            title={cell ? (on ? 'Engaged' : 'Bypassed') : 'No state reported'}
                          >
                            <span className="dot" />
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="hint">
            Click a dot to turn a block on or off in that scene. Each change switches to that
            scene to write, then switches back &mdash; so you&rsquo;ll hear it.
          </p>
        </>
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

  // /tempo/tap answers only {ok} — the device computes the tempo from the tap
  // spacing, so the new value is read back, debounced past the last tap.
  const tapReadback = useRef(null)
  const tap = async (e) => {
    beatFlash(e.currentTarget)
    try {
      await tapTempo()
      clearTimeout(tapReadback.current)
      tapReadback.current = setTimeout(async () => {
        try {
          const res = await getTempo()
          if (typeof res?.bpm === 'number') {
            setBpm(res.bpm)
            setDraft(String(res.bpm))
          }
        } catch {
          /* keep the last known value */
        }
      }, 700)
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
