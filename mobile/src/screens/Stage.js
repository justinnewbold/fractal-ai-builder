import { useCallback, useEffect, useState } from 'react'
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native'
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
  writeTuner
} from '../lib/rig'
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
export default function Stage({ onOpenSettings }) {
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
          <Press
            label="Setup"
            height={36}
            style={{ paddingHorizontal: space.md }}
            onPress={onOpenSettings}
          />
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
          <Press grow label="Tap" tone="signal" onPress={tapTempo} />
        </View>
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
