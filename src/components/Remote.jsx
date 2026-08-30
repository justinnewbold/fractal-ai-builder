import { useEffect, useState } from 'react'
import {
  loadRemoteConfig,
  saveRemoteConfig,
  remoteSignIn,
  remoteSignUp,
  remoteConnect,
  remoteDisconnect,
  remoteActive,
  remoteHostSeen,
  subscribeRemoteState,
  restoreSession,
  setAutoConnect,
  wantsAutoConnect,
  DEFAULT_PROJECT
} from '../lib/remote'

/**
 * Driving the unit from a phone.
 *
 * The Mac stays plugged into the amp with ForgeFX running as a host agent; this
 * joins the same private Supabase channel and relays requests to it. Both ends
 * sign in as the same user, and the channel's RLS means nobody else can join —
 * that is the entire security model and it holds by construction.
 *
 * Credentials are kept in this browser, not in the deployed build. The app is
 * hosted publicly and the Supabase project is the player's own; baking one
 * person's project into the bundle would be wrong even with one user.
 */
export default function Remote({ onConnected, onError }) {
  const saved = loadRemoteConfig()
  const [url, setUrl] = useState(saved?.url || DEFAULT_PROJECT.url)
  const [anonKey, setAnonKey] = useState(saved?.anonKey || DEFAULT_PROJECT.anonKey)
  const [advanced, setAdvanced] = useState(false)
  const [email, setEmail] = useState(saved?.email || '')
  const [password, setPassword] = useState('')
  const [state, setState] = useState(remoteActive() ? 'connected' : 'idle')
  const [note, setNote] = useState(null)

  /*
   * Rejoin without being asked, when that's plainly what's wanted.
   *
   * Supabase keeps the session across a refresh; nothing was picking it up, so
   * every reload looked like a sign-out. This restores it and rejoins the
   * channel silently — but only for someone who was connected when they left,
   * since having signed in once is not the same as wanting to be remote.
   */
  useEffect(() => {
    if (remoteActive() || !wantsAutoConnect()) return
    let stop = false
    ;(async () => {
      const uid = await restoreSession({ url: saved?.url, anonKey: saved?.anonKey })
      if (!uid || stop) return
      try {
        await remoteConnect()
        if (stop) return
        setState('connected')
        setNote('Reconnected to the host.')
        onConnected(true)
      } catch {
        // The host may simply be off. Leaving the form is the right answer, and
        // an error on page load for something nobody asked for is not.
        setAutoConnect(false)
      }
    })()
    return () => {
      stop = true
    }
    // Runs once on mount by design: this is about the state the app opened in.
  }, [])

  /*
   * The panel follows the link rather than remembering what it last did.
   *
   * It set `connected` once, on the way in, and nothing ever unset it — so a
   * dropped socket left a panel offering a Disconnect button for a session that
   * was already gone, with no way back except reloading the page.
   */
  useEffect(
    () =>
      subscribeRemoteState((up) => {
        setState(up ? 'connected' : 'idle')
        setNote(up ? 'Reconnected to the host.' : 'The connection to the Mac dropped.')
      }),
    []
  )

  /**
   * Back on the channel without typing the password again.
   *
   * The reason a reload was the only cure for a dropped session: on load the
   * app picks up the Supabase session that's already in this browser and
   * rejoins silently, while the panel itself offered nothing but a sign-in form
   * — and the password isn't kept, on purpose. This is the load path, on a
   * button, which is what should have been under the finger all along.
   */
  const rejoin = async () => {
    setState('connecting')
    setNote(null)
    try {
      const uid = await restoreSession({ url: saved?.url, anonKey: saved?.anonKey })
      if (!uid) throw new Error('That sign-in has expired — enter your password to connect again.')
      await remoteConnect()
      setState('connected')
      setNote('Reconnected to the host.')
      setAutoConnect(true)
      onConnected(true)
    } catch (err) {
      setState('idle')
      onError(err.message)
    }
  }

  const connect = async () => {
    if (!email.trim() || !password) {
      onError('Enter your email and password to connect.')
      return
    }
    setState('connecting')
    setNote(null)
    try {
      await remoteSignIn({
        url: url.trim(),
        anonKey: anonKey.trim(),
        email: email.trim(),
        password
      })
      const uid = await remoteConnect()
      // The password is deliberately not among them.
      saveRemoteConfig({
        url: url.trim(),
        anonKey: anonKey.trim(),
        email: email.trim(),
        autoConnect: true
      })
      setState('connected')
      /*
       * Joining a channel nobody else is on succeeds perfectly well and does
       * nothing, which would look like a working connection until the first
       * request timed out. Presence settles a moment after subscribe, so the
       * check waits for it rather than reading an empty state.
       */
      setTimeout(() => {
        setNote(
          remoteHostSeen()
            ? `Connected as ${uid.slice(0, 8)}… — the host is on the channel.`
            : `Connected as ${uid.slice(0, 8)}…, but nothing else is on this channel. Turn the host on at the Mac.`
        )
      }, 1200)
      setNote(`Connected as ${uid.slice(0, 8)}…`)
      setPassword('')
      onConnected(true)
    } catch (err) {
      setState('idle')
      onError(err.message)
    }
  }

  const register = async () => {
    if (!email.trim() || !password) {
      onError('Enter an email and password to create the account.')
      return
    }
    setState('connecting')
    try {
      const res = await remoteSignUp({
        url: url.trim(),
        anonKey: anonKey.trim(),
        email: email.trim(),
        password
      })
      setState('idle')
      setNote(
        res.needsConfirmation
          ? 'Account made — confirm the email Supabase just sent, then Connect.'
          : 'Account made. Hit Connect.'
      )
    } catch (err) {
      setState('idle')
      onError(err.message)
    }
  }

  const disconnect = async () => {
    // Disconnecting is a decision; don't undo it on the next load.
    setAutoConnect(false)
    await remoteDisconnect()
    setState('idle')
    setNote('Back to the local connection.')
    onConnected(false)
  }

  return (
    <section className="remote">
      <p className="silk-label">Run this from another device</p>

      {state === 'connected' ? (
        <>
          <p className="hint">
            Relaying through your Supabase project. Changes, scenes, tempo and preset selection all
            work from here.
          </p>
          <p className="hint">
            Saving to a slot, backups and the library stay at the Mac &mdash; on purpose, so a
            phone can&rsquo;t overwrite a preset in the middle of a set.
          </p>
          <div className="history-actions">
            <button className="chip" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Whoever has connected before wants this button, not the form. */}
          {saved?.email ? (
            <div className="history-actions">
              <button className="save-now" onClick={rejoin} disabled={state === 'connecting'}>
                {state === 'connecting' ? 'Reconnecting…' : `Reconnect as ${saved.email}`}
              </button>
            </div>
          ) : null}

          <p className="hint">
            On the Mac, add these to the helper app&rsquo;s <span className="mono">.env</span> file
            and restart it, then sign in and turn the host on:
          </p>
          <pre className="mono env-block">
{`AXIS_CLOUD=1
SUPABASE_URL=${DEFAULT_PROJECT.url}
SUPABASE_ANON_KEY=${DEFAULT_PROJECT.anonKey}`}
          </pre>

          <div className="save-row">
            <input
              type="email"
              className="name-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Account email"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
              placeholder="Password"
              aria-label="Account password"
            />
            <button className="save-now" onClick={connect} disabled={state === 'connecting'}>
              {state === 'connecting' ? 'Connecting…' : 'Connect'}
            </button>
          </div>

          <div className="history-actions">
            <button className="chip" onClick={register} disabled={state === 'connecting'}>
              Create the account
            </button>
            <button className="chip" onClick={() => setAdvanced((v) => !v)}>
              {advanced ? 'Hide project settings' : 'Use a different project'}
            </button>
          </div>

          {advanced ? (
            <>
              <div className="save-row">
                <input
                  type="text"
                  className="name-field"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://yourproject.supabase.co"
                  aria-label="Supabase project URL"
                />
              </div>
              <div className="save-row">
                <input
                  type="text"
                  className="name-field"
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="Supabase anon key"
                  aria-label="Supabase anon key"
                />
              </div>
            </>
          ) : null}

          <p className="hint">
            The key above is the publishable one, which is why it can sit in plain sight. A
            signed-in user can only reach their own channel, so it grants a stranger nothing.
            Never put a service role key here.
          </p>
        </>
      )}

      {note ? <p className="hint">{note}</p> : null}
    </section>
  )
}
