import { useCallback, useEffect, useState } from 'react'
import { RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useKeepAwake } from 'expo-keep-awake'

import { color, font, space, TAP } from '../lib/theme'
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
import { sync, useStored } from '../lib/store'
import { SIZES, loadSize } from '../lib/gigSize'
import {
  clearError,
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
import { nope, thud } from '../lib/feedback'
import { blockColor } from '../lib/blockColors'
import { sceneColor } from '../lib/sceneColors'
import { shortBlock } from '../lib/shortName'
import Note from '../components/Note'
import Press from '../components/Press'
import Tile from '../components/Tile'
import Sheet from '../components/Sheet'
import TempoBox from '../components/TempoBox'
import Tuner from '../components/Tuner'

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
export default function Stage({ onOpenTone, onOpenPresets, onOpenSetlists, onOpenEdit }) {
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
  /*
   * Whether somebody is typing a tempo. The box itself, what is in it and what
   * it refuses all live in components/TempoBox — it is an overlay, and holding
   * its state out here is how the keyboard came to be covering it.
   */
  const [typing, setTyping] = useState(false)
  const error = useRig(ofError)

  const [refreshing, setRefreshing] = useState(false)
  /*
   * How wide a row of tiles actually is. Measured rather than assumed, because
   * the answer is the phone's width less this screen's padding, and neither is
   * a number worth writing down twice.
   */
  const [grid, setGrid] = useState(0)
  /*
   * And what to draw with until the measurement lands.
   *
   * "After going to setlists and going back it shows this screen sized wrong
   * for a split second." It did, every time, and on every cold start too — a
   * screen that comes back is a screen that mounts again, so `grid` was 0 for
   * the first frame, `tileWidth` had no width to divide, and every tile fell
   * back to the width of the word on it. Eight scenes six across, then a jump.
   *
   * The honest width is no mystery: this screen is the window less its own
   * padding, and both numbers are right here. So that is what the first frame
   * uses, and the measurement corrects it the moment it arrives — which keeps
   * `onLayout` the authority for anything this arithmetic cannot know about,
   * a tablet in split view among them.
   */
  const { width: screen } = useWindowDimensions()
  const row = grid || Math.max(0, screen - space.lg * 2)
  /*
   * How big the tiles are, chosen in Setup and kept under the browser's own
   * key. Read here rather than passed down, because `useStored` above already
   * re-renders this screen on every write to storage.
   */
  const size = SIZES[loadSize(sync)] || SIZES[1]
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
    /* Not awaited: the rig puts the new slot on screen immediately and confirms
       it behind that. Waiting here would make Next feel like it missed. */
    loadPreset(next)
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
      {error ? (
        <Note tone="fault" onDismiss={clearError}>
          {error}
        </Note>
      ) : null}

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
              The way to the tone screen, up in the corner rather than down
              among the scenes.

              Both of the things up here take you OFF this screen, which is the
              honest grouping: everything below the preset name acts on the rig
              you are playing, and neither of these does. It is also the corner
              furthest from where a thumb rests during a song.

              The speaker and Setup used to be in this row too. They are on the
              bar at the top of the app now, where the browser keeps them — see
              components/TopBar.

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
          </View>
        </View>

        {/*
          The preset is a button now, not a heading.

          It reads the same and does the thing the browser's does: tapping it
          opens every slot by name. Previous and Next stay either side of it
          because they are the mid-song controls and a list is not — but
          "get me to SCHISM" was unanswerable on this screen until now.
        */}
        {/*
          "…" rather than "Untitled" for the one round trip between pressing a
          preset and the unit saying what it is called. The slot is already in
          the line above, so nothing here is a guess. See rig.loadPreset.
        */}
        <Press
          label={preset?.pending && !preset?.name ? '…' : presetLabel(preset)}
          sub={onOpenPresets ? 'Tap for all presets' : undefined}
          height={TAP + 12}
          disabled={!onOpenPresets}
          onPress={onOpenPresets}
          style={{ paddingHorizontal: space.lg }}
        />

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
          <View
            onLayout={(e) => setGrid(e.nativeEvent.layout.width)}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}
          >
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
                  height={size.tile}
                  haptic={thud}
                  onPress={() => writeScene(i)}
                  style={{ width: tileWidth(row, size.scenes) }}
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
        <View
          /* Both grids measure, because a unit that reports no scenes never
             draws the other one and these tiles would have no width. */
          onLayout={(e) => setGrid(e.nativeEvent.layout.width)}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}
        >
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
                height={Math.max(TAP, size.tile - 12)}
                onPress={() => writeBypass(idOf(block), !block.bypassed)}
                onLongPress={
                  channels?.length > 1
                    ? () => setPicking(picking === idOf(block) ? null : idOf(block))
                    : undefined
                }
                style={{ width: tileWidth(row, size.fx) }}
              />
            )
          })}
        </View>

      </View>

      {/* ------------------------------------------------------------ foot */}
      {/*
        Previous / Next, then Tuner and Tap. One block at the bottom, which is
        the browser's own arrangement and was Justin's correction to it:

        "Move Previous / Next directly above the bottom tap bar."

        They sat up by the preset name, which is where you READ, not where your
        thumb rests. The phone had them there too — the same mistake, made a
        second time — so stepping presets was at the top of the screen and the
        tuner was off the bottom of it.
      */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Press grow label="‹ Previous" disabled={landing(-1) === null} onPress={() => step(-1)} />
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

        {/*
          Tuner and Tap on one row, and the tempo ON the Tap button rather than
          beside it as its own heading with a forty-point number. That number
          was answering "what is this preset at" with a third of the screen; on
          the button it answers the same question and costs nothing.

          Tuner only where the unit has one. Absent means unknown — an older
          host predating the flag — and unknown still gets to try.
        */}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {caps?.tuner !== false ? (
            <Press
              grow
              label={tunerOn ? 'Stop tuner' : 'Tuner'}
              tone="live"
              on={tunerOn}
              onPress={() => writeTuner(!tunerOn)}
            />
          ) : null}
          {/*
            The one thing in this app that must never be sent twice. A parameter
            arriving twice leaves the unit where it was; a beat arriving twice is
            a beat that never happened, so the relay excludes this route from its
            retry.

            Hold it to type a tempo: "on the tap button, let's do where they hold
            the tap button they can manually enter in the beats per minute they
            want."
          */}
          <Press
            grow
            label="Tap"
            sub={Number.isFinite(bpm) ? String(Math.round(bpm)) : undefined}
            tone="signal"
            onPress={tapTempo}
            onLongPress={() => setTyping(true)}
          />
        </View>


      </View>

      {/*
        NO FOOTER. "Get rid of the everything you change here text at the bottom
        of the screen."

        It explained where changes land — true, and the kind of thing you read
        once and then scroll past for the rest of the app's life. The bar at the
        top already says which unit is being driven and that the link is up,
        which is the part that goes on mattering.
      */}

      {/*
        The two things that cover the screen rather than sitting in it, drawn
        last and outside the foot because both are modals.

        The volume is not among them any more: the speaker moved to the bar at
        the top of the app, which is where the browser keeps it, and the sheet
        moved with the button that opens it. See components/TopBar.
      */}
      {/*
        The channel picker, over the screen rather than inside it.

        "When holding a block to change channel have it be an overlay on the
        screen instead of inserting itself into the screen like the web
        version." It opened underneath the chain, which pushed everything below
        it down — so the tiles a thumb was aimed at moved while the thumb was on
        its way, on the one screen where that can happen mid-song.
      */}
      {/*
        Typing a tempo, high on the screen.

        "When holding tap button to manually enter tempo the keyboard blocks the
        numbers so you can see what your typing." It was in the foot — which is
        where a thumb rests and therefore exactly where the keyboard opens.
      */}
      <TempoBox
        open={typing}
        bpm={bpm}
        onSet={writeTempo}
        onClose={() => setTyping(false)}
      />

      <ChannelSheet
        block={blocks.find((b) => sameBlock(b, picking)) || null}
        channels={channels}
        onClose={() => setPicking(null)}
        onPick={(ch) => {
          writeChannel(picking, ch)
          setPicking(null)
        }}
      />

      {/* Closing the tuner stops it at the unit, which is what the button does. */}
      <Tuner on={tunerOn} reading={tuning} onClose={() => writeTuner(false)} />
    </ScrollView>
  )
}

/**
 * How wide a tile is when `n` of them share a row.
 *
 * A percentage rather than a measured width: the gap between tiles is real
 * pixels and the row is however wide the phone is, so asking for exactly 100/n
 * puts the last tile of every row on a line of its own. Two points of slack per
 * tile is what leaves room for the gaps at every one of the five sizes.
 */
/**
 * How wide one tile is when `n` share a row of `width` points.
 *
 * MEASURED RATHER THAN A PERCENTAGE, for two reasons that only show up on
 * hardware. `flexGrow: 1` fills the row, which is right until the last row is
 * short — nine blocks four across leaves one on its own, and it stretched the
 * whole width of the screen: a reverb the size of the preset name beside four
 * normal tiles. And a percentage cannot pay for the gaps, so four at 22% leave
 * a ragged strip down the right.
 *
 * The browser gets both for free from a CSS grid, which has real columns. This
 * is a wrapped row, so the arithmetic is done here: the row less its gaps,
 * divided by the tiles in it.
 */
const tileWidth = (width, n) => {
  const cols = Math.max(1, n)
  if (!width) return undefined
  return (width - space.sm * (cols - 1)) / cols
}

/**
 * Which channel a block is on.
 *
 * Each channel keeps its own model and settings, and the SCENE remembers which
 * one this block plays — which is the fact worth having in front of somebody
 * before they change it, because it is the difference between "this sounds
 * different now" and "scene 2 sounds different now".
 *
 * The same words the browser uses, because they are the same fact.
 */
function ChannelSheet({ block, channels, onClose, onPick }) {
  const name = block?.name || block?.slug || ''
  return (
    <Sheet open={!!block && channels?.length > 1} onClose={onClose} title={name} note="Channel">
      <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="radiogroup">
        {(channels || []).map((ch) => (
          <Press
            key={ch}
            grow
            label={ch}
            height={TAP + 28}
            tone="live"
            on={block?.channel === ch}
            accessibilityLabel={`Channel ${ch}`}
            onPress={() => onPick(ch)}
          />
        ))}
      </View>
      <Text style={{ color: color.silkDim, fontSize: font.small, lineHeight: 20 }}>
        {block?.channel ? `${name} is on channel ${block.channel}. ` : ''}
        Each channel keeps its own model and settings; the scene remembers which one this block
        plays.
      </Text>
    </Sheet>
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
