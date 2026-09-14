import { useEffect, useRef, useState } from 'react'
import { clearDebugLog, formatDebugLog, formatLine, formatMacDiag, getDebugLog, onDebugLog } from '../lib/debugLog'
import { wireReport } from './Diagnostics'
import { serverDiag } from '../lib/forgefx'
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

  /*
   * The Mac's own account, fetched when the log is copied rather than kept
   * live: it is one request, it can take a few seconds over the relay, and
   * it is only wanted in the paste. A Mac that does not answer is said so
   * in the same place, which is itself a finding.
   */
  const macReport = async () => {
    try {
      return formatMacDiag(await serverDiag())
    } catch (e) {
      return `MAC'S DEVICE SERVER — could not be asked: ${e?.message || e}`
    }
  }

  const text = (mac = '') =>
    formatDebugLog(
      {
        app: `${FULL} — built ${BUILT_AT} UTC`,
        unit: device?.short || device?.name || 'none',
        model: device?.model,
        /*
         * Over the relay the report also says WHICH Mac app answered. The
         * phone runs today's web build the moment it reloads; the Mac runs
         * whatever was installed, and a fix that lives in the Mac app is not
         * on until that app has been restarted into it — which the report
         * could not show, so "still broken" and "not updated yet" read alike.
         */
        link: link?.role
          ? `${link.role} · ${describeLink(link).note || ''}${
              link.role === 'remote' && link.link === 'connected'
                ? ` · Mac app ${link.macVersion ? `v${link.macVersion}` : 'older than 7.190.0 (does not say)'}`
                : ''
            }`
          : undefined,
        platform: platform(),
        screen: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : undefined,
        browser: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        at: new Date().toISOString()
      },
      [wireReport(), mac].filter(Boolean).join('\n\n')
    )

  /* The last resort for either button: the text selected in a box, for a
     long-press Copy — the one thing a phone never refuses. */
  const showToSelect = (t) => {
    setFallback(t)
    setCopied(null)
    setTimeout(() => box.current?.select?.(), 0)
  }

  const copyText = async (t) => {
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
        showToSelect(t)
      }
    }
  }

  const copy = async () => {
    const t = text(await macReport())
    setFallback('')
    await copyText(t)
    setTimeout(() => setCopied(null), 3000)
  }

  /*
   * The same report as one file, rather than a paste.
   *
   * "Can we make it so when we copy the bug log it's just a text file that I
   * can paste instead of paste in the entire chat?" The log is a few hundred
   * lines plus the Mac's own account; pasted, it is the whole conversation
   * for a screen and a half. As a .txt it is one attachment.
   *
   * On a phone the share sheet takes a file straight to the chat app. Where
   * there is no share sheet — a Mac in a browser — the file downloads, named
   * by the moment it was taken so two of them do not overwrite each other. If
   * the browser will do neither, the text goes on the clipboard instead: a
   * report that arrives the old way beats one that does not arrive.
   */
  const fileName = () =>
    `fractal-remote-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`

  const shareFile = async () => {
    const t = text(await macReport())
    setFallback('')
    try {
      const file = new File([t], fileName(), { type: 'text/plain' })
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Fractal Remote debug log' })
          setCopied('Shared as a file')
        } catch (err) {
          // Closing the sheet without picking anything is not a failure.
          if (err?.name === 'AbortError') {
            setCopied(null)
            return
          }
          throw err
        }
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
        setCopied('Saved as a file')
      }
    } catch {
      await copyText(t)
    }
    setTimeout(() => setCopied(null), 3000)
  }

  const shown = all.slice(-120)

  return (
    <section className="debug-log">
      <div className="diag-actions">
        <button className="chip" onClick={shareFile}>
          {copied || 'Share as file'}
        </button>
        <button className="chip" onClick={copy}>
          Copy log
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
        unit and what it said back, every error. When something goes wrong, share it as a file and
        attach that to the chat — or copy it and paste, if you would rather.
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
