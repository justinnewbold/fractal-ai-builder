import { useEffect, useState } from 'react'
import { desktopBridge, updateAdvice, updateReady } from '../lib/desktop'
import { VERSION } from '../lib/version'

/**
 * Updates, where somebody can see them.
 *
 * "I quit the app and restarted, I'm on 7.50.0, no update notification. In
 * addition to a notification that pops up can we add a check for update button
 * in settings?"
 *
 * Both halves of that are right. The updater downloaded quietly and installed
 * on quit and never said a word anywhere except the menu-bar menu — an icon
 * nobody has a reason to click. So an update could be sitting there finished
 * while the app looked exactly as it had before.
 *
 * Renders nothing outside the Mac app: a phone and a browser have no updater
 * to talk to, and a section explaining one they cannot use is worse than no
 * section.
 */
export default function Updates() {
  const bridge = desktopBridge()
  const [state, setState] = useState(null)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!bridge) return undefined
    let stop = false
    bridge.updates
      .state()
      .then((s) => !stop && setState(s))
      .catch(() => {})
    const off = bridge.updates.onState((s) => !stop && setState(s))
    return () => {
      stop = true
      off?.()
    }
  }, [bridge])

  if (!bridge) return null

  const line = state?.line
  const advice = updateAdvice(state)

  return (
    <div className="updates">
      <p className="hint mono">Version {VERSION}</p>
      {/*
        The app's own words for what is happening, built in the main process so
        this and the menu-bar menu cannot say different things about the same
        download.
      */}
      <p className={updateReady(state) ? 'updates-ready' : 'hint'}>
        {line || 'Nothing checked yet this session.'}
      </p>
      {advice ? <p className="hint">{advice}</p> : null}
      <div className="history-actions">
        <button
          className="chip"
          disabled={asking || state?.kind === 'checking'}
          onClick={async () => {
            setAsking(true)
            try {
              await bridge.updates.check()
            } catch {
              // The state above says what happened; a thrown check is not news.
            } finally {
              setAsking(false)
            }
          }}
        >
          {state?.kind === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
      </div>
    </div>
  )
}

/**
 * The one line worth showing outside Setup.
 *
 * Only when an update is downloaded and waiting, because that is the only
 * state where the person can finish it — and quitting is something they were
 * going to do anyway. Never a dialog, never a restart: the whole reason this
 * was quiet in the first place is that an app which restarts itself mid-set is
 * intolerable, and that part was right.
 */
export function UpdateReadyNotice() {
  const bridge = desktopBridge()
  const [state, setState] = useState(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!bridge) return undefined
    let stop = false
    bridge.updates
      .state()
      .then((s) => !stop && setState(s))
      .catch(() => {})
    const off = bridge.updates.onState((s) => !stop && setState(s))
    return () => {
      stop = true
      off?.()
    }
  }, [bridge])

  if (!bridge || hidden || !updateReady(state)) return null

  return (
    <div className="notice updates-notice">
      <p>
        {state.version ? `Version ${state.version} is ready.` : 'An update is ready.'} It installs
        when you quit the app &mdash; nothing is interrupted until then.
      </p>
      <div className="history-actions">
        <button className="chip" onClick={() => setHidden(true)}>
          Got it
        </button>
      </div>
    </div>
  )
}
