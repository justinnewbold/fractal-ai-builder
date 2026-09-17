import { useEffect, useRef } from 'react'
import { PanResponder, Text, View } from 'react-native'

import { color, font, radius } from '../lib/theme'
import { thud } from '../lib/feedback'

/**
 * The grip: hold it and the card follows the finger up or down the lane.
 *
 * Its own target, beside the card rather than on it, so a tap on the name
 * still opens the actions and a drag never starts by accident. The touch is
 * claimed on landing and never handed back, and the page is told not to
 * scroll for as long as it is held — the same two rules that stopped the
 * knobs scrolling the page. See components/Knob.
 */
export default function Grip({ label, hint = 'Hold and drag up or down to move it', disabled, onStart, onMove, onEnd }) {
  const live = useRef({ onStart, onMove, onEnd, disabled })
  useEffect(() => {
    live.current = { onStart, onMove, onEnd, disabled }
  })
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => !live.current.disabled,
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        thud()
        live.current.onStart?.()
      },
      onPanResponderMove: (_, g) => live.current.onMove?.(g.dy),
      onPanResponderRelease: () => live.current.onEnd?.(),
      onPanResponderTerminate: () => live.current.onEnd?.()
    })
  ).current
  return (
    <View
      {...pan.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={{
        width: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.rule,
        backgroundColor: color.panelHi,
        opacity: disabled ? 0.45 : 1
      }}
    >
      <Text style={{ color: color.silk, fontSize: font.title, lineHeight: font.title + 4 }}>≡</Text>
    </View>
  )
}
