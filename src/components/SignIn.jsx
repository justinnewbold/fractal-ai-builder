import { useState } from 'react'
import { loadRemoteConfig, remoteSignUp, sendPasswordReset } from '../lib/remote'

/**
 * The one sign-in form.
 *
 * There were three: one to connect a phone, a second to sign the Mac's
 * device server in, and an account panel that could reset a password but not
 * sign anyone in at all. Same account, same two fields, three places to type
 * them. This is the form; what happens on submit is the caller's.
 *
 * Create and forgot live inside it as modes rather than as separate screens,
 * because they are the two things a person at a sign-in form is about to
 * need, and sending them somewhere else to do them is a door too many.
 */
export default function SignIn({ email: initial = '', submitLabel = 'Sign in', onSubmit, busy, autoFocus }) {
  const [mode, setMode] = useState('in')
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
      } else if (mode === 'create') {
        const { needsConfirmation } = await remoteSignUp({ ...project(), email: address, password })
        setNote(
          needsConfirmation
            ? 'Check your email to confirm the account, then sign in.'
            : 'Account made. Sign in to continue.'
        )
        setMode('in')
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
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={off}
          />
        </label>
      ) : null}

      <div className="signin-actions">
        <button className="primary" type="submit" disabled={off}>
          {working
            ? 'One moment…'
            : mode === 'create'
              ? 'Create account'
              : mode === 'forgot'
                ? 'Email me a reset link'
                : submitLabel}
        </button>
        {mode === 'in' ? (
          <>
            <button type="button" className="signin-link" onClick={() => setMode('create')} disabled={off}>
              Create an account
            </button>
            <button type="button" className="signin-link" onClick={() => setMode('forgot')} disabled={off}>
              Forgot password?
            </button>
          </>
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
