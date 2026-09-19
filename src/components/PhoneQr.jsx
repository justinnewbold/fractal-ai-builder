import { isPairAccount } from '../lib/link'
import { servedLocally } from '../lib/forgefx'
import { PairCard, AccountCard, WifiCard } from './PhoneRemote'

/**
 * ONE SQUARE AT A TIME, and the other one behind a fold.
 *
 * "Are both QR codes needed on the Mac app? It's confusing and they are
 * literally right by each other so a phone will pick up both codes."
 *
 * Both are needed. Neither should have been next to the other, and the proof
 * that this was already costing people is in the phone app's scanner: it
 * carries a special message for somebody who scanned the wrong one — "that is
 * the same wifi square, which is for a web browser". A warning written to
 * apologise for a layout is a layout that wants fixing.
 *
 * THEY ARE FOR TWO DIFFERENT THINGS, which is the part that was never said:
 *
 *   The square below is for the FRACTAL REMOTE APP on the phone. It carries
 *   the pairing code, or opens the app on the hosted site to sign in. It
 *   works from anywhere — the venue, the other end of a tour.
 *
 *   The wifi square is for a WEB BROWSER on the phone. It opens this
 *   computer's own address, with no account and nothing to sign into, and it
 *   only works while both are on the same wifi. Genuinely useful in a room
 *   with no internet, and useless everywhere else.
 *
 * So the app's square is the one on screen, because it is the one that works
 * everywhere and the one the scanner understands. The wifi square is a fold,
 * named after the situation somebody is in when they want it rather than
 * after what it is.
 *
 * THE SAME COMPONENTS THE SETTINGS PAGE USES, not a second copy. Two
 * renderings of a pairing code drift, and the way that drift shows up is a
 * phone scanning a square that pairs it with nothing.
 */
export default function PhoneQr({ connected, email, onAction, busy }) {
  return (
    <div className="phone-qr-block">
      {isPairAccount(email) ? (
        /* onAction and busy are PairCard's way of offering to make a new code
           when this browser is not the one that paired. Passed through where
           there is something to press, absent in the tour where there is not
           — and PairCard already disables its own button when busy. */
        <PairCard on={connected} onAction={onAction || (() => {})} busy={busy ?? true} />
      ) : (
        <AccountCard on={connected} email={email} />
      )}

      {/*
        Folded, and the summary is the question somebody actually has rather
        than the name of a feature. WifiCard draws nothing at all when this
        page is not being served from the computer, so on the hosted site the
        fold is empty — which is why the whole thing is wrapped in it.
      */}
      <WifiFold />
    </div>
  )
}

/**
 * The other route, out of the way.
 *
 * Only where it exists: served from this machine means a phone on the same
 * wifi can reach it, and that is the only case where the square means
 * anything. Elsewhere there is nothing to show and nothing to fold.
 *
 * The condition is asked HERE rather than by rendering WifiCard and seeing
 * whether it came back empty. Calling a component as a plain function to look
 * at its output runs its hooks in this one's place, which works right up
 * until either of them changes shape.
 */
function WifiFold() {
  if (!servedLocally()) return null
  return (
    <details className="wifi-fold">
      <summary>On the same wifi, with no internet?</summary>
      <p className="hint">
        This one opens in your phone&rsquo;s <strong>web browser</strong> instead of the app &mdash;
        no account, nothing to sign into, and it only works while both are on this wifi.
      </p>
      <WifiCard />
    </details>
  )
}
