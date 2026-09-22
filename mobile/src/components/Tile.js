import { Image, Platform, Pressable, Text, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { at, vivid } from '../lib/vivid'
import { tick } from '../lib/feedback'
import { fire, said } from '../lib/tapped'

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
  /*
   * The picture above the letters, cut from Justin's mockup of this screen.
   * White in the file and tinted here, so one copy serves every hue — see
   * lib/blockIcons. Optional by design: a family he did not draw shows the
   * letters alone, exactly as the grid looked before any of this.
   */
  icon,
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
   * THE HUE IS THE PALETTE'S; THE VIBRANCY IS THIS SCREEN'S.
   *
   * `vivid` lifts saturation and leaves hue exactly where it was, so a drive
   * is still the red the unit shows and a delay is still the same blue — see
   * lib/vivid for why that distinction is worth a function. It is applied here
   * rather than in the palettes because those are shared with the browser, and
   * repainting the computer app was not what was asked for.
   *
   * Off is the same hue at a seventh, over the chassis, rather than a flat
   * panel: the tile stays recognisably its own colour while being obviously
   * unlit, which is the distinction the whole grid rests on.
   */
  const hue = vivid(fill)
  const background = on ? hue : at(hue, 0.14)
  const foreground = on ? ink : color.silk
  /*
   * The glow, and it is iOS only by nature rather than by choice: Android has
   * no coloured shadow, only `elevation`, which is grey. Rather than fake a
   * halo with an extra View behind every tile in a grid that can hold twenty
   * of them, Android gets the lift and iOS gets the light. Both read as raised;
   * only one of them glows.
   */
  /*
   * How big the picture can be, and whether there is room for one at all.
   *
   * Fit-to-screen squeezes these tiles down to 44pt on a small phone with a
   * long chain, and at that height the icon and the three letters are fighting
   * over the same space — the letters win, because they are the part you read.
   * Above that it takes a quarter of the tile, which is where the mockup has
   * it, and stops growing at 28 so a short chain's roomy tiles don't turn into
   * a row of billboards.
   */
  const picture = icon && height >= 66 ? Math.min(28, Math.round(height * 0.26)) : 0

  const glow = on
    ? Platform.select({
        ios: {
          shadowColor: hue,
          shadowOpacity: 0.55,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 }
        },
        default: { elevation: 3 }
      })
    : null

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={[label, sub, caption].filter(Boolean).join(', ')}
      onPress={() => {
        haptic?.()
        fire(`press ${said(label, sub)}`, onPress)
      }}
      onLongPress={
        onLongPress
          ? () => {
              haptic?.()
              fire(`hold ${said(label, sub)}`, onLongPress)
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
          borderColor: on ? at(hue, 0.85) : at(hue, 0.55),
          backgroundColor: background,
          opacity: pressed ? 0.7 : 1,
          ...glow
        },
        style
      ]}
    >
      {/*
        A sheen across the top, which is a gradient's job done without one.
        A real one needs expo-linear-gradient — native code, so it would move
        the fingerprint and cost a build to add a highlight. A single
        translucent white panel over the top half reads as the same thing at
        arm's length on a dark stage.

        pointerEvents none, and absolute so it takes no part in layout: this
        tile's height is what the fit-to-screen arithmetic is budgeting, and a
        decoration must not move it.
      */}
      {on ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: '50%',
            borderTopLeftRadius: radius.md - 2,
            borderTopRightRadius: radius.md - 2,
            backgroundColor: 'rgba(255,255,255,0.10)'
          }}
        />
      ) : null}
      <View style={{ alignItems: 'center' }}>
        {picture ? (
          <Image
            source={icon}
            /* Silent: the Pressable above already says the block's name and
               state, and a second announcement for the picture of it would
               make every tile read itself out twice. */
            accessible={false}
            style={{ width: picture, height: picture, marginBottom: 3, tintColor: foreground }}
            resizeMode="contain"
          />
        ) : null}
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
