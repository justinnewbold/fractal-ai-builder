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
 *   signed-out  — Connect (opens the sign-in sheet)
 *   joining     — nothing to press; it is happening
 *   no-answer   — Try now, and the reassurance that it keeps trying anyway
 */
import { useState } from 'react'

export default function ConnectScreen({ link, onConnect, onRetry, onSwitchAccount, onDemo, busy }) {
  const { link: state, account } = link
  const remembered = account?.email || null
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
            <button className="chip" onClick={onSwitchAccount} disabled={busy}>
              Sign in as someone else
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Connect to your Mac</h2>
          <p>Your Fractal is plugged into your Mac. Sign in and this phone becomes its remote.</p>
          <div className="connect-actions">
            <button className="primary" onClick={onConnect} disabled={busy}>
              {remembered ? `Connect as ${remembered}` : 'Connect'}
            </button>
            {remembered ? (
              <button className="chip" onClick={onSwitchAccount} disabled={busy}>
                Use a different account
              </button>
            ) : null}
          </div>
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
            <p className="silk-label">Or, on the same wifi — no account</p>
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
            <p className="hint">
              Signing in instead means your presets and what the AI has learned about your taste
              follow you to any device, anywhere &mdash; not just at home.
            </p>
          </div>
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
