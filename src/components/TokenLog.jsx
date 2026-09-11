import { useState, useRef, useEffect } from 'react'
import { readLedger, byDay, clearLedger, ledgerText, utcDay } from '../lib/ledger'
import { formatCost, formatTokens } from '../lib/cost'

/**
 * What this app has actually spent, day by day, kept across sessions.
 *
 * "Can we create a log just for the token usage and have it save it and persist
 * over sessions, so I can compare what was used for the day against what it
 * said I used for that day in the app — because it's actually spending a lot
 * more than what the app says."
 *
 * Days are UTC and the panel says so, because the console groups them that way
 * and a ledger that disagreed with it by a few hours would be useless for the
 * one job it has. The number that matters most is not the total: it is the
 * count of calls that reported nothing, because a gap made of those is a
 * different problem from a gap made of arithmetic.
 */
export default function TokenLog() {
  const [rows, setRows] = useState(() => readLedger())
  const [copied, setCopied] = useState(null)
  const [fallback, setFallback] = useState('')
  const box = useRef(null)

  /* Re-read when the panel is opened rather than subscribing: a generation that
     happens while Setup is open is not something anybody is watching this for. */
  useEffect(() => {
    setRows(readLedger())
  }, [])

  const days = byDay(rows)
  const now = utcDay()

  const copy = async () => {
    const text = ledgerText(rows)
    setFallback('')
    try {
      await navigator.clipboard.writeText(text)
      setCopied('Copied')
    } catch {
      try {
        if (navigator.share) {
          await navigator.share({ title: 'Fractal Remote token usage', text })
          setCopied('Shared')
        } else throw new Error('no share')
      } catch {
        setFallback(text)
        setCopied(null)
        setTimeout(() => box.current?.select?.(), 0)
      }
    }
    setTimeout(() => setCopied(null), 3000)
  }

  return (
    <section className="token-log">
      <div className="diag-actions">
        <button className="chip" onClick={copy} disabled={!rows.length}>
          {copied || 'Copy usage'}
        </button>
        <button className="chip" onClick={() => setRows(readLedger())}>
          Refresh
        </button>
        <button
          className="chip"
          onClick={() => {
            clearLedger()
            setRows([])
            setFallback('')
          }}
          disabled={!rows.length}
        >
          Clear
        </button>
        <span className="hint mono">
          {rows.length} call{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <p className="hint">
        Every request this app has made to the AI, kept on this device and totalled by day. Days
        run in UTC so they line up with the Usage page at platform.claude.com — open that, group by
        day, and the two columns should agree.
      </p>

      {fallback ? (
        <textarea
          ref={box}
          className="debug-log-text mono"
          readOnly
          value={fallback}
          rows={8}
          aria-label="Token usage, selected for copying"
        />
      ) : null}

      {days.length ? (
        <div className="token-days">
          {days.map((d) => (
            <div className={`token-day${d.day === now ? ' today' : ''}`} key={d.day}>
              <div className="token-day-head">
                <span className="mono token-date">{d.day}</span>
                <span className="mono token-cost">{formatCost(d.cost)}</span>
              </div>
              <div className="hint mono token-line">
                {d.calls} call{d.calls === 1 ? '' : 's'}
                {Object.entries(d.kinds).map(([kind, n]) => ` · ${n} ${kind}`)}
              </div>
              <div className="hint mono token-line">
                {formatTokens(d.fresh)} in · {formatTokens(d.output)} out
                {d.cached ? ` · ${formatTokens(d.cached)} cached` : ''}
                {d.written ? ` · ${formatTokens(d.written)} cache write` : ''}
              </div>
              {Object.entries(d.models).map(([model, m]) => (
                <div className="hint mono token-line" key={model}>
                  {model}: {formatCost(m.cost)} over {m.calls} call{m.calls === 1 ? '' : 's'}
                </div>
              ))}
              {/*
                The honest gap. A request that died before the model reported
                anything really did spend tokens and really has no number — and
                knowing how many of those there were is what tells you whether a
                difference against the console is bad arithmetic or blind spots.
              */}
              {d.unknown ? (
                <div className="hint mono token-line token-unknown">
                  {d.unknown} call{d.unknown === 1 ? '' : 's'} reported no count — those spent
                  something the console will show and this cannot
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">Nothing recorded yet. It fills up as tones are built and questions asked.</p>
      )}
    </section>
  )
}
