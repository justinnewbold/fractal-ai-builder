import { useEffect, useRef, useState } from 'react'
import { blockColor } from '../lib/blockColors'

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

/*
 * One palette for the whole app. This file used to carry its own, which meant
 * the chain tiles and the gig buttons could disagree about what colour a delay
 * is — and with the photo-corrected hues, they briefly did.
 */
const colorFor = (slug) => blockColor(slug).fill
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

/**
 * Bank-grouped preset list.
 *
 * Names are read one slot at a time down a serial port, so the whole list can't
 * arrive at once — it fills in as it scans, and the scan can be stopped. A
 * filter box matters more here than in most lists: 512 presets is a lot to
 * scroll, and half of them are called some variation of "Lead".
 */
export function PresetList({ slots, current, onSelect, onScan, onStop, scanning, progress, deviceSlots }) {
  const [filter, setFilter] = useState('')

  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? slots.filter(
        (s) => (s.name || '').toLowerCase().includes(needle) || String(s.number) === needle
      )
    : slots

  return (
    <div className="preset-panel">
      <div className="panel-head">
        <p className="panel-title">Presets</p>
        <button
          className="icon-btn"
          onClick={scanning ? onStop : onScan}
          title={scanning ? 'Stop' : 'Read all names'}
        >
          {scanning ? '■' : '⟳'}
        </button>
      </div>

      <input
        type="text"
        className="preset-filter"
        value={filter}
        placeholder="Filter"
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter presets"
      />

      {scanning && progress ? (
        <div className="scan-bar">
          <div className="scan-fill" style={{ width: `${progress.pct}%` }} />
          <span className="scan-text mono">
            {progress.done} / {progress.total}
          </span>
        </div>
      ) : null}

      <div className="preset-scroll">
        {slots.length === 0 ? (
          <p className="hint pad">Press ⟳ to read preset names off the unit.</p>
        ) : shown.length === 0 ? (
          <p className="hint pad">Nothing matches “{filter}”.</p>
        ) : (
          shown.map((slot, i) => {
            const bank = String.fromCharCode(65 + Math.floor(slot.number / 4))
            const within = (slot.number % 4) + 1
            const newBank =
              !needle &&
              (i === 0 || Math.floor(slot.number / 4) !== Math.floor(shown[i - 1].number / 4))
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
      {deviceSlots ? (
        <p className="hint pad">
          {slots.length} of {deviceSlots} read
        </p>
      ) : null}
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

  const commit = async (p, override) => {
    const next = override !== undefined ? override : local[p.id]
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
              <ValueBox
                param={p}
                value={valueOf(p)}
                onCommit={(v) => {
                  setLocal((prev) => ({ ...prev, [p.id]: v }))
                  commit(p, v)
                }}
              />
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

/**
 * The number under a knob, and a way to just type it.
 *
 * A knob is right for sweeping; a thumb on a phone is wrong for landing on
 * exactly 4.00. Tap the number and it becomes an input — type, and Enter or
 * tapping away commits through the same verified write as the knob. What's
 * typed clamps to the parameter's own range, the same rule the device itself
 * applies to every write.
 */
function ValueBox({ param, value, onCommit }) {
  const [text, setText] = useState(null) // null = showing, string = editing
  const abandon = useRef(false)

  const finish = () => {
    if (abandon.current) {
      abandon.current = false
      setText(null)
      return
    }
    if (text === null) return
    const n = Number(text.replace(',', '.').trim())
    setText(null)
    if (!Number.isFinite(n) || n === value) return
    const lo = typeof param.min === 'number' ? param.min : -Infinity
    const hi = typeof param.max === 'number' ? param.max : Infinity
    onCommit(Math.min(hi, Math.max(lo, n)))
  }

  return (
    <input
      className="knob-readout mono"
      type="text"
      inputMode="decimal"
      value={text !== null ? text : `${fmt(value)}${param?.unit ? ` ${param.unit}` : ''}`}
      onFocus={(e) => {
        // The unit drops out and the whole number is selected, so typing
        // replaces rather than appends to "6.70 dB".
        setText(typeof value === 'number' ? String(Math.round(value * 100) / 100) : '')
        const el = e.target
        requestAnimationFrame(() => el.select())
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          abandon.current = true
          e.currentTarget.blur()
        }
      }}
      aria-label={`${param?.name} value`}
    />
  )
}


/**
 * Tuner readout.
 *
 * Readings arrive over the event stream rather than on request, so this shows
 * whatever last came through. The bar is centre-out because that's the only
 * thing you look at while tuning — a number in cents is precise and useless
 * mid-string.
 */
export function Tuner({ reading, on }) {
  if (!on) return null

  const cents = reading?.cents ?? 0
  const inTune = Math.abs(cents) <= 3
  const offset = Math.max(-50, Math.min(50, cents))

  return (
    <div className="tuner-panel">
      <div className="tuner-note">
        {reading?.note ? (
          <>
            <span className={`note ${inTune ? 'in' : ''}`}>{reading.note}</span>
            {reading.octave !== undefined ? <span className="octave mono">{reading.octave}</span> : null}
          </>
        ) : (
          <span className="note waiting">—</span>
        )}
      </div>

      <div className="tuner-bar">
        <div className="tuner-centre" />
        <div
          className={`tuner-needle ${inTune ? 'in' : ''}`}
          style={{ left: `calc(50% + ${offset}%)` }}
        />
      </div>

      <div className="tuner-cents mono">
        {reading?.note ? `${cents > 0 ? '+' : ''}${cents} cents` : 'Play a string'}
      </div>
    </div>
  )
}
