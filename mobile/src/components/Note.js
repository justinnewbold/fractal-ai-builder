import { Pressable, Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'

/**
 * Something the app has to say, in the register it deserves.
 *
 * 'fault' is the unit or the link refusing; 'warn' is a thing that is true and
 * costs you something; 'hint' is everything else. Bordered rather than filled,
 * because a solid block of colour at the top of a stage screen reads as an
 * alarm whatever it says.
 *
 * WITH AN ✕ WHEN IT CAN BE PUT AWAY. "See the error banner at top of screen. It
 * also has no way to dismiss it." A fault stays on screen until something else
 * happens to replace it, which on a working rig can be the whole rest of the
 * song — a red bar sitting above the preset you are playing, about a read that
 * has since succeeded. Anything whose caller can clear it gets a cross; the
 * notes that describe a live condition (two Macs listening, a chain nobody has
 * read) do not, because there is nothing to put away.
 */
/*
 * `size` is here for one note in the app: the one that says a save is about
 * to overwrite a preset. "Make the text larger." Everything else on the
 * screen can be skimmed; that one has to be read, and it is the last thing
 * between somebody and losing a preset they built.
 */
/*
 * `strong` is for the line that says the download link went out: "have the
 * text bold and a little bit bigger than what it is now". Bold, and in the
 * bright ink rather than the hint's grey, because it is the answer to the
 * button just pressed.
 */
export default function Note({ tone = 'hint', onDismiss, size, strong, children }) {
  const accent = tone === 'fault' ? color.fault : tone === 'warn' ? color.signal : color.rule
  return (
    <View
      accessibilityLiveRegion={tone === 'hint' ? 'none' : 'polite'}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.sm,
        borderLeftWidth: 3,
        borderLeftColor: accent,
        backgroundColor: color.panel,
        borderRadius: radius.sm,
        paddingVertical: space.md,
        paddingHorizontal: space.md
      }}
    >
      <Text
        style={{
          flex: 1,
          color: tone === 'hint' && !strong ? color.silkDim : color.silk,
          fontSize: size || font.small,
          fontWeight: strong ? '700' : undefined,
          /* The default stays the exact 20 every other note has had, rather
             than a ratio that would nudge all of them. */
          lineHeight: size ? Math.round(size * 1.45) : 20
        }}
      >
        {children}
      </Text>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onDismiss}
          /* Bigger than it looks. The ✕ is drawn small so it does not compete
             with the message, and hit slop is what makes it a thumb target
             anyway — the alternative is a cross you stab at three times. */
          hitSlop={12}
          style={{ paddingHorizontal: space.xs, paddingVertical: 2 }}
        >
          <Text style={{ color: color.silkFaint, fontSize: font.body }}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
