import { useEffect, useState } from 'react'
import { currentAccount, signOut, changePassword, sendPasswordReset } from '../lib/remote'

/**
 * The account, and the three things anyone eventually needs from one.
 *
 * None of this existed. Sign-in and sign-up were the whole surface, which
 * meant a forgotten password was the end of the account and a shared one
 * could never be changed — and the way you discovered that was by needing it.
 *
 * Deliberately small, and deliberately not a "profile". There is nothing here
 * worth naming yourself in front of; an account exists so presets can follow a
 * player between machines and so a phone can find its own rig, and the honest
 * surface for that is an address, a password and a way out.
 */
export default function Account({ onError }) {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState(null)
  const [password, setPassword] = useState('')
  const [resetTo, setResetTo] = useState('')
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    let alive = true
    currentAccount()
      .then((a) => alive && setAccount(a))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const guard = async (what, fn) => {
    setBusy(what)
    setNote(null)
    try {
      await fn()
    } catch (err) {
      onError?.(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (loading) return null

  if (!account) {
    return (
      <section className="account">
        <p className="hint">
          Not signed in. An account is only needed to keep presets across machines, or to reach
          your rig from another network &mdash; on the same wifi you need neither.
        </p>

        {/*
          Reset is here, in the signed-out state, because that is the state
          someone who has forgotten a password is actually in. Offering it only
          once signed in would be a joke at their expense.
        */}
        <div className="save-row">
          <input
            type="email"
            className="name-field"
            value={resetTo}
            onChange={(e) => setResetTo(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email to send a password reset to"
          />
          <button
            className="chip"
            disabled={busy === 'reset' || !resetTo.trim()}
            onClick={() =>
              guard('reset', async () => {
                await sendPasswordReset({
                  email: resetTo.trim(),
                  redirectTo: window.location.origin
                })
                setNote('If that address has an account, a reset link is on its way.')
              })
            }
          >
            {busy === 'reset' ? 'Sending…' : 'Email a reset link'}
          </button>
        </div>
        {note ? <p className="hint">{note}</p> : null}
      </section>
    )
  }

  return (
    <section className="account">
      <p className="hint">
        Signed in as <strong>{account.email || account.id.slice(0, 8)}</strong>.
      </p>

      <div className="save-row">
        <input
          type="password"
          className="name-field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          aria-label="New password"
        />
        <button
          className="chip"
          disabled={busy === 'password' || password.length < 6}
          onClick={() =>
            guard('password', async () => {
              await changePassword(password)
              setPassword('')
              setNote('Password changed.')
            })
          }
        >
          {busy === 'password' ? 'Changing…' : 'Change password'}
        </button>
      </div>

      <div className="history-actions">
        <button
          className="chip"
          disabled={busy === 'out'}
          onClick={() =>
            guard('out', async () => {
              await signOut()
              setAccount(null)
              setNote('Signed out on this device.')
            })
          }
        >
          {busy === 'out' ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      {/* Said plainly, because the alternative is someone signing out on a
          phone mid-set and taking the host down with them. */}
      <p className="hint">Signing out here leaves other devices signed in.</p>
      {note ? <p className="hint">{note}</p> : null}
    </section>
  )
}
