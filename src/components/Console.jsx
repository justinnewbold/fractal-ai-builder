import { useEffect, useState } from 'react'
import Knob from './Knob'
import { blockParams, blockTypes, setParamConfirmed, setType, setBypass, setChannel } from '../lib/forgefx'
import { isSilencingParam } from '../lib/guardrails'

/**
 * Block colours, matched to how Fractal's own editors code them.
 *
 * The colour is doing real work: on a chain of four abbreviated tiles it's the
 * fastest way to read what kind of block sits where, faster than the three
 * letters printed on it.
 */
const FAMILY_COLOR = {
  wah: '#3f63c8',
  filter: '#3f63c8',
  drive: '#b32d2d',
  amp: '#8b8f96',
  cab: '#3f8f5c',
  comp: '#2f8f8f',
  compressor: '#2f8f8f',
  geq: '#c07a2a',
  peq: '#c07a2a',
  delay: '#2a7f9c',
  reverb: '#6b3fbf',
  chorus: '#4a5fb8',
  flanger: '#4a5fb8',
  phaser: '#5a4fb8',
  tremolo: '#8a5fb0',
  pitch: '#a04f8a',
  gate: '#6f7480',
  ingate: '#6f7480',
  volume: '#6f7480',
  volpan: '#6f7480',
  looper: '#6f7480',
  enhancer: '#4a8f7a',
  rotary: '#8a5fb0',
  synth: '#a04f8a',
  input: '#555b66',
  output: '#555b66'
}

/** Three-letter tile labels, the way the hardware abbreviates them. */
const SHORT = {
  wah: 'WAH',
  drive: 'DRV',
  amp: 'AMP',
  cab: 'CAB',
  comp: 'CMP',
  compressor: 'CMP',
  geq: 'GEQ',
  peq: 'PEQ',
  delay: 'DLY',
  reverb: 'REV',
  chorus: 'CHO',
  flanger: 'FLG',
  phaser: 'PHA',
  tremolo: 'TRM',
  pitch: 'PIT',
  gate: 'GTE',
  ingate: 'IGT',
  filter: 'FLT',
  volume: 'VOL',
  volpan: 'VOL',
  looper: 'LPR',
  enhancer: 'ENH',
  rotary: 'ROT',
  input: 'IN',
  output: 'OUT'
}

const shortName = (slug) => SHORT[slug] || (slug || '??').slice(0, 3).toUpperCase()
const colorFor = (slug) => FAMILY_COLOR[slug] || '#6f7480'

/** The signal chain, as coloured tiles with the active channel on each. */
export function Chain({ blocks, selected, onSelect }) {
  const chain = blocks.filter((b) => !['input', 'output'].includes(b.slug))

  return (
    <div className="fx-panel">
      <p className="panel-title">Effects</p>
      <div className="chain-strip">
        <span className="io-arrow" aria-hidden="true">
          ▶
        </span>
        {chain.map((block) => (
          <button
            key={block.effectId}
            className={`fx-tile ${selected === block.effectId ? 'selected' : ''} ${
              block.bypassed ? 'bypassed' : ''
            }`}
            style={{ '--tile': colorFor(block.slug) }}
            onClick={() => onSelect(block.effectId)}
            title={block.name}
          >
            <span className="fx-abbr">{shortName(block.slug)}</span>
            <span className="fx-chan">{block.channel || 'A'}</span>
          </button>
        ))}
        <span className="io-arrow" aria-hidden="true">
          ▶
        </span>
      </div>
    </div>
  )
}

/** Bank-grouped preset list, the way the hardware numbers them. */
export function PresetList({ slots, current, onSelect, onScan, scanning, deviceSlots }) {
  return (
    <div className="preset-panel">
      <div className="panel-head">
        <p className="panel-title">Presets</p>
        <button className="icon-btn" onClick={onScan} disabled={scanning} title="Read names">
          {scanning ? '…' : '⟳'}
        </button>
      </div>

      <div className="preset-scroll">
        {slots.length === 0 ? (
          <p className="hint pad">Press ⟳ to read preset names off the unit.</p>
        ) : (
          slots.map((slot, i) => {
            const bank = String.fromCharCode(65 + Math.floor(slot.number / 4))
            const within = (slot.number % 4) + 1
            const newBank = i === 0 || Math.floor(slot.number / 4) !== Math.floor(slots[i - 1].number / 4)
            return (
              <button
                key={slot.number}
                className={`preset-row ${slot.number === current ? 'current' : ''} ${
                  newBank ? 'bank-start' : ''
                }`}
                onClick={() => onSelect(slot.number)}
              >
                <span className="preset-id mono">
                  {bank}
                  {within}:
                </span>
                <span className="preset-title">{slot.name || <em>empty</em>}</span>
              </button>
            )
          })
        )}
      </div>
      {deviceSlots ? <p className="hint pad">{deviceSlots} slots on this unit</p> : null}
    </div>
  )
}

/**
 * The selected block: its channel, its model, and its controls as knobs.
 *
 * Knob edits are live — they write as you release, the way the hardware editors
 * do, because a tone control you have to confirm isn't a tone control. That's a
 * deliberate exception to this app's stage-then-send rule, which still governs
 * everything the generator produces.
 */
export function BlockPanel({ block, channels, onError, onChanged, busy }) {
  const [params, setParams] = useState([])
  const [models, setModels] = useState([])
  const [tab, setTab] = useState('main')
  const [loading, setLoading] = useState(false)
  const [local, setLocal] = useState({})

  useEffect(() => {
    if (!block) return
    let stop = false
    ;(async () => {
      setLoading(true)
      setLocal({})
      try {
        const [p, t] = await Promise.all([
          blockParams(block.effectId),
          blockTypes(block.slug).catch(() => [])
        ])
        if (stop) return
        setParams(p?.named || [])
        setModels(t || [])
      } catch (err) {
        if (!stop) onError(err.message)
      } finally {
        if (!stop) setLoading(false)
      }
    })()
    return () => {
      stop = true
    }
  }, [block, onError])

  if (!block) {
    return (
      <div className="block-panel empty">
        <p className="hint pad">Select a block from the chain.</p>
      </div>
    )
  }

  const editable = params.filter((p) => !isSilencingParam(p.name))
  const level = params.find((p) => /^.*\bLevel$/i.test(p.name) && !/boost|input/i.test(p.name))

  // The first handful are the controls anyone reaches for first; the rest are
  // there but behind a tab, the way the hardware editors split them.
  const primary = editable.slice(0, 6)
  const rest = editable.slice(6)
  const shown = tab === 'main' ? primary : rest

  const valueOf = (p) => (local[p.id] !== undefined ? local[p.id] : p.value)

  const commit = async (p) => {
    const next = local[p.id]
    if (next === undefined || next === p.value) return
    try {
      const res = await setParamConfirmed(block.effectId, p.id, next, p)
      if (!res.ok) onError(`${p.name} didn't take.`)
      const fresh = await blockParams(block.effectId)
      setParams(fresh?.named || [])
      setLocal((prev) => {
        const copy = { ...prev }
        delete copy[p.id]
        return copy
      })
      onChanged(`${block.name} · ${p.name} → ${next}`)
    } catch (err) {
      onError(err.message)
    }
  }

  const swapModel = async (value) => {
    try {
      await setType(block.effectId, Number(value))
      const fresh = await blockParams(block.effectId)
      setParams(fresh?.named || [])
      onChanged(`${block.name} → ${models.find((m) => m.value === Number(value))?.name}`)
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <div className="block-panel">
      <div className="block-side">
        <p className="block-heading">{block.name}</p>

        <div
          className="block-icon"
          style={{ '--tile': colorFor(block.slug) }}
          aria-hidden="true"
        >
          {shortName(block.slug)}
        </div>

        {channels?.length ? (
          <>
            <p className="silk-label">Channel</p>
            <div className="chan-row">
              {channels.map((ch) => (
                <button
                  key={ch}
                  className={`chan-btn ${block.channel === ch ? 'current' : ''}`}
                  onClick={async () => {
                    try {
                      await setChannel(block.effectId, ch)
                      onChanged(`${block.name} → channel ${ch}`)
                    } catch (err) {
                      onError(err.message)
                    }
                  }}
                  disabled={busy}
                >
                  {ch}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {models.length ? (
          <>
            <p className="silk-label">Type</p>
            <select
              className="type-select"
              value={models.find((m) => m.name === block.typeName)?.value ?? ''}
              onChange={(e) => e.target.value !== '' && swapModel(e.target.value)}
            >
              <option value="">{models.length} models…</option>
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.name}
                  {m.basedOn ? ` — ${m.basedOn}` : ''}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <button
          className={`bypass-btn ${block.bypassed ? 'off' : ''}`}
          onClick={async () => {
            try {
              await setBypass(block.effectId, !block.bypassed)
              onChanged(`${block.name} ${!block.bypassed ? 'bypassed' : 'engaged'}`)
            } catch (err) {
              onError(err.message)
            }
          }}
          disabled={busy}
        >
          {block.bypassed ? 'Bypassed' : 'Engaged'}
        </button>
      </div>

      <div className="block-tabs">
        <button className={tab === 'main' ? 'current' : ''} onClick={() => setTab('main')}>
          Main
        </button>
        {rest.length ? (
          <button className={tab === 'more' ? 'current' : ''} onClick={() => setTab('more')}>
            More
          </button>
        ) : null}
      </div>

      <div className="knob-deck">
        {loading ? (
          <p className="hint pad">Reading {block.name}…</p>
        ) : (
          shown.map((p) => (
            <div className="knob-cell" key={p.id}>
              <Knob
                param={p}
                label={p.name}
                value={valueOf(p)}
                onChange={(v) => setLocal((prev) => ({ ...prev, [p.id]: v }))}
                onCommit={() => commit(p)}
              />
              <div className="knob-readout mono">
                {fmt(valueOf(p))}
                {p.unit ? ` ${p.unit}` : ''}
              </div>
            </div>
          ))
        )}
      </div>

      {level ? (
        <div className="level-column">
          <Knob param={level} label="Level" value={level.value} onChange={() => {}} size={52} />
          <div className="knob-readout mono">
            {fmt(level.value)} {level.unit}
          </div>
          <span className="hint">read-only</span>
        </div>
      ) : null}
    </div>
  )
}

function fmt(n) {
  if (typeof n !== 'number') return '—'
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString()
  return n.toFixed(2)
}
