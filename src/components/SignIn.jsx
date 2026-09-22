import { useState } from 'react'
import { loadRemoteConfig, sendPasswordReset } from '../lib/remote'

/**
 * The one sign-in form.
 *
 * There were three: one to connect a phone, a second to sign the Mac's
 * device server in, and an account panel that could reset a password but not
 * sign anyone in at all. Same account, same two fields, three places to type
 * them. This is the form; what happens on submit is the caller's.
 *
 * CREATE IS NOT HERE, AND THAT IS DELIBERATE.
 *
 * "On the desktop app make it so you can only sign in with account that was
 * already created on a phone. So do not allow an account to be created on
 * any of the desktop or the web app version, only sign-ins."
 *
 * An account exists to join a phone to a computer, and the phone is the end
 * that is paid for. Making one here would let somebody set up the free half
 * of the arrangement and find out later that the half they wanted costs
 * money — and it would put the app's only sign-up form on the one device
 * that can never buy the unlock.
 *
 * Forgot stays: somebody signing in here with an account made on their phone
 * is exactly the person who will have forgotten the password.
 */
export default function SignIn({ email: initial = '', submitLabel = 'Sign in', onSubmit, busy, autoFocus }) {
  const [mode, setMode] = useState('in') // 'in' | 'forgot'
  const [email, setEmail] = useState(initial)
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [note, setNote] = useState(null)
  const [problem, setProblem] = useState(null)

  const off = busy || working
  const project = () => {
    const c = loadRemoteConfig() || {}
    return { url: c.url, anonKey: c.anonKey }
  }

  const go = async (e) => {
    e?.preventDefault?.()
    setProblem(null)
    setNote(null)
    const address = email.trim()
    if (!address) return setProblem('Enter your email.')
    if (mode !== 'forgot' && password.length < 6) return setProblem('Your password is at least 6 characters.')
    setWorking(true)
    try {
      if (mode === 'in') {
        await onSubmit({ email: address, password })
      } else {
        await sendPasswordReset({ ...project(), email: address, redirectTo: window.location.origin })
        setNote('If that address has an account, a reset link is on its way.')
        setMode('in')
      }
    } catch (err) {
      setProblem(err.message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <form className="signin" onSubmit={go}>
      <label className="signin-field">
        <span>Email</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus={autoFocus}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={off}
          placeholder="you@example.com"
        />
      </label>
      {mode !== 'forgot' ? (
        <label className="signin-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={off}
          />
        </label>
      ) : null}

      <div className="signin-actions">
        <button className="primary" type="submit" disabled={off}>
          {working ? 'One moment…' : mode === 'forgot' ? 'Email me a reset link' : submitLabel}
        </button>
        {mode === 'in' ? (
          <button type="button" className="signin-link" onClick={() => setMode('forgot')} disabled={off}>
            Forgot password?
          </button>
        ) : (
          <button type="button" className="signin-link" onClick={() => setMode('in')} disabled={off}>
            Back to sign in
          </button>
        )}
      </div>

      {problem ? (
        <p className="problem" role="alert">
          {problem}
        </p>
      ) : null}
      {note ? <p className="hint">{note}</p> : null}
    </form>
  )
}
