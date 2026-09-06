import { Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'

/**
 * Something the app has to say, in the register it deserves.
 *
 * 'fault' is the unit or the link refusing; 'warn' is a thing that is true and
 * costs you something; 'hint' is everything else. Bordered rather than filled,
 * because a solid block of colour at the top of a stage screen reads as an
 * alarm whatever it says.
 */
export default function Note({ tone = 'hint', children }) {
  const accent = tone === 'fault' ? color.fault : tone === 'warn' ? color.signal : color.rule
  return (
    <View
      accessibilityLiveRegion={tone === 'hint' ? 'none' : 'polite'}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: accent,
        backgroundColor: color.panel,
        borderRadius: radius.sm,
        paddingVertical: space.md,
        paddingHorizontal: space.md
      }}
    >
      <Text style={{ color: tone === 'hint' ? color.silkDim : color.silk, fontSize: font.small, lineHeight: 20 }}>
        {children}
      </Text>
    </View>
  )
}
