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
import { useState } from 'react'
import { isPairAccount } from '../lib/link'

export default function ConnectScreen({ link, onConnect, onRetry, onSwitchAccount, onUnpair, onDemo, busy }) {
  const { link: state, account } = link
  const remembered = account?.email || null
  const paired = isPairAccount(remembered)
  const [where, setWhere] = useState('')

  /*
   * Go to the Mac directly.
   *
   * Typed rather than found: a browser cannot look for a Mac on the network,
   * and this page is served over https, so it cannot talk to a plain-http
   * address on the LAN either. What it can do is send you to the page the Mac
   * is already serving, which is the whole of local mode — so the address goes
   * in, and the phone lands on the Mac's own copy of this app.
   */
  const go = () => {
    const typed = where.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    if (!typed) return
    window.location.href = `http://${/:\d+$/.test(typed) ? typed : `${typed}:5056`}`
  }

  return (
    <section className="connect" data-state={state}>
      <span className="lamp connect-lamp" data-state={state === 'no-answer' ? 'fault' : state === 'joining' ? 'busy' : 'idle'} />

      {state === 'joining' ? (
        <>
          <h2>Connecting…</h2>
          <p>Finding your computer.</p>
        </>
      ) : state === 'no-answer' ? (
        <>
          <h2>Your computer isn&rsquo;t answering</h2>
          <p>
            Make sure the Fractal app is open on the computer and the computer is awake. This keeps trying on
            its own.
          </p>
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
                {/* Unpairing forgets the hidden account and comes back to the code box; a person's account gets the sign-in sheet. */}
                <button className="chip" onClick={paired ? onUnpair : onSwitchAccount} disabled={busy}>
                  {paired ? 'Pair with a different computer' : 'Use a different account'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Sign in with the same account as the computer your unit is plugged into, and this
                phone becomes its remote.
              </p>
              <div className="connect-actions">
                <button className="primary" onClick={onSwitchAccount} disabled={busy}>
                  Sign in
                </button>
              </div>
            </>
          )}
          <p className="hint">
            Haven&rsquo;t set up the computer yet? Open this app on the computer, tap{' '}
            <strong>Set up phone remote</strong>, and sign in with this same account.
          </p>

          {/*
            The other way in, which has worked all along and was invisible.

            A phone on the same wifi needs no account at all — the Mac serves
            this same app, and everything is kept on the phone. But every word
            about it lived behind servedLocally(), which is to say it was only
            ever shown to someone who had already found it. "There should be two
            options, one just to sign in and control the device and use local
            browser storage… and then there should be a cloud login where they
            can save all their stuff between devices."
          */}
          <div className="connect-local">
            <p className="silk-label">Or, on the same wifi — no account, no code</p>
            <p className="hint">
              Your computer shows its address in the menu bar, next to the Fractal icon. Type it here and
              this phone talks to the computer directly. Nothing is signed into, and what you save stays
              on this phone.
            </p>
            <div className="connect-local-row">
              <input
                type="text"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={where}
                onChange={(e) => setWhere(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && go()}
                placeholder="fractal.local"
                aria-label="The address your computer shows"
              />
              <button onClick={go} disabled={busy || !where.trim()}>
                Go
              </button>
            </div>
          </div>

          {/*
            Signing in is optional, and it is offered for what it buys rather
            than as the way in. A paired phone can sign in too, later, from
            Settings; here it is the one line for someone who already has an
            account on the Mac.
          */}
          {!remembered ? (
            <div className="connect-account">
              <p className="silk-label">Or sign in — to save and sync</p>
              <p className="hint">
                Signing in instead means your presets and what the AI has learned about your taste
                follow you to any device, anywhere &mdash; not just at home. Set the computer up with the
                same account and no code is needed.
              </p>
              <div className="connect-local-row">
                <button className="chip" onClick={onConnect} disabled={busy}>
                  Sign in
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <p className="hint connect-demo">
        Just looking?{' '}
        <button className="chip" onClick={onDemo} disabled={busy}>
          Try the demo
        </button>
      </p>
    </section>
  )
}
