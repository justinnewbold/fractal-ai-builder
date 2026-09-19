import { waysFor, osGuess, RELEASES, waysWord } from '../../shared/ways-in.mjs'
import { pairCodeFromUrl, formatPairCode } from '../../shared/pairing.mjs'
import { AFFILIATION } from '../../shared/affiliation.mjs'

/**
 * What the hosted site is now: a way to get the app, not the app.
 *
 * "We are getting rid of the web app accessibility, I know that app is needed
 * for the computer app to work, but it's going to require an actual app
 * download. We don't want it accessible from their browser directly."
 *
 * THE BUNDLE IS UNCHANGED AND THAT IS THE POINT. The desktop apps serve this
 * very same build from the machine holding the cable — that is what they are —
 * so the app cannot be deleted without deleting them. What can be decided is
 * WHERE it agrees to run, and the one place it should not is a browser pointed
 * at the public address. See isHostedOrigin: the desktop app serves from
 * localhost and the phone app is not a browser at all, so neither of them is
 * touched by this.
 *
 * A PAIRING CODE IN THE ADDRESS IS STILL HONOURED, as words rather than as a
 * session. The squares the computer shows carry `#pair=CODE`, and somebody
 * who points a phone CAMERA at one lands here — so this reads the code back
 * out and prints it, large, to be typed into the app. The alternative is a
 * page that silently drops the one thing the person came with.
 */
export default function GetTheApp() {
  const code = pairCodeFromUrl({
    hash: typeof window === 'undefined' ? '' : window.location.hash,
    search: typeof window === 'undefined' ? '' : window.location.search
  })
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const ways = waysFor(osGuess(ua))

  return (
    <div className="get-app">
      <h1>Fractal Remote</h1>
      <p className="lead">
        Drive your Fractal rig from your phone &mdash; presets, scenes, the whole chain, from the
        other end of a stage.
      </p>

      {code ? (
        <section className="get-app-pair">
          <p className="hint">
            You scanned a pairing code. Install the app below, then type this into it &mdash;
            it&rsquo;s under <strong>Connect a computer</strong>.
          </p>
          <p className="pair-code mono" aria-label="Your pairing code">
            {formatPairCode(code)}
          </p>
        </section>
      ) : null}

      <section>
        <h2>On your computer</h2>
        <p className="hint">
          Your unit plugs into a computer with a USB cable. That computer talks to the unit, and
          your phone tells the computer what to do. {waysWord()} ways, and what each one costs you:
        </p>
        <ul className="get-app-ways">
          {ways.map((way) => (
            <li key={way.id}>
              <strong>{way.title}</strong> <span className="hint">{way.note}</span>
            </li>
          ))}
        </ul>
        <p>
          <a className="primary" href={RELEASES}>
            Download for Mac, Windows or Linux
          </a>
        </p>
      </section>

      <section>
        <h2>On your phone</h2>
        <p className="hint">
          The phone app is what you hold on stage. It talks to the computer, never to the unit
          directly.
        </p>
      </section>

      <p className="footnote">{AFFILIATION}</p>
      <p className="footnote">
        <a href="/privacy.html">Privacy</a> &middot; <a href="/support.html">Support</a>
      </p>
    </div>
  )
}
