import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Whether the walkthrough has been through on this phone.
 *
 * Its own key, and its own module, because the answer decides which screen
 * the app opens on — so it is read before anything is drawn rather than
 * during a render that has already started.
 *
 * DEFAULTS TO SEEN. AsyncStorage answers late, and the alternative default
 * puts a returning player at the start of a first-run flow for a frame. One
 * of those two mistakes is visible and annoying; the other costs a first-time
 * person nothing, because `walkthroughSeen` resolves a moment later with the
 * truth and the screen changes then.
 */
const KEY = 'fractal.walkthrough.v1'

export async function walkthroughSeen() {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'done'
  } catch {
    /* A phone refusing storage would otherwise meet this every launch. */
    return true
  }
}

export function markWalkthrough() {
  AsyncStorage.setItem(KEY, 'done').catch(() => {
    /* Costs the next launch, and nothing else. */
  })
}
