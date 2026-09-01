import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { servedLocally } from '../lib/forgefx'
import { changePassword } from '../lib/remote'
import { describeLink } from '../lib/link'

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
export default function PhoneRemote({ link, onAction, onError, busy }) {
  const said = describeLink(link)
  const email = link.account?.email || link.cloud?.user?.email || ''

  return (
    <section className="phone-remote">
      <p className={`phone-remote-state tone-${said.tone}`}>
        <span className="lamp" data-state={said.tone === 'good' ? 'live' : said.tone === 'bad' ? 'fault' : 'idle'} />
        {said.sentence || 'Working out which end this is…'}
      </p>

      {link.role === 'mac' ? (
        <MacSide link={link} email={email} onAction={onAction} busy={busy} />
      ) : link.role === 'wifi' ? (
        <p className="hint">
          Nothing to set up &mdash; this phone is talking to the Mac directly over wifi.
        </p>
      ) : link.role === 'remote' ? (
        <PhoneSide link={link} email={email} onAction={onAction} busy={busy} />
      ) : null}

      {link.account ? <AccountFold email={email} onAction={onAction} onError={onError} busy={busy} /> : null}
    </section>
  )
}

/* ------------------------------------------------------------------ */

function MacSide({ link, email, onAction, busy }) {
  const cloud = link.cloud

  if (cloud?.demo) {
    return <p className="hint">Phone remote isn&rsquo;t part of the demo.</p>
  }

  if (cloud && !cloud.enabled) {
    return (
      <p className="hint">
        Quit and reopen the Fractal app on this Mac to turn this on.
      </p>
    )
  }

  if (link.link === 'signed-out') {
    return (
      <>
        <WifiCard />
        <p className="hint">
          Sign in once and your phone can play through this Mac from anywhere.
        </p>
        <div className="history-actions">
          <button className="primary" onClick={() => onAction('mac-setup')} disabled={busy}>
            Set up phone remote
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <WifiCard />
      <p className="hint">
        {link.link === 'connected'
          ? `Signed in as ${email}. Open this app on your phone and sign in with the same account.`
          : `Signed in as ${email}.`}
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

/**
 * Same wifi, nothing to sign into. Shown at the Mac when the page is being
 * served from it, which is exactly when this route exists: point the phone's
 * camera at it and the phone is talking to the unit directly.
 */
function WifiCard() {
  const local = servedLocally()
  const url = local ? window.location.origin : null
  const [qr, setQr] = useState(null)

  useEffect(() => {
    if (!url) return undefined
    let alive = true
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#0d0f12', light: '#ffffff' } })
      .then((d) => alive && setQr(d))
      .catch(() => alive && setQr(null))
    return () => {
      alive = false
    }
  }, [url])

  if (!local) return null
  return (
    <div className="phone-setup">
      <p className="hint">Same wifi? Point your phone&rsquo;s camera at this &mdash; nothing to sign into.</p>
      {qr ? <img className="phone-qr" src={qr} alt={`Code for ${url}`} width={160} height={160} /> : null}
      <p className="phone-url mono">{url}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function PhoneSide({ link, email, onAction, busy }) {
  if (link.link === 'connected') {
    return (
      <>
        <p className="hint">
          Everything you change here happens on the unit at the Mac. Saving to a slot happens at
          the Mac.
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
    return <p className="hint">Finding your Mac.</p>
  }
  if (link.link === 'no-answer') {
    return (
      <>
        <p className="hint">
          Make sure the Fractal app is open on the Mac and the Mac is awake. This keeps trying on
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
  return (
    <>
      <p className="hint">Sign in and this phone becomes the remote for the unit at your Mac.</p>
      <div className="history-actions">
        <button className="primary" onClick={() => onAction('connect')} disabled={busy}>
          {email ? `Connect as ${email}` : 'Connect'}
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
function AccountFold({ email, onAction, onError, busy }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [note, setNote] = useState(null)

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
