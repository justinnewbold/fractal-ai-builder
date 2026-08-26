import { useEffect, useState } from 'react'
import { blockParams, blockTypes, setParam, setType, setBypass } from '../lib/forgefx'
import { isSilencingParam } from '../lib/guardrails'

/**
 * Hands-on editing, for when the generator gets something almost right.
 *
 * Edits are staged, not live. Every change is queued and shown as a diff until
 * it's explicitly sent — the same contract as generation, so there's exactly one
 * rule in this app for how values reach the hardware: nothing is written until
 * you say so.
 *
 * Output levels stay visible here but read-only. The generator shouldn't set
 * them; a player editing by hand still needs to see where they sit.
 */
export default function Editor({ blocks, onWritten, onError }) {
  const [openEid, setOpenEid] = useState(null)
  const [params, setParams] = useState([])
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [edits, setEdits] = useState({})
  const [modelEdit, setModelEdit] = useState(null)
  const [writing, setWriting] = useState(false)

  const active = blocks.find((b) => b.effectId === openEid)

  useEffect(() => {
    if (openEid === null) return
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setEdits({})
      setModelEdit(null)
      try {
        const block = blocks.find((b) => b.effectId === openEid)
        const [p, t] = await Promise.all([
          blockParams(openEid),
          blockTypes(block.slug).catch(() => [])
        ])
        if (cancelled) return
        setParams(p?.named || [])
        setModels(t || [])
      } catch (err) {
        if (!cancelled) onError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [openEid, blocks, onError])

  const stage = (id, raw) => {
    setEdits((prev) => {
      const next = { ...prev }
      if (raw === '' || raw === undefined) delete next[id]
      else next[id] = Number(raw)
      return next
    })
  }

  const pending = Object.entries(edits)
    .map(([id, value]) => {
      const param = params.find((p) => p.id === Number(id))
      if (!param || Number.isNaN(value)) return null
      if (value === param.value) return null
      return { id: Number(id), name: param.name, from: param.value, to: value, unit: param.unit || '' }
    })
    .filter(Boolean)

  const outOfRange = pending.filter((p) => {
    const param = params.find((x) => x.id === p.id)
    return typeof param?.min === 'number' && (p.to < param.min || p.to > param.max)
  })

  const send = async () => {
    setWriting(true)
    const detail = []
    try {
      if (modelEdit !== null) {
        const model = models.find((m) => m.value === modelEdit)
        await setType(openEid, modelEdit)
        detail.push(`${active.name} model → ${model?.name ?? modelEdit}`)
      }
      for (const change of pending) {
        const meta = params.find((x) => x.id === change.id)
        await setParam(openEid, change.id, change.to, meta)
        detail.push(`${active.name} · ${change.name} ${round(change.from)} → ${round(change.to)}${change.unit}`)
      }
      onWritten(`Edited ${active.name} by hand`, detail)
      const fresh = await blockParams(openEid)
      setParams(fresh?.named || [])
      setEdits({})
      setModelEdit(null)
    } catch (err) {
      onError(err.message)
    } finally {
      setWriting(false)
    }
  }

  const toggleBypass = async (block) => {
    try {
      await setBypass(block.effectId, !block.bypassed)
      onWritten(`${block.name} ${!block.bypassed ? 'bypassed' : 'engaged'}`, [])
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <section className="editor">
      <p className="silk-label">Adjust by hand</p>

      <div className="editor-tabs">
        {blocks.map((block) => (
          <button
            key={block.effectId}
            className={`chip ${block.effectId === openEid ? 'active' : ''}`}
            onClick={() => setOpenEid(block.effectId === openEid ? null : block.effectId)}
          >
            {block.name}
          </button>
        ))}
      </div>

      {openEid !== null ? (
        <div className="editor-panel">
          {loading ? (
            <p className="progress mono">Reading {active?.name}…</p>
          ) : (
            <>
              <div className="editor-head">
                <span className="block-name">{active?.name}</span>
                <button className="chip" onClick={() => toggleBypass(active)}>
                  {active?.bypassed ? 'Engage' : 'Bypass'}
                </button>
              </div>

              {models.length > 0 ? (
                <div className="param-row">
                  <label className="diff-label" htmlFor="model-select">
                    Model
                  </label>
                  <select
                    id="model-select"
                    value={modelEdit ?? ''}
                    onChange={(e) => setModelEdit(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">Leave unchanged</option>
                    {models.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.name}
                        {m.basedOn ? ` — ${m.basedOn}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="param-list">
                {params.map((param) => {
                  const locked = isSilencingParam(param.name)
                  return (
                    <div className="param-row" key={param.id}>
                      <label className="diff-label" htmlFor={`p-${param.id}`}>
                        {param.name}
                        {locked ? <span className="locked">read-only</span> : null}
                      </label>
                      <div className="param-input">
                        <input
                          id={`p-${param.id}`}
                          type="number"
                          step="any"
                          disabled={locked}
                          placeholder={String(round(param.value))}
                          value={edits[param.id] ?? ''}
                          onChange={(e) => stage(param.id, e.target.value)}
                        />
                        <span className="range mono">
                          {round(param.value)}
                          {param.unit} · {param.min}–{param.max}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {pending.length > 0 || modelEdit !== null ? (
                <div className="editor-confirm">
                  <div className="pending">
                    {modelEdit !== null ? (
                      <p className="mono">Model → {models.find((m) => m.value === modelEdit)?.name}</p>
                    ) : null}
                    {pending.map((p) => (
                      <p className="mono" key={p.id}>
                        {p.name} {round(p.from)} → {round(p.to)}
                        {p.unit}
                      </p>
                    ))}
                  </div>
                  {outOfRange.length ? (
                    <p className="problem mono">
                      {outOfRange.length} value{outOfRange.length > 1 ? 's' : ''} outside the allowed
                      range.
                    </p>
                  ) : null}
                  <button className="primary" onClick={send} disabled={writing || outOfRange.length > 0}>
                    {writing ? 'Writing…' : `Send ${pending.length + (modelEdit !== null ? 1 : 0)} changes`}
                  </button>
                  <button
                    onClick={() => {
                      setEdits({})
                      setModelEdit(null)
                    }}
                    disabled={writing}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}

function round(n) {
  if (typeof n !== 'number') return '—'
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100
}
