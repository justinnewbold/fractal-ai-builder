/**
 * Play mode: the switch that clears the stage screen for playing.
 *
 * Ask went off the phone entirely because of one real hazard — "a generate
 * button within reach of a stage tap", as mobile/src/screens/Stage.js puts it.
 * That reasoning was about accidents, and it was right about accidents. It was
 * wrong to conclude the whole thing had to go, for a reason that only turns up
 * when you read what a phone is actually allowed to do:
 *
 *   A PHONE CANNOT SAVE TO A SLOT. The host refuses POST /preset/store from a
 *   handset — see REMOTE_FORBIDDEN in shared/relay-rules.mjs — so everything a
 *   generated tone writes lands in the edit buffer and nowhere else. Revert is
 *   a preset re-select, which IS allowed, so one tap puts the saved version
 *   back.
 *
 * So the worst an accidental tap can cost on a phone is the sound being wrong
 * until you undo it. That is a smaller thing than never being able to ask for a
 * tone away from the desk, which is where a phone is most of the time.
 *
 * The rule is his: the button comes back, and a switch takes it away again for
 * as long as he is playing. Not a heuristic about what the app thinks he is
 * doing — a switch he sets, that stays set.
 *
 * OFF by default, because a switch that hides things has to be asked for. A
 * phone that has never heard of this shows the button.
 */

/*
 * The rule itself is shared with the phone app, which asks the same question
 * about its own stage screen. Only the storage differs, and it differs enough
 * to matter — see toneWayIn's third state over there.
 */
export { clampMode, askButtonShows } from '../../shared/play-mode.mjs'
import { clampMode } from '../../shared/play-mode.mjs'

const KEY = 'fractal.playMode'

/** Whether this device is set to playing. */
export function loadPlayMode(storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    return clampMode(store?.getItem(KEY))
  } catch {
    // Private windows and blocked site data both throw on read. Showing the
    // button beats failing to render the screen it sits on.
    return false
  }
}

/** Remember it. A failure here costs the next reload, not this press. */
export function savePlayMode(on, storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    store?.setItem(KEY, clampMode(on) ? '1' : '0')
    return true
  } catch {
    return false
  }
}
