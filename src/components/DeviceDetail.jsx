import { useState } from 'react'
import { getHost, setHost, isDemo, setDemo } from '../lib/forgefx'
import { remoteActive } from '../lib/remote'
import Theme from './Theme'
import { FULL } from '../lib/version'

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

  /*
   * A reload, not a re-read. Which end this is was decided when the page
   * loaded, and the demo decides it: a phone leaving the demo must be told
   * it is a phone again, or it keeps the Mac's error for good.
   */
  const toggleDemo = () => {
    setDemo(!demo)
    window.location.reload()
  }

  return (
    <div className="device-detail">
      {status === 'live' && device ? (
        <div className="device-meta mono">
          {/* The commit rides with the number. A version is hand-written and can
              be forgotten — seven merges went out under 6.9.5 — while the hash
              changes on its own with every single build, so "am I looking at
              the deploy that has my fix in it" is answerable without trusting
              anyone's memory. */}
          {FULL} · gen {device.gen}
          {/* The AM4 has a four-slot chain and reports no grid. "grid ×" with
              nothing either side of it isn't a fact about the unit. */}
          {grid?.rows && grid?.cols ? ` · grid ${grid.rows}×${grid.cols}` : ''} ·{' '}
          {device.capabilities?.sceneCount} scenes · {device.capabilities?.presets?.count} slots
        </div>
      ) : null}

      {status !== 'live' ? <div className="device-meta mono">{FULL}</div> : null}

      <div className="device-detail-row">
        {editing ? (
          <>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              aria-label="Address of the Fractal app on your Mac"
            />
            <button onClick={save}>Use this address</button>
          </>
        ) : (
          <>
            <span className="device-meta mono">
              {demo ? 'simulated' : remote ? 'through your Mac' : getHost()}
            </span>
            <button onClick={toggleDemo}>{demo ? 'Use real device' : 'Demo mode'}</button>
            {!demo && !remote ? (
              <button onClick={() => setEditing(true)}>Change address</button>
            ) : null}
            {/*
              The word depends on whether anything is disconnected.

              "Says connected to Mac. But has a reconnect button. That shouldn't
              say reconnect if already connected." Quite right: the button did
              the same two things either way — poke the link, then read the unit
              — and only one of those is worth a name when the link is up. On a
              live connection this is a re-read, which is the thing you want
              after somebody has turned a knob on the front panel, and saying so
              is more use than offering to fix a connection that is not broken.
            */}
            <button onClick={onRetry} disabled={busy}>
              {busy ? 'Reading…' : status === 'live' ? 'Read the unit again' : 'Reconnect'}
            </button>
            {/* Light or dark is set about as often as the host address. */}
            <Theme />
          </>
        )}
      </div>
    </div>
  )
}
