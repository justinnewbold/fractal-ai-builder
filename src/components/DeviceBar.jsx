import { useState } from 'react'
import { getHost, setHost } from '../lib/forgefx'

export default function DeviceBar({ status, device, onRetry, busy }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(getHost())

  const save = () => {
    setHost(draft)
    setEditing(false)
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
      <div className="lamp" data-state={status} />
      <div className="device-name">{label}</div>

      {status === 'live' && device ? (
        <div className="device-meta mono">
          gen {device.gen} · grid {device.capabilities?.grid?.rows}×
          {device.capabilities?.grid?.cols} · {device.capabilities?.sceneCount} scenes ·{' '}
          {device.capabilities?.presets?.count} slots
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
            aria-label="ForgeFX address"
          />
          <button onClick={save}>Use this address</button>
        </>
      ) : (
        <>
          <span className="device-meta mono">{getHost()}</span>
          <button onClick={() => setEditing(true)}>Change address</button>
          <button onClick={onRetry} disabled={busy}>
            {busy ? 'Reading…' : 'Reconnect'}
          </button>
        </>
      )}
    </div>
  )
}
