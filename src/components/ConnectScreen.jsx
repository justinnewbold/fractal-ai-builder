/**
 * The phone's screen when it is not connected to the Mac.
 *
 * Not an error. A phone that has just opened the app has nothing wrong with
 * it; it has one thing to do, and this says what that is and offers the
 * button. The old screen led with "Can't reach your unit" and a paragraph
 * about helper apps, then a sign-in form with no heading, and a person
 * reading it could not tell whether something was broken or whether they
 * were being asked to do something.
 *
 * Three states, each one sentence and one button:
 *
 *   signed-out  — sign in with the same account as the computer
 *   joining     — nothing to press; it is happening
 *   no-answer   — Try now, and the reassurance that it keeps trying anyway
 *
 * AND SIGNING IN IS THE WAY IN NOW, which it was not.
 *
 * "I want the QR code gone and the scanner gone. It has never worked once…
 * to use this app and connect it to your computer, you have to sign up."
 *
 * The first thing this page offered used to be the pairing code from the Mac,
 * typed into a box here, needing no account at all. The code is gone and so
 * is the box. What still needs no account is the demo, and the same-wifi
 * route at the bottom of this page, where nothing is signed into and what you
 * save stays on the phone.
 */
import { useEffect, useState } from 'react'
import SignIn from './SignIn'
import { isPairAccount } from '../lib/link'
import { computerElsewhere } from '../lib/remote'
import { P6, SETUP } from '../../shared/onboarding.mjs'
import { DOWNLOADS_URL } from '../../mobile/src/lib/downloadLink'
import { inDesktopApp, onAPhoneOrTablet } from '../lib/desktop'

export default function ConnectScreen({
  link,
  onConnect,
  onRetry,
  onSwitchAccount,
  onCreateAccount,
  onUnpair,
  onDemo,
  /* Opens Troubleshooting on "It will not connect at all". "Open the
     troubleshooting if it doesn't connect." */
  onTroubleshoot,
  /* The form on the first screen itself, as his mockup draws it: sign in and
     make an account here rather than in a sheet. Without them the screen
     falls back to the two buttons that open the sheet. */
  onSignIn,
  onCreate,
  /* Somebody who has paid. The phone never offers them "Try the Demo" —
     "if they are already signed in and the app is unlocked, instead of
     saying try the demo, have it just say Demo." */
  owned = false,
  busy
}) {
  const { link: state, account } = link
  const remembered = account?.email || null
  const paired = isPairAccount(remembered)
  /*
   * "Connecting…" does not stand on its own for ever: after fifteen seconds it
   * says what to check and offers Try now, as the phone's does. "Been stuck on
   * connecting screen for over a minute… I usually force close."
   */
  const [long, setLong] = useState(false)
  useEffect(() => {
    setLong(false)
    if (state !== 'joining') return undefined
    const t = setTimeout(() => setLong(true), 15000)
    return () => clearTimeout(t)
  }, [state])
  /*
   * And when the accounts don't match, it says so: "I was signed into the
   * wrong account, but it didn't notify me at all." A computer on this wifi
   * signed into a different account is a yes from the account server — yes
   * or no, nothing about whose (lib/remote.js). Asked once it has been
   * waiting a while, and every half minute after.
   */
  const [elsewhere, setElsewhere] = useState(false)
  const asking = (state === 'joining' && long) || state === 'no-answer'
  useEffect(() => {
    if (!asking || paired) {
      setElsewhere(false)
      return undefined
    }
    let live = true
    const ask = () => computerElsewhere().then((yes) => live && setElsewhere(yes))
    ask()
    const t = setInterval(ask, 30000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [asking, paired])
  const mismatch = elsewhere ? <Mismatch email={remembered} /> : null
  /* The mockup's first screen: nobody signed in, nothing being joined. */
  const fresh = state !== 'joining' && state !== 'no-answer' && !remembered
  const [howTo, setHowTo] = useState(false)

  if (fresh && onSignIn) {
    return (
      <section className="connect connect-fresh" data-state={state}>
        {/*
          HIS MOCKUP, TOP TO BOTTOM, the same as the phone's sign-in screen.
          "Redo this screen to match this photo in both the web app and the
          mobile apps." The words come from shared/onboarding.mjs (SETUP), so
          the two ends say the same thing.
        */}
        <header className="connect-brand">
          <Mark />
          <h1>Fractal Remote</h1>
          <p className="connect-tagline">{SETUP.tagline}</p>
        </header>
        <div className="connect-card">
          <h2>{SETUP.title}</h2>
          <Steps />
        </div>
        <SignIn variant="stage" submitLabel="Sign in" onSubmit={onSignIn} onCreate={onCreate} busy={busy} />
        <button type="button" className="connect-howto" onClick={() => setHowTo((v) => !v)} aria-expanded={howTo}>
          <ExternalIcon />
          {SETUP.howTo}
        </button>
        {howTo ? <NoComputerYet /> : null}
        <button type="button" className="connect-demo connect-demo-quiet" onClick={onDemo} disabled={busy}>
          {owned ? 'Demo' : 'Try the Demo'}
        </button>
      </section>
    )
  }

  return (
    <section className="connect" data-state={state}>
      <span className="lamp connect-lamp" data-state={state === 'no-answer' ? 'fault' : state === 'joining' ? 'busy' : 'idle'} />

      {state === 'joining' ? (
        <>
          <h2>Connecting…</h2>
          <p>Finding your computer.</p>
          {account ? <Using email={remembered} paired={paired} /> : null}
          {long ? (
            <>
              {mismatch || (
                <p className="hint">
                  Make sure the Fractal app is open on the computer and the computer is awake. This keeps
                  trying on its own.
                </p>
              )}
              <div className="connect-actions">
                <button className="primary" onClick={onRetry} disabled={busy}>
                  Try now
                </button>
                {elsewhere ? (
                  <button className="chip" onClick={onSwitchAccount} disabled={busy}>
                    Sign in as someone else
                  </button>
                ) : null}
                {onTroubleshoot ? (
                  <button className="chip" onClick={onTroubleshoot}>
                    Troubleshooting
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : state === 'no-answer' ? (
        <>
          <h2>Your computer isn&rsquo;t answering</h2>
          {mismatch || (
            <p>
              Make sure the Fractal app is open on the computer and the computer is awake. This keeps trying on
              its own.
            </p>
          )}
          <Using email={remembered} paired={paired} />
          <div className="connect-actions">
            <button className="primary" onClick={onRetry} disabled={busy}>
              Try now
            </button>
            <button className="chip" onClick={paired ? onUnpair : onSwitchAccount} disabled={busy}>
              {paired ? 'Pair with a different computer' : 'Sign in as someone else'}
            </button>
            {onTroubleshoot ? (
              <button className="chip" onClick={onTroubleshoot}>
                Troubleshooting
              </button>
            ) : null}
          </div>
          {/*
            THE NEXT STEP FOR SOMEBODY NEW. A first-timer who has just made an
            account and paid lands here, because there is no computer on the
            other end yet — and this screen only said to check a computer
            they have not set up. The connect screen's own line, and the
            address the phone app gives for the same moment (Connect.js).
          */}
          <NoComputerYet />
        </>
      ) : (
        <>
          <h2>Connect to your computer</h2>
          {remembered ? (
            <>
              <p>
                {paired
                  ? 'This phone is paired with your computer.'
                  : 'Your Fractal is plugged into your computer. Connect and this phone becomes its remote.'}
              </p>
              <div className="connect-actions">
                <button className="primary" onClick={onConnect} disabled={busy}>
                  {paired ? 'Connect' : `Connect as ${remembered}`}
                </button>
                {/* Unpairing forgets the hidden account and comes back to signing in — there is no code box any more; a person's account gets the sign-in sheet. */}
                <button className="chip" onClick={paired ? onUnpair : onSwitchAccount} disabled={busy}>
                  {paired ? 'Pair with a different computer' : 'Use a different account'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Sign in with the same account as the computer your unit is plugged into, and this
                phone becomes its remote. Your setlists and the presets you starred follow you to
                any device, anywhere &mdash; not just at home.
              </p>
              {/*
                The phone's three steps, in the phone's words, from the one
                place both ends read them (shared/onboarding.mjs, SETUP):
                "make sure the onboarding flow is the same, all of our
                changes are drifting apart again".
              */}
              <Steps />
              <div className="connect-actions">
                {/*
                  CREATE ACCOUNT FIRST, AND BIG. "Most people coming here for
                  the first time are going to be creating an account, not
                  signing in." It was the second button, the quiet one, and
                  before that it was not here at all. Sign in is the second
                  now, still a full button, for the person coming back.
                */}
                {onCreateAccount ? (
                  <button className="primary" onClick={onCreateAccount} disabled={busy}>
                    Create Account
                  </button>
                ) : null}
                <button className={onCreateAccount ? 'chip' : 'primary'} onClick={onSwitchAccount} disabled={busy}>
                  Sign in
                </button>
              </div>
            </>
          )}
          <NoComputerYet />

          {/*
            THE SAME-WIFI BOX IS GONE, and it was the last way in that did not
            want an account.

            It offered the computer's address, typed, and sent the browser to
            the copy the computer serves on the LAN. Nothing was signed into,
            nothing was paid, and a phone had full control of a rig — which
            made the one rule this whole screen exists to enforce optional for
            anybody who read to the bottom of it. "Yes, number three sounds
            good": free for signed-in accounts, and the box goes.

            NOTE WHAT THIS DOES NOT DO. The computer still serves the app on
            the LAN, and a person who types that address still lands on it.
            That is deliberate — it is the route that works with no internet
            at all, and taking it away would strand somebody at a venue with
            no signal. What is gone is this page advertising it as an
            alternative to signing in.
          */}

          {/*
            THERE WAS A SECOND SIGN-IN BLOCK HERE, and it drew at the same
            time as the first.

            Both branches turned on the same thing — the top one renders its
            Sign in button when `remembered` is null, and this rendered on
            `!remembered` — so a signed-out phone got the screen he sent back:
            "Sign in" at the top, a wifi box, and "Or sign in — to save and
            sync" with a second Sign in under it. Two buttons with one label,
            and not even the same call behind them: the top one switches
            account, this one connected.

            What it said that the top did not was what signing in buys, so
            that sentence moved up into the paragraph beside the button it
            belongs to.
          */}
        </>
      )}

      {/*
        THREE WORDS AND NOTHING OVER THEM.

        "Change just looking to just Try the Demo - no text underneath." That
        was said about the phone's sign-in screen and carried out there; this
        screen went on asking the same question for weeks afterwards, which is
        the drift Justin caught — "some of the wording".

        A button rather than a chip on the end of a sentence, for the same
        reason the phone's is one: it is one of the two ways off this screen,
        not a footnote to the other.
      */}
      <button type="button" className="connect-demo" onClick={onDemo} disabled={busy}>
        {owned ? 'Demo' : 'Try the Demo'}
      </button>
    </section>
  )
}

/**
 * WHICH ACCOUNT THIS IS, while it connects and when nothing answers.
 *
 * The likeliest reason nothing answers is a computer signed in as somebody
 * else. "I am connected, both the android app and the Apple app connects just
 * fine, so I'm not sure why this isn't connecting" — the browser was on a
 * second account made that evening, and nothing on the screen said so.
 *
 * His words for it: "shouldn't we have it say when it's trying to connect,
 * say, make sure you're connected to your computer using and then show the
 * user's email address? Could probably save me some trouble… the more
 * information we can provide the better."
 */
function Using({ email, paired }) {
  if (!email || paired) return null
  return (
    <p className="hint">
      Make sure you&rsquo;re connected to your computer using <strong>{email}</strong>.
    </p>
  )
}

/**
 * "Haven't set up the computer yet?", with where to get it.
 *
 * WHICH MACHINE THIS IS decides the rest. In the computer app's own window
 * there is nothing to get — it IS the computer app — so nothing is said. In a
 * browser on a computer the download is one click away: "they can just click
 * download now instead of sending it to their email". On a phone it is the
 * phone's address and label, and a tap copies it — "a lot of Mac users can
 * copy and paste between phone and computer, or they could copy it and email
 * it themselves".
 */
function NoComputerYet() {
  const [copied, setCopied] = useState(false)
  if (inDesktopApp()) return null
  const url = `https://${DOWNLOADS_URL}`
  const onPhone = onAPhoneOrTablet()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      /* No clipboard here (an old browser, or no permission): the address is on screen to read. */
    }
  }
  return (
    <>
      <p className="hint">
        Haven&rsquo;t set up the computer yet? Open this app on the computer, tap{' '}
        <strong>Set up phone remote</strong>, and sign in with this same account.
      </p>
      {onPhone ? (
        <div className="hint connect-address">
          <span className="mono">{P6.address}</span>
          <button type="button" className="connect-copy" onClick={copy}>
            <strong>{DOWNLOADS_URL}</strong>
            <span className={copied ? 'connect-copied' : undefined}>{copied ? P6.copied : P6.copyHint}</span>
          </button>
        </div>
      ) : (
        <div className="connect-actions">
          <button type="button" className="primary" onClick={() => window.open(url, '_blank', 'noopener')}>
            {P6.downloadNow}
          </button>
        </div>
      )}
    </>
  )
}

/** How the unit, the computer app and this app fit, as three numbered lines. */
function Steps() {
  return (
    <ol className="connect-steps">
      {SETUP.steps.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ol>
  )
}

/** Five amber bars over the name, tallest in the middle, as drawn. */
function Mark() {
  return (
    <span className="connect-mark" aria-hidden="true">
      {[14, 30, 46, 30, 14].map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </span>
  )
}

/** The box-and-arrow on "How to connect my computer": it opens something. */
function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

/**
 * WHICH ACCOUNT, ON THE NO UNIT FOUND NOTICE.
 *
 * "I think it's connected to a different account on the computer. We added
 * to the mobile version to state it needed to be signed in with the same
 * account — let's make sure that's added when there is no connection."
 *
 * The notice is drawn when the computer this app reached has no unit on it.
 * The likeliest reason, when a unit IS plugged in somewhere, is that it is
 * plugged into a different computer on a different account — so the account
 * this end is using is named, and the account server's yes-or-no about a
 * computer on this wifi on another account turns it into the red sentence
 * the connect screen already says.
 */
export function AccountCheck({ link }) {
  const email = link.account?.email || link.cloud?.user?.email || null
  const paired = isPairAccount(email)
  const [elsewhere, setElsewhere] = useState(false)
  useEffect(() => {
    if (paired) return undefined
    let live = true
    const ask = () => computerElsewhere().then((yes) => live && setElsewhere(yes))
    ask()
    const t = setInterval(ask, 30000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [paired])
  if (elsewhere) return <Mismatch email={email} />
  if (!email || paired) return null
  return (
    <p className="hint">
      Make sure the computer your Fractal is plugged into is signed in with <strong>{email}</strong>.
    </p>
  )
}

/** The computer on this wifi is on another account: said, with which one this is. */
function Mismatch({ email }) {
  return (
    <p className="connect-mismatch" role="alert">
      {email
        ? `The computer on this wifi is signed into a different account. This browser is signed in as ${email}. Sign the Fractal app on the computer in with ${email}, or sign this browser into the computer’s account.`
        : 'The computer on this wifi is signed into a different account than this browser. Sign both into the same account.'}
    </p>
  )
}
