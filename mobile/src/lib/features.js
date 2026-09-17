/**
 * What this build of the phone app ships with.
 *
 * ONE SWITCH, and for the first release on the App Store and Play it is off.
 *
 * "For the initial releases I only want to release the stuff related to the
 * live gig pedal board, nothing with the AI or chat changes or things like
 * that." So the first version people can install is the stand and nothing
 * else: the preset, the scenes, what's engaged, the tempo, the tuner.
 *
 * WHY A SWITCH RATHER THAN DELETING IT. The tone screen works, it is covered
 * by tests that drive a fake unit through the whole write order, and it is
 * going back on in a later update. Deleting it would mean writing it again
 * against a rig that is not in the room. A switch means the second release
 * turns one word from `false` to `true`.
 *
 * WHAT IT TAKES AWAY, all of it in three places:
 *
 *   App.js         the route to the tone screen, and reading play mode back
 *   Stage.js       the ✦ Tone button (App passes no handler, so the row closes
 *                  up rather than keeping a dead button)
 *   Settings.js    the Play mode switch, which exists only to hide that button
 *
 * Play mode goes with it deliberately. Its whole job is taking the ✦ Tone
 * button off the stage screen, and a switch that hides something already
 * absent is a switch that does nothing and says it did something.
 *
 * WHAT IT DOES NOT CHANGE. Nothing about the relay, the allowlist, or what the
 * Mac will carry out. A phone was already refused a save to a slot, a backup,
 * a restore and firmware by the host rather than by this app, and that is
 * untouched — see shared/relay-rules.mjs.
 *
 * The tone modules stay in the bundle, unreachable. That is the point of the
 * switch, and it is worth being plain that "unreachable" is the guarantee
 * being made: with this off, nothing in the app calls the model, because the
 * only thing that ever did was the screen this takes the door away from.
 */
export const AI = false

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
 * ever needs taking out again, and because the AI one above proves the pattern
 * works. Turning it off puts the route and the button back behind it, in
 * App.js and Stage.js, with no other change anywhere.
 */
export const BENCH = true
