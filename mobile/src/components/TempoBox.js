import { useEffect, useRef, useState } from 'react'
import { Modal, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { BlurView } from 'expo-blur'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { BPM_MAX, BPM_MIN, checkBpm } from '../lib/tempo'
import Note from './Note'
import Press from './Press'

const face = Platform.select(mono)

/**
 * A tempo, typed.
 *
 * "When holding tap button to manually enter tempo the keyboard blocks the
 * numbers so you can see what your typing."
 *
 * IT SITS HIGH ON PURPOSE, and that is the whole of the fix. The box was in the
 * foot of the stage screen, which is where a thumb rests and therefore exactly
 * where iOS puts the keyboard — so the moment it opened it covered the one
 * thing you had opened it to look at. A bottom sheet would have had the same
 * problem for the same reason.
 *
 * So it is an overlay in the upper part of the screen. A number pad takes
 * roughly the bottom two fifths; a third of the way down clears it on every
 * phone this runs on, and `keyboardVerticalOffset` is not a number anybody
 * should have to guess per device.
 *
 * Tap gets you close and this gets you exact — "on the tap button, let's do
 * where they hold the tap button they can manually enter in the beats per
 * minute they want."
 *
 * The range is the unit's own and is said out loud rather than enforced in
 * silence: a box that refuses 500 without explaining is a box that looks
 * broken. checkBpm is shared with the browser, so both refuse the same things
 * in the same words.
 */
export default function TempoBox({ open, bpm, onSet, onClose }) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState(null)
  const { height } = useWindowDimensions()
  const field = useRef(null)

  /* Opened on the tempo it is at, selected, so typing replaces rather than
     appends. Reset each time it opens rather than kept between openings. */
  useEffect(() => {
    if (!open) return
    setTyped(Number.isFinite(bpm) ? String(Math.round(bpm)) : '')
    setError(null)
  }, [open, bpm])

  const commit = async () => {
    const checked = checkBpm(typed)
    if (checked.error) {
      setError(checked.error)
      return
    }
    /* Nothing typed, or the tempo it is already at: close without a write. */
    if (checked.empty || checked.bpm === Math.round(bpm)) {
      onClose()
      return
    }
    try {
      await onSet(checked.bpm)
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal visible={!!open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }}>
        <BlurView
          intensity={70}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={{
            flex: 1,
            alignItems: 'center',
            /* High, so the number pad cannot reach it. */
            paddingTop: Math.max(space.xxl, height * 0.14),
            paddingHorizontal: space.xl
          }}
        >
          <Pressable
            /* Swallows presses, so tapping the panel does not close the thing
               you are typing into. */
            onPress={() => field.current?.focus()}
            style={{
              width: '100%',
              maxWidth: 420,
              gap: space.md,
              padding: space.lg,
              borderRadius: radius.lg * 2,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
              backgroundColor: 'rgba(255,255,255,0.04)'
            }}
          >
            <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.5 }}>TEMPO</Text>

            <TextInput
              ref={field}
              autoFocus
              selectTextOnFocus
              value={typed}
              onChangeText={(t) => {
                setTyped(t.replace(/[^0-9]/g, ''))
                setError(null)
              }}
              keyboardType="number-pad"
              returnKeyType="done"
              accessibilityLabel="Tempo in beats per minute"
              placeholder="BPM"
              placeholderTextColor={color.silkFaint}
              onSubmitEditing={commit}
              style={{
                minHeight: TAP + 24,
                backgroundColor: 'rgba(0,0,0,0.35)',
                borderWidth: 1,
                borderColor: error ? color.fault : color.live,
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                color: color.silk,
                fontSize: font.display,
                fontFamily: face,
                textAlign: 'center'
              }}
            />

            <Text style={{ color: color.silkDim, fontSize: font.small, textAlign: 'center' }}>
              {`${BPM_MIN} to ${BPM_MAX} beats per minute`}
            </Text>

            {error ? <Note tone="fault">{error}</Note> : null}

            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Press grow label="Cancel" onPress={onClose} />
              <Press grow label="Set" tone="signal" on onPress={commit} />
            </View>
          </Pressable>
        </BlurView>
      </Pressable>
    </Modal>
  )
}
