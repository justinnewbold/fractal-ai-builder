import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { changePassword } from '../lib/remote'
import { describeLink, formatPairCode, isPairAccount, pairLink, savedPairCode, HOSTED_ORIGIN } from '../lib/link'
import PhoneQr from './PhoneQr'

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

function MacSide({ link, email, onAction, busy }) {
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
     * Two ways to set the Mac up, and the one that asks for nothing comes
     * first. Pairing makes a code the phone scans; nobody types an email
     * anywhere. Signing in is for a person who wants presets to follow them
     * between devices, and it says so.
     */
    return (
      <>
        <p className="hint">
          Set this up once and your phone can play through this computer from anywhere. No account
          needed &mdash; the computer shows a code, the phone scans it.
        </p>
        <div className="history-actions">
          <button className="primary" onClick={() => onAction('mac-pair')} disabled={busy}>
            Set up phone remote
          </button>
          <button className="chip" onClick={() => onAction('mac-setup')} disabled={busy}>
            Sign in with an account instead
          </button>
        </div>
        <p className="hint">
          An account means your presets and what the AI has learned about your taste follow you to
          any device.
        </p>
      </>
    )
  }

  return (
    <>
      {/*
        ONE SQUARE, and the wifi one folded under it.

        "Are both QR codes needed on the Mac app? It's confusing and they are
        literally right by each other so a phone will pick up both codes."
        Both are needed and they are for different things — the app, and a web
        browser — which PhoneQr says in words. Two squares an inch apart is a
        camera choosing for you.

        Shared with the first-launch tour rather than drawn twice: two
        renderings of a pairing code drift, and that drift is a phone scanning
        a square that pairs it with nothing.
      */}
      <PhoneQr connected={link.link === 'connected'} email={email} onAction={onAction} busy={busy} />
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
 * The code a paired Mac shows, as a QR and as text.
 *
 * The QR opens the hosted app with the code in the address, so a phone that
 * scans it is connected without typing anything. The text is for a camera
 * that will not focus, and for a second phone across the room.
 *
 * The code is kept by the browser that did the pairing. A different browser
 * at the same Mac knows the Mac is paired but not with what, and the only
 * honest offer is to pair again.
 */
export function PairCard({ on, onAction, busy }) {
  const code = savedPairCode()
  const url = code ? pairLink(code) : null
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

  if (!code) {
    return (
      <>
        <p className="hint">
          Paired without an account, but the code was made from another browser on this computer, so it
          can&rsquo;t be shown here. Pairing again makes a new code; phones with the old one will
          need the new one.
        </p>
        <div className="history-actions">
          <button className="chip" onClick={() => onAction('mac-pair')} disabled={busy}>
            Pair again
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="phone-setup pair-card">
      <p className="hint">
        {on
          ? 'Paired, no account. On your phone, point the camera at this — or type the code.'
          : 'Paired, no account. Turn it on and your phone can connect with this code.'}
      </p>
      {qr ? <img className="phone-qr" src={qr} alt="Code to pair your phone with this computer" width={160} height={160} /> : null}
      <p className="pair-code mono" aria-label="Pairing code">
        {formatPairCode(code)}
      </p>
    </div>
  )
}

/**
 * The way in for a computer signed into an account.
 *
 * "I looked all over the Mac app. There is no other QR code besides the one
 * that gives the web address. There is also nowhere that shows the connect
 * code to connect."
 *
 * Both true, and the second one has an answer that had never been written
 * down anywhere he could read it: WITH AN ACCOUNT THERE IS NO CODE. A code
 * exists so that two devices can share a hidden account without anybody
 * making one — see PairCard. Once there is a real account, the account is
 * the code, and the phone joins by signing into it.
 *
 * What was wrong is that the app knew that and never said it. This computer
 * showed one line, "Signed in as you@example.com", beside a wifi QR for a
 * completely different route, and left somebody hunting the menus for a
 * number that does not exist.
 *
 * So: the same square, pointing at the app on the hosted site, and the
 * account to sign into written under it. Scanning gets the phone to the
 * right place; the line under it says what to do when it arrives.
 */
/**
 * @param showAccount  Whether to print the address. The Setup page does: it is
 *   answering "which account is this", and it is his own screen. THE TOUR DOES
 *   NOT — "the first shot that pops up in the tutorial literally shows my
 *   personal email address on it". That card is the first thing the app ever
 *   shows, it is what gets photographed and screen-shared, and the sentence
 *   above the square already says what to do without naming anybody.
 */
export function AccountCard({ on, email, showAccount = true }) {
  const url = HOSTED_ORIGIN
  const [qr, setQr] = useState(null)

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#0d0f12', light: '#ffffff' } })
      .then((d) => alive && setQr(d))
      .catch(() => alive && setQr(null))
    return () => {
      alive = false
    }
  }, [url])

  return (
    <div className="phone-setup">
      <p className="hint">
        {on
          ? 'From anywhere. Point your phone’s camera at this to open the app, then sign in with the same account.'
          : 'From anywhere, once this is turned on. Point your phone’s camera at this to open the app, then sign in with the same account.'}
      </p>
      {qr ? (
        <img className="phone-qr" src={qr} alt={`Code for ${url}`} width={160} height={160} />
      ) : null}
      {showAccount ? (
        <p className="pair-code mono" aria-label="The account to sign in as">
          {email}
        </p>
      ) : null}
      {/* The sentence that was missing. Somebody who has read about pairing
          codes will otherwise keep looking for one. */}
      <p className="footnote">
        There is no pairing code to type: that is for computers set up without an account. This one
        has one, so signing in on the phone is what joins it.
      </p>
    </div>
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
          {open ? 'Hide' : 'Paired without an account'}
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
