import { isPairAccount } from '../lib/link'
import { PairCard, AccountCard } from './PhoneRemote'

/**
 * ONE SQUARE. There used to be two, an inch apart.
 *
 * "Are both QR codes needed on the Mac app? It's confusing and they are
 * literally right by each other so a phone will pick up both codes." Then:
 * "Just delete the QR code. Because we will not be using it."
 *
 * The one that has gone was the SAME WIFI square: it opened the computer's
 * own address in a web browser on the phone, with nothing to sign into, and
 * only while both were on the same network. A real route, and one this app is
 * not going to ask anybody to use — the phone app is the phone app.
 *
 * What is left is the square for the FRACTAL REMOTE APP: the pairing code, or
 * the way in to signing into the same account. It works from anywhere, and it
 * is the one the phone's scanner actually reads.
 *
 * THE SAME COMPONENTS THE SETTINGS PAGE USES, not a second copy. Two
 * renderings of a pairing code drift, and the way that drift shows up is a
 * phone scanning a square that pairs it with nothing.
 *
 * The scanner's "that is the same wifi square" message is deliberately kept.
 * It stays correct for anybody on a desktop build older than this one, and a
 * wrong square is still a thing a camera can find.
 */
export default function PhoneQr({ connected, email, onAction, busy, showAccount = true }) {
  return (
    <div className="phone-qr-block">
      {isPairAccount(email) ? (
        /* onAction and busy are PairCard's way of offering to make a new code
           when this browser is not the one that paired. Passed through where
           there is something to press, absent in the tour where there is not
           — and PairCard already disables its own button when busy. */
        <PairCard on={connected} onAction={onAction || (() => {})} busy={busy ?? true} />
      ) : (
        <AccountCard on={connected} email={email} showAccount={showAccount} />
      )}
    </div>
  )
}
