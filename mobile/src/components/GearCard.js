import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  BackHandler,
  Easing,
  Image,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions
} from 'react-native'

import { color, font, radius, space } from '../lib/theme'
import { photoFor } from '../lib/gearPhotos'
import { descriptionFor, paragraphsOf, specsFor } from '../lib/lineage'
import { HOSTED_ORIGIN } from '../lib/pairing'
import Press from './Press'
import { tick } from '../lib/feedback'
import chevronIcon from '../../assets/icons/chevron.png'

/**
 * One model, on a page of its own.
 *
 * "Still not seeing any amp cab and pedal photos or descriptions. Should be
 * able to tap on the card and open a detailed page like this."
 *
 * The photographs and the descriptions were written and wired into one place
 * only — the panel inside the block editor, for the model already chosen,
 * which is the one model nobody is wondering about. The reference list, whose
 * whole purpose is "what have I got", was rows that could not be opened.
 *
 * Reading order, which is the order the questions come in: what the unit
 * calls it, what it really is, what it is like, what it looks like.
 *
 * WHERE THE PICTURE COMES FROM. Over the network, from the hosted site, and
 * not out of the app bundle. 55 photographs is 7MB and a finished roster
 * would be four times that — downloaded again by every phone on every
 * over-the-air update, for pictures somebody looks at twice. With no internet
 * this shows the words and no picture, which is what it does for three
 * quarters of the roster in any case.
 *
 * THE CREDIT IS PART OF THE PICTURE. Every one of these is Creative Commons
 * and naming the photographer is a condition of showing it at all, so there
 * is no arrangement of this screen that draws one without the other.
 */
/*
 * ONE MODEL AT A TIME, AND THE NEXT ONE A SWIPE AWAY.
 *
 * "Make it so swiping left or right on the screen takes you forward or
 * backwards to the next amp model. Also have little arrow buttons on each
 * side of the screen… Have the All models button take them back." And
 * smoothly: the page follows the finger, then slides off as the next one
 * slides in, the way a phone's own photo viewer does. It is the core
 * Animated library, so it costs no build.
 *
 * `entries` is the list the page was opened from (the tab and the search as
 * they were), and it wraps round at both ends, so the arrows never go dead.
 *
 * The swipe is claimed here, deeper than the app's swipe-from-the-edge back
 * gesture, so a sideways swipe on this page always means "next model" and
 * never "leave". Android's own back gesture comes to All models too, rather
 * than out of the app.
 */
const SWIPE = 0.22 // of the screen's width, dragged far enough to turn
const FLICK = 0.45 // or thrown fast enough

export default function GearCard({ entry, entries = [], onGo, onBack }) {
  const { width } = useWindowDimensions()
  const x = useRef(new Animated.Value(0)).current
  const [moving, setMoving] = useState(false)
  const list = entries.length ? entries : entry ? [entry] : []
  const at = Math.max(0, list.findIndex((e) => e === entry || (e.name === entry?.name && e.slug === entry?.slug)))
  const many = list.length > 1

  /* The live values, for a gesture made once and kept. */
  const live = useRef({})
  live.current = { list, at, many, width, onGo, moving }

  /* Out one side, swap, in from the other. */
  const turn = (dir) => {
    const { list: l, at: i, many: m, width: w, onGo: go, moving: busy } = live.current
    if (!m || busy) return
    setMoving(true)
    Animated.timing(x, { toValue: -dir * w, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      go?.(l[(i + dir + l.length) % l.length])
      x.setValue(dir * w)
      Animated.timing(x, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() =>
        setMoving(false)
      )
    })
  }
  const turnRef = useRef(turn)
  turnRef.current = turn

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      /* Nothing above this takes the gesture away mid-swipe. */
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        if (live.current.many && !live.current.moving) x.setValue(g.dx)
      },
      onPanResponderRelease: (_e, g) => {
        const w = live.current.width
        if (g.dx < -w * SWIPE || g.vx < -FLICK) return turnRef.current(1)
        if (g.dx > w * SWIPE || g.vx > FLICK) return turnRef.current(-1)
        Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start()
      },
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start()
    })
  ).current

  /* Android's back gesture and button: to All models, not out of the app. */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack?.()
      return true
    })
    return () => sub.remove()
  }, [onBack])

  /* The neighbours' photographs fetched ahead, so a swipe lands on a picture
     rather than on a blank box that fills in a moment later. */
  useEffect(() => {
    if (!many) return
    for (const d of [1, -1]) {
      const next = list[(at + d + list.length) % list.length]
      const p = next && photoFor(next.name, `${HOSTED_ORIGIN}/gear`)
      if (p) Image.prefetch(p.src).catch(() => {})
    }
  }, [at, many, list])

  if (!entry) return null
  const photo = photoFor(entry.name, `${HOSTED_ORIGIN}/gear`)
  const about = paragraphsOf(descriptionFor(entry.slug, entry.name))
  const specs = specsFor(entry.slug, entry.name)

  /* Two verbs, because one sentence will not carry both. "Based on Mesa" is
     not English — "based on" wants a thing. "Modelled on Mesa" reads correctly
     for every maker in the catalog, single word or not. */
  const lineage = entry.basedOn
    ? `Based on ${entry.basedOn}`
    : entry.manufacturer
      ? `Modelled on ${entry.manufacturer}`
      : entry.gear
        ? `Based on ${entry.gear}`
        : null

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: space.lg,
          gap: space.md
        }}
      >
        <Press label="‹ All models" height={40} onPress={onBack} />
        {many ? (
          <Text style={{ color: color.silkDim, fontSize: font.small }}>{`${at + 1} of ${list.length}`}</Text>
        ) : null}
      </View>

      <View style={{ flex: 1 }} {...pan.panHandlers}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: x }] }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg + (many ? 40 : 0), paddingBottom: space.xxl, gap: space.md }}
      >
        <View>
          <Text
            accessibilityRole="header"
            style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}
          >
            {entry.name}
          </Text>
          {lineage ? (
            <Text style={{ color: color.ok, fontSize: font.body, marginTop: 2 }}>{lineage}</Text>
          ) : null}
        </View>

        {/*
          THE PICTURE FIRST, then the numbers, then the writing.

          The order is the order the questions arrive in, and it changed once
          there was a photograph to put in it: what it looks like is answered
          by a glance, and a paragraph above the photograph is a paragraph
          read before you know what you are reading about.
        */}
        {photo ? (
          <View style={{ gap: space.xs }}>
            <Image
              source={{ uri: photo.src }}
              accessibilityLabel={photo.alt}
              resizeMode="contain"
              style={{
                width: '100%',
                height: 200,
                borderRadius: radius.md,
                backgroundColor: color.panel
              }}
            />
            <Text
              onPress={() => Linking.openURL(photo.rights)}
              style={{ color: color.silkFaint, fontSize: font.micro }}
            >
              {photo.credit}
            </Text>
          </View>
        ) : null}

        {specs ? (
          <Text style={{ color: color.silk, fontSize: font.body, fontWeight: '600' }}>{specs}</Text>
        ) : null}

        {/* As many paragraphs as were written. One sentence is an array of
            one, so everything already in the catalog draws as it did. */}
        {about.map((para, i) => (
          <Text key={i} style={{ color: color.silkDim, fontSize: font.body, lineHeight: 22 }}>
            {para}
          </Text>
        ))}

        {/*
          Said rather than left as a blank screen. Somebody who opens three
          models and gets three different amounts of page needs to know that
          is the state of the catalog rather than a fault in the app. The rule
          it obeys is the one lineage.js is built on: nothing invented,
          because a wrong attribution in a guitar app is worse than a blank.
        */}
        {!about.length && !photo ? (
          <Text style={{ color: color.silkFaint, fontSize: font.small, lineHeight: 20 }}>
            Nothing written down about this one yet. The catalog only
            holds what can be said for certain — a plausible guess would be read as fact by somebody
            who owns the real thing.
          </Text>
        ) : null}
      </ScrollView>
      </Animated.View>
      {many ? (
        <>
          <Arrow side="left" onPress={() => turn(-1)} label={`Previous: ${list[(at - 1 + list.length) % list.length]?.name}`} />
          <Arrow side="right" onPress={() => turn(1)} label={`Next: ${list[(at + 1) % list.length]?.name}`} />
        </>
      ) : null}
      </View>
    </View>
  )
}

/** A round arrow at the side of the page, held still while the page slides. */
function Arrow({ side, onPress, label }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        tick()
        onPress()
      }}
      style={({ pressed }) => ({
        position: 'absolute',
        top: 120,
        [side]: space.xs,
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: color.rule,
        backgroundColor: pressed ? color.panelHi : color.panel
      })}
    >
      <Image
        source={chevronIcon}
        accessible={false}
        style={{
          width: 16,
          height: 16,
          tintColor: color.silk,
          transform: side === 'left' ? [{ scaleX: -1 }] : []
        }}
      />
    </Pressable>
  )
}
