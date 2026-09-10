import { useRef, useState } from 'react'
import {
  blockParams,
  clearDeviceCache,
  currentPreset,
  getScene,
  presetBlocks,
  readGrid
} from '../lib/forgefx'
import { formatPresetReport, silenceFaults } from '../lib/presetReport'
import { describeLink } from '../lib/link'
import { FULL, BUILT_AT } from '../lib/version'
import { platform } from '../lib/platform'

/**
 * Ask the unit everything about the preset in front of you, and say what in
 * it would keep it quiet.
 *
 * "Can we set up a way to read the parameters of the current scene to
 * investigate why there is no sound on any of the scenes in this preset?"
 *
 * Every fact here was already readable and none of it was ever gathered: the
 * blocks with their positions and what is wired into them, whether each one is
 * on in this scene and on which channel, every parameter with its value and
 * range, and the routing grid in the unit's own words. lib/presetReport.js
 * does the judging; this does the reading, on a tap rather than on a timer,
 * because it is a dozen round trips down a port that carries the audio.
 *
 * The grid goes in raw. Block placement is the part of ForgeFX worked out from
 * the protocol rather than confirmed against hardware, so the exact shape of
 * what it reports is the answer to the question this panel exists to ask, and
 * summarising it would throw that away.
 */
export default function PresetReport({ device, link }) {
  const [busy, setBusy] = useState(null)
  const [report, setReport] = useState(null)
  const [faults, setFaults] = useState([])
  const [issue, setIssue] = useState(null)
  const [copied, setCopied] = useState(null)
  const [fallback, setFallback] = useState('')
  const box = useRef(null)

  const read = async () => {
    setBusy('Reading the preset…')
    setIssue(null)
    setFallback('')
    try {
      /* Values first-hand where the app can have them. At the Mac this clears
         ForgeFX's parameter cache; from a phone it is refused, and the read is
         whatever the cache holds — worth knowing, so it is said in the header
         rather than hidden. */
      let fresh = true
      await clearDeviceCache().catch(() => {
        fresh = false
      })

      const preset = await currentPreset().catch(() => null)
      const scene = await getScene().catch(() => null)
      const blocks = await presetBlocks()
      const grid = await readGrid().catch(() => null)

      const params = {}
      for (const [i, block] of blocks.entries()) {
        setBusy(`Reading ${block.name || block.slug} — ${i + 1} of ${blocks.length}`)
        try {
          const res = await blockParams(block.effectId)
          params[block.effectId] = res?.named || []
        } catch {
          // A block that will not read is left out of the values rather than
          // stopping the report: the rest of it still answers the question.
        }
      }

      const index = typeof scene?.index === 'number' ? scene.index : null
      const sceneName = (scene?.names || [])[index] || ''
      const found = silenceFaults({ blocks, params, sceneName })
      setFaults(found)
      setReport(
        formatPresetReport({
          header: {
            app: `${FULL} — built ${BUILT_AT} UTC`,
            unit: device?.short || device?.name || 'none',
            link: link?.role ? `${link.role} · ${describeLink(link).note || ''}` : undefined,
            platform: platform(),
            values: fresh
              ? 'read fresh from the unit'
              : 'from the unit’s cache — clearing it only works at the Mac',
            at: new Date().toISOString()
          },
          preset,
          sceneIndex: index,
          sceneName,
          blocks,
          params,
          grid,
          faults: found
        })
      )
    } catch (err) {
      setIssue(err?.message || String(err))
    } finally {
      setBusy(null)
    }
  }

  /* The same three tries the debug log makes: the clipboard, the share sheet,
     then the text selected in a box, which no phone refuses. */
  const copy = async () => {
    if (!report) return
    setFallback('')
    try {
      await navigator.clipboard.writeText(report)
      setCopied('Copied — paste it into the chat')
    } catch {
      try {
        if (navigator.share) {
          await navigator.share({ title: 'Fractal Remote preset report', text: report })
          setCopied('Shared')
        } else throw new Error('no share')
      } catch {
        setFallback(report)
        setCopied(null)
        setTimeout(() => box.current?.select?.(), 0)
      }
    }
    setTimeout(() => setCopied(null), 3000)
  }

  return (
    <section className="preset-report">
      <div className="diag-actions">
        <button className="chip" onClick={read} disabled={!!busy}>
          {busy ? 'Reading…' : report ? 'Read it again' : 'Read this preset'}
        </button>
        <button className="chip" onClick={copy} disabled={!report}>
          {copied || 'Copy report'}
        </button>
      </div>

      <p className="hint">
        Reads every block in the preset you are on — where it sits, whether it is on in this scene,
        which channel it is on, every value, and how the unit says the grid is wired. Then it says
        what in there would stop it making a sound.
      </p>

      {busy ? <p className="hint mono">{busy}</p> : null}
      {issue ? <p className="chain-issue">{issue}</p> : null}

      {report ? (
        <>
          {faults.length ? (
            <ul className="preset-report-faults">
              {faults.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          ) : (
            <p className="hint">
              Nothing this read can see would keep it quiet — every block is connected, on, and
              above its floor. Copy the report into the chat and it can be taken further.
            </p>
          )}

          {fallback ? (
            <textarea
              ref={box}
              className="debug-log-text mono"
              readOnly
              value={fallback}
              rows={8}
              aria-label="Preset report, selected for copying"
            />
          ) : null}

          <div className="log-body debug-log-body">
            <pre className="mono hint preset-report-text">{report}</pre>
          </div>
        </>
      ) : null}
    </section>
  )
}
