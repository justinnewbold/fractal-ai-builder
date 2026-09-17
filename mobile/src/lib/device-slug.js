/* Generated from shared/device-slug.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * The name a unit's own things are filed under.
 *
 * Setlists, stars and which of them Previous and Next step through are all kept
 * per unit, because slot 4 on an FM3 and slot 4 on an AM4 are different sounds
 * and a setlist of one must never play as the other.
 *
 * "Per unit" means per THIS STRING. Two apps that derive it differently do not
 * disagree loudly — they file into two buckets that never meet, so a setlist
 * built at the Mac is simply not on the phone, and the sync that is supposed to
 * carry it across has nothing to match on. That failure is silent, survives a
 * reinstall, and looks exactly like a sync that is broken.
 *
 * So it lives here, once, and both apps are handed the same copy by
 * `npm run sync:rules`.
 *
 * The rule itself is the browser's, unchanged: the unit's short name if it has
 * one, otherwise its long name, lowercased with everything that is not a letter
 * or a digit removed. `FM3` and `Axe-Fx III` become `fm3` and `axefxiii`.
 *
 * `'device'` is the fallback, and it is deliberately a real bucket rather than
 * null: a unit that answered without naming itself still has setlists worth
 * keeping, and they are better in a shared drawer than dropped.
 */
export const DEFAULT_SLUG = 'device'

/**
 * @param {{short?: string, name?: string}|string|null|undefined} unit
 *   Either the detect response, or a label already pulled out of it.
 */
export function deviceSlug(unit) {
  const label = typeof unit === 'string' ? unit : unit?.short || unit?.name
  if (!label) return DEFAULT_SLUG
  return String(label).toLowerCase().replace(/[^a-z0-9]/g, '') || DEFAULT_SLUG
}
