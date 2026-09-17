import { useEffect, useRef, useState } from 'react'
import { PanResponder, Platform, Text, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { blockParams, idOf, setParam, setParamConfirmed } from '../lib/device'
import {
  latestWriter,
  nudged,
  outputLevelParam,
  volumeLabel,
  volumeNudge,
  volumePercent
} from '../lib/volume'
import { tick } from '../lib/feedback'
import Press from './Press'

const face = Platform.select(mono)

/**
 * The volume, on the stage screen.
 *
 * "Add volume slider to the play screen to quickly turn volume up or down."
 *
 * It moves the Output block's Level — the one control that is the whole
 * preset's volume, and the thing a soundperson means by "give me a bit less".
 * The edit screen shows it and will not turn it, deliberately: a level dragged
 * to the bottom by accident makes a preset that looks right and is silent. That
 * rule is about a knob among thirty others under a thumb. This is the opposite
 * — one control, the width of the screen, that is FOR moving the volume, with
 * the number on it the whole time.
 *
 * WHY THE DRAG DOES NOT SEND EVERY VALUE. A slider reports one per frame, and
 * the unit takes one request at a time down a serial port with a relay to a Mac
 * in front of it. Sent as they come, a two-second drag queues a hundred writes
 * that the unit works through for the next ten seconds — landing on the value
 * you let go of long after you let go, and holding up the scene you pressed
 * next. `latestWriter` is shared with the Mac and does the coalescing: one
 * write out, the newest value replacing whatever was queued behind it.
 *
 * AND THE LAST ONE IS CONFIRMED. Everything mid-drag goes out unconfirmed,
 * because a read-back per frame is the same jam by another name. The value the
 * thumb comes off on is written again the careful way, because that is the one
 * that has to be true.
 *
 * MINUS AND PLUS EITHER SIDE. "Do a plus minus on the sides of the volume
 * slider that does 1 dB at a time." A dB is the unit a soundperson talks in and
 * a whole one is the smallest change worth a press: the slider is for the
 * sweep, the buttons for landing on a number.
 */
export default function Volume({ blocks, onError }) {
  const output = (blocks || []).find((b) => b.slug === 'output')
  const eid = idOf(output)

  const [param, setParamState] = useState(null)
  const [value, setValue] = useState(null)
  const [dragging, setDragging] = useState(false)
  /* Measured, because the thumb's position has to be a fraction of the real
     track rather than of a number typed here. */
  const [width, setWidth] = useState(0)

  const live = useRef({ param: null, value: null, width: 0 })
  useEffect(() => {
    live.current = { param, value, width }
  })

  /* One write on the wire at a time; see the note above. */
  const writer = useRef(null)
  if (!writer.current) {
    writer.current = latestWriter((v) => {
      const { param: p } = live.current
      return setParam(eid, p.id, v, p)
    })
  }

  useEffect(() => {
    if (!Number.isInteger(eid)) return undefined
    let stop = false
    ;(async () => {
      try {
        const res = await blockParams(eid)
        if (stop) return
        const found = outputLevelParam(res?.named)
        setParamState(found)
        setValue(found ? found.value : null)
      } catch (err) {
        if (!stop) onError?.(err.message)
      }
    })()
    return () => {
      stop = true
    }
  }, [eid, onError])

  /** Where the thumb was when the finger landed, as a value. */
  const from = useRef(0)

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        from.current = live.current.value
        setDragging(true)
        tick()
      },
      onPanResponderMove: (_, gesture) => {
        const { param: p, width: w } = live.current
        if (!p || !w) return
        const span = p.max - p.min
        const next = clamp(from.current + (gesture.dx / w) * span, p.min, p.max)
        const rounded = Math.round(next * 100) / 100
        setValue(rounded)
        writer.current.send(rounded)
      },
      onPanResponderRelease: () => {
        setDragging(false)
        land()
      },
      onPanResponderTerminate: () => {
        setDragging(false)
        land()
      }
    })
  ).current

  /**
   * The end of a drag: let the queue empty, then write the value under the
   * thumb once more, the careful way.
   *
   * The unit accepts a write it then ignores and says nothing about it, so the
   * one value that matters — the one you stopped on — is the one worth paying a
   * read-back for.
   */
  const land = async () => {
    const { param: p, value: v } = live.current
    if (!p || typeof v !== 'number') return
    try {
      const failed = await writer.current.settled()
      if (failed) onError?.(failed.message)
      const res = await setParamConfirmed(eid, p.id, v, p)
      if (!res.ok) onError?.('The volume didn’t take.')
    } catch (err) {
      onError?.(err.message)
    }
  }

  const nudge = async (direction) => {
    const p = live.current.param
    if (!p) return
    const next = nudged(live.current.value, p, volumeNudge(p) * direction)
    setValue(next)
    live.current = { ...live.current, value: next }
    await land()
  }

  /* No slider at all on a unit whose output block has no level this app can
     move — a control that can only disappoint is worse than none. */
  if (!Number.isInteger(eid) || !param) return null

  const pct = volumePercent(value, param)

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.5 }}>VOLUME</Text>
        <Text style={{ color: color.silk, fontSize: font.body, fontFamily: face }}>
          {volumeLabel(value, param)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Press
          label="−"
          height={TAP}
          style={{ width: 56 }}
          accessibilityLabel="Volume down"
          onPress={() => nudge(-1)}
        />

        <View
          {...pan.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="Volume"
          accessibilityValue={{ min: param.min, max: param.max, now: value, text: volumeLabel(value, param) }}
          accessibilityActions={ROTOR}
          onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={{
            flex: 1,
            height: TAP,
            justifyContent: 'center',
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: dragging ? color.signal : color.rule,
            backgroundColor: color.panel,
            overflow: 'hidden'
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              backgroundColor: color.signalWash
            }}
          />
          {/* The thumb, drawn as a bar so it reads at arm's length. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${pct}%`,
              top: 6,
              bottom: 6,
              width: 4,
              marginLeft: -2,
              borderRadius: 2,
              backgroundColor: color.signal
            }}
          />
        </View>

        <Press
          label="+"
          height={TAP}
          style={{ width: 56 }}
          accessibilityLabel="Volume up"
          onPress={() => nudge(1)}
        />
      </View>
    </View>
  )
}

/** What VoiceOver's rotor offers on the slider. */
const ROTOR = [{ name: 'increment' }, { name: 'decrement' }]

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
