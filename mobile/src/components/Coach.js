import { Text, View } from 'react-native'

import { P5 } from '../lib/onboarding'
import { color, font, radius, space } from '../lib/theme'
import Press from './Press'

/**
 * The channel tip, drawn where the gesture is.
 *
 * "This tip appears here - exactly when the gesture becomes useful."
 *
 * That line is a promise, so this is not a screen in the walkthrough and not
 * a dialog over the app. It is a card in the chain, directly above the tiles
 * it is talking about, shown only on a preset whose blocks really do have
 * channels to choose between. Somebody reading it can look down and try it
 * without dismissing anything first.
 *
 * WHICH IS ALSO WHY IT DOES NOT DIM THE SCREEN. A coach mark that greys out
 * the rig to point at it takes away the one thing the reader needs — the
 * blocks — for as long as it is up. This one costs a few lines of height and
 * hands the screen straight back.
 *
 * Not one word is typed here. Every string comes from the copy file, the
 * same as both walkthroughs: "do not change any wording without asking me
 * first", and copy that lives in a component is copy that gets tidied by
 * accident.
 */
export default function Coach({ open, onTry, onSkip }) {
  if (!open) return null

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        gap: space.sm,
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.rule,
        backgroundColor: color.panel
      }}
    >
      <Text style={{ color: color.signal, fontSize: font.micro, letterSpacing: 1.5 }}>
        {P5.count}
      </Text>
      <Text style={{ color: color.silk, fontSize: font.lead, lineHeight: font.lead * 1.3 }}>
        {P5.head}
      </Text>
      <Text style={{ color: color.silkDim, fontSize: font.body, lineHeight: font.body * 1.45 }}>
        {P5.body}
      </Text>

      {/*
        The gesture named on a swatch the colour of a block that is on, rather
        than a drawing of a particular block. A mock DLY tile here would be a
        picture of a preset nobody has — and the tiles it is pointing at are
        eight points below it, in the real colours, for real blocks.
      */}
      <View
        style={{
          alignSelf: 'flex-start',
          paddingVertical: space.xs,
          paddingHorizontal: space.sm,
          borderRadius: radius.sm,
          backgroundColor: color.signalWash
        }}
      >
        <Text style={{ color: color.signal, fontSize: font.small }}>{P5.hold}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {/*
          The first button closes and does nothing else, because the thing it
          invites is already on the screen underneath. A button that opened a
          channel picker for them would be performing the gesture rather than
          teaching it.
        */}
        <Press grow tone="signal" label={P5.go} onPress={onTry} />
        <Press grow label={P5.skip} onPress={onSkip} />
      </View>

      <Text style={{ color: color.silkFaint, fontSize: font.micro }}>{P5.foot}</Text>
    </View>
  )
}
