import { useEffect, useRef, useState } from 'react'
import { blockColor } from '../lib/blockColors'
import { useDismiss } from '../lib/dismiss'

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
import { bringIntoView } from '../lib/feedback'
import { useOverflow } from '../lib/overflow'
import { slotLabel, startsBank } from '../lib/slots'

/**
 * Block colours, matched to how Fractal's own editors code them.
 *
 * The colour is doing real work: on a chain of four abbreviated tiles it's the
 * fastest way to read what kind of block sits where, faster than the three
 * letters printed on it.
 */

/**
 * The signal chain, as coloured tiles with the active channel on each.
 *
 * A tile opens its block for editing; the On/Off pill under it flips the block
 * without opening anything, so kicking the drive in doesn't require a trip
 * through the editor. A quick second tap on the tile itself does the same —
 * the first tap already opened the editor, so the double costs nothing extra.
 */
export function Chain({ blocks, selected, onSelect, onToggle }) {
  const chain = blocks.filter((b) => !['input', 'output'].includes(b.slug))
  const lastTap = useRef({ id: null, at: 0 })
  const strip = useRef(null)

  /*
   * Whether there is more chain off the right edge. On a phone the strip
   * scrolls sideways with its scrollbar hidden, so a full chain simply ran off
   * the edge with a hard cut and nothing to say so. The fade that says so is
   * CSS; this is the one fact it needs, kept current on resize and scroll —
   * and shared with the grid, which has the same problem at every width.
   */
  useOverflow(strip, [chain.length])

  const tap = (block) => {
    const now = Date.now()
    if (onToggle && lastTap.current.id === block.effectId && now - lastTap.current.at < 350) {
      lastTap.current = { id: null, at: 0 }
      onToggle(block)
      return
    }
    lastTap.current = { id: block.effectId, at: now }
    onSelect(block.effectId)
  }

  return (
    <div className="fx-panel">
      {/* No heading. A row of coloured, three-letter tiles between two signal
          arrows is not something anyone needs told is the effects chain, and
          on a phone that word cost more vertical space than a tile. */}
      <div className="chain-strip" ref={strip}>
        <span className="io-arrow" aria-hidden="true">
          ▶
        </span>
        {chain.map((block) => (
          <div className="fx-cell" key={block.effectId}>
            <button
              className={`fx-tile ${selected === block.effectId ? 'selected' : ''} ${
                block.bypassed ? 'bypassed' : ''
              }`}
              style={{ '--tile': colorFor(block.slug) }}
              onClick={() => tap(block)}
              title={block.name}
            >
              <span className="fx-abbr">{shortName(block.slug)}</span>
              <span className="fx-chan">{block.channel || 'A'}</span>
            </button>
            {onToggle ? (
              <button
                className={`fx-power ${block.bypassed ? 'off' : 'on'}`}
                onClick={() => onToggle(block)}
                aria-pressed={!block.bypassed}
                aria-label={`${block.name || block.slug} ${block.bypassed ? 'off — turn on' : 'on — turn off'}`}
              >
                {block.bypassed ? 'Off' : 'On'}
              </button>
            ) : null}
          </div>
        ))}
        <span className="io-arrow" aria-hidden="true">
          ▶
        </span>
      </div>
    </div>
  )
}

/**
 * The preset list.
 *
 * Names are read one slot at a time down a serial port — and on a gen-3 unit
 * each one is a whole preset dump, because the firmware has no query for a
 * stored name. That makes a full read minutes of work rather than seconds, so
 * the scan says how long it has left, can be stopped at any point, and keeps
 * what it has already learned.
 *
 * A filter box matters more here than in most lists: 512 presets is a lot to
 * scroll, and half of them are called some variation of "Lead".
 */
export function PresetList({
  slots,
  current,
  onSelect,
  onScan,
  onStop,
  scanning,
  progress,
  deviceSlots,
  addressing,
  slowNames
}) {
  const [filter, setFilter] = useState('')
  const [showAll, setShowAll] = useState(false)

  const needle = filter.trim().toLowerCase()
  /*
   * The list shows what it knows. A slot never read used to be a row reading
   * "—", five hundred and twelve times over, with the empty-state sentence
   * underneath unreachable because the list was never empty. Now the unread
   * slots are one sentence and one chip: "Show all 512" is for going to 46
   * by eye, and a typed number always searches the whole unit.
   */
  const known = slots.filter((s) => s.name !== undefined)
  // The list is the presets, not the slots: a slot read and found empty is
  // hidden with the unread ones, behind the same "Show all" chip. On a
  // factory unit every slot is named, so this hides nothing there.
  const named = known.filter((s) => (s.name || '').trim())
  const base = needle || showAll ? slots : named
  const shown = needle
    ? base.filter(
        (s) => (s.name || '').toLowerCase().includes(needle) || String(s.number) === needle
      )
    : base
  const unread = slots.length - known.length
  const hidden = slots.length - named.length

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
            {progress.left ? ` · ${progress.left}` : ''}
          </span>
        </div>
      ) : null}

      <div className="preset-scroll">
        {named.length === 0 && !needle && !showAll ? (
          <p className="hint pad">
            {scanning ? (
              'Reading the names off the unit — they appear here as they come in.'
            ) : unread > 0 ? (
              <>
                No names read yet. Press ⟳ to read them off the unit
                {slowNames
                  ? ' — on this unit that means reading every preset, which takes a few minutes'
                  : ''}
                .
              </>
            ) : (
              'No named presets on this unit.'
            )}
          </p>
        ) : shown.length === 0 ? (
          <p className="hint pad">Nothing matches “{filter}”.</p>
        ) : (
          shown.map((slot, i) => (
            <button
              key={slot.number}
              className={`preset-row ${slot.number === current ? 'current' : ''} ${
                !needle && startsBank(slot.number, i === 0 ? null : shown[i - 1].number, addressing)
                  ? 'bank-start'
                  : ''
              }`}
              onClick={() => onSelect(slot.number)}
            >
              <span className="preset-id mono">{slotLabel(slot.number, addressing)}:</span>
              {/*
                Three states, not two. A slot whose name has been read and is
                blank IS empty; one that has never been read is unknown, and
                calling it empty is the app stating something it does not know
                — on a gen-3 unit reading all 512 takes minutes, so most of the
                list is unknown most of the time.
              */}
              <span className="preset-title">
                {slot.name === undefined ? (
                  <span className="preset-unread">—</span>
                ) : (
                  slot.name.trim() || <em>empty</em>
                )}
              </span>
            </button>
          ))
        )}
        {!needle && hidden > 0 ? (
          <p className="hint pad preset-unread-note">
            {named.length && unread > 0 ? (
              scanning ? (
                <>{unread} still to read. </>
              ) : (
                <>
                  {unread} slot{unread === 1 ? '' : 's'} not read yet — ⟳ reads them off the unit
                  {slowNames ? ' (a few minutes on this unit)' : ''}.{' '}
                </>
              )
            ) : null}
            <button className="chip" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Only the ${named.length} with names` : `Show all ${slots.length} slots`}
            </button>
          </p>
        ) : null}
      </div>
      {deviceSlots && named.length ? (
        <p className="hint pad">
          {named.length} of {deviceSlots} named
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
export function BlockPanel({ block, channels, onError, onChanged, busy, focus }) {
  const [params, setParams] = useState([])
  const [models, setModels] = useState([])
  // Which model this block is actually on. It comes back on the params read
  // and nowhere else: /preset/blocks has never carried a typeName, so the
  // `block.typeName` this used to match against was permanently undefined and
  // the picker permanently read "N models…" instead of naming the model.
  const [type, setTypeState] = useState(null)
  const [tab, setTab] = useState('main')
  // The model this block was on before the last swap, for the eight seconds
  // during which taking it back is one tap.
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)
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
        setTypeState(p?.type ?? null)
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

  // The offer belongs to the block it was made on, and dies with the panel.
  useEffect(() => {
    setUndo(null)
    return () => clearTimeout(undoTimer.current)
  }, [block?.effectId])

  /*
   * Derived above the effects that read them, and above the early return.
   *
   * A dependency array is evaluated during render, so an effect listing `rest`
   * while `rest` is declared further down throws on a const in its temporal
   * dead zone — and it throws before the panel draws anything, so the sheet
   * opens empty. React needs the early return after the hooks in any case.
   */
  const editable = params.filter((p) => !isSilencingParam(p.name))
  const level = params.find((p) => /^.*\bLevel$/i.test(p.name) && !/boost|input/i.test(p.name))

  // The first handful are the controls anyone reaches for first; the rest are
  // there but behind a tab, the way the hardware editors split them.
  const primary = editable.slice(0, 6)
  const rest = editable.slice(6)
  const shown = tab === 'main' ? primary : rest

  /*
   * Search hands over here: open the right block, then put your eyes — and the
   * cursor — on the control you named.
   *
   * Ported from the staged editor this replaced. The highlight has to wait for
   * the parameter read to finish and for the tab holding the control to be the
   * one on screen: jumping before the cell exists scrolls to nothing, which is
   * indistinguishable from a search result that did nothing.
   */
  const wanted = useRef(null)
  useEffect(() => {
    if (!focus?.nonce || focus.eid !== block?.effectId) return
    wanted.current = focus
    // A control on the second page is unreachable until that page is showing.
    const onMore = rest.some((p) => p.id === focus.paramId)
    setTab(onMore ? 'more' : 'main')
  }, [focus, block?.effectId, rest])

  useEffect(() => {
    const want = wanted.current
    if (!want || loading || !block || block.effectId !== want.eid) return
    if (!shown.some((p) => p.id === want.paramId)) return
    wanted.current = null
    const cell = document.getElementById(`p-${want.paramId}`)
    if (!cell) return
    bringIntoView(cell, { block: 'center' })
    cell.classList.add('found')
    const clear = setTimeout(() => cell.classList.remove('found'), 2000)
    return () => clearTimeout(clear)
  }, [loading, shown, block])

  if (!block) {
    return (
      <div className="block-panel empty">
        <p className="hint pad">Select a block from the chain.</p>
      </div>
    )
  }

  // What the chosen model is modelled on, for the line under the picker.
  const chosenValue =
    type && models.some((m) => m.value === type.value)
      ? type.value
      : (models.find((m) => m.name === type?.name)?.value ?? '')
  const chosen = models.find((m) => m.value === chosenValue)
  /*
   * The lineage when it is known, and the maker on its own when it is not.
   *
   * Which amp a Mark IV is voiced from is not recorded for every model, but who
   * built it is recorded for nearly all of them — and "Mesa" answers most of
   * what somebody wanted from "USA MK IV Lead" while staying true, which naming
   * a specific amp would not.
   *
   * Two verbs, because one sentence will not carry both. "Based on Mesa" is not
   * English: "based on" wants a thing, and an article does not save it — "a
   * Custom Audio Amplifiers" is worse. "Modelled on Mesa" reads correctly for
   * every one of the forty-seven makers in the catalog, single word or not.
   */
  const gear = chosen?.basedOn
    ? `Based on ${chosen.basedOn}`
    : chosen?.manufacturer
      ? `Modelled on ${chosen.manufacturer}`
      : null

  /*
   * What a model is, in the list where the choosing happens.
   *
   * "Search for the real life names that each AMP and all other effects are
   * based off of and list them next to the name." The line under the control
   * only ever described the model already chosen, which is the one model
   * nobody is wondering about: scrolling two hundred names looking for a
   * Rectifier, every one of them is a code word and the answer is a tap away
   * on each.
   *
   * The maker alone is deliberately not used here. Under the control it earns
   * its place — it is a fact about the amp in front of you — but as a suffix
   * on every row it would put "— Mesa/Boogie" beside forty models and tell
   * nobody which one is the Rectifier. A row says the specific amp or it says
   * nothing and stays short.
   */
  const listedAs = (m) => (m.basedOn ? `${m.name} — ${m.basedOn}` : m.name)

  /*
   * A list of our own, because a native one cannot say two things at once.
   *
   * "Let's make the model name that it's based off of smaller text and a
   * different color like green." An <option> is a single run of text to every
   * browser that renders one, and on iOS it is drawn by the system entirely —
   * there is no half of it to make smaller, and no half to make green. So the
   * menu is ours now: a button that opens a listbox, one row per model, the
   * name and the amp as two elements that can be styled apart.
   *
   * What the native control was good at is kept deliberately. It opened at the
   * model you were on, so this scrolls to it. It closed on a tap outside and on
   * Escape, so useDismiss does that. It took arrow keys and Enter, so those are
   * handled below. And the row stays one tall tap target rather than two lines
   * of small print.
   */
  const [picking, setPicking] = useState(false)
  const picker = useRef(null)
  const listRef = useRef(null)
  useDismiss(picker, () => setPicking(false), { open: picking, ignore: '.type-open' })

  // Open where you already are. A native menu does this and a list that starts
  // at the top of three hundred names would be a step backwards without it.
  useEffect(() => {
    if (!picking) return
    const here = listRef.current?.querySelector('[aria-selected="true"]')
    here?.scrollIntoView({ block: 'center' })
    here?.focus?.({ preventScroll: true })
  }, [picking])

  const pickAt = (i) => {
    const row = listRef.current?.querySelectorAll('.type-row')[i]
    row?.focus()
    row?.scrollIntoView({ block: 'nearest' })
  }

  const onPickKey = (e, i) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      pickAt((i + 1) % models.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      pickAt((i - 1 + models.length) % models.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      pickAt(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      pickAt(models.length - 1)
    }
  }

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
      /*
       * The numbers as well as the sentence.
       *
       * A hand change made just after a generation is the app's only labelled
       * before-and-after: the model chose p.value, the player wanted `next`.
       * lib/corrections.js turns a habit's worth of those into something the
       * next generation is told, so the same correction stops being needed.
       * The summary line stays exactly as it was, for the log a person reads.
       */
      onChanged(`${block.name} · ${p.name} → ${next}`, {
        block: block.name,
        slug: block.slug,
        param: p.name,
        from: p.value,
        to: next,
        min: p.min,
        max: p.max
      })
    } catch (err) {
      onError(err.message)
    }
  }

  /**
   * Swapping the model, and being able to take it back.
   *
   * A model swap is structural: it replaces the whole parameter set, so every
   * knob on this block means something different afterwards. That argues for a
   * confirm — but a dialog in front of a tone control is the ceremony that
   * sends people back to the hardware editor, and the one thing you want after
   * hearing a wrong amp is to be somewhere else, quickly.
   *
   * So it writes immediately and offers the way back for eight seconds. The
   * previous value is already in hand; nothing has to be read to undo it.
   */
  const applyModel = async (value, { undoable = true } = {}) => {
    const was = type
    await setType(block.effectId, Number(value))
    const fresh = await blockParams(block.effectId)
    setParams(fresh?.named || [])
    setTypeState(fresh?.type ?? null)
    setLocal({})
    const name = models.find((m) => m.value === Number(value))?.name
    onChanged(`${block.name} → ${name}`)
    clearTimeout(undoTimer.current)
    if (undoable && was && was.value !== Number(value)) {
      setUndo(was)
      undoTimer.current = setTimeout(() => setUndo(null), 8000)
    } else {
      setUndo(null)
    }
  }

  const swapModel = async (value) => {
    try {
      await applyModel(value)
    } catch (err) {
      onError(err.message)
    }
  }

  const undoModel = async () => {
    const back = undo
    if (!back) return
    setUndo(null)
    try {
      await applyModel(back.value, { undoable: false })
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <div className="block-panel">
      {/*
        Everything that isn't a knob, in two rows.
        It used to be a 190px column down the left of a four-column grid,
        because this panel was the bottom strip of a desktop console. It opens
        as a sheet now, so the layout is vertical and the budget is a phone's:
        282px of channel-type-bypass before the first control was most of what
        you could see. The name and the block's own colour are on the sheet
        header above, so neither is repeated here.
      */}
      <div className="block-switches">
        {channels?.length ? (
          <div className="chan-row" role="group" aria-label="Channel">
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
        ) : (
          <span />
        )}

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

      {undo ? (
        <div className="undo-strip" role="status">
          <span>Was {undo.name}</span>
          <button className="chip" onClick={undoModel} disabled={busy}>
            Undo
          </button>
        </div>
      ) : null}

      {models.length ? (
        <div className="type-pick" ref={picker}>
          <button
            type="button"
            className="type-open"
            aria-haspopup="listbox"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
          >
            {/* The closed control names the model and nothing else. What it is
                based on is the line underneath, in full, with no width to run
                out of — which is what the truncation was ever about. */}
            <span className="type-open-name">
              {type?.name || `${models.length} models…`}
            </span>
            <span className="type-open-caret" aria-hidden="true">
              ⌄
            </span>
          </button>

          {picking ? (
            <div className="type-list" role="listbox" aria-label="Model" ref={listRef}>
              {models.map((m, i) => (
                <button
                  type="button"
                  key={m.value}
                  role="option"
                  aria-selected={m.value === chosenValue}
                  tabIndex={-1}
                  className={`type-row ${m.value === chosenValue ? 'current' : ''}`}
                  onKeyDown={(e) => onPickKey(e, i)}
                  onClick={() => {
                    setPicking(false)
                    swapModel(m.value)
                  }}
                >
                  {/*
                    Two elements rather than one string, which is the whole
                    reason this is not a <select> any more. The name is the
                    thing being chosen and stays the size it was; the amp
                    behind it is the note that helps you find it, and reads as
                    a note — smaller, and in the green the rest of the app
                    already uses for a fact it is sure of.
                  */}
                  <span className="type-row-name">{m.name}</span>
                  {m.basedOn ? <span className="type-row-gear">{m.basedOn}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {models.length && gear ? <p className="hint pad based-on">{gear}</p> : null}

      {rest.length ? (
        <div className="block-tabs">
          <button className={tab === 'main' ? 'current' : ''} onClick={() => setTab('main')}>
            Main
          </button>
          <button className={tab === 'more' ? 'current' : ''} onClick={() => setTab('more')}>
            More
          </button>
        </div>
      ) : null}

      <div className="knob-deck">
        {loading ? (
          <p className="hint pad">Reading {block.name}…</p>
        ) : (
          shown.map((p) => (
            <div className="knob-cell" key={p.id} id={`p-${p.id}`}>
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

      {/* The block's output level: shown, never written. It's kept out of the
          deck above because a generator that sets it to -60 dB makes a preset
          that looks right and is silent — but gain staging is still something
          you need to be able to read. A row, not the 164px column it was. */}
      {level ? (
        <div className="block-level">
          <span className="silk-label">Level</span>
          <span className="mono">
            {fmt(level.value)} {level.unit}
          </span>
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
        {/* Nothing to show is the centre, not wherever the last string left it. */}
        <div
          className={`tuner-needle ${inTune ? 'in' : ''}`}
          style={{ left: reading?.note ? `calc(50% + ${offset}%)` : '50%' }}
        />
      </div>

      <div className="tuner-cents mono">
        {reading?.note ? `${cents > 0 ? '+' : ''}${cents} cents` : 'Play a string'}
      </div>
    </div>
  )
}
