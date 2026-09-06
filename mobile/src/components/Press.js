import { Pressable, Text, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { tick } from '../lib/feedback'

/**
 * Every button in the app.
 *
 * One component so the stage rules hold everywhere without anyone remembering
 * them: nothing below 56pt, a visible pressed state that does not depend on
 * colour alone, and a haptic on every press because the screen is the thing you
 * cannot look at.
 *
 * `tone` is meaning, not decoration. 'signal' is the audio path — a block that
 * is on, the scene that is live. 'live' is the link. 'plain' is everything
 * else, which is most of it.
 */
export default function Press({
  label,
  sub,
  onPress,
  tone = 'plain',
  on = false,
  disabled = false,
  grow = false,
  height = TAP,
  haptic = tick,
  style
}) {
  const accent = tone === 'signal' ? color.signal : tone === 'live' ? color.live : color.silk
  const background = on ? accent : color.panel
  const ink = on ? color.onSignal : disabled ? color.silkFaint : color.silk

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      disabled={disabled}
      onPress={() => {
        haptic?.()
        onPress?.()
      }}
      style={({ pressed }) => [
        {
          minHeight: height,
          flexGrow: grow ? 1 : 0,
          flexBasis: grow ? 0 : 'auto',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: on ? accent : color.rule,
          backgroundColor: background,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1
        },
        style
      ]}
    >
      <View style={{ alignItems: 'center' }}>
        <Text
          numberOfLines={1}
          style={{ color: ink, fontSize: font.body, fontWeight: '600', textAlign: 'center' }}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            numberOfLines={1}
            style={{
              color: on ? color.onSignal : color.silkDim,
              fontSize: font.micro,
              marginTop: 2
            }}
          >
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}
