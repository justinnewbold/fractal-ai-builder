/* Generated from shared/affiliation.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * Whose app this is, and whose it is not.
 *
 * "Leave the name, but add a disclaimer that we are in no way affiliated or
 * endorsed by Fractal Audio Systems."
 *
 * WHY IT IS ONE STRING IN ONE FILE. This sentence has to appear in several
 * places — both About screens, the privacy page, the third-party notices, and
 * eventually a store listing — and the version of it that matters is whichever
 * one somebody's lawyer reads. Four hand-typed copies drift, and a disclaimer
 * that says three different things in three places is worse than one that says
 * nothing, because it reads as carelessness about exactly the point it is
 * making.
 *
 * IT IS ALSO AN OBLIGATION WE INHERITED. The preset codec this app carries is
 * Apache-2.0 and ships a NOTICE file whose trademark section says the same
 * thing about its own author. Section 4(d) requires we carry that forward, so
 * some version of this was going to be in the product whatever anybody
 * decided.
 *
 * The marks named are the ones that actually appear in this app — model names
 * the unit reports and hardware the app connects to. Naming a trademark to say
 * truthfully what your product works with is ordinary; the disclaimer is there
 * so nobody reads it as a claim of endorsement.
 */

/** The full sentence, for a page with room for it. */
export const NOT_AFFILIATED =
  'Fractal Remote is an independent app. It is in no way affiliated with, ' +
  'endorsed by, or sponsored by Fractal Audio Systems, Inc.'

/** What the marks are and why they appear here at all. */
export const TRADEMARKS =
  '“Fractal Audio”, “Axe-Fx”, “FM3”, “FM9”, “AM4” and “VP4” are trademarks of ' +
  'Fractal Audio Systems, Inc., used here only to say which hardware this app ' +
  'works with.'

/**
 * The small line at the foot of the website's first screen, in his words:
 * "Also add a disclaimer at the bottom in small text that says this product
 * is not affiliated or endorsed by Fractal Audio Systems."
 */
export const WELCOME_NOTICE = 'This product is not affiliated or endorsed by Fractal Audio Systems.'

/** Both, for the places that show one block of small print. */
export const AFFILIATION = `${NOT_AFFILIATED} ${TRADEMARKS}`

/**
 * The short form, for somewhere with one line to spare.
 *
 * Deliberately still carries "not affiliated" rather than shortening to
 * "independent" alone — independent is a positioning word and this is a
 * disclaimer, and the whole point of it is the part a shortener would drop.
 */
export const NOT_AFFILIATED_SHORT = 'Not affiliated with or endorsed by Fractal Audio Systems.'
