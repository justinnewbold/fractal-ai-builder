import { useState } from 'react'
import { getHost, setHost, isDemo, setDemo } from '../lib/forgefx'
import { remoteActive } from '../lib/remote'
import Theme from './Theme'
import { VERSION } from '../lib/version'

/**
 * Everything about the connection that isn't its state.
 *
 * The state — which unit, and whether it's answering — is a permanent fact and
 * lives in the top bar now. This is the rest: what the unit is, where the
 * helper is, demo, reconnect, light or dark. Setup, touched about once a month,
 * and it used to cost a row of every screen to say so.
 *
 * This was DeviceBar, whose collapsed summary the top bar carries. What
 * survives is the fold, opened by the gear.
 */
export default function DeviceDetail({ status, device, onRetry, busy }) {
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

  return (
    <div className="device-detail">
      {status === 'live' && device ? (
        <div className="device-meta mono">
          v{VERSION} · gen {device.gen}
          {/* The AM4 has a four-slot chain and reports no grid. "grid ×" with
              nothing either side of it isn't a fact about the unit. */}
          {grid?.rows && grid?.cols ? ` · grid ${grid.rows}×${grid.cols}` : ''} ·{' '}
          {device.capabilities?.sceneCount} scenes · {device.capabilities?.presets?.count} slots
        </div>
      ) : null}

      {status !== 'live' ? <div className="device-meta mono">v{VERSION}</div> : null}

      <div className="device-detail-row">
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
            {/* Light or dark is set about as often as the host address. */}
            <Theme />
          </>
        )}
      </div>
    </div>
  )
}
