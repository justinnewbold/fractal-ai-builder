import { useState } from 'react'
import { formatTime } from '../lib/log'

const PAGE = 16

/**
 * Slot browser and rename.
 *
 * The FM3 holds 512 presets but doesn't support the bulk name scan, so names
 * are fetched a page at a time on request rather than all at once — 512
 * sequential reads down a serial port is not a page load.
 */
export function PresetBar({ preset, onSelect, onRename, busy }) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(() => Math.max(0, (preset?.number ?? 0) - 4))
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [jump, setJump] = useState('')

  const loadPage = async (from) => {
    setStart(from)
    setLoading('Reading names…')
    try {
      const { presetRange } = await import('../lib/forgefx')
      const found = await presetRange(from, PAGE, (done, total) =>
        setLoading(`Reading names — ${done} of ${total}`)
      )
      setSlots(found)
    } finally {
      setLoading(null)
    }
  }

  const openBrowser = () => {
    setOpen(true)
    if (!slots.length) loadPage(start)
  }

  const submitRename = () => {
    const name = draftName.trim()
    if (name) onRename(name)
    setRenaming(false)
  }

  return (
    <section className="preset-bar">
      <div className="preset-bar-row">
        <div>
          <p className="silk-label">Loaded preset</p>
          {renaming ? (
            <div className="rename-row">
              <input
                type="text"
                value={draftName}
                maxLength={31}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitRename()}
                aria-label="Preset name"
                autoFocus
              />
              <button onClick={submitRename} disabled={busy || !draftName.trim()}>
                Rename
              </button>
              <button onClick={() => setRenaming(false)}>Cancel</button>
            </div>
          ) : (
            <h2 className="preset-name">
              {preset?.name?.trim() || 'Untitled'}
              <span className="preset-slot mono"> · slot {preset?.number}</span>
            </h2>
          )}
        </div>

        <div className="preset-bar-actions">
          {!renaming ? (
            <button
              onClick={() => {
                setDraftName(preset?.name?.trim() || '')
                setRenaming(true)
              }}
              disabled={busy}
            >
              Rename
            </button>
          ) : null}
          <input
            type="text"
            className="jump"
            value={jump}
            placeholder="Go to slot"
            onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && jump) {
                onSelect(Number(jump))
                setJump('')
              }
            }}
            aria-label="Jump to preset slot"
          />
          <button onClick={() => (open ? setOpen(false) : openBrowser())} disabled={busy}>
            {open ? 'Hide presets' : 'Browse presets'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="browser">
          <div className="browser-nav">
            <button onClick={() => loadPage(Math.max(0, start - PAGE))} disabled={start === 0 || !!loading}>
              Earlier
            </button>
            <span className="mono browser-range">
              {start}–{start + PAGE - 1}
            </span>
            <button onClick={() => loadPage(Math.min(511 - PAGE + 1, start + PAGE))} disabled={!!loading}>
              Later
            </button>
            {loading ? <span className="progress mono">{loading}</span> : null}
          </div>

          <div className="slot-grid">
            {slots.map((slot) => (
              <button
                key={slot.number}
                className={`slot ${slot.number === preset?.number ? 'current' : ''}`}
                onClick={() => onSelect(slot.number)}
                disabled={busy}
              >
                <span className="slot-num mono">{slot.number}</span>
                <span className="slot-name">{slot.name || <em>empty</em>}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** Everything this app has sent to the hardware, newest first. */
export function ChangeLog({ log, onClear }) {
  const [open, setOpen] = useState(false)
  if (!log.length) return null

  return (
    <section className="log">
      <div className="log-head">
        <button className="chip" onClick={() => setOpen(!open)}>
          {open ? 'Hide log' : `Change log · ${log.length}`}
        </button>
        {open ? (
          <button className="chip" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="log-body">
          {log.map((entry) => (
            <div className="log-entry" key={entry.id} data-kind={entry.kind}>
              <div className="log-line">
                <span className="mono log-time">{formatTime(entry.at)}</span>
                <span className="log-summary">{entry.summary}</span>
              </div>
              {entry.detail?.length ? (
                <div className="log-detail">
                  {entry.detail.map((d, i) => (
                    <p key={i} className="mono">
                      {d}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Generation takes real time — a schema read walks every block down a single
 * serial port before the model is even called. Silence during that reads as a
 * hang, so this shows what stage it's actually in.
 */
export function Thinking({ message }) {
  if (!message) return null
  return (
    <div className="thinking" role="status" aria-live="polite">
      <span className="thinking-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="mono">{message}</span>
    </div>
  )
}
