import { useCallback, useEffect, useState } from 'react'
import DeviceBar from './components/DeviceBar'
import Grid from './components/Grid'
import { ToneForm, Preview } from './components/Generate'
import {
  detect,
  currentPreset,
  presetBlocks,
  readSchema,
  applyChanges,
  storePreset,
  getHost
} from './lib/forgefx'
import { validateSpec, countWrites } from './lib/validate'

import ampTypes from './data/amp-types.json'
import driveTypes from './data/drive-types.json'
import cabTypes from './data/cab-types.json'
import blockCatalog from './data/blocks.json'

const totalParams = blockCatalog.reduce((sum, b) => sum + (b.paramCount || 0), 0)

export default function App() {
  const [status, setStatus] = useState('idle')
  const [device, setDevice] = useState(null)
  const [preset, setPreset] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const [result, setResult] = useState(null)
  const [progress, setProgress] = useState(null)
  const [applied, setApplied] = useState(null)
  const [slot, setSlot] = useState('')

  const read = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const info = await detect()
      setDevice(info)
      if (!info?.connected) {
        setStatus('fault')
        setError('ForgeFX answered, but no Fractal unit is attached to it.')
        return
      }
      const [p, b] = await Promise.all([currentPreset(), presetBlocks()])
      setPreset(p)
      setBlocks(Array.isArray(b) ? b : [])
      setStatus('live')
    } catch (err) {
      setStatus('fault')
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    read()
  }, [read])

  const generate = async (description) => {
    setBusy(true)
    setError(null)
    setResult(null)
    setApplied(null)
    try {
      setProgress('Reading what the unit has loaded...')
      const schema = await readSchema(blocks, (done, total, name) =>
        setProgress(`Reading ${name} - ${done} of ${total}`)
      )

      setProgress('Designing the preset...')
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, device, blocks: schema })
      })
      const spec = await res.json()
      if (!res.ok) throw new Error(spec.error || 'Generation failed.')

      setResult(validateSpec(spec, schema))
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const failures = await applyChanges(result.changes, (done, total, label) =>
        setProgress(`${done} of ${total} - ${label}`)
      )
      setApplied({ failures, count: countWrites(result.changes) })
      await read()
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  const save = async () => {
    const number = Number(slot)
    if (!Number.isInteger(number) || number < 0) {
      setError('Enter a preset slot number.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await storePreset(number)
      setApplied((prev) => ({ ...prev, savedTo: number }))
      await read()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const writeCount = result ? countWrites(result.changes) : 0

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            Fractal <span>AI</span> Builder
          </h1>
          <p className="tagline">Describe a tone. Get a preset on the unit.</p>
        </div>
        <p className="silk-label">Phase 2 &middot; generation</p>
      </header>

      <DeviceBar status={status} device={device} onRetry={read} busy={busy} />

      {status === 'fault' ? (
        <div className="notice" data-kind="fault">
          <h2>No connection</h2>
          <p>{error}</p>
          <p>
            This app runs in the cloud, but your Fractal unit is on your desk &mdash; so it talks
            to ForgeFX running locally at <code>{getHost()}</code>.
          </p>
          <p>
            Safari blocks a secure page from calling <code>localhost</code>. Use Chrome, or run
            this app locally with <code>npm run dev</code>.
          </p>
        </div>
      ) : null}

      {status === 'live' ? (
        <>
          <ToneForm onGenerate={generate} busy={busy} disabled={status !== 'live'} />

          {progress ? <p className="progress mono">{progress}</p> : null}

          {error ? (
            <div className="notice" data-kind="fault">
              <h2>Didn&rsquo;t work</h2>
              <p>{error}</p>
            </div>
          ) : null}

          {applied ? (
            <div className="notice">
              <h2>{applied.savedTo !== undefined ? 'Saved' : 'Written to the unit'}</h2>
              <p>
                {applied.count} changes sent.
                {applied.savedTo !== undefined
                  ? ` Stored to slot ${applied.savedTo}.`
                  : ' Play it. If you want to keep it, save it to a slot below.'}
              </p>
              {applied.failures?.length
                ? applied.failures.map((f, i) => (
                    <p key={i} className="mono problem">
                      {f}
                    </p>
                  ))
                : null}
              {applied.savedTo === undefined ? (
                <div className="save-row">
                  <input
                    type="text"
                    value={slot}
                    onChange={(e) => setSlot(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Slot number"
                    aria-label="Preset slot to save into"
                  />
                  <button onClick={save} disabled={busy || !slot}>
                    Save to slot {slot || '--'}
                  </button>
                  <span className="hint">Overwrites whatever is in that slot.</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <Preview
            result={result}
            writeCount={writeCount}
            busy={busy}
            onApply={apply}
            onDiscard={() => setResult(null)}
          />

          {preset ? <Grid preset={preset} blocks={blocks} /> : null}
        </>
      ) : null}

      <section>
        <p className="silk-label" style={{ marginTop: 34 }}>
          Catalog loaded for generation
        </p>
        <div className="stats">
          <div className="stat">
            <div className="value">{ampTypes.length}</div>
            <div className="silk-label label">Amp models</div>
          </div>
          <div className="stat">
            <div className="value">{driveTypes.length}</div>
            <div className="silk-label label">Drive pedals</div>
          </div>
          <div className="stat">
            <div className="value">{cabTypes.length}</div>
            <div className="silk-label label">Cabinets</div>
          </div>
          <div className="stat">
            <div className="value">{blockCatalog.length}</div>
            <div className="silk-label label">Block slots</div>
          </div>
          <div className="stat">
            <div className="value">{totalParams.toLocaleString()}</div>
            <div className="silk-label label">Parameters</div>
          </div>
        </div>
      </section>

      <p className="footnote">
        Models and parameter ranges are read off your own hardware at generation time, so the
        designer can only pick models your unit has and only set values inside each control&rsquo;s
        real range. Anything outside it is rejected before a single write goes out. Device access
        via{' '}
        <a href="https://github.com/sKuhLight/ForgeFX" target="_blank" rel="noreferrer">
          ForgeFX
        </a>
        , an independent project not affiliated with Fractal Audio Systems.
      </p>
    </div>
  )
}
