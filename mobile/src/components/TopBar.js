import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'

import { color, font, mono, radius, space } from '../lib/theme'
import { tick } from '../lib/feedback'
import { linkTone, linkWord, toneOfRemote, unitWord } from '../lib/link-word'
import { APP_VERSION } from '../lib/version'
import { useRig } from '../lib/rig'
import { useDemo } from '../lib/demo'
import { usePurchase } from '../lib/purchases'
import { idOf } from '../lib/device'
import Lamp from './Lamp'
import Volume from './Volume'

const face = Platform.select(mono)

/**
 * One line, above everything, in every state — the browser's bar, on a phone.
 *
 * "Make sure the iOS app shows this exact header." It was a different bar
 * saying a different thing: a sentence, "Connected to MacBook Pro SG 566",
 * which named the Mac and nothing else. The unit was not on it, the version was
 * two sheets away under Setup, and the speaker and the gear were down in the
 * slot row competing with Edit for a corner of the stage screen.
 *
 * Left to right, the same five things and in the same order as the browser: the
 * lamp, the unit's short name, the version, the state of the link in one word,
 * the volume, and setup. Every one of them is a fact somebody checks BEFORE
 * playing — what am I plugged into, what am I running, is it live — and none of
 * them belongs on a screen you have to go and find.
 *
 * WHAT IT NO LONGER SAYS is which Mac. That sentence was the whole of the old
 * bar and it is the one fact here nobody needs mid-song: there is normally one
 * Mac, and when there is more than one the setup screen is where you choose
 * between them. The name is still there, under the gear.
 *
 * The words come from shared/link-word.mjs rather than from here, so the two
 * apps cannot drift into saying different things about the same link.
 */
export default function TopBar({ link, onOpenSettings, onOpenUnit, onUnlock }) {
  const unit = useRig(ofDeviceName)
  const unitState = useRig(ofUnitState)
  const blocks = useRig(ofAllBlocks)
  const [volume, setVolume] = useState(false)
  const [failed, setFailed] = useState(null)
  const purchase = usePurchase()
  /* Named once, because the word and the pill below must agree about it. */
  const canBuy = Boolean(demo && purchase.available && !purchase.unlocked && onUnlock)

  /*
   * The demo says DEMO, not CONNECTED.
   *
   * It reads as a connected link everywhere else on purpose — the questions do
   * get answered — but the bar is the one place somebody looks to know what
   * they are driving, and a simulated FM3 wearing the same green CONNECTED as a
   * real one is the app telling a lie in the one spot that exists to prevent
   * that. "It does sound connected, even in demo."
   */
  const demo = useDemo()
  const connected = link?.link === 'connected'
  const tone = toneOfRemote(link?.link)
  const mark = demo ? 'wait' : linkTone(tone)
  const word = demo ? 'demo' : linkWord(tone, 'remote')

  /*
   * TWO SPOTS, EACH TELLING ITS OWN TRUTH. The word on the right is the
   * computer: CONNECTED means the phone can reach the Mac, and nothing more.
   * The lamp and name on the left are the unit: green with its name while it
   * answers, red with NOT ANSWERING when the Mac has a unit that has gone
   * quiet, red with NO UNIT when the Mac has none. See unitWord. Before this
   * the left showed the name and the right showed the link, and a frozen FM3
   * looked exactly like a working one.
   */
  const unitSaid = demo ? null : unitWord(tone, unitState)
  /* Green when connected to the unit, red when not — including when the
     computer itself is out of reach, since the unit is then out of reach
     too. Unlit only while nobody has been asked yet, and in the demo. */
  const unitLamp = demo ? 'idle' : connected && unitState === 'present' ? 'good' : !connected || unitSaid ? 'fault' : 'idle'

  /*
   * The unit's short name, and a dash rather than a guess.
   *
   * 'FM3' comes back from the unit itself, so until it has answered there is
   * nothing true to write here. The browser draws "Looking…" in the same spot;
   * on a bar this narrow that is most of the width, and the lamp beside it is
   * already saying the same thing in a shape you can read at a glance.
   */
  const named = unitSaid ? `${unit ? `${unit} · ` : ''}${unitSaid}`.toUpperCase() : unit || (connected ? 'Looking…' : '—')

  /*
   * Only where there is an output block to move, the same rule the browser
   * uses: a speaker that opens an empty sheet is worse than no speaker.
   *
   * AND ONLY WHERE IT CAN BE WRITTEN TO, which is not the same thing and cost
   * an evening to tell apart. This asked whether a block called "output" was
   * in the chain; the slider asks whether that block has an id to address. A
   * unit that reports the block without one satisfies the first and fails the
   * second, so the speaker appeared and every press of it answered "the chain
   * has not been read" about a chain that had:
   *
   *   01:24:41 [set] volume: no Output block known yet — the chain has not been read
   *   01:25:04 [set] volume: no Output block known yet — the chain has not been read
   *
   * — twenty seconds apart, on a preset whose chain had just been edited block
   * by block. One question now, asked in one place, so the button and the
   * write can no longer disagree about whether there is a volume to move.
   */
  const hasOutput = connected && Number.isInteger(idOf((blocks || []).find((b) => b?.slug === 'output')))

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderBottomWidth: 1,
        borderBottomColor: color.rule,
        backgroundColor: color.panel
      }}
    >
      <Lamp state={unitLamp} />

      {/*
        The name is pressed, not just read. "If you tap the top left button
        where it shows the current device in the demo mode, that it'll bring
        up that same list where you can change which one you're on."

        It goes to Setup, which is where both answers already live: the five
        units under Which unit while the demo is on, and what this rig is and
        what it is connected through when it is not. The browser can open Setup
        already standing on the right page and this cannot — Setup is one
        screen here, not a stack — so the phone lands at the top of it, with
        the demo block first on the screen when the demo is what is running.
      */}
      <Pressable
        onPress={onOpenUnit || onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel={demo ? 'Demo Unit' : 'About this unit'}
        hitSlop={8}
      >
        <Text
          numberOfLines={1}
          style={{ color: unitSaid ? color.fault : color.silk, fontSize: font.small, fontWeight: '700', letterSpacing: 1.5 }}
        >
          {named}
        </Text>
      </Pressable>

      {/*
        The version, where it can be read without opening anything.

        "The app version number is listed only in settings. I like to always
        know easily what version we are working on." It is the first thing
        either of us needs when something looks wrong, and on the phone it was
        behind Setup — which is the screen you cannot reach when the thing that
        looks wrong is the link.

        `flex: 1` so it takes the slack: the bar has a fixed left and a fixed
        right, and the gap between them is the one thing that can give.
      */}
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          color: color.silkFaint,
          fontSize: font.micro,
          fontFamily: face,
          letterSpacing: 1
        }}
      >
        {`v${APP_VERSION}`}
      </Text>

      {/*
        The word carries the state as well as saying it — and in the demo it
        carries the way out too.

        "On the main screen, make it so demo can be clicked to bring up the
        unlock page." The Unlock pill beside it says what it does in a word,
        which is what makes it findable; DEMO is the thing an eye actually
        lands on. Both go to the same place now, which costs nothing and
        forgives a thumb.

        Only while there is something to buy. Outside the demo this is
        CONNECTED or FINDING and means nothing of the sort, so it stays a
        plain label rather than a control that would do nothing.
      */}
      <Text
        numberOfLines={1}
        {...(canBuy
          ? {
              accessibilityRole: 'button',
              accessibilityLabel: 'Unlock the full version',
              suppressHighlighting: true,
              onPress: () => {
                tick()
                onUnlock()
              }
            }
          : null)}
        style={{
          color:
            mark === 'ok'
              ? color.ok
              : mark === 'no'
                ? color.fault
                : mark === 'wait'
                  ? color.signal
                  : color.silkFaint,
          fontSize: font.micro,
          fontWeight: '700',
          letterSpacing: 1.5
        }}
      >
        {word.toUpperCase()}
      </Text>

      {/*
       * THE WAY OUT OF THE DEMO AND INTO THE PAID APP, and until now there
       * was not one.
       *
       * The paywall was shown at one moment only: somebody with a pairing
       * code who had not paid. Which meant the demo — the entire shop window,
       * the thing a person spends an hour in before deciding — had no way to
       * buy anything at all. "Where is the unlock button to unlock to the
       * full version? I don't see it anywhere in the app."
       *
       * It was not buried. It was not there.
       *
       * So it sits next to the word DEMO, which is the one part of this bar
       * that is already saying "this is not your real rig". Amber, because
       * every other amber thing in this app is the signal path and this is
       * the one exception worth making: it has to be findable by somebody who
       * is not looking for it.
       *
       * Only in the demo, only when there is something to buy, and never once
       * it is bought — a button that charges a person twice, or that cannot
       * take money at all, is worse than no button.
       */}
      {canBuy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Unlock the full version"
          onPress={() => {
            tick()
            onUnlock()
          }}
          hitSlop={8}
          style={({ pressed }) => ({
            paddingHorizontal: space.sm,
            paddingVertical: 3,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: color.signal,
            backgroundColor: pressed ? color.signalWash : 'transparent'
          })}
        >
          <Text
            style={{
              color: color.signal,
              fontSize: font.micro,
              fontWeight: '700',
              letterSpacing: 0.6
            }}
          >
            Unlock
          </Text>
        </Pressable>
      ) : null}

      {hasOutput ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volume"
          hitSlop={10}
          onPress={() => setVolume(true)}
        >
          <Text style={{ fontSize: font.lead }}>🔊</Text>
        </Pressable>
      ) : null}

      {/*
        The gear is a letter, not a picture, and a letter needs a colour.

        "The settings icon is too dark to even see, but if I click where it's
        supposed to be" — on Android. ⚙ is drawn from the phone's text font in
        the text colour, which nobody set, so it took the default: black, on
        a bar that is nearly black. The iPhone got away with it because Apple
        swaps that character for its own picture of a gear. The speaker beside
        it is a true emoji and paints itself on both.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Connection and setup"
        hitSlop={10}
        onPress={onOpenSettings}
      >
        <Text style={{ color: color.silk, fontSize: font.lead }}>⚙</Text>
      </Pressable>

      {/*
        The volume opens from here now rather than from the stage screen, which
        is what moving the speaker up means: the sheet belongs to the button.
        It is a modal, so it does not care which screen is behind it.
      */}
      <Volume blocks={blocks} open={volume} onClose={() => setVolume(false)} onError={setFailed} />
      {failed ? <Reported said={failed} onClear={() => setFailed(null)} /> : null}
    </View>
  )
}

const ofDeviceName = (s) => s.deviceName
const ofUnitState = (s) => s.unit
const ofAllBlocks = (s) => s.allBlocks

/**
 * A volume that would not take, said on the bar that owns the speaker.
 *
 * Small and absolutely positioned under the bar rather than in it: the bar is
 * one line and has to stay one line, and a failure here is rare enough that it
 * can afford to sit over the top of the screen for as long as it takes to read.
 */
function Reported({ said, onClear }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Dismiss"
      onPress={onClear}
      style={{
        position: 'absolute',
        left: space.lg,
        right: space.lg,
        top: '100%',
        zIndex: 2,
        borderLeftWidth: 3,
        borderLeftColor: color.fault,
        backgroundColor: color.panelHi,
        paddingVertical: space.sm,
        paddingHorizontal: space.md
      }}
    >
      <Text style={{ color: color.silk, fontSize: font.small }}>{`${said}  ✕`}</Text>
    </Pressable>
  )
}
