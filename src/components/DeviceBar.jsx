import { useState } from 'react'
import { getHost, setHost, isDemo, setDemo } from '../lib/forgefx'
import { remoteActive } from '../lib/remote'

export default function DeviceBar({ status, device, onRetry, busy }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(getHost())

  const save = () => {
    setHost(draft)
    setEditing(false)
    onRetry()
  }

  const demo = isDemo()
  /*
   * A remote session doesn't go to the saved address, so printing it is a lie —
   * and an expensive one. It's what makes a phone relaying through the Mac look
   * like a phone that has somehow reached its own localhost, which sends you
   * looking for a networking problem that isn't there.
   */
  const remote = remoteActive()
  const grid = device?.capabilities?.grid

  const toggleDemo = () => {
    setDemo(!demo)
    onRetry()
  }

  const label =
    status === 'live'
      ? device?.name || 'Connected'
      : status === 'fault'
        ? 'No device'
        : 'Looking…'

  return (
    <div className="device-bar">
      <div className="lamp" data-state={demo ? 'demo' : status} />
      <div className="device-name">{label}</div>

      {status === 'live' && device ? (
        <div className="device-meta mono">
          gen {device.gen}
          {/* The AM4 has a four-slot chain and reports no grid. "grid ×" with
              nothing either side of it isn't a fact about the unit. */}
          {grid?.rows && grid?.cols ? ` · grid ${grid.rows}×${grid.cols}` : ''} ·{' '}
          {device.capabilities?.sceneCount} scenes · {device.capabilities?.presets?.count} slots
        </div>
      ) : null}

      <div className="spacer" />

      {editing ? (
        <>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label="Address of the helper app on your Mac"
          />
          <button onClick={save}>Use this address</button>
        </>
      ) : (
        <>
          <span className="device-meta mono">
            {demo ? 'simulated' : remote ? 'remote session' : getHost()}
          </span>
          <button onClick={toggleDemo}>{demo ? 'Use real device' : 'Demo mode'}</button>
          {!demo && !remote ? (
            <button onClick={() => setEditing(true)}>Change address</button>
          ) : null}
          <button onClick={onRetry} disabled={busy}>
            {busy ? 'Reading…' : 'Reconnect'}
          </button>
        </>
      )}
    </div>
  )
}
