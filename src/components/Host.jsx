import { useEffect, useRef, useState } from 'react'
import {
  cloudStatus,
  cloudLogin,
  cloudLogout,
  remoteStatus,
  remoteEnable,
  readHostDoc,
  writeHostDoc
} from '../lib/forgefx'

/**
 * That the host is wanted, kept where the cable is.
 *
 * ForgeFX holds the switch in memory and nothing writes it down, so every
 * restart of the helper — an update, a reboot, a crash — turns the phone link
 * off without saying anything. From the phone that is indistinguishable from a
 * broken connection, and the fix is a machine you may not be standing next to.
 *
 * So the intent is remembered, in ForgeFX's own document store rather than this
 * browser's: it belongs to the Mac with the cable in it, not to whichever
 * browser last opened the page.
 */
const WANTED = 'remote.host'

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
  const [note, setNote] = useState(null)

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

  const armed = useRef(false)

  useEffect(() => {
    refresh()
  }, [])

  /*
   * Put it back on after a restart took it off.
   *
   * Only ever re-arms what someone turned on here before, only on the machine
   * holding the cable, and only once per visit — this restores a decision that
   * was already made rather than making one.
   */
  useEffect(() => {
    if (armed.current || !cloud?.enabled || !cloud?.user || !host || host.enabled) return
    armed.current = true
    ;(async () => {
      const doc = await readHostDoc(WANTED)
      if (!doc?.wanted) return
      try {
        const res = await remoteEnable(true)
        if (res?.error) return // Said plainly by the status line below.
        setNote('The helper had restarted with the host off. Switched it back on.')
        await refresh()
      } catch {
        // Nothing to say here that the status line won't say better.
      }
    })()
  }, [cloud, host])

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
    setNote(null)
    try {
      const res = await remoteEnable(on)
      if (res?.error) onError(res.error)
      // Remembered either way: turning it off is as much a decision as turning
      // it on, and re-arming something someone switched off would be worse than
      // not re-arming at all.
      await writeHostDoc(WANTED, { wanted: !!on && !res?.error, at: Date.now() })
      await refresh()
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /**
   * Off, then on.
   *
   * The helper reports `connected` from a channel handle it sets once and never
   * clears, so a socket that died an hour ago still reads as "host online" —
   * and the phone, which can only tell that nothing answers, gets blamed for a
   * link that is deaf at this end. Rejoining is the cure and there is no way to
   * ask for it: turning it off and on again is what the terminal did.
   */
  const restart = async () => {
    setWorking('restart')
    setNote(null)
    try {
      await remoteEnable(false)
      const res = await remoteEnable(true)
      if (res?.error) onError(res.error)
      else setNote('Rejoined the channel. Test the link from the phone.')
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
          The helper app on your Mac isn&rsquo;t set up for this yet. Add the three settings shown
          below to its <span className="mono">.env</span> file, restart it, and this will wake up.
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
            {/* The channel is the account, so two ends signed in as different
                accounts each work perfectly and never meet. The phone prints
                the same eight characters when it connects; if they differ,
                that is the whole problem and nothing else will show it. */}
            {host?.userId ? ` · channel ${host.userId.slice(0, 8)}…` : ''}
          </p>
          <p className="hint">
            With the host on, open this app on your phone, go to{' '}
            <strong>Run this from another device</strong> and sign in as the same account. The phone
            shows the same eight characters when it connects &mdash; if they don&rsquo;t match, the
            two ends are on different channels and neither will ever hear the other.
          </p>
          {note ? <p className="hint">{note}</p> : null}
          {host?.enabled ? (
            <p className="hint">
              &ldquo;Host online&rdquo; is the helper reporting a channel it opened, not one it has
              heard from &mdash; a socket that died an hour ago still reads that way. If the phone
              says nothing answers, rejoin the channel here.
            </p>
          ) : null}
          {!host?.enabled ? (
            <p className="hint">
              The helper forgets this switch when it restarts, and a phone can&rsquo;t tell that
              from a broken connection. Turned on here, it gets switched back on for you next time
              this page is open at the Mac.
            </p>
          ) : null}
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
            {host?.enabled ? (
              <button className="chip" onClick={restart} disabled={working === 'restart'}>
                {working === 'restart' ? 'Rejoining…' : 'Rejoin the channel'}
              </button>
            ) : null}
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
