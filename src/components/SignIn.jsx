import { useEffect, useState } from 'react'
import { loadRemoteConfig, sendPasswordReset } from '../lib/remote'

/**
 * The one sign-in form.
 *
 * There were three: one to connect a phone, a second to sign the Mac's
 * device server in, and an account panel that could reset a password but not
 * sign anyone in at all. Same account, same two fields, three places to type
 * them. This is the form; what happens on submit is the caller's.
 *
 * CREATE IS HERE WHERE THE CALLER ASKS FOR IT, and it was not, once.
 *
 * It used to be refused outright: "do not allow an account to be created on
 * any of the desktop or the web app version, only sign-ins." That was
 * written when the phone was the only end that could take money, and an
 * account made here would have been the free half of something whose paid
 * half lived on a handset.
 *
 * The browser and the computer app sell the unlock now, and a purchase has
 * to belong to an account — so somebody who has never had the phone app
 * could not buy at all. "That was old info before we decided to do
 * purchases on the web, so yes, somebody should be able to create an account
 * on the web and desktops, and make purchases as well."
 *
 * So `onCreate` turns it on, and a caller with nothing to sell leaves it
 * off. The words are the phone's: Create Account, and I already have one.
 *
 * Forgot stays: somebody signing in here with an account made on their phone
 * is exactly the person who will have forgotten the password.
 */
export default function SignIn({
  email: initial = '',
  submitLabel = 'Sign in',
  onSubmit,
  onCreate,
  startIn = 'in',
  /* Told which side the form is on, so the sheet around it can say so in its title. */
  onMode,
  busy,
  autoFocus
}) {
  /* Opened by a Create Account button, the form starts on making one. */
  const [mode, setMode] = useState(onCreate && startIn === 'up' ? 'up' : 'in') // 'in' | 'up' | 'forgot' | 'sent'
  useEffect(() => {
    onMode?.(mode)
  }, [mode, onMode])
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
      } else if (mode === 'up') {
        const { needsConfirmation } = await onCreate({ email: address, password })
        /*
         * THE EMAIL, AS A SCREEN OF ITS OWN. "When I did sign up and I clicked
         * create account, it didn't give me any confirmation that I need to
         * check my email or that account was created." It did — as one grey
         * line under the buttons, below a phone's keyboard. Now the form gives
         * way to it. The words are still the phone's.
         */
        if (needsConfirmation) setMode('sent')
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

  if (mode === 'sent') {
    return (
      <div className="signin signin-sent" role="status">
        <span className="signin-sent-mark" aria-hidden="true">
          ✉
        </span>
        <p className="signin-sent-head">Account made.</p>
        <p className="signin-sent-body">
          Confirm it from the email we just sent, then sign in.
        </p>
        <p className="signin-sent-to">
          <strong>{email.trim()}</strong>
        </p>
        <button className="primary signin-wide" type="button" onClick={() => setMode('in')}>
          Sign in
        </button>
      </div>
    )
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
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
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
            : mode === 'forgot'
              ? 'Email me a reset link'
              : mode === 'up'
                ? 'Create Account'
                : submitLabel}
        </button>
        {/*
          THE OTHER SIDE OF THE FORM, as a button the size of the one above it.
          "When it says create account, it's in a very tiny font underneath
          where it says sign in. Most people coming here for the first time
          are going to be creating an account." A link-sized Create Account
          was the thing a first-timer most needed and was least likely to see.
        */}
        {mode === 'up' ? (
          <button type="button" className="chip signin-wide" onClick={() => setMode('in')} disabled={off}>
            I already have one
          </button>
        ) : mode === 'in' && onCreate ? (
          <button type="button" className="chip signin-wide" onClick={() => setMode('up')} disabled={off}>
            Create Account
          </button>
        ) : null}
        {mode === 'in' ? (
          <button type="button" className="signin-link" onClick={() => setMode('forgot')} disabled={off}>
            Forgot password?
          </button>
        ) : null}
        {mode === 'forgot' ? (
          <button type="button" className="signin-link" onClick={() => setMode('in')} disabled={off}>
            Back to sign in
          </button>
        ) : null}
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
