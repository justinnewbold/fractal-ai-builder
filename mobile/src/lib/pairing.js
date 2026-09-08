/* Generated from shared/pairing.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * Pairing a phone with a Mac, with nobody making an account.
 *
 * The relay only ever carries one thing: a private channel named after a
 * signed-in user, which both ends must be signed in as. That is a good
 * security model and a bad first minute — the phone's "Connect" button opened
 * a sign-in form, and a person who only wanted to turn a knob from across the
 * room was asked for an email and a password before anything happened.
 *
 *   "User shouldn't be required to sign in unless they want to save and sync
 *   across the cloud. It's requiring a login to connect."
 *
 * The Mac's end is a separate program that can only sign in with an email and
 * a password, and the channel policy cannot be changed from here. So the
 * account stays — but the person never sees it. When the Mac is set up it
 * makes a pairing code, and the code IS the account: an address and a password
 * are derived from it the same way at both ends, so a phone that has the code
 * can sign in as the same user the Mac did without anyone typing anything but
 * the code. The Mac shows it as a QR that opens the hosted app with the code
 * in the address, and as text for a camera that will not focus.
 *
 * A signed-in account is still there for anyone who wants their presets to
 * follow them between devices; it is simply no longer the price of a remote.
 *
 * Everything here is pure and shared with the phone apps, because the two ends
 * deriving different credentials from the same code is a fault that would
 * look, to the person holding the phone, exactly like a Mac that is off.
 */

/** Letters and digits that cannot be misread for each other: no 0/O, no 1/I. */
export const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** 16 symbols from a 32-symbol alphabet is 80 bits, which nobody guesses. */
export const PAIR_LENGTH = 16
/** Where the hidden account's address lives. Nothing is ever mailed to it. */
export const PAIR_DOMAIN = 'pair.fractal.newbold.cloud'
/** The one place the QR points, wherever the Mac is serving from. */
export const HOSTED_ORIGIN = 'https://fractal.newbold.cloud'

const pairPattern = new RegExp(`^[${PAIR_ALPHABET}]{${PAIR_LENGTH}}$`)

/**
 * A fresh code. `random` fills a byte array, the way `crypto.getRandomValues`
 * does; it is a parameter so a test can hand in known bytes.
 */
export function makePairCode(random) {
  const fill =
    random ||
    ((bytes) => {
      const c = globalThis.crypto
      if (!c?.getRandomValues) throw new Error('No source of randomness here.')
      return c.getRandomValues(bytes)
    })
  const bytes = fill(new Uint8Array(PAIR_LENGTH))
  let code = ''
  for (let i = 0; i < PAIR_LENGTH; i++) code += PAIR_ALPHABET[bytes[i] % PAIR_ALPHABET.length]
  return code
}

/**
 * A code as typed — lower case, spaces, dashes — as the code it means.
 * Returns null for anything that is not a code at all, so a caller can say
 * "that isn't a code" rather than trying to sign in with it. The alphabet has
 * no 0, 1, I or O, so a code never contains the characters people misread.
 */
export function normalizePairCode(text) {
  const raw = String(text || '')
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
  return pairPattern.test(raw) ? raw : null
}

/** The code the way it is shown and read out: four groups of four. */
export function formatPairCode(code) {
  const clean = String(code || '').replace(/[^A-Z2-9]/gi, '').toUpperCase()
  return clean.replace(/(.{4})(?=.)/g, '$1-')
}

/** Whether something is already a code — for enabling a Connect button. */
export const isPairCode = (text) => normalizePairCode(text) !== null

/**
 * The account a code stands for. Same code, same account, at both ends.
 *
 * The address carries only half the code, so a screen that shows who is signed
 * in never shows enough to sign in with. The password carries all of it.
 */
export function pairCredentials(code) {
  const clean = normalizePairCode(code)
  if (!clean) throw new Error('That isn’t a pairing code. It’s 16 letters and numbers, shown on your Mac.')
  return {
    email: `pair-${clean.slice(0, 8).toLowerCase()}@${PAIR_DOMAIN}`,
    password: `pair-${clean}`
  }
}

/** Whether an account is one of these, rather than one a person made. */
export function isPairAccount(email) {
  return new RegExp(`^pair-[a-z2-9]{8}@${PAIR_DOMAIN.replace(/\./g, '\\.')}$`).test(String(email || ''))
}

/**
 * What the QR carries: the hosted app, with the code in the fragment.
 *
 * The fragment rather than the query, because a fragment never leaves the
 * phone — it is not sent to the server, so the code is in no access log.
 */
export function pairLink(code, origin = HOSTED_ORIGIN) {
  const clean = normalizePairCode(code)
  if (!clean) return null
  return `${origin.replace(/\/+$/, '')}/#pair=${clean}`
}

/** The code in a URL the phone opened, or null. Accepts the query too, for a link typed by hand. */
export function pairCodeFromUrl({ hash = '', search = '' } = {}) {
  for (const part of [hash, search]) {
    const m = /(?:^|[#?&])pair=([^&]*)/i.exec(String(part || ''))
    if (m) {
      const code = normalizePairCode(decodeURIComponent(m[1]))
      if (code) return code
    }
  }
  return null
}
