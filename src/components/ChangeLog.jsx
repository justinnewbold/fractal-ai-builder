import { useState } from 'react'
import { formatTime } from '../lib/log'

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
