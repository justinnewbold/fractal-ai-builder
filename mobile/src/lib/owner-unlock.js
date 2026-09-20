/* Generated from shared/owner-unlock.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * Accounts that are unlocked without paying.
 *
 * "Is there any way we can set it up so that my email unlocks the app
 * automatically? I still wanna be able to test with live connections and I'm
 * blocked now by the gate for the unlock."
 *
 * Somebody has to be able to drive a real rig before the thing is on sale,
 * and the person who wrote it is the obvious one. A store cannot help: there
 * is no product to buy yet, and once there is, buying your own app is a
 * refund request waiting to happen.
 *
 * HOW THIS IS SAFE, which is the only interesting part. The list below is
 * PUBLIC — this repository is public and anybody can read it. It grants
 * nothing on its own, because it is a list of ACCOUNTS, and the app only
 * consults it for an account somebody is already signed in as. Reading the
 * list tells you whose account is unlocked; it does not let you become them.
 * The password is the gate, exactly as it is for everything else that account
 * can reach.
 *
 * WHY HASHES RATHER THAN ADDRESSES. Not secrecy — see above, it buys none.
 * An email address in a public file is scraped and sold within a week, and
 * that is a real cost for no benefit. A hash is the same check with nobody's
 * inbox in it.
 *
 * It is deliberately NOT a cryptographic hash. A pure-JS one costs nothing to
 * carry and adds no dependency to the phone app — and a dependency here would
 * move the native fingerprint and spend an iOS build, which is a poor trade
 * for a list of two. Anyone determined can find the address; that was never
 * what this protects.
 */

/** djb2, as a hex string. Stable, tiny, and the same at both ends. */
export function fold(text) {
  let h = 5381
  const s = String(text || '')
    .trim()
    .toLowerCase()
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * The accounts that carry an unlock without a purchase.
 *
 * Add one by running `fold('someone@example.com')` and pasting the answer.
 */
export const OWNERS = [
  /* The author, who has to be able to drive a real rig before there is
     anything to buy. The VALUE is written out rather than computed from the
     address here — calling fold('…') in this file would put the address in
     it, which is the one thing the hashing was for. */
  '8a9f8fc4'
]

/**
 * Whether this signed-in account is one of them.
 *
 * Takes the email the ACCOUNT SERVICE reports, never one typed into a box:
 * the caller is `currentAccount()`, which reads it back from the session.
 * An empty or missing address is nobody.
 */
export const isOwner = (email) => {
  const at = String(email || '').trim()
  if (!at || !at.includes('@')) return false
  return OWNERS.includes(fold(at))
}
