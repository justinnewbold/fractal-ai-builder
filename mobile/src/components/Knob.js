import { useEffect, useRef, useState } from 'react'
import { PanResponder, Platform, Text, View } from 'react-native'

import { color, font, mono } from '../lib/theme'
import { fromNormalized, toNormalized } from '../lib/scale'
import { tick } from '../lib/feedback'

const face = Platform.select(mono)

const START = 135 // degrees, 7 o'clock
const SWEEP = 270 // to 5 o'clock
/** How many marks go round the dial. Odd, so one of them sits at twelve. */
const TICKS = 21

/** What VoiceOver's rotor offers on a knob. */
const ROTOR = [{ name: 'increment' }, { name: 'decrement' }]

/**
 * A rotary control.
 *
 * Fractal's editors use knobs because the hardware does, and because a knob
 * shows where a value sits in its range at a glance in a way a number never
 * does.
 *
 * WHY A RING OF MARKS RATHER THAN A SWEPT ARC. The browser draws the sweep as
 * an SVG path. There is no SVG here and adding it would mean a native module in
 * the build — and the build is the one thing in this project that costs Justin
 * something that does not come back, so it is not a dependency to take on for a
 * curve. A ring of marks, lit up to the current value, says the same thing out
 * of plain views: where you are in the range, from arm's length, without
 * reading the number. It is also what the unit's own display does.
 *
 * DRAGGING IS VERTICAL ONLY, and that is not a simplification. Circular
 * tracking sounds right and isn't — the finger leaves the knob, and small
 * movements near the centre produce huge jumps. Every hardware editor uses a
 * vertical drag for the same reason.
 *
 * THE DRAG CLAIMS THE GESTURE ON TOUCH, not on the first movement. A knob lives
 * inside a screen that scrolls vertically, and a drag that waits to see which
 * way the finger is going has already given the gesture to the scroll view on a
 * phone. The browser's copy of this makes exactly the same trade, by calling
 * preventDefault in a non-passive touchstart. The cost is that a finger landing
 * on a knob cannot then scroll the page, which is the right way round: the
 * knobs are what the screen is for.
 *
 * `live` holds the current props for the responder, which is created once. Not
 * a micro-optimisation — a responder rebuilt mid-drag is a drag that stops.
 */
export default function Knob({ param, value, onChange, onCommit, size = 64, label, onScrollLock }) {
  const [dragging, setDragging] = useState(false)

  const norm = clamp01(toNormalized(value, param) ?? 0)

  const live = useRef({ norm, param, onChange, onCommit, onScrollLock })
  useEffect(() => {
    live.current = { norm, param, onChange, onCommit, onScrollLock }
  })

  /* A screen left locked by a drag that never released will not scroll again. */
  useEffect(() => () => onScrollLock?.(false), [onScrollLock])

  /** Where the value was when the finger landed. */
  const origin = useRef(0)

  const pan = useRef(
    PanResponder.create({
      /*
       * THE LOCK GOES ON HERE, IN THE CAPTURE PHASE, and that is the whole
       * difference between a knob that turns and one that scrolls the page.
       *
       * Claiming the responder is not enough. On iOS the scroll view's pan
       * gesture recogniser is NATIVE: it takes the touch back and terminates
       * the drag rather than losing to a JavaScript responder. "The knobs just
       * scroll the screen up and down when trying to change them."
       *
       * Capture runs on touch-down, from the root inward, before anything has
       * been granted and before the scroll view has decided this is a scroll.
       * Doing it in onPanResponderGrant is one hop later and one re-render
       * closer to the first move — which is a race this does not need to be in.
       */
      onStartShouldSetPanResponderCapture: () => {
        live.current.onScrollLock?.(true)
        return true
      },
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        origin.current = live.current.norm
        setDragging(true)
        tick()
      },
      onPanResponderMove: (_, gesture) => {
        const { param: p, onChange: change } = live.current
        /*
         * 260 points of travel covers the whole range. Longer than the
         * browser's mouse throw of 180 on purpose: a thumb is less precise
         * than a pointer, and a gain control that crosses its whole range in
         * an inch is one nobody can land on 4.00 with.
         */
        const next = clamp01(origin.current - gesture.dy / 260)
        change?.(round3(fromNormalized(next, p)))
      },
      onPanResponderRelease: () => {
        setDragging(false)
        live.current.onScrollLock?.(false)
        live.current.onCommit?.()
      },
      onPanResponderTerminate: () => {
        setDragging(false)
        live.current.onScrollLock?.(false)
        live.current.onCommit?.()
      }
    })
  ).current

  const lit = Math.round(norm * (TICKS - 1))
  const angle = START + norm * SWEEP

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        {...pan.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={label || param?.name}
        accessibilityValue={{
          min: param?.min,
          max: param?.max,
          now: value,
          text: `${fmt(value)}${param?.unit ? ` ${param.unit}` : ''}`
        }}
        /*
         * The whole range in a hundred steps, for anyone driving this with
         * VoiceOver's rotor rather than a thumb. Each one commits on its own,
         * because a rotor turn has no "let go" to commit on.
         */
        accessibilityActions={ROTOR}
        onAccessibilityAction={(e) => {
          const by = e.nativeEvent.actionName === 'increment' ? 0.01 : -0.01
          const { param: p, onChange: change, onCommit: commit } = live.current
          change?.(round3(fromNormalized(clamp01(live.current.norm + by), p)))
          commit?.()
        }}
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      >
        {/* The ring. Each mark is a view rotated about the centre of the dial,
            with the mark itself sitting at the top of it. */}
        {Array.from({ length: TICKS }, (_, i) => {
          const on = i <= lit
          return (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: size,
                height: size,
                alignItems: 'center',
                transform: [{ rotate: `${START + (i / (TICKS - 1)) * SWEEP - 180}deg` }]
              }}
            >
              <View
                style={{
                  width: 2,
                  height: on ? 7 : 5,
                  borderRadius: 1,
                  backgroundColor: on ? color.signal : color.rule
                }}
              />
            </View>
          )
        })}

        {/* The body, and the pointer on it. */}
        <View
          pointerEvents="none"
          style={{
            width: size - 20,
            height: size - 20,
            borderRadius: (size - 20) / 2,
            backgroundColor: dragging ? color.panelHi : color.panel,
            borderWidth: 1,
            borderColor: dragging ? color.signal : color.rule,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size,
            height: size,
            alignItems: 'center',
            transform: [{ rotate: `${angle - 180}deg` }]
          }}
        >
          <View
            style={{
              marginTop: 14,
              width: 2,
              height: size / 2 - 20,
              borderRadius: 1,
              backgroundColor: color.silk
            }}
          />
        </View>

        {/*
          A finger covers the knob and the number under it at the same time, so
          while it is being turned the value floats above where it can be seen.
          The browser's copy does this for the same reason and it is the one
          thing about a knob on a phone that is not optional.
        */}
        {dragging ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: size + 4,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 6,
              backgroundColor: color.signal
            }}
          >
            <Text style={{ color: color.onSignal, fontSize: font.small, fontFamily: face }}>
              {fmt(value)}
              {param?.unit ? ` ${param.unit}` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      {label ? (
        <Text
          numberOfLines={1}
          style={{ color: color.silkDim, fontSize: font.micro, marginTop: 4, maxWidth: size + 24 }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  )
}

/** How a value is written down, here and in the box under the knob. */
export function fmt(n) {
  if (typeof n !== 'number') return '—'
  if (Math.abs(n) >= 1000) return String(Math.round(n))
  return n.toFixed(2)
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
