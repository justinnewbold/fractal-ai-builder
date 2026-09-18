import { useEffect, useRef, useState } from 'react'
import { Keyboard, PanResponder, Platform, ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import {
  bindModifier,
  blockCatalog,
  blockParams,
  blockTypes,
  clearCell,
  dropReadCache,
  idOf,
  modifierModel,
  placeBlock,
  sameBlock,
  setParamConfirmed,
  setType
} from '../lib/device'
import { colLabel, doubtfulWrite, gridShape, laneItems, lanesShown, rowLabel } from '../lib/grid-plan'
import { blockPositions, landingIndex, reorderPlan, settledItems } from '../lib/laneOrder'
import { isSilencingParam } from '../lib/guardrails'
import { buildParamIndex, findControls, indexFor } from '../lib/paramIndex'
import { beginChainWrite, endChainWrite, getState, refreshBlocks, useRig, writeBypass, writeChannel } from '../lib/rig'
import { useKeepAwake } from 'expo-keep-awake'
import { logDebug } from '../lib/debugLog'
import { blockColor } from '../lib/blockColors'
import { shortBlock } from '../lib/shortName'
import { thud } from '../lib/feedback'
import Knob, { fmt } from '../components/Knob'
import Note from '../components/Note'
import Grip from '../components/Grip'
import Press from '../components/Press'
import { SaveButton, SaveNotes, useSaveToSlot } from '../components/SaveToSlot'
import Tile from '../components/Tile'

const face = Platform.select(mono)

const ofBlocks = (s) => s.allBlocks
const ofScene = (s) => s.sceneIndex
const ofSceneNames = (s) => s.sceneNames
const ofCaps = (s) => s.capabilities
const ofChain = (s) => s.chain

/**
 * Why a knob did not take, in words that say whose doing it is.
 *
 * "Says Time 1 didn't take when I adjusted a preset." It did not: the unit
 * read back a different number, and on a delay the usual reason is the
 * block's own Tempo control. Set to a note value, it holds the time to the
 * song's tempo and the time knob is decoration — the unit accepts the write,
 * then puts its own number back. The old message stopped at "didn't take",
 * which reads as the app failing. Now it says what the unit is holding, and
 * when there is a Tempo control on the block that is not at its lowest
 * setting (None), it says that is why and what to do about it.
 */
const didNotTake = (p, actual, params) => {
  const held = typeof actual === 'number' ? ` The unit is holding it at ${fmt(actual)}${p.unit ? ` ${p.unit}` : ''}.` : ''
  const tempo = (params || []).find((q) => /^tempo$/i.test(q?.name || ''))
  const lowest = typeof tempo?.min === 'number' ? tempo.min : 0
  if (/time/i.test(p.name || '') && tempo && typeof tempo.value === 'number' && tempo.value > lowest) {
    return `${p.name} didn’t take.${held} This block’s Tempo is set to a note value, so its time follows the song tempo. Set Tempo to None to set the time by hand.`
  }
  return `${p.name} didn’t take.${held}`
}

/**
 * A word about a model whose name says nothing.
 *
 * "In the edit menu it says Null on the current effect." It does: the Filter
 * block's flat type is called Null on the unit itself — no filtering at all,
 * the block passing the sound through unchanged, which is what you pick when
 * a Filter is there to be a level or pan control. A real name, read as an
 * error by anyone who has not met it. So it is explained where it is shown.
 */
const modelNote = (name) =>
  typeof name === 'string' && name.trim().toLowerCase() === 'null'
    ? 'Flat: the sound passes through unchanged. For a level or pan control.'
    : null

/**
 * The bench, not the stand.
 *
 * The stage screen is for the things you do mid-song with your eyes somewhere
 * else. This is the other half: the chain as a thing to work THROUGH — tap a
 * block and its controls open underneath, turn them, hear it.
 *
 * WHY THE CHAIN IS DRAWN TWICE IN THIS APP, once here and once on the stage
 * screen, and why that is not a duplicate. They do opposite things with a tap.
 * On the stage a tap toggles the block, because that is the press you make
 * between two bars. Here a tap OPENS it, because nothing on this screen is
 * pressed mid-song. Merging them would mean one of the two gestures losing, and
 * both of them are right where they are.
 *
 * AND THE ENDS ARE HERE. The stage screen hides the input, the output, the
 * looper and the gate; this one shows them, quieter and with no on/off, because
 * a chain being looked at that silently drops two of its blocks is a diagram
 * that disagrees with the unit. Tapping one is how you find out what the gate
 * is doing or where the output sits.
 *
 * WHICH SCENE THE EDIT LANDS IN is said at the top and is not decoration. Every
 * knob turned here writes into the scene that is live, and a footswitch on the
 * floor changes every value on this screen without touching anything in it.
 */
export default function Edit({ onBack }) {
  /*
   * Whether a knob has the finger, and the screen therefore must not scroll.
   *
   * On iOS the scroll view's gesture recogniser is native and does not lose to
   * a JavaScript responder — it takes the touch and terminates the drag. That
   * is the whole of "the knobs just scroll the screen up and down when trying
   * to change them", and turning scrolling off while a knob is held is the only
   * thing that reliably stops it. See components/Knob.
   */
  const [held, setHeld] = useState(false)
  /* Bench work takes minutes and a chain move takes long enough for the
     screen to lock — which suspended the app mid-write. The stage screen
     already stays awake; so does this one. */
  useKeepAwake()
  const blocks = useRig(ofBlocks)
  const scene = useRig(ofScene)
  const sceneNames = useRig(ofSceneNames)
  const caps = useRig(ofCaps)
  const chain = useRig(ofChain)

  const [openEid, setOpenEid] = useState(null)
  const [error, setError] = useState(null)
  /* SAVE, and it asks twice. The same piece the naming section in Setup
     uses; see components/SaveToSlot. */
  const saveTo = useSaveToSlot()
  /*
   * Search hands over by naming a control, not by editing one. Tapping a result
   * opens the block that holds it and puts your eyes on it — so there stays
   * exactly one place in this app where a value changes, with its verified
   * write behind it.
   */
  const [focus, setFocus] = useState(null)

  const block = blocks.find((b) => sameBlock(b, openEid)) || null

  /*
   * And brings the page to it. The block's knobs are drawn under the search
   * results and the row of block tiles, and on a phone with the keyboard up
   * that is below the bottom of the screen: "it'll pull up the parameters but
   * then clicking on it does nothing." It did — out of sight. So a tap on a
   * result also scrolls the page to the block it opened, once that block has
   * been laid out, which is the moment its position is known.
   */
  const page = useRef(null)
  const bringTo = useRef(null)
  useEffect(() => {
    if (focus?.nonce) bringTo.current = focus.nonce
  }, [focus])
  const panelLaid = (e) => {
    if (!bringTo.current) return
    bringTo.current = null
    const y = Math.max(0, e.nativeEvent.layout.y - space.md)
    page.current?.scrollTo({ y, animated: true })
  }

  return (
    <ScrollView
      ref={page}
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
      scrollEnabled={!held}
      /*
       * NOT the scroll view's cancel-content-touches rule. It was here for the knobs — the
       * native rule that a scroll may not take a touch a child is tracking —
       * and on iOS it applies to every child, not just a knob. This page is
       * buttons from top to bottom, so a finger that landed on any of them
       * could never become a scroll: "On edit screen I can't scroll at all
       * down to edit the parameters." The knob claims its touch in the
       * capture phase and refuses to hand it back (see components/Knob);
       * that, with the lock above, is what keeps a knob drag off the page.
       */
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ flexShrink: 1 }}>
          <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
            Edit
          </Text>
          <Text numberOfLines={1} style={{ color: color.silkDim, fontSize: font.small }}>
            {caps?.hasScenes === false
              ? 'Changes land in the preset'
              : `Changes land in scene ${scene + 1}${sceneNames[scene] ? ` — ${sceneNames[scene]}` : ''}`}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <SaveButton s={saveTo} />
          <Press label="Done" height={40} onPress={onBack} />
        </View>
      </View>

      <SaveNotes s={saveTo} />

      {error ? (
        <Note tone="fault" onDismiss={() => setError(null)}>
          {error}
        </Note>
      ) : null}

      {chain === 'reading' && !blocks.length ? (
        <Note>Reading what’s in this preset…</Note>
      ) : null}
      {chain === 'failed' ? (
        <Note tone="warn">
          The unit didn’t answer when we asked what’s in this preset, so these are whatever it last
          told us.
        </Note>
      ) : null}
      {!blocks.length && chain === 'ok' ? <Note>This preset is empty.</Note> : null}

      <FindControl
        blocks={blocks}
        onError={setError}
        onPick={(eid, paramId) => {
          setOpenEid(eid)
          setFocus({ eid, paramId, nonce: Date.now() })
        }}
      />

      {/* ----------------------------------------------------------- chain */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {blocks.map((b) => {
          const hue = blockColor(b.slug)
          const open = sameBlock(b, openEid)
          const engaged = !b.bypassed
          /* Named rather than written inline: the word the unit uses for a
             block that is off has no business sitting next to the text that
             gets drawn. */
          const state = engaged ? 'On' : 'Off'
          const under = open ? 'Open' : b.channel || state
          return (
            <Tile
              key={idOf(b)}
              label={shortBlock(b)}
              sub={under}
              fill={hue.fill}
              ink={hue.ink}
              on={open}
              height={TAP}
              haptic={thud}
              onPress={() => setOpenEid(open ? null : idOf(b))}
              style={{ flexGrow: 1, flexBasis: '22%', opacity: engaged ? 1 : 0.55 }}
            />
          )
        })}
      </View>

      {block ? (
        <View onLayout={panelLaid}>
          <BlockPanel
            key={`${idOf(block)}:${block.channel || ''}:${scene}`}
            block={block}
            channels={caps?.channelNames}
            focus={focus}
            onError={setError}
            onScrollLock={setHeld}
          />
        </View>
      ) : blocks.length ? (
        <Note>Tap a block to open its controls.</Note>
      ) : null}

      <ChainEditor blocks={blocks} caps={caps} onError={setError} onScrollLock={setHeld} />

      <Modifiers blocks={blocks} onError={setError} />
    </ScrollView>
  )
}

/**
 * One block's controls.
 *
 * Keyed from above on the block, its channel and the scene — the three things
 * that genuinely change what a knob here MEANS. Not on the block object: every
 * commit ends in a re-read that hands this an identical block under a new
 * identity, and keying on that threw the knobs away and read them again for
 * nothing, once per knob.
 */
function BlockPanel({ block, channels, focus, onError, onScrollLock }) {
  /* Read once and used everywhere below: see unit.mjs on why this is not
     `block.eid`, and what it cost to find out. */
  const eid = idOf(block)
  const [params, setParams] = useState([])
  const [models, setModels] = useState([])
  /* Which model this block is on. It comes back on the params read and nowhere
     else — /preset/blocks has never carried one. */
  const [type, setType_] = useState(null)
  const [tab, setTab] = useState('main')
  const [picking, setPicking] = useState(false)
  /* What is typed into the model find box. */
  const [hunt, setHunt] = useState('')
  const [loading, setLoading] = useState(false)
  /* Values a finger has moved but the unit has not confirmed yet. */
  const [local, setLocal] = useState({})
  /* The model this block was on before the last swap, for the eight seconds
     during which taking it back is one tap. */
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)

  useEffect(() => {
    let stop = false
    ;(async () => {
      setLoading(true)
      setLocal({})
      try {
        const [p, t] = await Promise.all([
          blockParams(eid),
          blockTypes(block.slug).catch(() => [])
        ])
        if (stop) return
        setParams(p?.named || [])
        setModels(t || [])
        setType_(p?.type ?? null)
      } catch (err) {
        if (!stop) onError(err.message)
      } finally {
        if (!stop) setLoading(false)
      }
    })()
    return () => {
      stop = true
    }
  }, [eid, block.slug, onError])

  useEffect(() => () => clearTimeout(undoTimer.current), [])

  /*
   * Levels are read, never turned.
   *
   * The same rule the browser holds, and it is not about tidiness: a block
   * level set to -60 dB makes a preset that looks right and is silent, and the
   * one place that is easy to do by accident is a knob under a thumb. Gain
   * staging is still something you need to be able to READ, so the level sits
   * under the deck as a number.
   */
  const editable = params.filter((p) => !isSilencingParam(p.name))
  const level = params.find((p) => /^.*\bLevel$/i.test(p.name) && !/boost|input/i.test(p.name))

  /* The first handful are what anyone reaches for; the rest are behind a tab,
     the way the hardware editors split them. */
  const primary = editable.slice(0, 6)
  const rest = editable.slice(6)
  const shown = tab === 'main' ? primary : rest

  /*
   * Search opens the right block, then puts your eyes on the control you named.
   *
   * Two steps, because a control on the second page is unreachable until that
   * page is showing: the tab moves first, and the knob is marked once the read
   * has finished and the cell it names actually exists. Marking before that is
   * marking nothing, which looks exactly like a search result that did nothing.
   */
  const [lit, setLit] = useState(null)
  useEffect(() => {
    if (!focus?.nonce || focus.eid !== eid) return undefined
    const onMore = rest.some((p) => p.id === focus.paramId)
    setTab(onMore ? 'more' : 'main')
    if (loading) return undefined
    if (!shown.some((p) => p.id === focus.paramId)) return undefined
    setLit(focus.paramId)
    const clear = setTimeout(() => setLit(null), 2500)
    return () => clearTimeout(clear)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, eid, loading, tab])

  const valueOf = (p) => (local[p.id] !== undefined ? local[p.id] : p.value)

  const commit = async (p, override) => {
    const next = override !== undefined ? override : local[p.id]
    if (next === undefined || next === p.value) return
    try {
      const res = await setParamConfirmed(eid, p.id, next, p)
      const fresh = await blockParams(eid)
      setParams(fresh?.named || [])
      if (!res.ok) onError(didNotTake(p, res.actual, fresh?.named || []))
      setLocal((prev) => {
        const copy = { ...prev }
        delete copy[p.id]
        return copy
      })
      /*
       * And nothing about the chain has changed, so nothing is re-read. Every
       * commit used to end in a full read of the unit for a knob that changed
       * none of it — five round trips down one channel per knob, competing
       * with the writes for the same port.
       */
    } catch (err) {
      onError(err.message)
    }
  }

  /**
   * Swapping the model, and being able to take it back.
   *
   * A swap is structural: it replaces the whole parameter set, so every knob
   * here means something different afterwards. That argues for a confirm — but
   * a dialog in front of a tone control is the ceremony that sends people back
   * to the hardware editor, and the one thing you want after hearing a wrong
   * amp is to be somewhere else, quickly. So it writes now and offers the way
   * back for eight seconds.
   */
  const applyModel = async (value, { undoable = true } = {}) => {
    const was = type
    await setType(eid, Number(value))
    const fresh = await blockParams(eid)
    /* The answer is what the unit shows afterwards, not what it said. */
    logDebug(
      'write',
      `block ${eid} model after the change`,
      fresh?.type?.value === Number(value) ? 'unit shows it' : `unit shows ${fresh?.type?.value ?? 'nothing'}, asked ${Number(value)}`
    )
    setParams(fresh?.named || [])
    setType_(fresh?.type ?? null)
    setLocal({})
    clearTimeout(undoTimer.current)
    if (undoable && was && was.value !== Number(value)) {
      setUndo(was)
      undoTimer.current = setTimeout(() => setUndo(null), 8000)
    } else {
      setUndo(null)
    }
  }

  const swap = async (value) => {
    setPicking(false)
    setHunt('')
    try {
      await applyModel(value)
    } catch (err) {
      onError(err.message)
    }
  }

  const engaged = !block.bypassed
  const hue = blockColor(block.slug)

  /*
   * The models worth drawing. Capped rather than paged: the list is scrolled
   * with a thumb, and a cap with a count under it is honest about what is
   * missing in a way a list that just stops is not.
   */
  const needle = hunt.trim().toLowerCase()
  const found = needle
    ? models.filter(
        (m) =>
          m.name?.toLowerCase().includes(needle) || m.basedOn?.toLowerCase().includes(needle)
      )
    : models
  const matches = found.slice(0, 40)
  const more = found.length - matches.length

  return (
    <View style={{ gap: space.md }}>
      <View
        style={{
          borderLeftWidth: 4,
          borderLeftColor: hue.fill,
          paddingLeft: space.md,
          gap: space.xs
        }}
      >
        <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.lead, fontWeight: '700' }}>
          {block.name}
        </Text>
      </View>

      {/* ------------------------------------------------ channel and state */}
      {channels?.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {channels.map((ch) => (
            <Press
              key={ch}
              grow
              label={ch}
              tone="signal"
              on={block.channel === ch}
              onPress={async () => {
                try {
                  await writeChannel(eid, ch)
                } catch (err) {
                  onError(err.message)
                }
              }}
            />
          ))}
        </View>
      ) : null}

      {/*
        The two ends of the chain have no on/off, and that is the unit's rule
        rather than a choice: a preset with its output bypassed is a preset
        nobody can hear.
      */}
      {['input', 'output'].includes(block.slug) ? null : (
        <Press
          label={engaged ? 'Engaged' : 'Bypassed'}
          tone="signal"
          on={engaged}
          onPress={() => writeBypass(eid, engaged)}
        />
      )}

      {/* ------------------------------------------------------------ model */}
      {models.length ? (
        <View style={{ gap: space.sm }}>
          <Press
            caption="Model"
            label={type?.name || `${models.length} to choose from`}
            sub={picking ? 'Close' : modelNote(type?.name) || 'Tap to change'}
            onPress={() => setPicking((v) => !v)}
          />
          {/*
            What a model is based on, under the control and in every row of the
            list. "Search for the real life names that each AMP and all other
            effects are based off of and list them next to the name" — the line
            under the control only ever described the model already chosen,
            which is the one nobody is wondering about.
          */}
          {!picking && gearLine(type) ? (
            <Text style={{ color: color.silkDim, fontSize: font.small }}>{gearLine(type)}</Text>
          ) : null}
          {picking ? (
            <View style={{ gap: space.sm }}>
              {/*
                A find box, because an amp block offers three hundred and
                thirty-one models. The browser scrolls its list to the one you
                are on and lets you read; a thumb cannot read three hundred
                rows, and drawing them all is a screen that stutters while you
                try.
              */}
              <TextInput
                value={hunt}
                onChangeText={setHunt}
                placeholder="Find a model"
                placeholderTextColor={color.silkFaint}
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="Find a model"
                style={{
                  minHeight: TAP,
                  paddingHorizontal: space.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: color.rule,
                  backgroundColor: color.panel,
                  color: color.silk,
                  fontSize: font.body
                }}
              />
              {matches.map((m) => (
                <Press
                  key={m.value}
                  label={m.name}
                  /* The amp beside the name, in the list where the choosing
                     happens. The maker alone is deliberately not used here: as
                     a suffix on forty rows it would say "Mesa/Boogie" beside
                     all of them and tell nobody which one is the Rectifier. */
                  sub={m.basedOn || modelNote(m.name) || undefined}
                  tone="signal"
                  on={m.value === type?.value}
                  onPress={() => swap(m.value)}
                />
              ))}
              {more > 0 ? (
                <Text style={{ color: color.silkDim, fontSize: font.micro }}>
                  {`${more} more — type to narrow it down.`}
                </Text>
              ) : null}
              {!matches.length ? <Note>Nothing named like that.</Note> : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {undo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text style={{ color: color.silkDim, fontSize: font.small, flex: 1 }}>
            {`Was ${undo.name}`}
          </Text>
          <Press label="Undo" height={44} onPress={() => swap(undo.value)} />
        </View>
      ) : null}

      {/* ------------------------------------------------------------ knobs */}
      {rest.length ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Press grow label="Main" tone="signal" on={tab === 'main'} height={44} onPress={() => setTab('main')} />
          <Press grow label="More" tone="signal" on={tab === 'more'} height={44} onPress={() => setTab('more')} />
        </View>
      ) : null}

      {/*
        The knobs stay up while they are being read again. Swapping a deck of
        six for one line of text takes 200 points out of a screen that is as
        tall as its contents, so it lurches down and back up — for a read that
        is usually over in a second, on values that are usually the same ones.
      */}
      {loading && !shown.length ? (
        <Note>{`Reading ${block.name}…`}</Note>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {shown.map((p) => (
            <View
              key={p.id}
              style={{
                width: '30%',
                alignItems: 'center',
                gap: space.xs,
                /* The one you searched for, said with a ring for a couple of
                   seconds rather than a colour change that outstays it. */
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: lit === p.id ? color.live : 'transparent',
                paddingVertical: 2
              }}
            >
              <Knob
                param={p}
                label={p.name}
                value={valueOf(p)}
                onChange={(v) => setLocal((prev) => ({ ...prev, [p.id]: v }))}
                onCommit={() => commit(p)}
                onScrollLock={onScrollLock}
              />
              <ValueBox param={p} value={valueOf(p)} onCommit={(v) => commit(p, v)} />
            </View>
          ))}
        </View>
      )}

      {level ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.5 }}>LEVEL</Text>
          <Text style={{ color: color.silk, fontSize: font.body, fontFamily: face }}>
            {`${fmt(level.value)}${level.unit ? ` ${level.unit}` : ''}`}
          </Text>
          <Text style={{ color: color.silkFaint, fontSize: font.micro }}>read-only</Text>
        </View>
      ) : null}
    </View>
  )
}

/**
 * Add, remove and move blocks.
 *
 * THE GRID IS NOT DRAWN AS A GRID, deliberately. Forty-eight cells of which
 * five hold anything is three cells visible on a phone and a scroll to find the
 * one you want — the browser had exactly that and the report was blunt: "the
 * rest you can't really add anything or change anything… let's rethink that
 * whole thing." So each row of the grid is a LANE: what is actually in it, in
 * signal order, with the free cells between it shown as gaps you can tap.
 * Nothing is hidden — the column number is on every card and a preset with
 * parallel rows gets a lane each — but nothing is drawn that isn't there.
 *
 * TWO THINGS ABOUT WRITING HERE ARE WORTH KNOWING BEFORE CHANGING ANY OF IT.
 *
 * Placement writes STRUCTURE rather than a value, so a bad write mangles a
 * preset rather than mis-setting a knob. Which is why the column arithmetic is
 * `lib/grid-plan`, shared with the Mac rather than done again here: getting it
 * wrong once already put slot 1 of an AM4 into column 2.
 *
 * And this hardware answers `ok:false` to writes that landed. The browser's old
 * editor took that at its word and rolled back moves that had worked — "delete
 * works, the rest doesn't". So nothing here acts on it: the answer is shown,
 * the chain is re-read from the unit, and you look.
 *
 * Folded away until asked for. It is the least-reached-for thing on the bench
 * and the easiest to press by accident.
 */
function ChainEditor({ blocks, caps, onError, onScrollLock }) {
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState(null)
  /* Which card's actions are showing, as "row:col". One at a time. */
  const [acting, setActing] = useState(null)
  /* Add: the card whose next free space a picked block goes into. */
  const [addAfter, setAddAfter] = useState(null)
  /* Which block a tapped gap would receive, by its own type code. */
  const [choice, setChoice] = useState(null)
  const [busy, setBusy] = useState(false)
  /* Said beside the control that caused it, never at the top of the screen. */
  const [issue, setIssue] = useState(null)
  const [hunt, setHunt] = useState('')
  /*
   * A block being dragged: which lane, which item, how far the finger has
   * gone, and where that puts it. Measured heights per lane item, because a
   * card and a free space are different heights and a lane can hold both.
   */
  const [drag, setDrag] = useState(null)
  /*
   * A move that has been let go of and is being written: which row, and the
   * block positions it is going between. The lane is drawn in its new order
   * from this until the unit has been asked again — see settledItems.
   */
  const [settling, setSettling] = useState(null)
  const heights = useRef({})

  const { linear } = gridShape(caps)
  const lanes = lanesShown(blocks, caps)

  useEffect(() => {
    if (!open || palette !== null) return undefined
    let stop = false
    ;(async () => {
      try {
        const list = await blockCatalog()
        if (!stop) setPalette(list)
      } catch {
        /* An empty catch left Place disabled with nothing to explain it. */
        if (!stop) setPalette([])
      }
    })()
    return () => {
      stop = true
    }
  }, [open, palette])

  if (!open) {
    return <Press label="Edit chain" sub="Add, move or remove blocks in this preset" onPress={() => setOpen(true)} />
  }

  const where = (row, col) =>
    linear ? `slot ${colLabel(col)}` : `row ${rowLabel(row)}, column ${colLabel(col)}`

  /* A write is done when the unit has been asked AND the chain re-read. */
  const after = async (res) => {
    /*
     * A structure write, then a read that must not come out of the computer's
     * fifteen-second copy of the preset — a copy taken before the write, so
     * a read out of it shows the chain as it was: "When I rearranged with the
     * slider and moved it up, it didn't take, it just put it right back where
     * it was." The copy is dropped first, so the read is off the unit.
     */
    endChainWrite({ refresh: false })
    await dropReadCache()
    await refreshBlocks({ quiet: true })
    setIssue(doubtfulWrite(res))
    if (!doubtfulWrite(res)) setActing(null)
  }

  /* Whether the unit now holds a block at (row, col) — its own answer, off
     the fresh read `after` makes. */
  const holds = (row, col) => (getState().allBlocks || []).some((b) => b.row === row && b.col === col)

  /*
   * Where the unit has a block now, whichever row it is in.
   *
   * A block asked into one row and found in another is the one answer that
   * tells a wrong row number from a write the unit ignored: both leave the
   * cell you asked for empty, and only one of them puts the block somewhere
   * else. So the add and the move say where the unit put it, not just that
   * it is not where it was asked to go.
   */
  const placeOf = (eid) => (getState().allBlocks || []).find((b) => idOf(b) === eid) || null

  const add = async (row, col, page = choice) => {
    if (page === null || page === undefined) return
    setBusy(true)
    setIssue(null)
    beginChainWrite()
    try {
      const r = await placeBlock(row, col, Number(page))
      logDebug('chain', `add block ${page} at ${where(row, col)}`, refusedAnswer(r) ? 'refused' : r?.ok === true ? 'ok' : 'no answer')
      await after(r)
      setAddAfter(null)
      logDebug('chain', `${where(row, col)} after the add`, holds(row, col) ? 'holds the block' : 'still empty')
      if (!holds(row, col)) {
        const put = placeOf(Number(page))
        logDebug('chain', `block ${page} after the add`, put ? `unit has it at ${where(put.row, put.col)}` : 'unit has it nowhere')
        setIssue(
          `The unit did not add it: ${where(row, col)} is still empty${refusedAnswer(r) ? ', and the unit answered “refused”' : ''}.${
            put ? ` The unit put it at ${where(put.row, put.col)} instead.` : ''
          }`
        )
      }
    } catch (err) {
      endChainWrite()
      setIssue(err.message)
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Add, from a card: the picked block goes into the first free space after
   * that card in its row. "Change Move to Add, to add a new block."
   */
  const addAfterCard = (lane, col, page) => {
    const free = (lane.gaps || []).filter((c) => c > col).sort((a, b) => a - b)[0]
    if (free === undefined) {
      setIssue(`No free space after ${where(lane.row, col)} in this row.`)
      return
    }
    add(lane.row, free, page)
  }

  /**
   * A drag, landed: the blocks of the lane dealt back into the same columns
   * in their new order. See lib/laneOrder for why the columns stay put.
   *
   * ORDER MATTERS AND THE SAFE ORDER IS NOT OBVIOUS. A block instance exists
   * once — a unit has one Amp — so placing it in a second cell while it still
   * occupies the first may be refused or may do something undefined. Every
   * moving block is cleared first, then every one is placed, so no target is
   * occupied when it is written to. The cost is a moment where they exist
   * nowhere, so they go back if a placement THROWS. Not on `ok:false`: that
   * answer means nothing on this hardware, and undoing a move because of it
   * is the bug this panel was reported for.
   */
  /* Whether the unit sent a rejection frame for a write. Counted and said,
     never acted on: see doubtfulWrite for why that answer undoes nothing. */
  const refusedAnswer = (r) => !!r && r.ok === false

  const reorder = async (lane, fromItem, toItem) => {
    const items = laneItems(lane)
    const pos = blockPositions(items, fromItem, toItem)
    if (!pos) return
    const moves = reorderPlan(
      items.filter((it) => it.kind === 'block').map((it) => ({ col: it.col, block: it.block })),
      pos.from,
      pos.to
    )
    if (!moves.length) return
    /* Where the finger left it, held on screen through the writes below. */
    setSettling({ row: lane.row, from: pos.from, to: pos.to })
    setBusy(true)
    setIssue(null)
    beginChainWrite()
    let last = null
    /*
     * EVERY ANSWER IS WRITTEN DOWN. The server only calls a write refused
     * when the unit sends a rejection frame within a tenth of a second; a
     * unit that quietly ignores a command answers exactly like one that took
     * it. So each clear and each placement is logged with what the unit
     * said, and a "refused" anywhere in the six is said on screen too.
     */
    const answers = []
    const said = (r) => (refusedAnswer(r) ? 'refused' : r?.ok === true ? 'ok' : 'no answer')
    try {
      for (const m of moves) {
        const r = await clearCell(lane.row, m.from)
        answers.push(r)
        logDebug('chain', `clear ${m.block.name} from column ${m.from + 1}`, said(r))
      }
      try {
        for (const m of moves) {
          last = await placeBlock(lane.row, m.to, idOf(m.block))
          answers.push(last)
          logDebug('chain', `place ${m.block.name} at column ${m.to + 1}`, said(last))
        }
      } catch (err) {
        for (const m of moves) await placeBlock(lane.row, m.from, idOf(m.block)).catch(() => {})
        throw err
      }
      await after(last)
      /* The unit has been asked again, so the lane is drawn from its answer
         rather than from where the finger left it. Dropped here rather than in
         the `finally` below: by this line the two agree, and holding it any
         longer would deal the move a second time on top of itself. */
      setSettling(null)
      const refused = answers.filter(refusedAnswer).length
      /*
       * And checked, in numbers, against the unit's own answer. A move the
       * unit did not keep used to look exactly like one that was never made:
       * the cards went back and nothing said why. Now each moved block is
       * looked for where it was put, and the ones that are not there are
       * named on screen and in the log.
       */
      const now = getState().allBlocks || []
      const colOf = (m) => now.find((b) => idOf(b) === idOf(m.block) && b.row === lane.row)?.col
      const astray = moves.filter((m) => colOf(m) !== m.to)
      /* Not in this row is not the same as nowhere: a block the unit put in
         another row is named with the row it went to. */
      const elsewhere = (m) => (colOf(m) === undefined ? placeOf(idOf(m.block)) : null)
      const found = (m) => {
        const put = elsewhere(m)
        return put ? `unit has it at ${where(put.row, put.col)}` : `unit has it at ${colOf(m) ?? 'nowhere'}`
      }
      for (const m of moves) {
        logDebug('chain', `${m.block.name}: column ${m.from} → ${m.to}`, astray.includes(m) ? found(m) : 'landed')
      }
      if (astray.length) {
        setIssue(
          `The unit did not keep the move: ${astray
            .map((m) => {
              const put = elsewhere(m)
              if (put) return `${m.block.name} is in ${where(put.row, put.col)}`
              return `${m.block.name} is ${colOf(m) === undefined ? 'not in this row' : `still in column ${colOf(m) + 1}`}`
            })
            .join(', ')}. ${
            refused
              ? `The unit answered “refused” to ${refused} of the ${answers.length} steps.`
              : `The unit answered every step without refusing it. Copy Logs from Setup — it has each answer.`
          }`
        )
      }
    } catch (err) {
      setIssue(err.message)
      onError(err.message)
    } finally {
      /* A throw on the way past the line above leaves it set, and a lane drawn
         for ever in an order the unit never took is worse than one that snaps
         back. The truth wins whenever this ends badly. */
      setSettling(null)
      endChainWrite()
      setBusy(false)
    }
  }

  const remove = async (row, col) => {
    setBusy(true)
    setIssue(null)
    beginChainWrite()
    try {
      const r = await clearCell(row, col)
      logDebug('chain', `remove block at ${where(row, col)}`, refusedAnswer(r) ? 'refused' : r?.ok === true ? 'ok' : 'no answer')
      await after(r)
      logDebug('chain', `${where(row, col)} after the remove`, holds(row, col) ? 'still holds a block' : 'empty now')
      if (holds(row, col)) {
        setIssue(`The unit did not remove it: ${where(row, col)} still holds a block${refusedAnswer(r) ? ', and the unit answered “refused”' : ''}.`)
      }
    } catch (err) {
      setIssue(err.message)
      onError(err.message)
    } finally {
      endChainWrite()
      setBusy(false)
    }
  }

  /* The drag itself. The grip in each card reports; this decides. */
  const dragStart = (row, index) => {
    onScrollLock?.(true)
    setDrag({ row, index, dy: 0, to: index })
  }
  const dragMove = (row, index, dy) => {
    const laneHeights = heights.current[row] || []
    const to = landingIndex(laneHeights, index, dy, space.sm)
    setDrag({ row, index, dy, to })
  }
  const dragEnd = (row, index) => {
    onScrollLock?.(false)
    const lane = lanes.find((l) => l.row === row)
    const to = drag?.to ?? index
    setDrag(null)
    if (lane && to !== index) reorder(lane, index, to)
  }

  const needle = hunt.trim().toLowerCase()
  const offered = (palette || [])
    .filter((b) => !needle || (b.name || '').toLowerCase().includes(needle))
    .slice(0, 30)
  const picked = (palette || []).find((b) => b.page === Number(choice))

  const paletteBox = (onPick, hint) => (
    <View style={{ gap: space.sm }}>
      {palette === null ? (
        <Note>Asking your unit what it can add…</Note>
      ) : !palette.length ? (
        <Note tone="warn">Couldn’t read the list of blocks from your unit.</Note>
      ) : (
        <>
          <TextInput
            value={hunt}
            onChangeText={setHunt}
            placeholder="Find a block"
            placeholderTextColor={color.silkFaint}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Find a block to add"
            style={{
              minHeight: TAP,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: color.rule,
              backgroundColor: color.panel,
              color: color.silk,
              fontSize: font.body
            }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {offered.map((b) => (
              <Press
                key={b.page}
                label={b.name}
                tone="signal"
                on={b.page === Number(choice)}
                height={44}
                disabled={busy}
                style={{ paddingHorizontal: space.md }}
                onPress={() => onPick(b)}
              />
            ))}
          </View>
          <Text style={{ color: color.silkDim, fontSize: font.micro }}>{hint}</Text>
        </>
      )}
    </View>
  )

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <Label>The chain</Label>
        <Press label="Close" height={40} onPress={() => setOpen(false)} />
      </View>

      {issue ? <Note tone="warn">{issue}</Note> : null}

      <Text style={{ color: color.silkFaint, fontSize: font.micro }}>
        Hold ≡ and drag a block up or down to move it. Tap a block for Add and Remove.
      </Text>

      {lanes.map((lane) => {
        /* While a move is being written the lane is drawn where the finger
           left it, not where the unit last said it was. */
        const resting = laneItems(lane)
        const items =
          settling && settling.row === lane.row ? settledItems(resting, settling.from, settling.to) : resting
        const dragging = drag && drag.row === lane.row ? drag : null
        const lift = dragging ? (heights.current[lane.row] || [])[dragging.index] || 0 : 0
        return (
          <View key={lane.row} style={{ gap: space.sm }}>
            {linear ? null : <Label>{`Row ${rowLabel(lane.row)}`}</Label>}
            {items.map((item, index) => {
              /* Where this item is drawn while a drag is on: the dragged one
                 follows the finger; the ones it has passed step out of its
                 way by its own height. */
              let shift = 0
              if (dragging) {
                if (index === dragging.index) shift = dragging.dy
                else if (dragging.to > dragging.index && index > dragging.index && index <= dragging.to)
                  shift = -(lift + space.sm)
                else if (dragging.to < dragging.index && index >= dragging.to && index < dragging.index)
                  shift = lift + space.sm
              }
              return (
                <View
                  key={item.kind === 'block' ? `b${item.col}` : `g${item.col}`}
                  onLayout={(e) => {
                    const h = heights.current[lane.row] || (heights.current[lane.row] = [])
                    h[index] = e.nativeEvent.layout.height
                  }}
                  style={{
                    transform: [{ translateY: shift }],
                    zIndex: dragging && index === dragging.index ? 2 : 0,
                    opacity: dragging && index === dragging.index ? 0.92 : 1
                  }}
                >
                  {item.kind === 'block' ? (
                    <BlockCard
                      block={item.block}
                      at={where(lane.row, item.col)}
                      busy={busy}
                      acting={acting === `${lane.row}:${item.col}`}
                      lifted={!!dragging && index === dragging.index}
                      onToggleActions={() => {
                        setActing(acting === `${lane.row}:${item.col}` ? null : `${lane.row}:${item.col}`)
                        setAddAfter(null)
                      }}
                      onAdd={() => setAddAfter(addAfter === `${lane.row}:${item.col}` ? null : `${lane.row}:${item.col}`)}
                      onRemove={() => remove(lane.row, item.col)}
                      onDragStart={() => dragStart(lane.row, index)}
                      onDragMove={(dy) => dragMove(lane.row, index, dy)}
                      onDragEnd={() => dragEnd(lane.row, index)}
                      adding={
                        addAfter === `${lane.row}:${item.col}`
                          ? paletteBox(
                              (b) => addAfterCard(lane, item.col, b.page),
                              `Tap a block to put it right after ${item.block.name}.`
                            )
                          : null
                      }
                    />
                  ) : (
                    <Press
                      caption={where(lane.row, item.col)}
                      label={picked ? `Put ${picked.name} here` : 'Empty'}
                      disabled={busy || !picked}
                      height={48}
                      onPress={() => add(lane.row, item.col)}
                    />
                  )}
                </View>
              )
            })}
          </View>
        )
      })}

      {/* ---------------------------------------------------- what to place */}
      <View style={{ gap: space.sm }}>
        <Label>Put a block in an empty space</Label>
        {paletteBox(
          (b) => setChoice(b.page === Number(choice) ? null : b.page),
          picked ? `Now tap an empty space to put ${picked.name} in it.` : 'Pick a block, then tap an empty space.'
        )}
      </View>
    </View>
  )
}

/**
 * One block in a lane: its name, a grip to drag it by, and Add and Remove
 * folded under it on a tap.
 *
 * "Remove the words What can I do with this from each of the block's name."
 * The card says what it is and no more; the line under the lane says how the
 * cards work, once.
 */
function BlockCard({
  block,
  at,
  busy,
  acting,
  lifted,
  adding,
  onToggleActions,
  onAdd,
  onRemove,
  onDragStart,
  onDragMove,
  onDragEnd
}) {
  const hue = blockColor(block.slug)
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: space.sm }}>
        <Press
          grow
          caption={at}
          label={block.name}
          on={lifted}
          tone="signal"
          style={{ borderLeftWidth: 4, borderLeftColor: hue.fill }}
          onPress={onToggleActions}
        />
        <Grip label={`Drag ${block.name}`} disabled={busy} onStart={onDragStart} onMove={onDragMove} onEnd={onDragEnd} />
      </View>
      {acting ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Press grow label="Add" sub="A new block after this one" height={48} disabled={busy} onPress={onAdd} />
          <Press grow label="Remove" sub="Delete this block" height={48} disabled={busy} onPress={onRemove} />
        </View>
      ) : null}
      {acting && adding ? adding : null}
    </View>
  )
}


/**
 * Modifiers — what makes a preset respond instead of sit still.
 *
 * A modifier attaches a source to a control: an envelope follower on drive so
 * it cleans up when you back off, an LFO on a filter, an expression pedal on
 * delay mix. Everything else this app writes is a static value; this is the
 * part that reacts to playing.
 *
 * NOT EVERY UNIT CAN BE TOLD TO DO THIS. An AM4 serves the modifier list and
 * reports the wire binding unsupported — the data is there, the binding is not.
 * So this reads the flag and says so in a sentence rather than drawing an
 * Attach button that cannot attach. It is the specific mistake the browser made
 * twice: once by guarding on a field the host has never served, and once by
 * returning nothing at all, which left a heading over blank space and read as
 * "broken" to everyone who opened it.
 *
 * Folded away until asked for. Four pickers and a button is most of a phone
 * screen, and this is the least-reached-for thing on the bench.
 */
function Modifiers({ blocks, onError }) {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState(undefined)
  const [slot, setSlot] = useState(1)
  const [eid, setEid] = useState(null)
  const [paramId, setParamId] = useState(null)
  const [source, setSource] = useState(null)
  const [params, setParams] = useState([])
  const [loading, setLoading] = useState(false)
  const [said, setSaid] = useState(null)

  /* Read on opening, not on mount: a fold nobody opens should cost nothing. */
  useEffect(() => {
    if (!open || model !== undefined) return undefined
    let stop = false
    ;(async () => {
      try {
        const m = await modifierModel()
        if (!stop) setModel(m?.error ? null : m)
      } catch {
        if (!stop) setModel(null)
      }
    })()
    return () => {
      stop = true
    }
  }, [open, model])

  useEffect(() => {
    if (eid === null) {
      setParams([])
      return undefined
    }
    let stop = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await blockParams(eid)
        if (!stop) setParams((res?.named || []).filter((p) => !isSilencingParam(p.name)))
      } catch (err) {
        if (!stop) onError(err.message)
      } finally {
        if (!stop) setLoading(false)
      }
    })()
    return () => {
      stop = true
    }
  }, [eid, onError])

  if (!open) {
    return <Press label="Modifiers" sub="Let a pedal or your playing move a control" onPress={() => setOpen(true)} />
  }

  const ready = eid !== null && paramId !== null && source !== null

  /*
   * What is still to pick, said beside the button rather than left to a
   * disabled button that says nothing.
   */
  const missing = [
    eid === null && 'a block',
    paramId === null && 'a control',
    source === null && 'a source'
  ].filter(Boolean)
  const why =
    missing.length === 0
      ? null
      : missing.length === 1
        ? `Pick ${missing[0]} to attach.`
        : `Pick ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]} to attach.`

  const attach = async () => {
    try {
      await bindModifier(Number(slot), Number(eid), Number(paramId), Number(source))
      const b = blocks.find((x) => sameBlock(x, Number(eid)))
      const p = params.find((x) => x.id === Number(paramId))
      const src = model.sources?.find((x) => x.ordinal === Number(source))
      setSaid(`${src?.name} now moves ${b?.name} ${p?.name}.`)
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <Label>Modifiers</Label>
        <Press label="Close" height={40} onPress={() => setOpen(false)} />
      </View>

      {model === undefined ? (
        <Note>Asking your unit what it can attach…</Note>
      ) : !model ? (
        <Note tone="warn">Couldn’t read the list of things to attach from your unit.</Note>
      ) : model.bindingSupported === false ? (
        <Note>
          This unit doesn’t let an app attach a modifier — the FM3 and larger units do. You can
          still set one up on the unit itself.
        </Note>
      ) : (
        <>
          <Text style={{ color: color.silkDim, fontSize: font.small, lineHeight: 20 }}>
            Attach a source to a control so it moves while you play — your picking on a drive, a
            pedal on delay mix.
          </Text>

          <Pick
            title="Slot"
            options={Array.from({ length: model.slotCount || 4 }, (_, i) => ({
              key: i + 1,
              label: String(i + 1)
            }))}
            chosen={slot}
            onPick={setSlot}
          />

          <Pick
            title="Block"
            options={blocks.map((b) => ({ key: idOf(b), label: b.name }))}
            chosen={eid}
            onPick={(k) => {
              setEid(k)
              setParamId(null)
            }}
          />

          <Pick
            title={loading ? 'Control — reading…' : 'Control'}
            options={params.map((p) => ({ key: p.id, label: p.name }))}
            chosen={paramId}
            onPick={setParamId}
            empty={eid === null ? 'Pick a block first.' : loading ? null : 'Nothing to attach to here.'}
          />

          <Pick
            title="Source"
            /* `ordinal`, not `value`. A source has never carried a `value`, and
               reading one gave the device a NaN where an ordinal belonged. */
            options={(model.sources || []).map((x) => ({ key: x.ordinal, label: x.name }))}
            chosen={source}
            onPick={setSource}
            empty={model.sourcesNote || 'This unit didn’t list any sources.'}
          />

          <Press label="Attach" tone="signal" on={ready} disabled={!ready} onPress={attach} />
          {why ? (
            <Text accessibilityLiveRegion="polite" style={{ color: color.silkDim, fontSize: font.small }}>
              {why}
            </Text>
          ) : null}
          {said ? <Note>{said}</Note> : null}
        </>
      )}
    </View>
  )
}

/**
 * One row of choices.
 *
 * A wrapped row of buttons rather than a dropdown: a phone's native picker is a
 * modal that covers the four other things you are in the middle of choosing,
 * and the whole point of this panel is that you can see all four at once.
 */
function Pick({ title, options, chosen, onPick, empty }) {
  return (
    <View style={{ gap: space.sm }}>
      <Label>{title}</Label>
      {options.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {options.map((o) => (
            <Press
              key={o.key}
              label={o.label}
              tone="signal"
              on={o.key === chosen}
              height={44}
              style={{ paddingHorizontal: space.md }}
              onPress={() => onPick(o.key)}
            />
          ))}
        </View>
      ) : empty ? (
        <Text style={{ color: color.silkDim, fontSize: font.small }}>{empty}</Text>
      ) : null}
    </View>
  )
}

/**
 * Find a control by name, across every block at once.
 *
 * "Where does the presence live" has one good answer per preset and this is it.
 * Typing three letters beats opening four blocks in turn to look — and on a
 * phone each of those is a round trip to the Mac, so it beats it by more.
 *
 * THE LIST IS NOT BUILT UNTIL SOMEBODY ASKS FOR IT. Building it means reading
 * every block's controls, one at a time, and each of those is a slow read that
 * can make the unit dump its preset over serial. A find box nobody touches must
 * not cost that, so nothing happens until two letters are typed.
 *
 * AND IT SAYS WHAT IT IS DOING WHILE IT DOES IT. Seven of those reads on a
 * relay is several seconds, and a search box that sits there for several
 * seconds with no explanation is a search box that looks broken. It counts them
 * off instead.
 *
 * Results navigate rather than edit. Tapping one opens that block with the
 * control marked, so there stays exactly one place in this app where a value
 * changes, with its verified write behind it. And the tap is the end of the
 * search: the keyboard goes, the results go with it, and the page is left to
 * the block that opened — with the results still up and the keyboard still
 * over the bottom half, the block opened somewhere nobody could see.
 */
function FindControl({ blocks, onPick, onError }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(() => indexFor(blocks))
  const [progress, setProgress] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const needle = query.trim()
  const hits = findControls(index, needle)

  const change = async (text) => {
    setQuery(text)
    if (text.trim().length < 2 || index) return
    const ready = indexFor(blocks)
    if (ready) {
      setIndex(ready)
      return
    }
    try {
      const built = await buildParamIndex(blocks, (done, total) => {
        if (alive.current) setProgress({ done, total })
      })
      if (alive.current) setIndex(built)
    } catch (err) {
      if (alive.current) onError(err.message)
    } finally {
      if (alive.current) setProgress(null)
    }
  }

  const reading = progress && progress.done < progress.total

  const pick = (eid, paramId) => {
    Keyboard.dismiss()
    setQuery('')
    onPick(eid, paramId)
  }

  return (
    <View style={{ gap: space.sm }}>
      <TextInput
        value={query}
        onChangeText={change}
        placeholder="Find a control — gain, mix, presence…"
        placeholderTextColor={color.silkFaint}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Find a control by name"
        style={{
          minHeight: TAP,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color.rule,
          backgroundColor: color.panel,
          color: color.silk,
          fontSize: font.body
        }}
      />

      {reading ? (
        <Text style={{ color: color.silkDim, fontSize: font.micro, fontFamily: face }}>
          {`Reading block ${progress.done + 1} of ${progress.total}…`}
        </Text>
      ) : null}

      {needle.length >= 2 && index ? (
        hits.length ? (
          <View style={{ gap: space.sm }}>
            {hits.map(({ block, param }) => (
              <Press
                key={`${idOf(block)}-${param.id}`}
                caption={block.name}
                label={param.name}
                sub={`${fmt(param.value)}${param.unit || ''}`}
                onPress={() => pick(idOf(block), param.id)}
              />
            ))}
          </View>
        ) : (
          <Note>{`No control called “${needle}” in this preset.`}</Note>
        )
      ) : null}
    </View>
  )
}

/** What a model is modelled on, in a sentence, or nothing when nobody recorded it. */
function gearLine(model) {
  if (!model) return null
  if (model.basedOn) return `Based on ${model.basedOn}`
  /*
   * Two verbs, because one sentence will not carry both. "Based on Mesa" is not
   * English — "based on" wants a thing, and an article does not save it.
   * "Modelled on Mesa" reads correctly for every maker in the catalog.
   */
  if (model.manufacturer) return `Modelled on ${model.manufacturer}`
  return null
}

/**
 * The number under a knob, and a way to just type it.
 *
 * A knob is right for sweeping; a thumb is wrong for landing on exactly 4.00.
 * Tap the number and type one — it commits through the same verified write the
 * knob uses, clamped to the control's own range, which is the rule the unit
 * applies to every write anyway.
 */
function ValueBox({ param, value, onCommit }) {
  const [text, setText] = useState(null)

  const finish = () => {
    if (text === null) return
    const n = Number(text.replace(',', '.').trim())
    setText(null)
    if (!Number.isFinite(n) || n === value) return
    const lo = typeof param.min === 'number' ? param.min : -Infinity
    const hi = typeof param.max === 'number' ? param.max : Infinity
    onCommit(Math.min(hi, Math.max(lo, n)))
  }

  return (
    <TextInput
      value={text !== null ? text : `${fmt(value)}${param?.unit ? ` ${param.unit}` : ''}`}
      onFocus={() =>
        /* The unit drops out, so typing replaces rather than appends to "6.70 dB". */
        setText(typeof value === 'number' ? String(Math.round(value * 100) / 100) : '')
      }
      onChangeText={setText}
      onBlur={finish}
      onSubmitEditing={finish}
      selectTextOnFocus
      keyboardType="numbers-and-punctuation"
      returnKeyType="done"
      accessibilityLabel={`${param?.name} value`}
      style={{
        width: '100%',
        minHeight: 32,
        textAlign: 'center',
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: color.rule,
        backgroundColor: color.panel,
        color: color.silk,
        fontSize: font.micro,
        fontFamily: face,
        paddingHorizontal: 2,
        paddingVertical: 2
      }}
    />
  )
}

/** A small heading over a group of controls. */
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
