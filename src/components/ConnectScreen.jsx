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
import { isPairAccount } from '../lib/link'

export default function ConnectScreen({
  link,
  onConnect,
  onRetry,
  onSwitchAccount,
  onCreateAccount,
  onUnpair,
  onDemo,
  /* Somebody who has paid. The phone never offers them "Try the Demo" —
     "if they are already signed in and the app is unlocked, instead of
     saying try the demo, have it just say Demo." */
  owned = false,
  busy
}) {
  const { link: state, account } = link
  const remembered = account?.email || null
  const paired = isPairAccount(remembered)

  return (
    <section className="connect" data-state={state}>
      <span className="lamp connect-lamp" data-state={state === 'no-answer' ? 'fault' : state === 'joining' ? 'busy' : 'idle'} />

      {state === 'joining' ? (
        <>
          <h2>Connecting…</h2>
          <p>Finding your computer.</p>
          {account ? <Using email={remembered} paired={paired} /> : null}
        </>
      ) : state === 'no-answer' ? (
        <>
          <h2>Your computer isn&rsquo;t answering</h2>
          <p>
            Make sure the Fractal app is open on the computer and the computer is awake. This keeps trying on
            its own.
          </p>
          <Using email={remembered} paired={paired} />
          <div className="connect-actions">
            <button className="primary" onClick={onRetry} disabled={busy}>
              Try now
            </button>
            <button className="chip" onClick={paired ? onUnpair : onSwitchAccount} disabled={busy}>
              {paired ? 'Pair with a different computer' : 'Sign in as someone else'}
            </button>
          </div>
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
              <div className="connect-actions">
                <button className="primary" onClick={onSwitchAccount} disabled={busy}>
                  Sign in
                </button>
                {/*
                  "Where is the sign-up button?" Beside the sign-in, where
                  somebody without an account looks for it — not behind it.
                  The browser can make an account since it can sell the
                  unlock; the phone's word for it.
                */}
                {onCreateAccount ? (
                  <button className="chip" onClick={onCreateAccount} disabled={busy}>
                    Create Account
                  </button>
                ) : null}
              </div>
            </>
          )}
          <p className="hint">
            Haven&rsquo;t set up the computer yet? Open this app on the computer, tap{' '}
            <strong>Set up phone remote</strong>, and sign in with this same account.
          </p>

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
