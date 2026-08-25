import { useCallback, useEffect, useState } from 'react'
import DeviceBar from './components/DeviceBar'
import Grid from './components/Grid'
import { detect, currentPreset, presetBlocks, getHost } from './lib/forgefx'

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

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            Fractal <span>AI</span> Builder
          </h1>
          <p className="tagline">Describe a tone. Get a preset on the unit.</p>
        </div>
        <p className="silk-label">Phase 1 · device link</p>
      </header>

      <DeviceBar status={status} device={device} onRetry={read} busy={busy} />

      {status === 'fault' ? (
        <div className="notice" data-kind="fault">
          <h2>No connection</h2>
          <p>{error}</p>
          <p>
            This app runs in the cloud, but your Fractal unit is on your desk — so it talks to
            ForgeFX running locally at <code>{getHost()}</code>.
          </p>
          <p>
            Start it with <code>npm run dev</code> in the ForgeFX <code>server</code> folder, on
            Node 20. Then plug in the unit, power it on, and quit FM3-Edit — only one program can
            hold the USB port at a time.
          </p>
        </div>
      ) : null}

      {status === 'live' && preset ? <Grid preset={preset} blocks={blocks} /> : null}

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
        Every model above was read off the hardware, each with the real amp or pedal it was
        modelled on. The generator picks only from this list, so it cannot invent a model your
        unit does not have. Device access via{' '}
        <a href="https://github.com/sKuhLight/ForgeFX" target="_blank" rel="noreferrer">
          ForgeFX
        </a>
        , an independent project not affiliated with Fractal Audio Systems.
      </p>
    </div>
  )
}
