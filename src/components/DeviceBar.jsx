import { useState } from 'react'
import { getHost, setHost, isDemo, setDemo } from '../lib/forgefx'
import { remoteActive } from '../lib/remote'
import Theme from './Theme'

/**
 * One line about the unit, everything else behind it.
 *
 * Collapsed — the default — this says the two things worth a permanent slot:
 * which unit ("FM3", "AM4") and how it's reached (connected, demo, remote,
 * offline). The grid shape, scene count, host address, demo toggle and
 * reconnect are setup, not status: touched once a month, and until now they
 * cost a full panel on every visit. They open on tap.
 */
export default function DeviceBar({ status, device, onRetry, busy }) {
  const [open, setOpen] = useState(false)
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

  // The short name is the point of the collapsed row: "FM3", not a sentence.
  const name =
    status === 'live'
      ? device?.short || device?.name || 'Connected'
      : status === 'fault'
        ? 'No device'
        : 'Looking…'

  const how =
    demo ? 'demo' : status === 'live' ? (remote ? 'remote' : 'connected') : status === 'fault' ? 'offline' : ''

  return (
    <div className="device-bar">
      <button
        className="device-summary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${name}${how ? `, ${how}` : ''} — connection details`}
      >
        <span className="lamp" data-state={demo ? 'demo' : status} />
        <span className="device-name">{name}</span>
        {/* The word carries the state as well as saying it: green when the unit
            is answering, red when it isn't, so the bar reads at a glance. */}
        {how ? (
          <span className="device-state mono" data-state={demo ? 'demo' : status}>
            {how}
          </span>
        ) : null}
        <span className={`device-chevron ${open ? 'open' : ''}`} aria-hidden="true" />
      </button>

      {open ? (
        <div className="device-detail">
          {status === 'live' && device ? (
            <div className="device-meta mono">
              gen {device.gen}
              {/* The AM4 has a four-slot chain and reports no grid. "grid ×"
                  with nothing either side of it isn't a fact about the unit. */}
              {grid?.rows && grid?.cols ? ` · grid ${grid.rows}×${grid.cols}` : ''} ·{' '}
              {device.capabilities?.sceneCount} scenes · {device.capabilities?.presets?.count}{' '}
              slots
            </div>
          ) : null}

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
                {/* Light or dark is set about as often as the host address, and
                    kept a row of every screen to itself for it. */}
                <Theme />
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
