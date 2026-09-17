/**
 * Requests to the account service that do not wait forever.
 *
 * There was no limit at all, and the day the Supabase project ran out of its
 * disk allowance the app simply stopped. Three sign-ins, no error, no spinner
 * that meant anything, twenty seconds each:
 *
 *   sign in — 19874ms
 *   sign in — 19661ms
 *   sign in — 19735ms
 *
 * Twenty seconds of a frozen phone is indistinguishable from a crash, and it
 * is part of what "the app is barely usable" was made of. This is the cap, and
 * the readable message that comes back when it bites.
 *
 * ITS OWN FILE so it can be RUN. Everything else the phone's relay does needs
 * a phone — storage, a websocket, a real account — and none of that exists in
 * the test runner. This needs nothing but `fetch`, so the one piece worth
 * exercising is the one piece that can be.
 */

/*
 * Twelve seconds: longer than any healthy answer takes on bad hotel wifi, short
 * enough that the screen comes back and says something a person can act on.
 */
export const ACCOUNT_MS = 12000

/**
 * `fetch`, with a stopwatch on it.
 *
 * ABORTED, NOT RACED. Walking away from a request leaves it running, and a
 * sign-in that lands two minutes later would quietly sign somebody in on a
 * screen that gave up on it long ago. This cuts the request off.
 *
 * An abort the caller asked for is still the caller's, and has to arrive as
 * their error rather than as ours — supabase-js cancels its own requests, and
 * one of those reported as "the account service timed out" would be a lie told
 * at exactly the moment somebody is trying to work out what is wrong.
 */
export function notForever(url, options = {}, ms = ACCOUNT_MS) {
  const cut = new AbortController()
  const bell = setTimeout(() => cut.abort(), ms)
  const theirs = options.signal
  const relay = () => cut.abort()
  if (theirs) {
    if (theirs.aborted) relay()
    else theirs.addEventListener('abort', relay)
  }
  return fetch(url, { ...options, signal: cut.signal })
    .catch((err) => {
      if (cut.signal.aborted && !(theirs && theirs.aborted)) {
        throw new Error('The account service timed out.')
      }
      throw err
    })
    .finally(() => {
      clearTimeout(bell)
      if (theirs) theirs.removeEventListener('abort', relay)
    })
}
