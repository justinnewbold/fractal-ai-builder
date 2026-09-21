/**
 * When a fault on screen stops being true, as two pure functions and nothing
 * else.
 *
 * Separated from rig.js for the same reason unlock-rule.js is separated from
 * purchases.js: that file imports React and the device layer, so node cannot
 * load it and a rule inside it could only ever be checked by reading the
 * source as text. This is the part that matters — get it backwards and either
 * a working rig carries a red note about being disconnected, or a real fault
 * is swallowed by a reconnect — so it lives here, where a test can call it.
 *
 * Nothing in this file imports anything. That is the point of it.
 */

/**
 * A fault on screen, and whether the link going away is what put it there.
 *
 * `aboutLink` is set by the relay on the two errors that mean the channel was
 * not there: nothing joined yet, and nothing answered. It is deliberately NOT
 * the same flag as `linkDown`, which decides whether a request is sent again
 * — the tap tempo route is excluded from retries because a beat sent twice is
 * a beat that never happened.
 */
export const faultFrom = (err) => ({
  error: err?.message || 'Something went wrong.',
  errorLink: Boolean(err?.aboutLink)
})

/**
 * Is this fault withdrawn by the link reaching `link`?
 *
 * "Says I'm not connected to the computer, but it also says I'm connected."
 *
 * Only a complaint ABOUT the link, and only on `connected`. A unit that
 * refused a write is still worth reading after a reconnect, and clearing
 * every message on every reconnect would lose exactly the ones somebody needs
 * on a bad night.
 */
export const withdrawsFault = ({ error = null, errorLink = false } = {}, link) =>
  Boolean(error) && Boolean(errorLink) && link === 'connected'
