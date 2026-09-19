import { Text, View } from 'react-native'

import { demoSentence, UNITS } from '../lib/demoUnits'
import { setDemoUnit, useDemoUnit } from '../lib/demo'
import { color, font, space } from '../lib/theme'
import Note from './Note'
import Press from './Press'
import Sheet from './Sheet'

/**
 * Which Fractal the demo is, one tap from the name in the corner.
 *
 * "If you tap the top left button where it shows the current device in the demo
 * mode, that it'll bring up that same list where you can change which one
 * you're on." The browser got exactly that. The phone got a button that opened
 * Setup — the whole screen, from the top — and the five units were two doors
 * further in, inside a page named after pairing a phone.
 *
 * "Now it's buried under another menu." It was, and it had got one row deeper
 * that afternoon when Amp & pedal names moved to the top of Setup. The row
 * order is what was asked for; the burial is this, and this is the fix: the
 * list comes to the name rather than the name leading a walk to the list.
 *
 * A sheet rather than a screen, like every other choice in this app: it covers
 * the stage instead of replacing it, so picking a unit and carrying on is one
 * tap and one tap back.
 *
 * IT STAYS IN SETUP AS WELL. Somebody who has never thought to press the name
 * still finds it where the rest of the demo's controls are — the sentence
 * saying what the demo is, and the way out of it — and both places drive the
 * same store, so neither can show a different answer from the other.
 */
export default function DemoUnit({ open, onClose }) {
  /* useDemoUnit, not demoUnit(): a plain read cannot say when the answer
     changes, which is the whole reason the five buttons used to stay lit on
     whichever unit the app started as. */
  const unit = useDemoUnit()

  return (
    <Sheet open={open} onClose={onClose} title="Which unit the demo is" note="Five to choose from">
      <Note tone="warn">{demoSentence(unit)}</Note>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md }}>
        {UNITS.map((u) => (
          <Press
            key={u.key}
            label={u.name}
            tone="signal"
            on={u.key === unit}
            height={56}
            style={{ paddingHorizontal: space.md }}
            /* Closed on the way out, because the change is the errand. Staying
               open to admire the lit button is a second tap for nothing, and
               the screen behind it has just become a different rig — which is
               the thing worth looking at. */
            onPress={() => {
              setDemoUnit(u.key)
              onClose()
            }}
          />
        ))}
      </View>

      {/* What picking one actually changes, because it is not cosmetic: each
          carries the presets and the scenes that unit ships with, and an AM4
          has no eight scenes to show. */}
      <Text
        style={{
          color: color.silkDim,
          fontSize: font.small,
          marginTop: space.md,
          lineHeight: font.small * 1.5
        }}
      >
        {UNITS.map((u) => `${u.name} — ${u.scenes} scenes, ${u.slots} presets`).join('\n')}
      </Text>
    </Sheet>
  )
}
