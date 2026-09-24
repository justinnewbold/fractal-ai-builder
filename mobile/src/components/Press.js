import { Image, Pressable, Text, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { tick } from '../lib/feedback'
import { fire, said } from '../lib/tapped'

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
  caption,
  /*
   * A picture beside the words, cut from Justin's mockup of the play screen.
   * White in the file and tinted to whatever the label is, so one copy works
   * on a lit button and an unlit one. Optional: a button he drew without an
   * icon still gets none.
   */
  icon,
  /*
   * A second picture, on the right. The preset button wears both — the list
   * on the left saying what it opens, the chevron on the right saying it
   * opens somewhere — and Next wears this one alone, because there the
   * chevron IS the direction rather than a decoration on it.
   */
  after,
  /*
   * Mirror the left picture. Previous and Next are the same chevron pointing
   * opposite ways, and one file flipped is better than two files that could
   * drift apart.
   */
  flip = false,
  onPress,
  onLongPress,
  tone = 'plain',
  on = false,
  disabled = false,
  grow = false,
  height = TAP,
  /* The label's size, for the one button whose label is the headline: the
     preset name on the stage screen. Everything else keeps the body size. */
  labelSize = font.body,
  haptic = tick,
  style,
  /*
   * What a screen reader says instead of the visible words.
   *
   * Almost every button here reads fine off its own label. A stepper does
   * not: "−" and "+" are shapes, and a person who cannot see which control
   * they sit either side of is told nothing at all. Passing this was silently
   * ignored before, which is worse than not offering it.
   */
  accessibilityLabel
}) {
  const accent = tone === 'signal' ? color.signal : tone === 'live' ? color.live : color.silk
  const background = on ? accent : color.panel
  const ink = on ? color.onSignal : disabled ? color.silkFaint : color.silk

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      accessibilityLabel={accessibilityLabel || [caption, label, sub].filter(Boolean).join(', ')}
      disabled={disabled}
      onPress={() => {
        haptic?.()
        fire(`press ${said(caption, label)}`, onPress)
      }}
      /* A hold is a different thing from a press, and RN keeps them apart: a
         press that becomes a hold never fires onPress. Only wired when asked
         for, so a button with nothing to hold ignores a slow finger. */
      onLongPress={
        onLongPress
          ? () => {
              haptic?.()
              fire(`hold ${said(caption, label)}`, onLongPress)
            }
          : undefined
      }
      delayLongPress={450}
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {icon ? <Picture source={icon} tint={ink} flip={flip} /> : null}
        <View style={{ alignItems: 'center' }}>
          {/*
            A word ABOVE the label, for the one button whose name does not say
            what it is. "All" between Previous and Next reads as a caption; the
            word Source over it says that pressing it changes what those two do.
          */}
          {caption ? (
            <Text
              numberOfLines={1}
              style={{
                color: on ? color.onSignal : color.silkFaint,
                fontSize: font.micro,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                marginBottom: 1
              }}
            >
              {caption}
            </Text>
          ) : null}
          <Text
            numberOfLines={1}
            style={{
              color: ink,
              fontSize: labelSize,
              fontWeight: labelSize > font.body ? '700' : '600',
              textAlign: 'center'
            }}
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
        {after ? <Picture source={after} tint={ink} /> : null}
      </View>
    </Pressable>
  )
}

/**
 * The picture on a button.
 *
 * Silent to a screen reader on purpose — the Pressable above already carries
 * the words, and a chevron that announced itself would make Next read out
 * twice. Sized once here so every button in the row agrees.
 */
function Picture({ source, tint, flip = false }) {
  return (
    <Image
      source={source}
      accessible={false}
      resizeMode="contain"
      style={{ width: 20, height: 20, tintColor: tint, transform: flip ? [{ scaleX: -1 }] : undefined }}
    />
  )
}
