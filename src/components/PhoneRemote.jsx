import { useEffect, useState } from 'react'
import { changePassword } from '../lib/remote'
import { describeLink, isPairAccount } from '../lib/link'

/**
 * Phone remote, in Setup: what this end is, whether the other end is there,
 * and the one thing to do about it.
 *
 * This replaces four panels stacked in one fold with no headings between
 * them — how the phone gets here, an account panel that could not sign in,
 * the Mac's host switch, and the phone's sign-in form — each written for the
 * person building the app rather than the person holding a guitar. Three
 * names for one thing, three sign-ins for one account, and a "Connected"
 * that meant a channel had been joined.
 *
 * One panel. It branches on which end this is and says the state in a
 * sentence, with the single button that state calls for. Nothing here says
 * relay, channel, helper, or the name of the account service; the
 * diagnostics that need those words live under Technical details.
 */
export default function PhoneRemote({ link, onAction, onError, error, busy }) {
  const said = describeLink(link)
  const email = link.account?.email || link.cloud?.user?.email || ''

  return (
    <section className="phone-remote">
      <p className={`phone-remote-state tone-${said.tone}`}>
        <span className="lamp" data-state={said.tone === 'good' ? 'live' : said.tone === 'bad' ? 'fault' : 'idle'} />
        {said.sentence || 'Working out which end this is…'}
      </p>

      {link.role === 'mac' ? (
        <MacSide link={link} email={email} onAction={onAction} busy={busy} error={error} />
      ) : link.role === 'wifi' ? (
        <p className="hint">
          Nothing to set up &mdash; this phone is talking to the computer directly over wifi.
        </p>
      ) : link.role === 'remote' ? (
        <PhoneSide link={link} email={email} onAction={onAction} busy={busy} />
      ) : null}

      {link.account ? (
        <AccountFold email={email} paired={isPairAccount(email)} role={link.role} onAction={onAction} onError={onError} busy={busy} />
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------------------ */

function MacSide({ link, email, onAction, busy, error }) {
  const cloud = link.cloud

  if (cloud?.demo) {
    return <p className="hint">Phone remote isn&rsquo;t part of the demo.</p>
  }

  if (cloud && !cloud.enabled) {
    return (
      <p className="hint">
        Quit and reopen the Fractal app on this computer to turn this on.
      </p>
    )
  }

  if (link.link === 'signed-out') {
    /*
     * ONE WAY IN NOW, and the other one is why.
     *
     * "I want the QR code gone and the scanner gone. It has never worked
     * once… to use this app and connect it to your computer, you have to
     * sign up. That's the way we're doing it."
     *
     * The button that used to come first made a pairing code: a hidden
     * account nobody had to create, shown as a QR code for the phone's camera
     * and eight characters under it to type. It is gone, along with the
     * camera at the other end.
     *
     * The demo is still free and needs no account. This computer app is still
     * free and needs no account. Joining a phone to it is the one thing that
     * does, and both ends sign into the same one.
     */
    return (
      <>
        <p className="hint">
          Sign in here, then sign in on the phone with the same account, and the phone becomes the
          remote for the unit on this computer. The demo and this app are both free without one.
        </p>
        <div className="history-actions">
          <button className="primary" onClick={() => onAction('mac-setup')} disabled={busy}>
            Sign in to set up the phone remote
          </button>
        </div>
        {error ? <p className="hint tone-bad">{String(error)}</p> : null}
        <p className="hint">
          An account also means your presets and what the AI has learned about your taste follow you
          to any device.
        </p>
      </>
    )
  }

  /*
   * NO QR CODE HERE ANY MORE. It carried the pairing code, and before that
   * the hosted app's address for a phone that did not have the app yet.
   * Both were read by a camera this app no longer has.
   */
  return (
    <>
      <p className="hint">
        Signed in as <strong>{email}</strong>. Sign in on the phone with the same account and it
        becomes the remote for the unit here.
      </p>
      <div className="history-actions">
        {link.link === 'connected' ? (
          <button className="chip" onClick={() => onAction('mac-off')} disabled={busy}>
            Turn off
          </button>
        ) : (
          <button className="primary" onClick={() => onAction('mac-on')} disabled={busy}>
            Turn on
          </button>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

function PhoneSide({ link, email, onAction, busy }) {
  if (link.link === 'connected') {
    return (
      <>
        <p className="hint">
          Everything you change here happens on the unit at the computer. Saving to a slot happens at
          the computer.
        </p>
        <div className="history-actions">
          <button className="chip" onClick={() => onAction('disconnect')} disabled={busy}>
            Disconnect
          </button>
        </div>
      </>
    )
  }
  if (link.link === 'joining') {
    return <p className="hint">Finding your computer.</p>
  }
  if (link.link === 'no-answer') {
    return (
      <>
        <p className="hint">
          Make sure the Fractal app is open on the computer and the computer is awake. This keeps trying on
          its own.
        </p>
        <div className="history-actions">
          <button className="chip" onClick={() => onAction('retry')} disabled={busy}>
            Try now
          </button>
        </div>
      </>
    )
  }
  const paired = isPairAccount(email)
  return (
    <>
      <p className="hint">
        {paired
          ? 'This phone is paired with your computer. Connect and it becomes the remote for the unit there.'
          : 'Connect and this phone becomes the remote for the unit at your computer.'}
      </p>
      <div className="history-actions">
        <button className="primary" onClick={() => onAction('connect')} disabled={busy}>
          {email && !paired ? `Connect as ${email}` : 'Connect'}
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * The account, folded away: a new password and a way to sign out. Small on
 * purpose — these are done about once a year, and the panel above is the
 * one that gets used.
 */
function AccountFold({ email, paired, role, onAction, onError, busy }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [note, setNote] = useState(null)

  /*
   * A paired device has an account nobody chose and nobody should have to
   * think about: no email to show, no password to change. The one thing to
   * offer is the way out — and, on a phone, the account route in, for someone
   * who now wants their presets to follow them.
   */
  if (paired) {
    return (
      <div className="account-fold">
        <button className="signin-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {/* Was "Paired without an account", which is how this device got
              here and is no longer something the app offers to do. It is a
              statement about the past now, so it reads as one. */}
          {open ? 'Hide' : 'Paired with a code, before accounts'}
        </button>
        {open ? (
          <div className="account">
            <p className="hint">
              {role === 'mac'
                ? 'Presets stay on this computer. Sign in with an account to have them follow you between devices.'
                : 'What you save stays on this phone. Sign in with an account to have it follow you between devices.'}
            </p>
            <div className="history-actions">
              <button className="chip" disabled={busy} onClick={() => onAction(role === 'mac' ? 'mac-setup' : 'switch')}>
                Sign in with an account
              </button>
              <button className="chip" disabled={busy} onClick={() => onAction('signout')}>
                {role === 'mac' ? 'Unpair this computer' : 'Unpair this phone'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="account-fold">
      <button className="signin-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? 'Hide account' : `Account · ${email}`}
      </button>
      {open ? (
        <div className="account">
          <div className="save-row">
            <input
              type="password"
              className="name-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              aria-label="New password"
              autoComplete="new-password"
            />
            <button
              className="chip"
              disabled={busy || working || password.length < 6}
              onClick={async () => {
                setWorking(true)
                try {
                  await changePassword(password)
                  setPassword('')
                  setNote('Password changed.')
                } catch (err) {
                  onError?.(err.message)
                } finally {
                  setWorking(false)
                }
              }}
            >
              {working ? 'Changing…' : 'Change password'}
            </button>
          </div>
          <div className="history-actions">
            <button className="chip" disabled={busy} onClick={() => onAction('signout')}>
              Sign out on this device
            </button>
          </div>
          <p className="hint">Other devices stay signed in.</p>
          {note ? <p className="hint">{note}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
