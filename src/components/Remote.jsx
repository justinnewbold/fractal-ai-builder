import { useState } from 'react'
import {
  loadRemoteConfig,
  saveRemoteConfig,
  remoteSignIn,
  remoteConnect,
  remoteDisconnect,
  remoteActive
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
  const [url, setUrl] = useState(saved?.url || '')
  const [anonKey, setAnonKey] = useState(saved?.anonKey || '')
  const [email, setEmail] = useState(saved?.email || '')
  const [password, setPassword] = useState('')
  const [state, setState] = useState(remoteActive() ? 'connected' : 'idle')
  const [note, setNote] = useState(null)

  const connect = async () => {
    if (!url.trim() || !anonKey.trim() || !email.trim() || !password) {
      onError('Fill in all four fields to connect.')
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
      saveRemoteConfig({ url: url.trim(), anonKey: anonKey.trim(), email: email.trim() })
      setState('connected')
      setNote(`Connected as ${uid.slice(0, 8)}…`)
      setPassword('')
      onConnected(true)
    } catch (err) {
      setState('idle')
      onError(err.message)
    }
  }

  const disconnect = async () => {
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
            Saving to a slot, backups and the library stay at the Mac &mdash; ForgeFX refuses those
            from a distance on purpose, so a phone can&rsquo;t overwrite a preset mid-set.
          </p>
          <div className="history-actions">
            <button className="chip" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            On the Mac: put <span className="mono">AXIS_CLOUD=1</span>,{' '}
            <span className="mono">SUPABASE_URL</span> and{' '}
            <span className="mono">SUPABASE_ANON_KEY</span> in{' '}
            <span className="mono">ForgeFX/server/.env</span>, restart it, sign in and enable the
            remote host. Then sign in here as the same user.
          </p>

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
              placeholder="Supabase anon key (publishable)"
              aria-label="Supabase anon key"
            />
          </div>
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

          <p className="hint">
            The anon key is the publishable one and is safe here. Never put a service role key in a
            browser.
          </p>
        </>
      )}

      {note ? <p className="hint">{note}</p> : null}
    </section>
  )
}
