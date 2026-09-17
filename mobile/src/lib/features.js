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
 * The bench — the Edit screen — and for the first release it is off too.
 *
 * "Just remove edit for now and mark it as something we will work on in a
 * later update."
 *
 * And it is the brief, read properly: "for the initial releases I only want to
 * release the stuff related to the live gig pedal board." The bench is not the
 * pedalboard. It is the other half of the app — the chain, the knobs, the model
 * picker, finding a control by name, modifiers, adding and moving blocks — and
 * none of it is a thing anybody does between two bars.
 *
 * IT IS ALSO NOT FINISHED, which is the honest second reason. "The knobs just
 * scroll the screen up and down when trying to change them." A knob turns on a
 * vertical drag and it lives on a screen that scrolls vertically, and on iOS
 * the scroll view's own gesture recogniser wins that argument at the native
 * level — the JS responder is granted and then terminated out from under the
 * drag. The fix is to stop the scroll view scrolling for as long as a control
 * is being held, which is what `onScrollLock` does; the volume slider uses it
 * and works, and the bench will use it when it comes back. Shipping a screen of
 * knobs that cannot be turned is worse than not shipping the screen.
 *
 * WHAT IT TAKES AWAY, in two places:
 *
 *   App.js     the route to the edit screen, and the handler it hands down
 *   Stage.js   the Edit button (App passes no handler, so the row closes up
 *              rather than keeping a dead button)
 *
 * Everything behind it stays in the bundle and stays tested, for the same
 * reason the tone screen does: it goes back on by turning one word from
 * `false` to `true`, and rebuilding it against a rig that is not in the room
 * would be the expensive way to get back to here.
 */
export const BENCH = false
