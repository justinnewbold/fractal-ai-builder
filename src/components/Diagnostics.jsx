import { useState } from 'react'
import { getWireLog, clearWireLog } from '../lib/forgefx'
import { FULL, BUILT_AT } from '../lib/version'
import { fromNormalized } from '../lib/scale'

/**
 * What actually went on the wire.
 *
 * The device accepts an out-of-range write silently — it clamps and reports
 * success — so "did it work" can't be answered from the response. This shows
 * the real value, the converted value, and the range used for the conversion,
 * which is enough to tell a conversion bug from a stale build without opening
 * browser devtools.
 */
export default function Diagnostics() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])

  const refresh = () => setRows(getWireLog())

  const show = () => {
    refresh()
    setOpen(true)
  }

  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const current = getWireLog()
    const lines = [
      `${FULL} — built ${BUILT_AT} UTC`,
      `${current.length} writes`,
      '',
      'parameter | wanted | sent | means | range',
      ...current.map((r) => {
        const means = r.sent === null || !r.range ? '—' : round4(fromNormalized(r.sent, r.range))
        const range = r.range
          ? `${r.range.min}–${r.range.max}${r.range.log ? ' log' : ''}${r.outOfRange ? ' OUTSIDE' : ''}`
          : 'NO RANGE'
        return `${r.name || '#' + r.paramId} | ${r.wanted} | ${r.sent === null ? 'refused' : round4(r.sent)} | ${means} | ${range}`
      })
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  const suspicious = rows.filter(
    (r) => r.sent === null || r.sent === 0 || r.sent === 1 || r.outOfRange
  )

  return (
    <section className="diagnostics">
      <div className="log-head">
        <button className="chip" onClick={() => (open ? setOpen(false) : show())}>
          {open ? 'Hide what was sent' : 'What was sent'}
        </button>
        <span className="hint mono">
          {FULL} &middot; built {BUILT_AT} UTC
        </span>
      </div>

      {open ? (
        <>
          <div className="diag-actions">
            <button className="chip" onClick={refresh}>
              Refresh
            </button>
            <button className="chip" onClick={copy}>
              {copied ? 'Copied' : 'Copy all as text'}
            </button>
            <button
              className="chip"
              onClick={() => {
                clearWireLog()
                setRows([])
              }}
            >
              Clear
            </button>
            {suspicious.length ? (
              <span className="problem mono">
                {suspicious.length} write{suspicious.length > 1 ? 's' : ''} landed at an extreme
              </span>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <p className="hint">Nothing written yet this session.</p>
          ) : (
            <div className="diag-table">
              <div className="diag-row diag-head-row silk-label">
                <span>Parameter</span>
                <span>Wanted</span>
                <span>Sent</span>
                <span>Means</span>
                <span>Range</span>
              </div>
              {rows.map((row, i) => {
                const extreme =
                  row.sent === null || row.sent === 0 || row.sent === 1 || row.outOfRange
                return (
                  <div className="diag-row mono" key={i} data-extreme={extreme}>
                    <span className="diag-name">{row.name || `#${row.paramId}`}</span>
                    <span>{fmt(row.wanted)}</span>
                    <span>{row.sent === null ? 'refused' : round4(row.sent)}</span>
                    <span>
                      {row.sent === null || !row.range ? '—' : fmt(fromNormalized(row.sent, row.range))}
                    </span>
                    <span className="diag-range">
                      {row.range
                        ? `${row.range.min}–${row.range.max}${row.range.log ? ' log' : ''}${
                            row.outOfRange ? ' · OUTSIDE' : ''
                          }`
                        : 'no range'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <p className="hint diag-note">
            Sent is the normalised 0–1 value that went to the device. Means is what that converts
            back to. If Wanted and Means disagree, the conversion is wrong. If Sent shows the raw
            number instead of a decimal, this build is stale.
          </p>
        </>
      ) : null}
    </section>
  )
}

function fmt(n) {
  if (typeof n !== 'number') return '—'
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString()
  return Math.round(n * 100) / 100
}

function round4(n) {
  return Math.round(n * 10000) / 10000
}
