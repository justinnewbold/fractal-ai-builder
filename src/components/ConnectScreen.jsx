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
export default function ConnectScreen({ link, onConnect, onRetry, onSwitchAccount, onDemo, busy }) {
  const { link: state, account } = link
  const remembered = account?.email || null

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
