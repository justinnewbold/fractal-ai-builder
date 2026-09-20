import { useEffect, useState } from 'react'
import { Modal, ScrollView, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { color, font, radius, space } from '../lib/theme'
import Press from './Press'

/**
 * The four things nobody works out on their own, on a phone.
 *
 * "First issue is demo has no tutorial. Very important."
 *
 * The browser has had one since long before this app existed and the phone
 * never did, which left the demo — the one place somebody arrives knowing
 * nothing — as the end with no explanation at all.
 *
 * IT IS NOT THE BROWSER'S TOUR WITH THE WORDS CHANGED. Two of those cards
 * teach things that are not true here. The browser can save a preset into a
 * slot; a phone cannot, and the host refuses it from a distance — see
 * REMOTE_FORBIDDEN in shared/relay-rules. Saying "press Save" on a phone
 * would send somebody hunting for a button that is deliberately absent, which
 * is worse than saying nothing.
 *
 * A TOUR IS A TAX ON EVERYONE WHO DID NOT NEED IT, so this one says only what
 * the screen cannot. Where the buttons are is not in here: they are labelled
 * and they are on screen. What IS in here is the one gesture with no visible
 * control, the one concept a Fractal explains badly, and the one thing about
 * this app that will otherwise be discovered as a disappointment.
 *
 * It is offered, not imposed. Skip is a real button in the same place on
 * every card, because somebody who has used a Fractal for ten years should be
 * out in one tap without reading anything. And it never returns once it has
 * been closed, however it was closed — a tutorial that reappears after you
 * dismissed it is worse than one you never saw.
 */
const KEY = 'fractal.tour.v1'

export const tourSeen = async () => {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'done'
  } catch {
    /* A phone that refuses storage would otherwise show this every launch.
       Assuming it has been seen is the kinder of the two failures. */
    return true
  }
}

const markSeen = () => AsyncStorage.setItem(KEY, 'done').catch(() => {})

const CARDS = [
  {
    title: 'Two screens',
    lines: [
      'Play is the one to have open with a guitar in your hands: the preset you are on, its scenes, and the tuner.',
      'Edit is the signal chain. Tap a block to open it and turn its knobs.'
    ]
  },
  {
    /*
     * Not "eight scenes". Eight is the FM3's count and the family does not
     * agree on it — the app reads the number off the unit for that reason, so
     * a tour asserting eight is wrong on whichever unit has a different
     * number, and it is the sort of wrong a player notices at once.
     */
    title: 'Scenes are one rig, several sounds',
    lines: [
      'A scene is not another preset. One preset holds one set of blocks, and a scene remembers two things about each: whether it is on, and which channel it is playing.',
      'Channels are where the sound lives. The amp and most blocks worth switching carry four, A to D, each with its own model and settings — so a lead scene can have a genuinely hotter amp, not the rhythm amp with a boost in front of it.'
    ]
  },
  {
    /*
     * The card above explains what a channel IS and never says how to reach
     * one. There is no visible control for it, which is exactly why it has to
     * be said out loud rather than left to be found.
     */
    title: 'Hold a block to change its channel',
    lines: [
      'On Play, every block in the chain is a button. A tap switches it on and off.',
      'Hold one down and its channels appear — A to D. That is the whole gesture, and there is nothing on screen that hints at it.'
    ]
  },
  {
    /*
     * The disappointment card. Better learned in ten seconds here than after
     * twenty minutes of work on a dark stage.
     */
    title: 'This is a remote, not a workbench',
    lines: [
      'What you change here is the sound coming out of the unit right now, and it lasts until you load another preset.',
      'Saving into a slot is done at the computer, on purpose — a save button within reach of a stage tap is a hazard, and the computer refuses one from a phone anyway.'
    ]
  }
]

export default function Tour({ onClose }) {
  const [at, setAt] = useState(0)
  const card = CARDS[at]
  const last = at === CARDS.length - 1

  const done = () => {
    markSeen()
    onClose?.()
  }

  /* A Modal, not a View in the tree. Rendered inline this would take a slice
     of the stage screen's layout and push the rig down the page, rather than
     being the screen while it is up. */
  return (
    <Modal visible animationType="slide" onRequestClose={done} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: color.chassis, paddingTop: space.xxl }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Text style={{ color: color.silkDim, fontSize: font.small, letterSpacing: 1 }}>
          {`${at + 1} OF ${CARDS.length}`}
        </Text>

        <Text style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
          {card.title}
        </Text>

        <View style={{ gap: space.md }}>
          {card.lines.map((line) => (
            <Text
              key={line}
              style={{ color: color.silkDim, fontSize: font.body, lineHeight: font.body * 1.5 }}
            >
              {line}
            </Text>
          ))}
        </View>
      </ScrollView>

      <View style={{ padding: space.lg, gap: space.md, borderTopWidth: 1, borderTopColor: color.rule }}>
        <Press
          label={last ? 'Start playing' : 'Next'}
          tone="signal"
          onPress={() => (last ? done() : setAt(at + 1))}
        />
        {/* Same place on every card, so leaving is one tap from anywhere. */}
        <Press label={last ? 'Back' : 'Skip'} onPress={() => (last ? setAt(at - 1) : done())} />
        </View>
      </View>
    </Modal>
  )
}
