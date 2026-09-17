import { useEffect, useRef, useState } from 'react'
import { Platform, ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { blockParams, blockTypes, idOf, sameBlock, setParamConfirmed, setType } from '../lib/device'
import { isSilencingParam } from '../lib/guardrails'
import { useRig, writeBypass, writeChannel } from '../lib/rig'
import { blockColor } from '../lib/blockColors'
import { shortBlock } from '../lib/shortName'
import { thud } from '../lib/feedback'
import Knob, { fmt } from '../components/Knob'
import Note from '../components/Note'
import Press from '../components/Press'
import Tile from '../components/Tile'

const face = Platform.select(mono)

const ofBlocks = (s) => s.allBlocks
const ofScene = (s) => s.sceneIndex
const ofSceneNames = (s) => s.sceneNames
const ofCaps = (s) => s.capabilities
const ofChain = (s) => s.chain

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
  const blocks = useRig(ofBlocks)
  const scene = useRig(ofScene)
  const sceneNames = useRig(ofSceneNames)
  const caps = useRig(ofCaps)
  const chain = useRig(ofChain)

  const [openEid, setOpenEid] = useState(null)
  const [error, setError] = useState(null)

  const block = blocks.find((b) => sameBlock(b, openEid)) || null

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
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
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      {error ? <Note tone="fault">{error}</Note> : null}

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
        <BlockPanel
          key={`${idOf(block)}:${block.channel || ''}:${scene}`}
          block={block}
          channels={caps?.channelNames}
          onError={setError}
        />
      ) : blocks.length ? (
        <Note>Tap a block to open its controls.</Note>
      ) : null}
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
function BlockPanel({ block, channels, onError }) {
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

  const valueOf = (p) => (local[p.id] !== undefined ? local[p.id] : p.value)

  const commit = async (p, override) => {
    const next = override !== undefined ? override : local[p.id]
    if (next === undefined || next === p.value) return
    try {
      const res = await setParamConfirmed(eid, p.id, next, p)
      if (!res.ok) onError(`${p.name} didn’t take.`)
      const fresh = await blockParams(eid)
      setParams(fresh?.named || [])
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
            sub={picking ? 'Close' : 'Tap to change'}
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
                  sub={m.basedOn || undefined}
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
            <View key={p.id} style={{ width: '30%', alignItems: 'center', gap: space.xs }}>
              <Knob
                param={p}
                label={p.name}
                value={valueOf(p)}
                onChange={(v) => setLocal((prev) => ({ ...prev, [p.id]: v }))}
                onCommit={() => commit(p)}
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
