import { useState } from 'react'
import { getWireLog, clearWireLog, getCheckLog, clearCheckLog, sceneNameTrace } from '../lib/forgefx'
import { getGenerationLog } from '../lib/stream'
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
  const [checks, setChecks] = useState([])
  // Read straight from the log rather than snapshotting it into state: this
  // panel is most wanted right after something went wrong, and a stale copy of
  // the very events being asked about would be the one useless version.
  const gen = getGenerationLog()

  const refresh = () => {
    setRows(getWireLog())
    setChecks(getCheckLog())
  }

  const show = () => {
    refresh()
    setOpen(true)
  }

  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const current = getWireLog()
    const verified = getCheckLog()
    const lines = [
      `${FULL} — built ${BUILT_AT} UTC`,
      `${current.length} writes, ${verified.length} verifications`,
      '',
      'VERIFIED — parameter | wanted | read back | landed | encoding | attempt | device said',
      ...verified.map(
        (c) =>
          `${c.name || '#' + c.paramId} | ${c.wanted} | ${
            c.readBack === null ? 'unreadable' : c.readBack
          } | ${c.landed ? 'yes' : 'NO'} | ${c.encoding ? 'cont' : 'disc'} | ${c.attempt} | ${
            c.deviceOk === undefined ? '—' : c.deviceOk ? 'ok' : 'ok:false'
          }`
      ),
      '',
      'parameter | wanted | sent | means | range | encoding',
      ...current.map((r) => {
        const means = r.sent === null || !r.range ? '—' : round4(fromNormalized(r.sent, r.range))
        const range = r.range
          ? `${r.range.min}–${r.range.max}${r.range.log ? ' log' : ''}${r.outOfRange ? ' OUTSIDE' : ''}`
          : 'NO RANGE'
        return `${r.name || '#' + r.paramId} | ${r.wanted} | ${r.sent === null ? 'refused' : round4(r.sent)} | ${means} | ${range} | ${r.continuous ? 'cont' : 'disc'}`
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

      {/*
          What the model side did, which used to be visible only in devtools.
          The device has had a wire log for a long time; a generation that sat
          there for four minutes had no record at all, so "what was it doing"
          could only be guessed at. Each line is a real event with the time it
          happened, so a slow model and a dead connection stop looking alike.
      */}
      {gen.length ? (
        <div className="diag-block">
          <p className="silk-label">Last generations</p>
          {gen.map((e, i) => (
            <p key={i} className="mono hint">
              {new Date(e.at).toLocaleTimeString()} · {e.event}
              {typeof e.ms === 'number' ? ` at ${(e.ms / 1000).toFixed(1)}s` : ''}
              {e.blocks !== undefined ? ` · ${e.blocks} blocks` : ''}
              {e.kind ? ` · ${e.kind}` : ''}
              {e.message ? ` — ${e.message}` : ''}
            </p>
          ))}
        </div>
      ) : null}

      {sceneNameTrace.length ? (
        <div className="diag-block">
          <p className="silk-label">Last scene-name lookup</p>
          {sceneNameTrace.map((step, i) => (
            <p key={i} className="mono hint">
              {step}
            </p>
          ))}
        </div>
      ) : null}

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
                clearCheckLog()
                setRows([])
                setChecks([])
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

          {checks.length ? (
            <div className="diag-table">
              <div className="diag-row diag-head-row silk-label">
                <span>Verified</span>
                <span>Wanted</span>
                <span>Read back</span>
                <span>Landed</span>
                <span>Enc</span>
                <span>Device said</span>
              </div>
              {checks.map((c, i) => (
                <div className="diag-row mono" key={`c${i}`} data-extreme={!c.landed}>
                  <span className="diag-name">{c.name || `#${c.paramId}`}</span>
                  <span>{fmt(c.wanted)}</span>
                  <span>{c.readBack === null ? 'unreadable' : fmt(c.readBack)}</span>
                  <span>{c.landed ? 'yes' : 'NO'}</span>
                  <span className="diag-range">
                    {c.encoding ? 'cont' : 'disc'}
                    {c.attempt > 1 ? ` · retry` : ''}
                  </span>
                  <span className="diag-range">
                    {c.deviceOk === undefined ? '—' : c.deviceOk ? 'ok' : 'ok:false'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

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
                <span>Enc</span>
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
                    <span className="diag-range">{row.continuous ? 'cont' : 'disc'}</span>
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

          <p className="hint diag-note">
            Read back is what the device reported after the write, with its cache cleared first —
            the only trustworthy signal that a value stuck. Device said is the unit&rsquo;s own
            verdict, which an AM4 gets wrong: it reports <span className="mono">ok:false</span> on
            continuous writes that landed correctly, because it waits for an acknowledgement the
            unit doesn&rsquo;t send. A row marked <span className="mono">retry</span> means the
            first encoding didn&rsquo;t take and the other one was tried.
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
