import { useCallback, useEffect, useState } from 'react'
import { Platform, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { useKeepAwake } from 'expo-keep-awake'

import { color, font, mono, space, TAP } from '../lib/theme'
import { hostConflict, remoteChosenHost, remoteHosts } from '../lib/relay'
import { idOf, presetLabel, sameBlock, sceneShape, slotCount, slotLabel, stepSlot } from '../lib/device'
import {
  listsFor,
  marksFor,
  orderFor,
  positionIn,
  sourceFor,
  sourceLabel,
  stepTarget
} from '../lib/lists'
import { useStored } from '../lib/store'
import {
  loadPreset,
  refreshAll,
  tapTempo,
  useRig,
  writeBypass,
  writeChannel,
  writeScene,
  writeTempo,
  writeTuner
} from '../lib/rig'
import { checkBpm } from '../lib/tempo'
import { nope, thud } from '../lib/feedback'
import { blockColor } from '../lib/blockColors'
import { sceneColor } from '../lib/sceneColors'
import { shortBlock } from '../lib/shortName'
import Note from '../components/Note'
import Press from '../components/Press'
import Tile from '../components/Tile'
import Tuner from '../components/Tuner'

const face = Platform.select(mono)

/* Hoisted: a selector rebuilt each render re-reads the store on every notify. */
const ofPreset = (s) => s.preset
const ofBlocks = (s) => s.blocks
const ofScene = (s) => s.sceneIndex
const ofSceneNames = (s) => s.sceneNames
const ofCaps = (s) => s.capabilities
const ofChain = (s) => s.chain
const ofTunerOn = (s) => s.tunerOn
const ofTuning = (s) => s.tuning
const ofBpm = (s) => s.bpm
const ofError = (s) => s.error
const ofSlug = (s) => s.deviceSlug

/**
 * The stand, not the bench.
 *
 * Nothing here designs anything. On stage you need to know what preset you're
 * on, get to the next one, switch scenes, turn a block off, and check you're in
 * tune — with targets big enough to hit without looking closely, on a phone, in
 * the dark, possibly mid-song.
 *
 * Everything the desktop app can do and this cannot is deliberate. A generate
 * button within reach of a stage tap is a hazard, and saving to a slot is
 * refused by the Mac anyway.
 */
export default function Stage({ onOpenSettings, onOpenTone, onOpenPresets, onOpenSetlists, onOpenEdit }) {
  // The screen is the instrument panel for as long as this is open. A phone
  // that locks itself between songs is a phone you have to wake and unlock
  // while the count-in is happening.
  useKeepAwake()

  const preset = useRig(ofPreset)
  const blocks = useRig(ofBlocks)
  const scene = useRig(ofScene)
  const sceneNames = useRig(ofSceneNames)
  const caps = useRig(ofCaps)
  const chain = useRig(ofChain)
  const tunerOn = useRig(ofTunerOn)
  const tuning = useRig(ofTuning)
  const bpm = useRig(ofBpm)
  const device = useRig(ofSlug)
  /*
   * What Previous and Next step through, and where you are in it.
   *
   * Re-read on every write to storage — the star is pressed on the picker and
   * the setlist is chosen on the screen behind this one, and the count between
   * the two buttons has to follow both. `useStored` is the phone's version of
   * the browser's two window listeners and its counter in state.
   */
  useStored()
  const favourites = marksFor(device).favourites
  const lists = listsFor(device)
  const source = sourceFor(device)
  const order = orderFor(source, { favourites, lists })
  /* The tempo box under Tap, open only while somebody is typing into it. */
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [typedError, setTypedError] = useState(null)
  useEffect(() => {
    if (typing) {
      setTyped(Number.isFinite(bpm) ? String(Math.round(bpm)) : '')
      setTypedError(null)
    }
  }, [typing]) // eslint-disable-line react-hooks/exhaustive-deps
  const commitTyped = async () => {
    const checked = checkBpm(typed)
    setTyping(false)
    if (checked.error) {
      setTypedError(checked.error)
      return
    }
    if (checked.bpm !== undefined && checked.bpm !== Math.round(bpm)) {
      try {
        await writeTempo(checked.bpm)
      } catch (err) {
        setTypedError(err.message)
      }
    }
  }
  const error = useRig(ofError)

  const [refreshing, setRefreshing] = useState(false)
  /** Which block's channel picker is open, by effect id. */
  const [picking, setPicking] = useState(null)

  const scenes = sceneShape(caps)
  const channels = caps?.channelNames
  const slots = slotCount(caps)
  const conflict = hostConflict(remoteHosts(), remoteChosenHost())

  const reload = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshAll()
    } catch {
      // refreshAll puts what it learned in the store, including the failure.
      // Nothing to add here that the screen is not already showing.
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  /*
   * Where a press of Previous or Next would land, or null when the button has
   * nothing to do.
   *
   * Two rules, not one, and the split is deliberate. Inside a setlist or the
   * stars the order wraps, because a running order does come back round to the
   * first song — that is `stepTarget`, the browser's own. Slot by slot has no
   * such order to come back to, so it stops at the ends: `stepSlot` knows how
   * many slots the unit reported and greys the button rather than sending a
   * press the unit is going to refuse.
   */
  const landing = (by) =>
    order
      ? stepTarget({ source, current: preset?.number, delta: by, favourites, lists })
      : stepSlot(preset?.number, by, caps)

  const step = async (by) => {
    const next = landing(by)
    if (next === null) {
      // The end of the list. Wrapping round to slot 0 mid-set is worse than a
      // button that does nothing, so it does nothing and says so in the case.
      nope()
      return
    }
    thud()
    await loadPreset(next)
  }

  /*
   * The button between the two: what they walk, and where you are in it.
   *
   * "Starred 3/7" is the third starred preset of seven; a setlist shows its
   * name. Off the list altogether it shows only the count, and Next goes to the
   * first song. The word SOURCE sits above it because a lone "All" between
   * Previous and Next reads as a caption rather than as the button that decides
   * what those two do.
   */
  const at = order ? positionIn(order, preset?.number) : 0
  const where = order ? (at ? `${at}/${order.length}` : `${order.length}`) : ''

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={color.silkDim} />
      }
    >
      {conflict ? <Note tone="fault">{conflict}</Note> : null}
      {error ? <Note tone="fault">{error}</Note> : null}

      {/* ---------------------------------------------------------- preset */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.5 }}>
            {Number.isInteger(preset?.number)
              ? `SLOT ${slotLabel(preset.number, caps?.presets?.addressing)}`
              : 'SLOT —'}
            {slots ? ` OF ${slots}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {/*
              The way to the tone screen, beside Setup rather than down among
              the scenes.

              Both of the things up here take you OFF this screen, which is the
              honest grouping: everything below the preset name acts on the rig
              you are playing, and neither of these does. It is also the corner
              furthest from where a thumb rests during a song.

              Absent, not disabled, when play mode is on — and absent until the
              setting has been read back, because a button that appears late is
              safer than one that vanishes under a press. See lib/playMode.js.

              Absent throughout the first release, which ships with the AI
              switched off: App hands down no handler at all. Nothing changes
              here for that — a row that closes up around a button it was not
              given is the same row either way. See lib/features.js.
            */}
            {onOpenTone ? (
              <Press
                label="✦ Tone"
                height={36}
                style={{ paddingHorizontal: space.md }}
                onPress={onOpenTone}
              />
            ) : null}
            {/*
              The way to the bench, beside the other thing that takes you off
              this screen. Everything below the preset name acts on the rig you
              are playing; neither of these does.
            */}
            {onOpenEdit ? (
              <Press
                label="Edit"
                height={36}
                style={{ paddingHorizontal: space.md }}
                onPress={onOpenEdit}
              />
            ) : null}
            <Press
              label="Setup"
              height={36}
              style={{ paddingHorizontal: space.md }}
              onPress={onOpenSettings}
            />
          </View>
        </View>

        {/*
          The preset is a button now, not a heading.

          It reads the same and does the thing the browser's does: tapping it
          opens every slot by name. Previous and Next stay either side of it
          because they are the mid-song controls and a list is not — but
          "get me to SCHISM" was unanswerable on this screen until now.
        */}
        <Press
          label={presetLabel(preset)}
          sub={onOpenPresets ? 'Tap for all presets' : undefined}
          height={TAP + 12}
          disabled={!onOpenPresets}
          onPress={onOpenPresets}
          style={{ paddingHorizontal: space.lg }}
        />

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Press grow label="‹ Prev" disabled={landing(-1) === null} onPress={() => step(-1)} />
          <Press
            grow
            caption="Source"
            label={order ? sourceLabel(source, { favourites, lists }) : 'All'}
            sub={where || undefined}
            tone="signal"
            on={Boolean(order)}
            height={TAP}
            disabled={!onOpenSetlists}
            onPress={onOpenSetlists}
          />
          <Press grow label="Next ›" disabled={landing(1) === null} onPress={() => step(1)} />
        </View>
      </View>

      {/* ---------------------------------------------------------- scenes */}
      {/*
        Two across, named, and each one its own colour — the browser's Play
        screen, tile for tile.

        Four across with nothing but a numeral was a reading task: eight
        identical panels, and between two bars of a song you are counting
        squares. Two across buys the width for the NAME, which is the thing a
        player actually thinks in — RHYTHM, LEAD, CLEAN — and the colour means
        the right tile is found before any of it is read.

        The number stays, small, above the name. It is what the unit calls the
        scene and what a setlist written on paper says.
      */}
      {scenes.hasScenes ? (
        <View style={{ gap: space.sm }}>
          <Label>Scenes</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {Array.from({ length: scenes.count }, (_, i) => {
              const hue = sceneColor(i)
              return (
                <Tile
                  key={i}
                  caption={String(i + 1)}
                  label={sceneNames[i] || ''}
                  fill={hue.fill}
                  ink={hue.ink}
                  on={i === scene}
                  height={TAP + 20}
                  haptic={thud}
                  onPress={() => writeScene(i)}
                  /* Two columns: half the width less half the gap. */
                  style={{ flexGrow: 1, flexBasis: '47%' }}
                />
              )
            })}
          </View>
        </View>
      ) : null}

      {/* ---------------------------------------------------------- blocks */}
      <View style={{ gap: space.sm }}>
        <Label>
          {chain === 'reading' ? 'Reading the chain…' : chain === 'failed' ? 'Chain — out of date' : 'Chain'}
        </Label>

        {chain === 'failed' ? (
          <Note tone="warn">
            The unit didn’t answer when we asked what’s in this preset, so these buttons are
            whatever it last told us. Pull down to ask again.
          </Note>
        ) : null}

        {blocks.length === 0 && chain === 'ok' ? (
          <Note>Nothing in this preset but input and output.</Note>
        ) : null}

        {/*
          A wrapped grid of coloured tiles, which is the browser's chain and
          also the unit's own screen.

          A full-width row per block was honest and unreadable: seven rows of
          "Delay 1 / Channel A" is a list to be read top to bottom, and it
          pushed the tempo and the tuner off the bottom of the phone. Four
          across fits the whole chain in the space two rows used to take, and
          the colour does the finding — the drive is red on the AM4's display,
          so it is red here.

          The abbreviation is shortName's, shared with the browser: DLY, and
          DLY 2 only when there is more than one, because a preset can hold a
          second delay without holding the first.

          Tapping still toggles. The channel moved into the tile as a sub-line
          and onto a hold, because a separate square per block doubled the
          number of targets on the busiest part of the screen.
        */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {blocks.map((block) => {
            const hue = blockColor(block.slug)
            /* Named here rather than inline: the word the unit uses for this is
               not a word anybody says out loud, and it has no business sitting
               next to the text that gets drawn. */
            const engaged = !block.bypassed
            const state = engaged ? 'On' : 'Off'
            return (
              <Tile
                key={idOf(block)}
                label={shortBlock(block)}
                sub={block.channel ? `${state}  ${block.channel}` : state}
                fill={hue.fill}
                ink={hue.ink}
                on={engaged}
                height={TAP + 8}
                onPress={() => writeBypass(idOf(block), !block.bypassed)}
                onLongPress={
                  channels?.length > 1
                    ? () => setPicking(picking === idOf(block) ? null : idOf(block))
                    : undefined
                }
                style={{ flexGrow: 1, flexBasis: '22%' }}
              />
            )
          })}
        </View>

        {/* The channel picker, under the grid rather than inline, so opening it
            cannot reflow the tiles out from under a thumb. */}
        {picking !== null && channels?.length > 1 ? (
          <View style={{ gap: space.sm }}>
            <Label>
              {shortBlock(blocks.find((b) => sameBlock(b, picking)) || {})} — channel
            </Label>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {channels.map((name) => (
                <Press
                  key={name}
                  grow
                  label={name}
                  tone="signal"
                  on={blocks.find((b) => sameBlock(b, picking))?.channel === name}
                  onPress={() => {
                    writeChannel(picking, name)
                    setPicking(null)
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>

      {/* ----------------------------------------------------------- tempo */}
      <View style={{ gap: space.sm }}>
        <Label>Tempo</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text
            accessibilityLabel={Number.isFinite(bpm) ? `${Math.round(bpm)} beats per minute` : 'tempo unknown'}
            style={{ color: color.silk, fontSize: font.hero, fontFamily: face, minWidth: 92 }}
          >
            {Number.isFinite(bpm) ? Math.round(bpm) : '—'}
          </Text>
          {/*
            * The one thing in this app that must never be sent twice. A
            * parameter arriving twice leaves the unit where it was; a beat
            * arriving twice is a beat that never happened, so the relay
            * excludes this route from its retry.
            */}
          {/*
            * Hold Tap to type the tempo. "On the tap button, let's do where
            * they hold the tap button they can manually enter in the beats per
            * minute they want." The field opens beneath with the current
            * tempo selected; the keyboard's Done sets it.
            */}
          <Press grow label="Tap" tone="signal" onPress={tapTempo} onLongPress={() => setTyping(true)} />
        </View>
        {typing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <TextInput
              autoFocus
              selectTextOnFocus
              value={typed}
              onChangeText={(t) => setTyped(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              returnKeyType="done"
              accessibilityLabel="Tempo in beats per minute"
              placeholder="BPM"
              placeholderTextColor={color.silkFaint}
              onSubmitEditing={commitTyped}
              onBlur={() => setTyping(false)}
              style={{
                flexGrow: 1,
                minHeight: TAP,
                backgroundColor: color.panel,
                borderWidth: 1,
                borderColor: color.live,
                borderRadius: 10,
                paddingHorizontal: space.md,
                color: color.silk,
                fontSize: font.hero,
                fontFamily: face,
                textAlign: 'center'
              }}
            />
            <Press label="Set" tone="signal" on onPress={commitTyped} />
          </View>
        ) : null}
        {typedError ? <Note tone="fault">{typedError}</Note> : null}
      </View>

      {/* ----------------------------------------------------------- tuner */}
      <View style={{ gap: space.md }}>
        <Press
          label={tunerOn ? 'Stop tuner' : 'Tuner'}
          tone="live"
          on={tunerOn}
          onPress={() => writeTuner(!tunerOn)}
        />
        <Tuner on={tunerOn} reading={tuning} />
      </View>

      <Text style={{ color: color.silkFaint, fontSize: font.micro, fontFamily: face }}>
        Everything you change here happens on the unit at the Mac. Saving to a slot happens there
        too.
      </Text>
    </ScrollView>
  )
}

function Label({ children }) {
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: color.silkFaint,
        fontSize: font.micro,
        letterSpacing: 1.5,
        textTransform: 'uppercase'
      }}
    >
      {children}
    </Text>
  )
}
