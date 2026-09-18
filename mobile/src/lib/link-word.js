/* Generated from shared/link-word.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * The one word at the top of the screen, and what colour it is.
 *
 * The bar says CONNECTED in green, or DISCONNECTED in red, or CONNECTING while
 * it is on its way. That word lived inside the browser's LinkChip, which is
 * JSX and reachable from nowhere else — so when the phone was asked for "this
 * exact header" the only way to give it one was to write the same four cases
 * out a second time, in a second file, where nothing holds them together.
 *
 * They are the same four cases. A link is up, or on its way, or should be up
 * and is not, or was never turned on — and a phone and a Mac disagreeing about
 * which of those is true, in a bar somebody checks before walking on stage, is
 * the kind of difference that only ever shows up in a photograph.
 *
 * `tone` is the browser's own vocabulary, from describeLink: good, busy, bad,
 * dim. The phone has no describeLink — its link module is a different thing
 * entirely — so `toneOfRemote` reads the same four states straight off the
 * link, and a test holds the two to each other.
 */

/** What the browser's describeLink says about a phone remote, by link state. */
export function toneOfRemote(link) {
  if (link === 'connected') return 'good'
  if (link === 'joining') return 'busy'
  if (link === 'no-answer') return 'bad'
  return 'dim'
}

/**
 * The word, given a tone and which end is asking.
 *
 * "Just the word connected (green), disconnected (red)" — with connecting for
 * the state that is neither, because a link on its way is not a link that
 * failed. The fourth is for a remote nobody has turned on yet: grey, and
 * saying what is missing rather than claiming something broke.
 */
export function linkWord(tone, role) {
  if (tone === 'good') return 'connected'
  if (tone === 'busy') return 'connecting'
  if (tone === 'bad') return 'disconnected'
  return role === 'remote' ? 'no computer' : 'no phone'
}

/**
 * The unit, on top of the link.
 *
 * CONNECTED was true and useless. It meant the phone could reach the Mac,
 * and it stayed green for the whole of an evening in which the FM3 had
 * frozen: no preset number, no chain, every read timing out, and the bar
 * still saying the one word that means everything is fine. "What's the point
 * of having things that sound connected if it's not connected? Otherwise
 * it's just lying."
 *
 * So the unit gets a say. `unit` is what the Mac knows about it: 'missing'
 * when the Mac has no unit at all, 'silent' when it has one that stopped
 * answering, 'present' when it answers, 'unknown' before anything has been
 * asked. Only a good link gets a unit word -- with the link down, the link
 * is the news.
 */
export function unitWord(tone, unit) {
  if (tone !== 'good') return null
  if (unit === 'missing') return 'no unit'
  if (unit === 'silent') return 'unit not answering'
  return null
}

/** The colour that word is drawn in, named rather than hexed. */
export function linkTone(tone) {
  if (tone === 'good') return 'ok'
  if (tone === 'busy') return 'wait'
  if (tone === 'bad') return 'no'
  return 'off'
}
