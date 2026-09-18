import { useEffect, useRef, useState } from 'react'
import { Modal, PanResponder, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { BlurView } from 'expo-blur'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import Note from './Note'
import { blockParams, idOf, setParam, setParamConfirmed } from '../lib/device'
import {
  latestWriter,
  NUDGE_SETTLE_MS,
  nudged,
  outputLevelParam,
  volumeLabel,
  volumeNudge,
  volumePercent
} from '../lib/volume'
import { tick } from '../lib/feedback'
import { logDebug } from '../lib/debugLog'
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
/*
 * IT IS A POP-UP, and that is not decoration — it is the fix.
 *
 * "Volume slider also tries to scroll the screen when sliding the volume. Just
 * an overlay that pops up on the screen separately would be cool… whatever we
 * gotta do to fix that so that when you tap the volume button, the volume
 * slider pops up and is able to be slid without scrolling or moving anything
 * else."
 *
 * A slider drags across a screen that scrolls, and on iOS the scroll view's pan
 * gesture recogniser is NATIVE: it takes the touch back and terminates the drag
 * rather than losing to a JavaScript responder. There are fixes that fight
 * that — the bench's knobs use one — but for a control that is wanted twice a
 * night the better answer is to take the fight away entirely. In a modal there
 * is no scroll view behind it and nothing to argue with.
 *
 * The browser reached the same place from the other direction: "put a sound
 * button that looks like a speaker in the header, and when it's tapped you can
 * slide the volume left or right… but it's not there on the main screen."
 */
/**
 * Why there is nothing to write to, told apart rather than guessed at.
 *
 * This said "the chain is still loading" for both, and it was the wrong half
 * of the time: the chain HAD been read, and the Output block in it came back
 * with no id to address. Blaming a read that already happened sends somebody
 * to wait for something that has finished, which is the worst kind of wrong
 * message — it looks like patience is the answer.
 *
 * With the bar's speaker now asking the same question this does, neither
 * should be reachable at all. They are kept because they are what says so if
 * the two ever disagree again.
 */
const noOutput = (present, onError) => {
  const why = present
    ? 'the unit reported an Output block with no id to write to'
    : 'the chain has not been read'
  logDebug('set', 'volume: no Output block known yet', why)
  onError?.(
    present
      ? 'This preset’s Output block came back without a level this app can move.'
      : 'No output level to move yet — the chain is still loading.'
  )
}

export default function Volume({ blocks, open, onClose, onError }) {
  const output = (blocks || []).find((b) => b.slug === 'output')
  const eid = idOf(output)

  const [param, setParamState] = useState(null)
  const [value, setValue] = useState(null)
  const [dragging, setDragging] = useState(false)
  /* Measured, because the thumb's position has to be a fraction of the real
     track rather than of a number typed here. */
  const [width, setWidth] = useState(0)
  /* And the window, for how wide the panel itself should be. */
  const { width: width0 } = useWindowDimensions()

  const live = useRef({ param: null, value: null, width: 0, eid: null })
  useEffect(() => {
    live.current = { param, value, width, eid }
  })

  /*
   * One write on the wire at a time; see the note above.
   *
   * THE WRITER READS THE BLOCK OFF THE REF, NOT THE RENDER. It is made once,
   * on the first render, and the first render is before the chain has been
   * read, so the Output block it closed over was nothing at all -- and stayed
   * nothing for the life of the screen. Every press of − and + after that
   * went out as a write to block "undefined": twenty-seven of them in one
   * log, each refused with a sentence about doing it at the computer, while
   * the guard on the button saw the block it had by then and let them
   * through. The ref is what the guard looks at, so the writer looks there
   * too.
   */
  const writer = useRef(null)
  if (!writer.current) {
    writer.current = latestWriter((v) => {
      const { param: p, eid: block } = live.current
      if (!Number.isInteger(block)) return Promise.reject(new Error('The chain has not been read yet, so there is no output level to write.'))
      return setParam(block, p.id, v, p)
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
    if (!Number.isInteger(eid)) {
      noOutput(!!output, onError)
      return
    }
    try {
      const failed = await writer.current.settled()
      if (failed) onError?.(failed.message)
      const res = await setParamConfirmed(eid, p.id, v, p)
      /* A newer value arrived while this one was being checked: its own
         check follows, and a miss against a value nobody wants any more is
         not a miss. */
      if (live.current.value !== v) return
      if (!res.ok) {
        /* Say what the unit is holding, and show it: a slider left pointing
           at a number the unit refused is a slider lying about the volume. */
        const holding = typeof res.actual === 'number' ? res.actual : null
        if (holding !== null) setValue(holding)
        onError?.(
          holding === null
            ? `The volume didn’t take. You asked for ${volumeLabel(v, p)}.`
            : `The volume didn’t take. You asked for ${volumeLabel(v, p)}; the unit says ${volumeLabel(holding, p)}.`
        )
      }
    } catch (err) {
      onError?.(err.message)
    }
  }

  /*
   * A press goes to the unit now, through the same coalescing writer as a
   * drag; the careful read-back waits until the presses stop, and runs one
   * at a time. See NUDGE_SETTLE_MS for the evening that taught this.
   */
  const settle = useRef({ timer: null, landing: false, again: false })
  useEffect(() => () => clearTimeout(settle.current.timer), [])
  const settleNow = async () => {
    if (settle.current.landing) {
      settle.current.again = true
      return
    }
    settle.current.landing = true
    try {
      await land()
    } finally {
      settle.current.landing = false
      if (settle.current.again) {
        settle.current.again = false
        settleNow()
      }
    }
  }
  const nudge = (direction) => {
    const p = live.current.param
    if (!p) return
    if (!Number.isInteger(eid)) {
      noOutput(!!output, onError)
      return
    }
    const next = nudged(live.current.value, p, volumeNudge(p) * direction)
    setValue(next)
    live.current = { ...live.current, value: next }
    writer.current.send(next)
    clearTimeout(settle.current.timer)
    settle.current.timer = setTimeout(settleNow, NUDGE_SETTLE_MS)
  }

  const pct = volumePercent(value, param)
  const panel = Math.min(width0 - space.xl * 2, 460)

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close the volume" onPress={onClose} style={{ flex: 1 }}>
        <BlurView
          intensity={70}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}
        >
          {/*
            The panel swallows presses so a thumb that slips off the slider does
            not close the thing it is holding. Only the glass around it closes.
          */}
          <Pressable
            onPress={() => {}}
            style={{
              width: panel,
              gap: space.lg,
              paddingVertical: space.xl,
              paddingHorizontal: space.lg,
              borderRadius: radius.lg * 2,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
              backgroundColor: 'rgba(255,255,255,0.04)'
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.5 }}>VOLUME</Text>
              <Text style={{ color: color.silk, fontSize: font.hero, fontFamily: face }}>
                {param ? volumeLabel(value, param) : '—'}
              </Text>
            </View>

            {/* No slider at all on a unit whose output block has no level this
                app can move — a control that can only disappoint is worse than
                none. The panel still opens and says so. */}
            {!Number.isInteger(eid) || !param ? (
              <Note tone="warn">
                This unit’s output block has no level this app can move. Use the knob on the unit.
              </Note>
            ) : (
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
            )}

            <Press label="Done" height={TAP} tone="signal" onPress={onClose} />
            <Text style={{ color: color.silkFaint, fontSize: font.micro, textAlign: 'center' }}>
              Tap outside to close
            </Text>
          </Pressable>
        </BlurView>
      </Pressable>
    </Modal>
  )
}

/** What VoiceOver's rotor offers on the slider. */
const ROTOR = [{ name: 'increment' }, { name: 'decrement' }]

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
