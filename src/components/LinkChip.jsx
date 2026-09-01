import { useEffect, useRef, useState } from 'react'
import { describeLink } from '../lib/link'

/**
 * The state of the phone remote, in the bar, on every screen.
 *
 * Pure: it is handed the link state and draws it. The previous chip read the
 * connection module at render time and polled it on a timer, so it was
 * right only when something else had caused a re-render, and it went red
 * over a working link because a dead presence check kept resetting the fact
 * it was reading.
 *
 * The colour says whether things are good; the word says which state; the
 * popover carries the sentence and the one action that state calls for.
 */
export default function LinkChip({ link, compact, onAction, busy }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // Nothing to say until the role is known, and nothing worth a chip in the
  // wifi role either — that link has no state to watch.
  if (!link || link.role === 'unknown' || link.role === 'wifi') return null

  const said = describeLink(link)
  if (!said.word) return null

  /** The single thing this state wants done. */
  const action =
    link.role === 'remote'
      ? link.link === 'connected'
        ? { label: 'Disconnect', kind: 'disconnect' }
        : link.link === 'no-answer'
          ? { label: 'Try now', kind: 'retry' }
          : link.link === 'joining'
            ? null
            : { label: 'Connect', kind: 'connect' }
      : link.link === 'connected'
        ? { label: 'Turn off', kind: 'mac-off' }
        : link.link === 'signed-out'
          ? { label: 'Set up', kind: 'mac-setup' }
          : { label: 'Turn on', kind: 'mac-on' }

  return (
    <span className="phone-link" ref={wrap}>
      <button
        className={`phone-chip ${compact ? 'compact' : ''} ${said.tone}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${said.sentence} — phone remote options`}
      >
        {compact ? null : <span className="lamp" data-state={said.tone === 'good' ? 'live' : said.tone === 'bad' ? 'fault' : 'idle'} />}
        {compact ? said.word : said.sentence}
      </button>

      {open ? (
        <div className="phone-pop">
          <p className="hint">{said.sentence}.</p>
          {action ? (
            <div className="phone-pop-actions">
              <button
                className="chip"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  onAction?.(action.kind)
                }}
              >
                {action.label}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  )
}
