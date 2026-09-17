import { Pressable, Text, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { tick } from '../lib/feedback'

/**
 * A coloured tile, for the two things on this screen that have an identity.
 *
 * `Press` is the app's button and stays the app's button: one shape, one
 * meaning of colour, amber for the audio path. That grammar works for a row of
 * controls and breaks for a grid of eight scenes, because every tile in the
 * grid would then be the same colour and tell you nothing until you read it.
 *
 * THE RULE THIS FOLLOWS, and it is the browser's, in sceneColors' own words:
 * colour is identity and brightness is state. A scene keeps its hue whether or
 * not it is live; a filled tile is the one you are in. The blocks say the same
 * thing one step further — a drive is red on the unit's own screen, so a screen
 * pretending to be that hardware had better agree, and the fill says engaged
 * while the edge keeps saying drive even when it is off.
 *
 * That is the whole reason this is worth a component rather than a style prop.
 * On a dark stage the eye finds the red long before three letters resolve, and
 * an app that only agreed with the unit some of the time would be worse than
 * one that never tried.
 *
 * The colours themselves are not decided here. `blockColors.js` and
 * `sceneColors.js` are generated from the browser's copies by
 * `npm run sync:rules`, so the two screens cannot drift into disagreeing about
 * which tile is the delay.
 */
export default function Tile({
  label,
  sub,
  caption,
  fill,
  ink,
  on = false,
  onPress,
  onLongPress,
  height = TAP,
  haptic = tick,
  style
}) {
  /*
   * Off is the hue at a twelfth, over the chassis, rather than a flat panel.
   * Eight-digit hex is RN's own alpha and needs no colour maths: the tile stays
   * recognisably its own colour while being obviously unlit, which is the
   * distinction the whole grid rests on.
   */
  const background = on ? fill : `${fill}1f`
  const foreground = on ? ink : color.silk

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={[label, sub, caption].filter(Boolean).join(', ')}
      onPress={() => {
        haptic?.()
        onPress?.()
      }}
      onLongPress={
        onLongPress
          ? () => {
              haptic?.()
              onLongPress()
            }
          : undefined
      }
      delayLongPress={450}
      style={({ pressed }) => [
        {
          minHeight: height,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: space.sm,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          /* Two pixels, because the edge is doing real work when the tile is
             off — it is the only thing still naming the block. */
          borderWidth: 2,
          borderColor: on ? fill : `${fill}88`,
          backgroundColor: background,
          opacity: pressed ? 0.7 : 1
        },
        style
      ]}
    >
      <View style={{ alignItems: 'center' }}>
        {caption ? (
          <Text
            numberOfLines={1}
            style={{ color: on ? ink : color.silkDim, fontSize: font.micro, marginBottom: 1 }}
          >
            {caption}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          style={{
            color: foreground,
            fontSize: font.body,
            fontWeight: '700',
            letterSpacing: 0.5,
            textAlign: 'center'
          }}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            numberOfLines={1}
            style={{ color: on ? ink : color.silkDim, fontSize: font.micro, marginTop: 2 }}
          >
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}
