import { View } from 'react-native'

import { color } from '../lib/theme'

/**
 * The one indicator, in the three states it can honestly be in.
 *
 * 'live' is the Mac answering, 'fault' is it not, 'idle' is not knowing yet —
 * and the third is a real state rather than a placeholder. A lamp that shows
 * green while a link is still being established is the reason someone walks on
 * stage believing they have a remote.
 */
export default function Lamp({ state = 'idle', size = 10 }) {
  const fill =
    state === 'live' ? color.live : state === 'fault' ? color.fault : color.silkFaint
  const halo =
    state === 'live' ? color.liveHalo : state === 'fault' ? color.faultHalo : 'transparent'
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: fill,
        borderWidth: size / 2,
        borderColor: halo
      }}
    />
  )
}
