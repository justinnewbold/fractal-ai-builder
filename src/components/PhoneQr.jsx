import { isPairAccount } from '../lib/link'
import { PairCard, AccountCard, WifiCard } from './PhoneRemote'

/**
 * The square a phone points its camera at, wherever somebody needs it.
 *
 * "Mac app first-launch tutorial pulling up QR/pairing codes automatically."
 *
 * The squares existed. What they did not do was turn up on their own: they
 * live behind Setup → Phone & computer, three taps into a menu, and the one
 * moment somebody needs them is the first minute of owning the Mac app —
 * before they know there is a Setup menu, or that a phone was part of the
 * arrangement at all.
 *
 * THE SAME COMPONENTS THE SETTINGS PAGE USES, not a second copy. Two
 * renderings of a pairing code drift, and the way that drift shows up is a
 * phone scanning a square that pairs it with nothing. So this is the one
 * arrangement of them, and both places call it.
 *
 * Which square depends on how the computer is set up, and the three cases are
 * genuinely different:
 *
 *   Same wifi — the phone talks to this machine directly, nothing to sign
 *   into. Only offered where that route exists, which WifiCard decides.
 *
 *   Paired, no account — there is a code, and it is the way in.
 *
 *   Signed in — there is NO code, and saying so is the whole point:
 *   somebody who has read about pairing codes will otherwise hunt for one
 *   that does not exist. The account is the code.
 */
export default function PhoneQr({ connected, email }) {
  return (
    <div className="phone-qr-block">
      <WifiCard />
      {isPairAccount(email) ? (
        /* `onAction` and `busy` are PairCard's way of offering to pair again
           when the code was made in another browser. There is nothing to
           press mid-tour, so it is given neither and shows the code alone. */
        <PairCard on={connected} onAction={() => {}} busy />
      ) : (
        <AccountCard on={connected} email={email} />
      )}
    </div>
  )
}
