import { useEffect, useState } from 'react'
import {
  cloudStatus,
  cloudLogin,
  cloudLogout,
  remoteStatus,
  remoteEnable
} from '../lib/forgefx'

/**
 * Turning this Mac into the host the phone talks to.
 *
 * ForgeFX signs in and enables its host agent over POST routes that are
 * deliberately local-only — they aren't on the remote allowlist, so only the
 * machine with the cable in it can drive them. POSTs can't be reached from a
 * browser address bar, which made this the last part of the setup that still
 * needed a terminal. Now it doesn't.
 *
 * Only rendered on a local session. From a phone these calls would be refused,
 * and offering a button that cannot work is worse than not offering it.
 */
export default function Host({ onError }) {
  const [cloud, setCloud] = useState(null)
  const [host, setHost] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(null)

  const refresh = async () => {
    try {
      const [c, r] = await Promise.all([cloudStatus(), remoteStatus().catch(() => null)])
      setCloud(c)
      setHost(r)
    } catch {
      // A build without the cloud module answers nothing useful; stay quiet and
      // let the "not enabled" branch explain it.
      setCloud({ enabled: false })
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const signIn = async () => {
    if (!email.trim() || !password) {
      onError('Enter the email and password you made in the panel above.')
      return
    }
    setWorking('login')
    try {
      await cloudLogin(email.trim(), password)
      setPassword('')
      await refresh()
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  const toggle = async (on) => {
    setWorking('toggle')
    try {
      const res = await remoteEnable(on)
      if (res?.error) onError(res.error)
      await refresh()
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  const signOut = async () => {
    setWorking('logout')
    try {
      await remoteEnable(false).catch(() => {})
      await cloudLogout()
      await refresh()
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  if (!cloud?.enabled) {
    return (
      <section className="host">
        <p className="silk-label">This Mac as the host</p>
        <p className="hint">
          ForgeFX isn&rsquo;t running with <span className="mono">AXIS_CLOUD=1</span> yet. Add it to{' '}
          <span className="mono">ForgeFX/server/.env</span> along with the two Supabase lines above,
          restart ForgeFX, and this will wake up.
        </p>
      </section>
    )
  }

  const user = cloud?.user

  return (
    <section className="host">
      <p className="silk-label">This Mac as the host</p>

      {!user ? (
        <>
          <p className="hint">
            Sign in as the same account you made above. The two ends have to be the same person
            &mdash; that&rsquo;s what puts them on the same private channel.
          </p>
          <div className="save-row">
            <input
              type="email"
              className="name-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Host account email"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && signIn()}
              placeholder="Password"
              aria-label="Host account password"
            />
            <button className="save-now" onClick={signIn} disabled={working === 'login'}>
              {working === 'login' ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint mono">
            Signed in as {user.email || user.id}
            {host?.connected ? ' · host online' : host?.enabled ? ' · connecting…' : ' · host off'}
          </p>
          <p className="hint">
            With the host on, open this app on your phone, go to{' '}
            <strong>Run this from another device</strong> and sign in as the same account.
          </p>
          <div className="history-actions">
            <button
              className="chip"
              onClick={() => toggle(!host?.enabled)}
              disabled={working === 'toggle'}
            >
              {working === 'toggle'
                ? 'Working…'
                : host?.enabled
                  ? 'Turn the host off'
                  : 'Turn the host on'}
            </button>
            <button className="chip" onClick={signOut} disabled={working === 'logout'}>
              Sign out
            </button>
            <button className="chip" onClick={refresh}>
              Check again
            </button>
          </div>
        </>
      )}
    </section>
  )
}
