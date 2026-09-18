/**
 * What this build of the phone app ships with.
 *
 * ONE SWITCH, and it is the bench.
 *
 * There were two. The other was the AI, which shipped `false` from the first
 * release — "For the initial releases I only want to release the stuff related
 * to the live gig pedal board, nothing with the AI or chat changes or things
 * like that" — and it was kept as a switch rather than a deletion because the
 * tone screen worked and was expected back.
 *
 * It is not coming back. The tone designer and the chat are out of all four
 * apps now, so the switch, the screen, lib/tone.js and the play-mode setting
 * that existed only to hide the ✦ Tone button have gone with it. What was
 * built is not lost: the branch feature/ai-builder-preserved holds the whole
 * of it.
 *
 * Nothing about the relay or the allowlist changed with it. A phone was
 * already refused a save to a slot, a backup, a restore and firmware by the
 * host rather than by this app — see shared/relay-rules.mjs — and that is
 * untouched.
 */

/**
 * The bench — the Edit screen — and it is ON.
 *
 * It was off for about twenty minutes, on the strength of "just remove edit for
 * now", and then: "actually just fix the edit screen I actually like it."
 *
 * WHAT WAS ACTUALLY WRONG WAS NOT THE SCREEN. "The knobs just scroll the screen
 * up and down when trying to change them" is a gesture problem, not a missing
 * feature — a knob turns on a vertical drag and lives on a screen that scrolls
 * vertically, and on iOS the scroll view's pan gesture recogniser is NATIVE: it
 * takes the touch back and terminates the drag rather than losing to a
 * JavaScript responder. Switching the screen off would have been hiding a
 * two-line fix behind a feature flag.
 *
 * The fix is `onScrollLock` — see components/Knob, which stops the screen
 * scrolling at the earliest hook there is, the capture phase of the touch,
 * before the scroll view has been asked anything.
 *
 * The switch stays because it is the honest way to take something out if it
 * ever needs taking out again.
 */
export const BENCH = true
