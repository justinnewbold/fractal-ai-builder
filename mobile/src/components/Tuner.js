import { useEffect, useRef, useState } from 'react'
import { Platform, Text, View } from 'react-native'

import { color, font, mono, radius, space } from '../lib/theme'
import Note from './Note'

const face = Platform.select(mono)

/**
 * The needle, and the sentence for when there is no needle to show.
 *
 * The second half matters more than the first here. `POST /tuner` is allowed
 * over the relay, so a phone can start the unit's tuner and then never see a
 * reading: ForgeFX's relay bridges discrete change events and deliberately
 * filters the roughly eight-per-second telemetry streams to keep the channel
 * quiet, and the tuner is one of them. The poll is running at the Mac and every
 * answer stays there.
 *
 * So after five silent seconds this says exactly that, rather than showing a
 * needle that will never move while someone stands there playing an open E into
 * it. Tracked by time rather than a flag, so a newer host that does bridge the
 * stream lights this up with no change here.
 */
export default function Tuner({ reading, on }) {
  const [stalled, setStalled] = useState(false)
  const lastAt = useRef(0)

  useEffect(() => {
    if (!reading) return
    lastAt.current = Date.now()
    setStalled(false)
  }, [reading])

  useEffect(() => {
    if (!on) {
      setStalled(false)
      return undefined
    }
    const since = Date.now()
    const timer = setTimeout(() => {
      if (lastAt.current < since) setStalled(true)
    }, 5000)
    return () => clearTimeout(timer)
  }, [on])

  if (!on) return null

  const cents = reading?.cents ?? 0
  const inTune = Math.abs(cents) <= 3
  // Clamped to the width of the bar. A string a whole tone flat is off the
  // scale, and pinning the needle at the end is the honest picture of that.
  const offset = Math.max(-50, Math.min(50, cents))
  const ink = inTune ? color.ok : color.signal

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }}>
        <Text
          accessibilityLabel={reading?.note ? `${reading.note}${reading.octave ?? ''}` : 'no note'}
          style={{
            color: reading?.note ? ink : color.silkFaint,
            fontSize: font.display + 24,
            fontWeight: '700'
          }}
        >
          {reading?.note || '—'}
        </Text>
        {reading?.octave !== undefined && reading?.note ? (
          <Text style={{ color: color.silkDim, fontSize: font.title, fontFamily: face }}>
            {reading.octave}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          height: 12,
          borderRadius: radius.pill,
          backgroundColor: color.panel,
          borderWidth: 1,
          borderColor: color.rule,
          justifyContent: 'center'
        }}
      >
        {/* Centre first, so the needle draws over it. */}
        <View
          style={{
            position: 'absolute',
            left: '50%',
            width: 2,
            marginLeft: -1,
            top: 0,
            bottom: 0,
            backgroundColor: color.silkFaint
          }}
        />
        {/* Nothing to show is the centre, not wherever the last string left it. */}
        <View
          style={{
            position: 'absolute',
            left: `${50 + (reading?.note ? offset : 0)}%`,
            marginLeft: -6,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: ink
          }}
        />
      </View>

      <Text
        style={{
          color: color.silkDim,
          fontSize: font.body,
          fontFamily: face,
          textAlign: 'center'
        }}
      >
        {reading?.note ? `${cents > 0 ? '+' : ''}${cents} cents` : 'Play a string'}
      </Text>

      {stalled ? (
        <Note tone="warn">
          The tuner is running on the unit, but the readings aren’t reaching this phone — your Mac
          keeps them to itself over a remote link. Use the unit’s own display, or tune at the Mac.
        </Note>
      ) : null}
    </View>
  )
}
