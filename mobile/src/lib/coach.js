import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Whether the channel tip has been seen on this phone.
 *
 * ITS OWN KEY, NOT THE WALKTHROUGH'S, because the two are answered at
 * different moments and one must not silence the other. The walkthrough is
 * done the moment somebody reaches the Play screen; this tip has not been
 * shown yet at that point and may not be for a while, because it waits for a
 * preset whose blocks actually have channels. Sharing a key would mean
 * finishing the walkthrough cancelled a tip that was never drawn.
 *
 * DEFAULTS TO SEEN, the same as walkthroughSeen and for the same reason:
 * AsyncStorage answers late, and a tip that flashes up over somebody's rig
 * because storage had not replied yet is worse than a tip that never appears.
 * The real answer arrives a moment later and the card can open then.
 */
const KEY = 'fractal.coach.channels.v1'

export async function coachSeen() {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'done'
  } catch {
    /* A phone refusing storage would otherwise meet this every launch. */
    return true
  }
}

export function markCoach() {
  AsyncStorage.setItem(KEY, 'done').catch(() => {
    /* Costs one more showing, and nothing else. */
  })
}
