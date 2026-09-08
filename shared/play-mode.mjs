/**
 * When a generate button is allowed on a stage screen.
 *
 * Both apps ask this and both apps answer it differently in the details, so
 * the answers live together rather than apart — the failure this prevents is
 * one of them quietly becoming more permissive than the other, which nobody
 * would notice until a tone started building mid-song.
 *
 * WHY THERE IS A BUTTON AT ALL. Tone generation was off the phone entirely,
 * for a reason that was right about accidents: "a generate button within reach
 * of a stage tap is a hazard". What that reasoning did not account for is what
 * an accident COSTS on a phone. A handset cannot save to a slot — the host
 * refuses it, see REMOTE_FORBIDDEN in relay-rules — so everything a tone writes
 * lands in the edit buffer and re-selecting the preset puts the stored version
 * back. The worst an accidental tap can do is make the sound wrong until it is
 * undone, which is smaller than never being able to ask for a tone away from
 * the desk.
 *
 * So the button comes back, and a switch takes it away for as long as somebody
 * says they are playing. Not a heuristic about what the app thinks is
 * happening — a switch that is set, and stays set.
 *
 * Pure, and shared as a copy into the phone app by
 * scripts/sync-relay-rules.mjs. No storage here: the browser reads
 * localStorage synchronously and the phone cannot read AsyncStorage at all
 * without waiting, and that difference is the whole of `toneWayIn`'s third
 * state below.
 */

/**
 * Anything unreadable is "not playing".
 *
 * One-sided on purpose. A value nobody can parse must never come back as "hide
 * the button": a missing button reads as the feature being gone, while an extra
 * one is a button somebody can ignore.
 */
export const clampMode = (v) => v === true || v === 'true' || v === '1'

/**
 * The browser's rule, for the floating ✦ Ask button.
 *
 * Three parts, and the first two are the ones easy to lose: there is nothing to
 * ask about before a unit has answered, and offering to open the conversation
 * you are already reading is a button that does nothing.
 */
export const askButtonShows = ({ status, view, playing }) =>
  status === 'live' && view !== 'ask' && !playing

/**
 * The phone app's rule, for the ✦ Tone button on the stage screen.
 *
 * `playing` is a TRI-STATE here, unlike the browser's: `null` means the setting
 * has not been read back yet, which AsyncStorage makes unavoidable, and it is
 * not the same as "not playing".
 *
 * Hidden during that gap. Both choices flicker; only one of them flickers
 * dangerously. A button that appears a beat late is one nobody has reached for
 * yet. A button that vanishes out from under a thumb already on its way down
 * becomes a press on whatever the layout put there instead — which, in a row of
 * stage controls, is a scene change mid-song.
 */
export const toneWayIn = ({ connected, playing }) => connected === true && playing === false
