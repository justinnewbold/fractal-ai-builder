import { useEffect, useRef, useState } from 'react'
import { clearDebugLog, formatDebugLog, formatLine, getDebugLog, onDebugLog } from '../lib/debugLog'
import { wireReport } from './Diagnostics'
import { describeLink } from '../lib/link'
import { FULL, BUILT_AT } from '../lib/version'
import { platform } from '../lib/platform'

/**
 * The one log, and the one button.
 *
 * "Make a unified debug log with a copy log button to send back to you for
 * debugging in the settings menu." Everything the app records — what the AI
 * did and when, what went to the unit and what came back, what the app
 * changed, every error and crash — is one list here, in order, and Copy log
 * puts the whole of it on the clipboard with the version and the unit at the
 * top, so a bug report is one paste.
 *
 * On a phone the clipboard can refuse — it needs a fresh tap and a secure
 * page — so the fallbacks are the share sheet, and failing that the text in a
 * box already selected, which is never refused.
 */
export default function DebugLog({ device, link }) {
  // Re-rendered on every line rather than snapshotting: this panel is opened
  // right after something went wrong, and the lines about it are the ones
  // still arriving.
  const [, bump] = useState(0)
  useEffect(() => onDebugLog(() => bump((n) => n + 1)), [])

  const [copied, setCopied] = useState(null)
  const [fallback, setFallback] = useState('')
  const box = useRef(null)
  const body = useRef(null)

  const all = getDebugLog()
  // Newest at the bottom, and the box follows it.
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight
  }, [all.length])

  const text = () =>
    formatDebugLog(
      {
        app: `${FULL} — built ${BUILT_AT} UTC`,
        unit: device?.short || device?.name || 'none',
        model: device?.model,
        link: link?.role ? `${link.role} · ${describeLink(link).note || ''}` : undefined,
        platform: platform(),
        screen: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : undefined,
        browser: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        at: new Date().toISOString()
      },
      wireReport()
    )

  const copy = async () => {
    const t = text()
    setFallback('')
    try {
      await navigator.clipboard.writeText(t)
      setCopied('Copied — paste it into the chat')
    } catch {
      try {
        if (navigator.share) {
          await navigator.share({ title: 'Fractal Remote debug log', text: t })
          setCopied('Shared')
        } else throw new Error('no share')
      } catch {
        // Selected for a long-press Copy, the one thing a phone never refuses.
        setFallback(t)
        setCopied(null)
        setTimeout(() => box.current?.select?.(), 0)
      }
    }
    setTimeout(() => setCopied(null), 3000)
  }

  const shown = all.slice(-120)

  return (
    <section className="debug-log">
      <div className="diag-actions">
        <button className="chip" onClick={copy}>
          {copied || 'Copy log'}
        </button>
        <button
          className="chip"
          onClick={() => {
            clearDebugLog()
            setFallback('')
          }}
          disabled={!all.length}
        >
          Clear
        </button>
        <span className="hint mono">
          {all.length} line{all.length === 1 ? '' : 's'}
        </span>
      </div>

      <p className="hint">
        Everything that happened this session, in order — what the AI did, what was written to the
        unit and what it said back, every error. When something goes wrong, copy this and paste it
        into the chat.
      </p>

      {fallback ? (
        <textarea
          ref={box}
          className="debug-log-text mono"
          readOnly
          value={fallback}
          rows={8}
          aria-label="Debug log, selected for copying"
        />
      ) : null}

      <div className="log-body debug-log-body" ref={body}>
        {shown.length ? (
          shown.map((e, i) => (
            <p key={`${e.at}-${i}`} className="mono hint debug-line" data-source={e.source}>
              {formatLine(e)}
            </p>
          ))
        ) : (
          <p className="hint">Nothing logged yet this session.</p>
        )}
      </div>
    </section>
  )
}
