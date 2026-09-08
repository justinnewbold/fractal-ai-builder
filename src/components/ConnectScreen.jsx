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
 *   signed-out  — the pairing code from the Mac, and Connect
 *   joining     — nothing to press; it is happening
 *   no-answer   — Try now, and the reassurance that it keeps trying anyway
 *
 * Nobody is asked to sign in. The first way in is the code the Mac shows —
 * scanned, or typed into the box here — and it needs no account. Signing in
 * is the third thing on the page, offered for what it actually buys: presets
 * and taste that follow you between devices. "User shouldn't be required to
 * sign in unless they want to save and sync across the cloud."
 */
import { useState } from 'react'
import { formatPairCode, isPairAccount, isPairCode } from '../lib/link'

export default function ConnectScreen({ link, onPair, onConnect, onRetry, onSwitchAccount, onUnpair, onDemo, busy }) {
  const { link: state, account, pairError } = link
  const remembered = account?.email || null
  const paired = isPairAccount(remembered)
  const [code, setCode] = useState('')
  const [where, setWhere] = useState('')

  const pair = () => {
    if (!isPairCode(code)) return
    onPair(code)
  }

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
          <p>Finding your Mac.</p>
        </>
      ) : state === 'no-answer' ? (
        <>
          <h2>Your Mac isn&rsquo;t answering</h2>
          <p>
            Make sure the Fractal app is open on the Mac and the Mac is awake. This keeps trying on
            its own.
          </p>
          <div className="connect-actions">
            <button className="primary" onClick={onRetry} disabled={busy}>
              Try now
            </button>
            <button className="chip" onClick={paired ? onUnpair : onSwitchAccount} disabled={busy}>
              {paired ? 'Pair with a different Mac' : 'Sign in as someone else'}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Connect to your Mac</h2>
          {remembered ? (
            <>
              <p>
                {paired
                  ? 'This phone is paired with your Mac. No account needed.'
                  : 'Your Fractal is plugged into your Mac. Connect and this phone becomes its remote.'}
              </p>
              <div className="connect-actions">
                <button className="primary" onClick={onConnect} disabled={busy}>
                  {paired ? 'Connect' : `Connect as ${remembered}`}
                </button>
                {/* Unpairing forgets the hidden account and comes back to the code box; a person's account gets the sign-in sheet. */}
                <button className="chip" onClick={paired ? onUnpair : onSwitchAccount} disabled={busy}>
                  {paired ? 'Pair with a different Mac' : 'Use a different account'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Your Fractal is plugged into your Mac. Point this phone&rsquo;s camera at the code
                the Mac shows, or type the code here. No account needed.
              </p>
              <div className="connect-actions">
                <div className="connect-code-row">
                  <input
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    autoComplete="one-time-code"
                    spellCheck={false}
                    value={code}
                    onChange={(e) => setCode(formatPairCode(e.target.value))}
                    onKeyDown={(e) => e.key === 'Enter' && pair()}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    aria-label="The pairing code your Mac shows"
                    maxLength={19}
                  />
                </div>
                <button className="primary" onClick={pair} disabled={busy || !isPairCode(code)}>
                  Connect
                </button>
              </div>
              {pairError ? (
                <p className="problem" role="alert">
                  {pairError}
                </p>
              ) : null}
            </>
          )}
          <p className="hint">
            Haven&rsquo;t set up the Mac yet? Open this app on the Mac and tap{' '}
            <strong>Set up phone remote</strong>.
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
              Your Mac shows its address in the menu bar, next to the Fractal icon. Type it here and
              this phone talks to the Mac directly. Nothing is signed into, and what you save stays
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
                aria-label="The address your Mac shows"
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
                follow you to any device, anywhere &mdash; not just at home. Set the Mac up with the
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
