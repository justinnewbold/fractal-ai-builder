import { useCallback, useEffect, useRef, useState } from 'react'
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
import { SIZES, fitTiles, loadFit, loadSize } from '../lib/gigSize'
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
import { useDemoUnit } from '../lib/demo'
import { coachSeen, markCoach } from '../lib/coach'
import { nope, thud } from '../lib/feedback'
import { blockColor } from '../lib/blockColors'
import { sceneColor } from '../lib/sceneColors'
import { shortBlock } from '../lib/shortName'
import UnlockOffer from '../components/UnlockOffer'
import Note from '../components/Note'
import { fixById, fixFor } from '../lib/troubleshooting'
import Press from '../components/Press'
import Tile from '../components/Tile'
import Coach from '../components/Coach'
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
export default function Stage({ onOpenPresets, onOpenSetlists, onOpenEdit, onOpenFix, onUnlock }) {
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
  /*
   * SMALLEST MEANS IT FITS. "On the smallest setting, if we could make it so
   * the screen won't scroll and everything fits on the screen — it's barely
   * hanging off the edge." The tiles were already at their smallest, but
   * everything around them was at its ordinary size: the gaps between
   * sections, the padding under the foot, the preset button's extra height,
   * and a chain tile that would not go below the stage floor of 56 even when
   * the scene tiles beside it were 48. At the smallest step the screen is
   * being asked to fit, so all of that gives too — and nothing pressable goes
   * below the platform's own 44.
   */
  const tight = size === SIZES[0]

  /*
   * FIT ON SCREEN: the screen decides the height, not a step on the ladder.
   *
   * "Make one that says fit on screen, and if they click that, it'll just make
   * sure whatever size device they're on, all of those will fit onto the
   * screen so they don't have to manually push up and down for sizes and then
   * go back to the play screen to see what it did and then go back."
   *
   * That round trip is the whole complaint, and no fixed step can end it: a
   * step is a number of pixels, and whether a rig fits at that number depends
   * on the preset in front of you and the phone in your hand. So this measures
   * instead — the browser has done it this way since "everything static on the
   * screen without being able to scroll", and this is the same arithmetic
   * against React Native's measurements rather than the DOM's.
   *
   * CHROME IS WHAT IS LEFT OVER. Everything here that is not a tile — the
   * preset button, the notes, the tempo and tuner at the foot — has a height
   * that does not depend on the tile size. So it is the content's whole height
   * less the two grids, and whatever the viewport has left after THAT is what
   * the grids may share.
   *
   * It settles rather than oscillating: the grids are subtracted out of the
   * measurement, so the chrome figure does not move when the tiles resize.
   */
  const scenes = sceneShape(caps)
  const [viewport, setViewport] = useState(0)
  const [content, setContent] = useState(0)
  const [sceneGrid, setSceneGrid] = useState(0)
  const [blockGrid, setBlockGrid] = useState(0)
  const fitOn = loadFit(sync, true)
  const chrome = Math.max(0, content - sceneGrid - blockGrid)
  /*
   * WHAT THE PREDICTION MISSED, MEASURED RATHER THAN GUESSED AT AGAIN.
   *
   * "This is set to the fit to screen setting but the tempo numbers are
   * cutting off."
   *
   * fitTiles works out how tall a tile may be and assumes every row comes out
   * that tall. Tiles take it as a MINIMUM — a scene tile carrying a number
   * over a name grows past it — so the grids landed taller than the budget
   * they were given, and the footer went off the bottom of the screen. Worse,
   * it was STABLE there: chrome and the budget both stay put, so it settled
   * overflowing and stayed overflowing.
   *
   * Rather than teach the prediction about every way a tile can grow — the
   * two-line name, the block rows being 12 shorter, whatever is added next —
   * this measures what actually happened and takes it off the budget. It only
   * ever grows within a layout, so it converges in a frame or two instead of
   * oscillating, and it is thrown away whenever the thing being fitted
   * changes.
   */
  const [trim, setTrim] = useState(0)
  const fitKey = `${viewport}:${scenes.hasScenes ? scenes.count : 0}:${blocks.length}:${fitOn}`
  const lastKey = useRef(fitKey)
  if (lastKey.current !== fitKey) {
    lastKey.current = fitKey
    if (trim !== 0) setTrim(0)
  }
  useEffect(() => {
    if (!fitOn || !viewport || !content) return
    const over = content - viewport
    /* A pixel or two is rounding, not an overflow worth another pass. */
    if (over > 2) setTrim((was) => was + over)
  }, [fitOn, content, viewport])
  /* Only once every piece has been measured. Fitting against a chrome of
     zero would hand the grids the whole screen for one frame, which is the
     flash of wrong sizes this screen already learned to avoid. */
  const fitted =
    fitOn && viewport > 0 && content > 0 && (sceneGrid > 0 || blockGrid > 0)
      ? fitTiles({
          available: viewport - chrome - trim,
          scenes: scenes.hasScenes ? scenes.count : 0,
          blocks: blocks.length,
          sceneCols: size.scenes,
          fxCols: size.fx,
          gap: space.sm
        })
      : null
  /** The two numbers the tiles are actually drawn with. */
  const tileH = fitted ? fitted.tile : size.tile
  const fxCols = fitted ? fitted.fxCols : size.fx
  /** Which block's channel picker is open, by effect id. */
  const [picking, setPicking] = useState(null)

  const channels = caps?.channelNames
  const slots = slotCount(caps)
  const conflict = hostConflict(remoteHosts(), remoteChosenHost())

  /*
   * The channel tip, and the conditions it waits for.
   *
   * "This tip appears here - exactly when the gesture becomes useful." So it
   * does not open on the first launch, or the first time this screen is
   * drawn: it opens on the first preset that has blocks to hold AND a unit
   * with more than one channel to choose between. On anything else the tip
   * would be teaching a gesture that does nothing — the same hold is wired to
   * `undefined` down in the grid for exactly that reason.
   *
   * The chain has to have been read, too. A chain that failed leaves the last
   * blocks it knew on screen, and a tip over stale tiles is a tip about a
   * preset that may not be loaded.
   */
  const holdDoesSomething = chain === 'ok' && blocks.length > 0 && channels?.length > 1
  const [coach, setCoach] = useState(false)

  useEffect(() => {
    if (!holdDoesSomething) return undefined
    let live = true
    coachSeen().then((seen) => {
      if (live && !seen) setCoach(true)
    })
    return () => {
      live = false
    }
  }, [holdDoesSomething])

  /* Shown once, and remembered the moment it is shown rather than when it is
     answered — killing the app with the card up is not an accident to correct
     on the next launch. */
  const closeCoach = useCallback(() => {
    markCoach()
    setCoach(false)
  }, [])

  /* And it gets out of the way the moment somebody does the thing. Opening a
     channel picker is the whole point of the card, so leaving it sitting
     there afterwards would be the app failing to notice it had worked. */
  useEffect(() => {
    if (picking && coach) closeCoach()
  }, [picking, coach, closeCoach])

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

  /*
   * And again when the demo becomes a different unit.
   *
   * "It's not letting you switch to a different demo. It's stuck on the FM3."
   * Picking one rebuilt the simulated unit immediately — but this read ran
   * once, on mount, so the screen went on showing the old unit's presets, its
   * scenes and its chain. The rig underneath had changed and nothing had asked
   * it anything since.
   *
   * Harmless outside the demo: `demoUnit` never moves there, so this is the
   * same single read on mount it has always been.
   */
  const demoIs = useDemoUnit()

  useEffect(() => {
    reload()
  }, [reload, demoIs])

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
   * The word SETLIST sits above it because a lone "All" between Previous and
   * Next reads as a caption rather than as the button that decides what those
   * two do — and because setlist is what the thing IS called everywhere else
   * in the app. "Source" was the word for the mechanism: All, Starred or a
   * list, three things a programmer would group and nobody else would.
   */
  const at = order ? positionIn(order, preset?.number) : 0
  const where = order ? (at ? `${at}/${order.length}` : `${order.length}`) : ''

  /* The foot's buttons: the stage floor, or 48 when the screen is asked to fit. */
  const foot = tight ? 48 : TAP

  return (
    <ScrollView
      style={{ flex: 1 }}
      /* The viewport, and everything in it: fit is the difference between
         the two, less the grids. */
      onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
      onContentSizeChange={(_w, h) => setContent(h)}
      contentContainerStyle={{
        padding: space.lg,
        gap: tight ? space.md : space.lg,
        paddingBottom: tight ? space.lg : space.xxl
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={color.silkDim} />
      }
    >
      {/* Above the faults, because a fault is about right now and this is
          about the app itself — and below nothing, because this is the first
          screen and the top of it is where an eye starts. */}
      <UnlockOffer onUnlock={onUnlock} />
      {conflict ? <Note tone="fault">{conflict}</Note> : null}
      {error ? (
        <Note tone="fault" onDismiss={clearError}>
          {error}
        </Note>
      ) : null}
      {/*
        And what to do about it, when this app can tell.

        A message that says what went wrong and offers nothing to do next is
        where the guide came from. fixFor reads the message for a handful of
        plain signals; anything it cannot place gets no button, which is the
        honest answer — a wrong fix offered confidently costs more than no fix
        offered at all.

        Its own conditional rather than a fragment inside the note's: the note
        above is read by a test for the exact shape that makes it dismissible,
        and wrapping it was how that broke.
      */}
      {error && onOpenFix && fixFor(error) ? (
        <Press
          label={fixById(fixFor(error)).title}
          sub="What to try"
          onPress={() => onOpenFix(fixFor(error))}
        />
      ) : null}

      {/* ---------------------------------------------------------- preset */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.5 }}>
            {Number.isInteger(preset?.number)
              ? `PRESET ${slotLabel(preset.number, caps?.presets?.addressing)}`
              : 'PRESET —'}
            {slots ? ` OF ${slots}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {/*
              What is up here rather than down among the scenes.

              This corner takes you OFF the screen, which is the honest
              grouping: everything below the preset name acts on the rig you
              are playing, and this does not. It is also the corner furthest
              from where a thumb rests during a song.

              The speaker and Setup used to be in this row too. They are on the
              bar at the top of the app now, where the browser keeps them — see
              components/TopBar.

              A ✦ Tone button stood here until the tone designer was taken out
              of the app. A row that closes up around a button it was not given
              is the same row either way.
            */}
            {/*
              EDIT IS NOT HERE ANY MORE. "On the phone versions move the edit
              button down to the bottom tab bar exactly like it's set up on the
              web app." It sat up here beside the preset name on the reasoning
              that neither of them acts on the rig you are playing — true, and
              it put the way to the bench in the row your eye goes to first,
              at 36 points, above everything you actually press on a stage.

              The browser has always had it on the bottom bar beside the tuner
              and the tempo. That bar is the strip for what you do BETWEEN
              songs rather than during one, which is exactly what opening the
              chain is.
            */}
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
          height={tight ? TAP : TAP + 12}
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
            onLayout={(e) => {
              setGrid(e.nativeEvent.layout.width)
              setSceneGrid(e.nativeEvent.layout.height)
            }}
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
                  height={tileH}
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
          The channel tip, directly over the tiles it is about.

          Inside the chain's own block rather than at the top of the screen,
          because "this tip appears here" is a promise about WHERE: the
          gesture it describes belongs to the squares eight points below it,
          and a card up by the preset name would be describing something off
          the bottom of somebody's phone.
        */}
        <Coach open={coach} onTry={closeCoach} onSkip={closeCoach} />

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
          onLayout={(e) => {
            setGrid(e.nativeEvent.layout.width)
            setBlockGrid(e.nativeEvent.layout.height)
          }}
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
                height={Math.max(tight || fitted ? 44 : TAP, tileH - 12)}
                onPress={() => writeBypass(idOf(block), !block.bypassed)}
                onLongPress={
                  channels?.length > 1
                    ? () => setPicking(picking === idOf(block) ? null : idOf(block))
                    : undefined
                }
                style={{ width: tileWidth(row, fxCols) }}
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
          <Press grow label="‹ Previous" height={foot} disabled={landing(-1) === null} onPress={() => step(-1)} />
          <Press
            grow
            caption="Setlists"
            label={order ? sourceLabel(source, { favourites, lists }) : 'All'}
            sub={where || undefined}
            tone="signal"
            on={Boolean(order)}
            height={foot}
            disabled={!onOpenSetlists}
            onPress={onOpenSetlists}
          />
          <Press grow label="Next ›" height={foot} disabled={landing(1) === null} onPress={() => step(1)} />
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
              height={foot}
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
            label="Tap Tempo"
            sub={Number.isFinite(bpm) ? String(Math.round(bpm)) : undefined}
            tone="signal"
            height={foot}
            onPress={tapTempo}
            onLongPress={() => setTyping(true)}
          />
          {/*
            And the way to the bench, third on the same bar the browser puts
            it on. Last of the three because it is the only one that leaves
            this screen: a button that takes you somewhere else does not belong
            between two that do not.
          */}
          {onOpenEdit ? <Press grow label="Edit" height={foot} onPress={onOpenEdit} /> : null}
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
