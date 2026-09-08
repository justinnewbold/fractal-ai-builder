import { useCallback, useEffect, useState } from 'react'
import { Platform, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { useKeepAwake } from 'expo-keep-awake'

import { color, font, mono, space, TAP } from '../lib/theme'
import { hostConflict, remoteChosenHost, remoteHosts } from '../lib/relay'
import { presetLabel, sceneShape, slotCount, stepSlot } from '../lib/device'
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
import Note from '../components/Note'
import Press from '../components/Press'
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
export default function Stage({ onOpenSettings, onOpenTone }) {
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

  const step = async (by) => {
    const next = stepSlot(preset?.number, by, caps)
    if (next === null) {
      // The end of the list. Wrapping round to slot 0 mid-set is worse than a
      // button that does nothing, so it does nothing and says so in the case.
      nope()
      return
    }
    thud()
    await loadPreset(next)
  }

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
            {Number.isInteger(preset?.number) ? `SLOT ${preset.number}` : 'SLOT —'}
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
            */}
            {onOpenTone ? (
              <Press
                label="✦ Tone"
                height={36}
                style={{ paddingHorizontal: space.md }}
                onPress={onOpenTone}
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

        <Text
          numberOfLines={2}
          accessibilityRole="header"
          style={{ color: color.silk, fontSize: font.display, fontWeight: '700', lineHeight: 46 }}
        >
          {presetLabel(preset)}
        </Text>

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Press
            grow
            label="Previous"
            disabled={stepSlot(preset?.number, -1, caps) === null}
            onPress={() => step(-1)}
          />
          <Press
            grow
            label="Next"
            disabled={stepSlot(preset?.number, 1, caps) === null}
            onPress={() => step(1)}
          />
        </View>
      </View>

      {/* ---------------------------------------------------------- scenes */}
      {scenes.hasScenes ? (
        <View style={{ gap: space.sm }}>
          <Label>Scenes</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {Array.from({ length: scenes.count }, (_, i) => (
              <Press
                key={i}
                label={String(i + 1)}
                sub={sceneNames[i] || undefined}
                tone="signal"
                on={i === scene}
                haptic={thud}
                onPress={() => writeScene(i)}
                style={{ minWidth: TAP + 8, flexGrow: 1, flexBasis: '22%' }}
              />
            ))}
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

        {blocks.map((block) => (
          <View key={block.eid} style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Press
                grow
                label={block.name || block.slug}
                sub={block.channel ? `Channel ${block.channel}` : undefined}
                tone="signal"
                on={!block.bypassed}
                onPress={() => writeBypass(block.eid, !block.bypassed)}
              />
              {channels?.length > 1 ? (
                <Press
                  label={block.channel || '—'}
                  height={TAP}
                  style={{ width: TAP }}
                  onPress={() => setPicking(picking === block.eid ? null : block.eid)}
                />
              ) : null}
            </View>

            {picking === block.eid ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {channels.map((name) => (
                  <Press
                    key={name}
                    grow
                    label={name}
                    on={block.channel === name}
                    onPress={() => {
                      writeChannel(block.eid, name)
                      setPicking(null)
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ))}
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
