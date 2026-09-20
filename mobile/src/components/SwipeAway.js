import { useRef, useState } from 'react'
import { Animated, PanResponder, Pressable, Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'
import { nope, tick } from '../lib/feedback'

/**
 * Swipe a row left to remove it.
 *
 * "Make the setlist songs swipe to delete instead of the x. Make a full swipe
 * delete it and a partial swipe show the x that can be tapped. Otherwise hide
 * the X."
 *
 * Two gestures out of one movement, which is the arrangement every phone has
 * taught people already: a short pull parks the row open and hands you a
 * button to think about, a long pull means you were never in any doubt. The ✕
 * stops being a permanent fixture on a row you are mostly just reading.
 *
 * WHY A FULL SWIPE IS SAFE HERE. It is a running order, not a preset: removing
 * a song takes it out of tonight's list and leaves the preset on the unit
 * untouched, so the worst case is adding it again. That is the test a gesture
 * with no confirmation has to pass, and this one does — the same gesture over
 * a slot on the unit would not.
 *
 * PanResponder and Animated, both inside React Native. The usual answer is
 * react-native-gesture-handler's Swipeable, and installing it would move the
 * native fingerprint — which stops every installed handset receiving updates
 * until a new build is made. See EdgeBack for the same reasoning.
 *
 * WHAT IT REFUSES TO CLAIM:
 *
 *   - Leftward only, and only when the movement is clearly sideways rather
 *     than a scroll that drifted.
 *   - Never on touch-down, so the row's own buttons still work.
 *   - Not the capture handler, so the drag grip beside it keeps its gesture:
 *     a song is reordered by holding that, and losing a reorder to a row
 *     sliding open would be the gesture doing harm.
 *
 * Rows are independent: opening one does not close another. iOS closes the
 * others, and doing that here would mean a shared owner for something that is
 * otherwise a self-contained row. A second open row is untidy rather than
 * wrong, and both still close on a tap.
 */

/** How far the row parks when it is opened, and how wide the button is. */
export const OPEN = 84
/** Past this, the swipe was not a question. */
const FULL = 180
/** Sideways by this much before the row claims the gesture at all. */
const CLAIM = 12

export default function SwipeAway({ children, onRemove, label }) {
  const x = useRef(new Animated.Value(0)).current
  const [width, setWidth] = useState(0)
  /* Where the row sits between gestures: 0 or -OPEN. Read inside the
     responder, which is built once and cannot see re-rendered state. */
  const rest = useRef(0)
  const live = useRef(onRemove)
  live.current = onRemove

  const settle = (to) => {
    rest.current = to
    Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 20 }).start()
  }

  const away = () => {
    /* Out to the left, then gone. The row keeps moving while the list closes
       the gap, which is what makes a delete feel like a delete rather than a
       disappearance. */
    Animated.timing(x, {
      toValue: -(width || 400),
      duration: 160,
      useNativeDriver: true
    }).start(() => live.current?.())
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > CLAIM && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_e, g) => {
        /* Never past the right edge: there is nothing revealed on that side,
           and a row that slides right is a row promising something. */
        const next = Math.min(0, rest.current + g.dx)
        x.setValue(next)
      },
      onPanResponderRelease: (_e, g) => {
        const total = rest.current + g.dx
        if (total <= -FULL) {
          nope()
          away()
          return
        }
        if (total <= -OPEN / 2) {
          tick()
          settle(-OPEN)
          return
        }
        settle(0)
      },
      /* A gesture taken away mid-swipe (a phone call, the list re-rendering)
         leaves the row wherever it was. Put it back. */
      onPanResponderTerminate: () => settle(rest.current)
    })
  ).current

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ justifyContent: 'center' }}>
      {/*
        The button behind, which is what the row slides off to reveal.

        Always in the tree rather than drawn only once the row has moved: a
        screen reader cannot swipe, and this is the only way to remove a song
        without the gesture. It is hidden by the row itself, not by being
        absent.
      */}
      <View
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: OPEN,
          borderRadius: radius.md,
          backgroundColor: color.fault,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={8}
          onPress={() => {
            nope()
            away()
          }}
          style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
        >
          <Text style={{ color: color.onFault, fontSize: font.lead, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>

      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  )
}
