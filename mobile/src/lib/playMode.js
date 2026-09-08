/**
 * Play mode, on the phone app.
 *
 * The same switch the browser has, for the same reason, and the rule that
 * decides what it hides is the browser's own — `askButtonShows` is generated
 * across so the two apps cannot end up disagreeing about when a generate
 * button is on a stage screen.
 *
 * ONE REAL DIFFERENCE, and it decides the default. The browser reads its
 * setting synchronously and paints the right screen first time. AsyncStorage
 * cannot be read synchronously, so there is always a frame before the answer
 * arrives, and something has to be true during it.
 *
 * It stays HIDDEN until known. Both choices flicker; only one of them flickers
 * dangerously. A button that appears a beat late is a button somebody has not
 * reached for yet. A button that vanishes out from under a thumb already on its
 * way down is a press that lands on whatever the layout put there instead —
 * which, in a row of stage controls, is a scene change mid-song.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

/* The rule is the browser's, generated across so the two cannot drift into
   disagreeing about when a generate button is on a stage screen. */
export { clampMode, toneWayIn } from './play-mode.js'
import { clampMode } from './play-mode.js'

const KEY = 'fractal.playMode'

/** Whether this phone is set to playing. Unknown until this resolves. */
export async function loadPlayMode() {
  try {
    return clampMode(await AsyncStorage.getItem(KEY))
  } catch {
    // Storage that will not answer is not a reason to fail the screen it sits
    // on. The switch reads as off and the person can set it again.
    return false
  }
}

/** Remember it. A failure costs the next launch, not this press. */
export async function savePlayMode(on) {
  try {
    await AsyncStorage.setItem(KEY, clampMode(on) ? '1' : '0')
    return true
  } catch {
    return false
  }
}
