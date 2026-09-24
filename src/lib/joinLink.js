/**
 * A link that opens straight onto Create Account.
 *
 * "Is there a direct link I can give out that takes people directly to the
 * create account page?" There was not: the site opened on its welcome, and
 * making an account was two taps in. A tester he has just given access to — or
 * put on the waiting list — needs one link that ends in an account.
 *
 * fractal.newbold.cloud/join, and /signup for anybody who guesses. vercel.json
 * already sends every path that is not a file to the app, so the path survives
 * to here; the app opens the form and puts the address back to plain `/`, so a
 * reload or a bookmark afterwards is the ordinary site.
 */
export const JOIN_PATHS = ['/join', '/signup']

export const JOIN_LINK = 'https://fractal.newbold.cloud/join'

/** Whether this page was opened from the join link. */
export function arrivedToJoin(loc = globalThis.location) {
  const path = String(loc?.pathname || '').replace(/\/+$/, '').toLowerCase()
  return JOIN_PATHS.includes(path)
}
