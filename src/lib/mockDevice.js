/**
 * A simulated FM3.
 *
 * Built from data captured off a real unit — the 331 amp models, the drive and
 * cab rosters, and the amp block's actual 98 named parameters with their real
 * ranges and log flags.
 *
 * Two reasons this exists. Development shouldn't require sitting at the amp,
 * and more importantly the write semantics that cost an evening to discover are
 * reproduced here deliberately:
 *
 *   - writes take normalised 0-1, reads return real units
 *   - an out-of-range write does not error, it clamps and reports success
 *   - a model swap resets that block's parameters and can change their ranges
 *
 * That last set is the point. Every one of those failures looked like success
 * from the response alone, and none of them were catchable without hardware
 * until now.
 */
/*
 * With the attribute, as lineage.js already does. Vite is happy either way;
 * node is not, and without it this module — and everything that imports it,
 * which is the whole device layer — could only ever be checked by reading its
 * source. The write-and-read-back path is worth running rather than grepping.
 */
import ampTypes from '../data/amp-types.json' with { type: 'json' }
import driveTypes from '../data/drive-types.json' with { type: 'json' }
import cabTypes from '../data/cab-types.json' with { type: 'json' }
import ampParams from '../data/amp-params.json' with { type: 'json' }
import blockParams from '../data/block-params.json' with { type: 'json' }
import demoPresets from '../data/demo-presets.json' with { type: 'json' }
import { nameFor, scenesFor, presetsFor } from './factoryPresets.js'
import { unitByKey, DEFAULT_UNIT } from './demoUnits.js'
import { fromNormalized } from './scale.js'
import { createSceneState } from './sceneState.js'
import { storedSceneNames, keepSceneNames, DEFAULT_SCENE_NAMES } from './demoMemory.js'
import { createTunerStream } from './tunerStream.js'

const GRID = { rows: 4, cols: 12 }

/** Layout captured from a real preset. */
const LAYOUT = [
  { slug: 'input', name: 'Input 1', effectId: 37, col: 0 },
  { slug: 'comp', name: 'Comp 1', effectId: 46, col: 1, bypassed: true },
  { slug: 'wah', name: 'Wah 1', effectId: 94, col: 2, bypassed: true },
  { slug: 'drive', name: 'Drive 1', effectId: 118, col: 3 },
  { slug: 'amp', name: 'Amp 1', effectId: 58, col: 4, channel: 'C' },
  { slug: 'cab', name: 'Cab 1', effectId: 62, col: 5, channel: 'C' },
  { slug: 'delay', name: 'Delay 1', effectId: 70, col: 6, bypassed: true },
  { slug: 'reverb', name: 'Reverb 1', effectId: 66, col: 7, bypassed: true },
  { slug: 'output', name: 'Output 1', effectId: 42, col: 8 }
]

const ROSTERS = { amp: ampTypes, drive: driveTypes, cab: cabTypes }

/*
 * WHICH BLOCKS EACH UNIT'S DEMO CHAIN HOLDS.
 *
 * Every unit was built on the FM3's chain, which is where "the VP4 simulation
 * displayed Amp and Cab blocks" came from: the VP4 has no amp and no cab, and
 * the AM4 is not a grid at all but four slots in a row. The grid units — FM3,
 * FM9, Axe-Fx III — share a family and a layout, so they keep LAYOUT. The two
 * that are not get their own four slots, from the same blocks (the same
 * effect ids, so the scene seeds that name them still find them):
 *
 *   AM4 — drive, amp, delay, reverb. Its amp carries the cab; there is no
 *         separate Cab block.
 *   VP4 — compressor, drive, delay, reverb. Effects only.
 */
const LINEAR = {
  am4: ['drive', 'amp', 'delay', 'reverb'],
  vp4: ['comp', 'drive', 'delay', 'reverb']
}
const layoutFor = (unitKey) =>
  LINEAR[unitKey] ? LINEAR[unitKey].map((slug, col) => ({ ...LAYOUT.find((l) => l.slug === slug), col })) : LAYOUT

/*
 * What each scene switches off, by effect id. The first three are named —
 * Rhythm, Lead, Clean — and each is a pattern a player would recognise:
 * rhythm is drive into the amp with the time effects off; lead adds delay and
 * reverb and the compressor; clean drops the drive and keeps the reverb. The
 * rest start as rhythm. Scene 1 matches the LAYOUT flags, which the block
 * catalogue and the starter chain still read.
 */
const eid = (slug) => LAYOUT.find((l) => l.slug === slug).effectId
const SCENE_SEEDS = {
  default: LAYOUT.filter((l) => l.bypassed).map((l) => l.effectId),
  1: [eid('wah')],
  2: [eid('wah'), eid('drive'), eid('delay')]
}

/*
 * The other half of a scene: which channel each block plays there.
 *
 * Lead runs the amp on channel D and Clean on A, so the demo shows what the
 * hardware actually does — three sounds out of one amp block, not one amp with
 * pedals switched in front of it.
 */
const SCENE_CHANNELS = {
  1: { [eid('amp')]: 'D' },
  2: { [eid('amp')]: 'A' }
}

/*
 * THE TWELVE PRESETS THE DEMO PRETENDS THE UNIT IS HOLDING.
 *
 * Demo mode used to be one preset, one chain, and five hundred and eleven
 * empty slots — so every screen that reads a LIST was demonstrated empty,
 * which is the one thing a demo must not do. src/data/demo-presets.json is
 * twelve rigs with real models on them and four named scenes each.
 *
 * A preset is built the first time it is selected and then kept, so editing
 * one and coming back to it shows the edit — a demo that forgets is a demo
 * that looks broken.
 */
const SEEDS = new Map(demoPresets.presets.map((p) => [p.number, p]))



/** Where a seeded preset's blocks sit: signal order, one per column. */
const chainOf = (seed) =>
  seed.chain.map((slug, col) => {
    const known = LAYOUT.find((l) => l.slug === slug)
    return {
      slug,
      name: known.name,
      effectId: known.effectId,
      col,
      row: 1,
      fromRows: col === 0 ? [] : [1],
      channel: seed.scenes[0]?.channels?.[slug] || known.channel || 'A'
    }
  })

/** A seed's scenes as the engine wants them: off-lists and channels by effect id. */
function sceneStateOf(seed, blocks) {
  const idOfSlug = (slug) => blocks.find((b) => b.slug === slug)?.effectId
  const seeds = {}
  const channels = {}
  seed.scenes.forEach((scene, i) => {
    seeds[i] = scene.off.map(idOfSlug).filter((n) => Number.isInteger(n))
    const per = {}
    for (const [slug, ch] of Object.entries(scene.channels || {})) {
      const id = idOfSlug(slug)
      if (Number.isInteger(id)) per[id] = ch
    }
    if (Object.keys(per).length) channels[i] = per
  })
  /* Scenes past the seeded four sit as the first one does, which is what an
     untouched scene on the hardware looks like. */
  seeds.default = seeds[0] || []
  return { seeds, channels }
}

/*
 * GET /cab/irs, as the device serves it: bank name → a plain list of IR names.
 * Not objects, and not wrapped in anything.
 */
const IR_BANKS = {
  'Factory 1': cabTypes.map((c) => c.name),
  'Factory 2': cabTypes.slice(0, 40).map((c) => c.name),
  Scratchpad: []
}

/*
 * Only what every Fractal block has, for a block whose real list was never
 * read. It used to be an amp's tone stack — Drive, Tone, Bass, Mid, Treble —
 * on every block, so the demo's Delay and Reverb showed an amp's knobs:
 * "Users could believe they are editing real device parameters when the app
 * is displaying unrelated controls." The blocks in the demo's chains all have
 * their real lists now (data/block-params.json); this is for anything placed
 * from the palette that has not been read yet.
 */
const GENERIC = [
  { id: 1, name: 'Level', value: 0, min: -80, max: 20, unit: 'dB' },
  { id: 2, name: 'Balance', value: 0, min: -100, max: 100, unit: '%' },
  { id: 3, name: 'Mix', value: 100, min: 0, max: 100, unit: '%' }
]

function clone(x) {
  return JSON.parse(JSON.stringify(x))
}

/*
 * The shape ForgeFX actually serves from /ports: one `ports` list carrying
 * both transports, each entry flagged, plus the chosen connection. The
 * invented `serial` / `midiIn` / `midiOut` split that used to be here is why
 * the picker read an always-undefined field and told everyone their unit
 * wasn't plugged in.
 */
const SERIAL_PORTS = {
  chosen: { transport: 'serial', id: '/dev/cu.usbmodem1104' },
  override: null,
  profileOverride: null,
  profile: { key: 'fm3', name: 'FM3', model: '0x11' },
  ports: [
    { transport: 'serial', id: '/dev/cu.usbmodem1104', label: '/dev/cu.usbmodem1104 · FM3', fractal: true, model: 'FM3' },
    { transport: 'serial', id: '/dev/cu.usbmodem2201', label: '/dev/cu.usbmodem2201 · AM4', fractal: true, model: 'AM4' },
    { transport: 'serial', id: '/dev/cu.Bluetooth-Incoming-Port', label: '/dev/cu.Bluetooth-Incoming-Port', fractal: false },
    { transport: 'midi', id: 'FM3 MIDI In', label: 'FM3 MIDI In', fractal: true, dir: 'input' },
    { transport: 'midi', id: 'FM3 MIDI Out', label: 'FM3 MIDI Out', fractal: true, dir: 'output' }
  ]
}

/*
 * The same route with the unit on MIDI and nothing on a serial port: an AM4
 * over USB-MIDI. Its input and output are separate endpoints under one name,
 * which is why the panel used to say "Also reachable over MIDI: AM4, AM4".
 */
const MIDI_PORTS = {
  chosen: { transport: 'midi', id: 'AM4', inId: 'AM4', outId: 'AM4' },
  override: null,
  profileOverride: null,
  profile: { key: 'am4', name: 'AM4', model: '0x10' },
  ports: [
    { transport: 'midi', id: 'AM4', label: 'AM4', fractal: true, model: 'AM4', dir: 'input' },
    { transport: 'midi', id: 'AM4', label: 'AM4', fractal: true, model: 'AM4', dir: 'output' },
    { transport: 'midi', id: 'IAC Driver Bus 1', label: 'IAC Driver Bus 1', fractal: false, dir: 'input' },
    { transport: 'midi', id: 'IAC Driver Bus 1', label: 'IAC Driver Bus 1', fractal: false, dir: 'output' }
  ]
}

const midiCarried = () => {
  try {
    return localStorage.getItem('forgefx.demo.midi') === '1'
  } catch {
    return false
  }
}

/**
 * @param {string} [unitKey] which Fractal to pretend to be — see demoUnits.js.
 *   Anything unrecognised is the FM3, because a mock that cannot say what it
 *   is cannot draw a screen either.
 */
export function createMockDevice(unitKey = DEFAULT_UNIT) {
  const unit = unitByKey(unitKey)
  const UNIT = unit.key
  /*
   * THE TWELVE HAND-BUILT PRESETS ARE FM3 PRESETS, so they only appear on the
   * FM3. They are an FM3 chain with FM3 amp and cab numbers in it, and
   * "Drop D Chug" is not a name anybody's AM4 has ever shown. Putting them on
   * every unit would undo the whole point of the other four banks: a demo you
   * can check against the thing on your desk.
   *
   * On the other units every slot is the factory bank, and the rigs behind
   * them are the generic chain — which is honest about what this knows. The
   * names and the scenes are real; the blocks are the simulation's own.
   */
  /* `rigSeeds`, not `seeds`: buildRig destructures a local `seeds` out of
     sceneStateOf, and the two names in one scope is a temporal-dead-zone
     error at the first preset load rather than anything visible here. */
  const rigSeeds = unit.key === DEFAULT_UNIT ? SEEDS : new Map()
  /*
   * THE DEMO OPENS ON THE FIRST PRESET THE UNIT REALLY SHIPS WITH.
   *
   * "In demo mode, can we set it up so that it starts at preset one... and
   * that that is the one that loads first in the demo is whatever's on preset
   * one across all five demo units."
   *
   * It opened on 500 — a slot outside the factory bank, invented here and
   * named DEMO. Two things were wrong with that. It is not a preset anybody's
   * unit has, which is the one promise this demo makes; and it put the picker
   * five hundred rows down a list of 512, so the first thing anybody did on
   * opening it was scroll back to the top.
   *
   * Read off the bank rather than written as 0, so it stays the first preset
   * if a unit's bank ever starts somewhere else. All five start at 0 today —
   * "59 Bassguy" on the three grid units, "AM4 Gig Rig", "Virtual Pedalboard"
   * — and each is that unit's own, which is the point of five banks.
   */
  const firstPreset = presetsFor(UNIT).find((p) => p.name)?.number ?? 0
  const state = {
    presetNumber: firstPreset,
    presetName: '',
    scene: 0,
    sceneNames: [],
    // Bypass and channel both live per scene, not on the block — see sceneState.js.
    scenes: null,
    blocks: [],
    // Both keyed "effectId:channel", because that is where a value lives.
    params: null,
    models: null,
    /*
     * The names the unit would report for its slots.
     *
     * THE REAL FACTORY BANK, not twelve presets and 500 blanks. "Here are all
     * the preset names and scene names for all of the current fractal units
     * for you to put in the demos" — so an FM3 in the demo holds the 384 it
     * actually ships with, in the slots it ships them in. Somebody trying
     * this before they buy is comparing it against the unit on their desk,
     * and a list sharing no names with theirs is one they cannot check.
     *
     * The twelve hand-built presets keep their own names, ON TOP of the
     * factory ones, because those are the slots with a real chain, real
     * models and scenes that differ — they are what the Edit screen is
     * demonstrating. A factory name over a chain that is not that preset's
     * would be worse than either.
     *
     * Past 384 the slots are genuinely empty, which is what they are on the
     * unit: a demo with 512 full slots is its own kind of lie.
     */
    stored: new Map(
      presetsFor(UNIT)
        .filter((p) => p.name)
        .map((p) => [p.number, p.name])
        .concat([...rigSeeds.values()].map((seed) => [seed.number, seed.name]))
        .concat([[500, 'DEMO']])
    )
  }

  /*
   * One working rig per preset, built on first visit and kept after.
   *
   * state.blocks and its neighbours POINT AT the rig rather than copying it,
   * so every existing write in this file — a bypass, a model swap, a knob —
   * lands on the preset it was made on and is still there on the way back.
   */
  const rigs = new Map()

  function buildRig(number) {
    const seed = rigSeeds.get(number)
    const blocks = seed
      ? chainOf(seed)
      : layoutFor(UNIT).map((b, i) => ({
          slug: b.slug,
          name: b.name,
          effectId: b.effectId,
          col: b.col,
          row: 1,
          fromRows: i === 0 ? [] : [1],
          channel: b.channel || 'A'
        }))

    const { seeds, channels } = seed
      ? sceneStateOf(seed, blocks)
      : { seeds: SCENE_SEEDS, channels: SCENE_CHANNELS }

    const rig = {
      blocks,
      params: new Map(),
      models: new Map(),
      /* The unit's own scene count. An AM4 has four, and eight tiles on a
         four-scene unit is the demo teaching something untrue. */
      scenes: createSceneState({ count: unit.scenes, seeds, channels }),
      /*
       * A renamed scene wins, then the hand-built preset's own four, then the
       * real factory names for that slot — see factoryPresets.js. An unnamed
       * factory scene comes back as "Scene 5", which is what the unit shows;
       * only a slot with nothing in it falls through to the defaults.
       */
      sceneNames:
        storedSceneNames(number) ||
        (seed
          ? seed.scenes.map((sc) => sc.name).concat(['', '', '', '']).slice(0, unit.scenes)
          : scenesFor(UNIT, number) || DEFAULT_SCENE_NAMES.slice(0, unit.scenes))
    }

    for (const block of blocks) {
      rig.params.set(`${block.effectId}:${block.channel}`, paramsFor(block.slug))
    }

    /* The models and the levels the seed asked for, applied through the same
       maps a real edit writes to — so a seeded sound and an edited one are
       indistinguishable from here down. */
    if (seed) {
      for (const [kind, value] of Object.entries(seed.models)) {
        const block = blocks.find((b) => b.slug === kind)
        if (block) rig.models.set(`${block.effectId}:${block.channel}`, value)
      }
      const setLevel = (slug, ch, level) => {
        const block = blocks.find((b) => b.slug === slug)
        if (!block) return
        const key = `${block.effectId}:${ch || block.channel}`
        if (!rig.params.has(key)) rig.params.set(key, paramsFor(block.slug))
        const named = rig.params.get(key).find((x) => x.name === 'Amp1 Level' || x.name === 'Level')
        if (named) named.value = Math.max(named.min, Math.min(named.max, level))
      }

      /* What the scenes cannot switch: one setting for the whole preset. */
      for (const [slug, level] of Object.entries(seed.levels || {})) setLevel(slug, null, level)

      /*
       * And what they can. A level belongs to a CHANNEL, so a scene only has a
       * level of its own because it selects a channel of its own — see the
       * note in demo-presets.json about the draft where two scenes shared a
       * channel and the second one's level quietly won.
       */
      for (const scene of seed.scenes) {
        for (const [slug, level] of Object.entries(scene.levels || {})) {
          setLevel(slug, scene.channels?.[slug], level)
        }
      }
    }
    return rig
  }

  /** Point the live state at a preset's rig, building it if this is the first visit. */
  function loadRig(number) {
    if (!rigs.has(number)) rigs.set(number, buildRig(number))
    const rig = rigs.get(number)
    state.blocks = rig.blocks
    state.params = rig.params
    state.models = rig.models
    state.scenes = rig.scenes
    state.sceneNames = rig.sceneNames
  }

  loadRig(state.presetNumber)
  state.presetName = state.stored.get(state.presetNumber) || ''

  /** Whether a block is off in the scene the unit is in. */
  const off = (effectId) => state.scenes.isOff(state.scene, effectId)

  /**
   * Which channel a block is playing right now — the scene's choice if it has
   * one, otherwise the channel it was placed on.
   */
  const chan = (effectId) =>
    state.scenes.channelOf(state.scene, effectId) ||
    state.blocks.find((b) => b.effectId === effectId)?.channel ||
    'A'

  /*
   * Values and models belong to a block's channel, not to the block. A channel
   * nobody has visited starts as a copy of the one the block was placed on,
   * which is close enough to how a unit behaves and is what makes "the lead
   * scene has a hotter amp" something a person can actually try in the demo.
   */
  const paramsOf = (eid) => {
    const key = `${eid}:${chan(eid)}`
    if (!state.params.has(key)) {
      const block = state.blocks.find((b) => b.effectId === eid)
      const from = state.params.get(`${eid}:${block?.channel || 'A'}`)
      state.params.set(key, from ? clone(from) : paramsFor(block?.slug))
    }
    return state.params.get(key)
  }

  /** The model this block is on, in this channel. */
  const typeOf = (eid) => {
    const key = `${eid}:${chan(eid)}`
    if (!state.models.has(key)) {
      const block = state.blocks.find((b) => b.effectId === eid)
      state.models.set(key, state.models.get(`${eid}:${block?.channel || 'A'}`) ?? 0)
    }
    return state.models.get(key)
  }

  function paramsFor(slug) {
    if (slug === 'amp') {
      return clone(ampParams.named).map((p) => ({ ...p, log: !!p.log }))
    }
    /* The block's own controls, as a real FM3 reported them. */
    const real = blockParams.blocks[slug]
    if (real) return clone(real.named).map((p) => ({ ...p, log: !!p.log }))
    return clone(GENERIC)
  }

  /**
   * Model swaps reset parameters and shift ranges. Amp models genuinely differ
   * in the span their low cut covers, and normalising against the pre-swap
   * range is one of the ways a value silently lands on an end stop.
   */
  function applyModelSwap(eid, slug, value) {
    const fresh = paramsFor(slug)
    const shift = (value % 3) - 1
    for (const p of fresh) {
      if (p.log && shift !== 0) {
        p.min = Math.max(1, Math.round(p.min * (shift > 0 ? 2 : 0.5)))
        p.max = Math.round(p.max * (shift > 0 ? 2 : 0.5))
        p.value = p.min
      }
    }
    state.params.set(`${eid}:${chan(eid)}`, fresh)
  }

  return {
    isMock: true,

    healthz: () => ({ ok: true, api: { version: 2 }, device: 'FM3 (simulated)' }),

    detect: () => ({
      connected: true,
      name: `${unit.name} (simulated)`,
      short: unit.name,
      gen: 3,
      supported: true,
      simulated: true,
      capabilities: {
        /*
         * An AM4 and a VP4 are a chain of four blocks and report no grid, so
         * the app must not be told they have one — "grid ×" with nothing
         * either side of it is not a fact about a unit. See demoUnits.js.
         *
         * 'linear', NOT 'chain', and the difference was a whole broken screen.
         *
         * This mock invented the word. Four places in the app ask
         * `slotModel === 'linear'` — grid-plan's gridShape, slots.js's
         * isLinearChain at both ends, and the meter on the play screen — and
         * all four were written on 17 September against what ForgeFX really
         * reports. This line arrived on the 19th with the five demo units and
         * said 'chain', which matches nothing, so every one of those checks
         * quietly answered "no, it is a grid".
         *
         * What that looked like on a handset: a VP4 drawn as a 4x12 grid with
         * ROW 2, COLUMN 1 over a unit that has neither rows nor columns.
         *
         *   "My Demo version is saying it failed to read blocks."
         *
         * Which is exactly the fault the note further down this file warns
         * about: a mock that invents its own shapes makes the broken path the
         * only one anybody tests. A real AM4 was always fine; only the demo
         * was wrong, and the demo is what somebody judges this app by.
         */
        slotModel: unit.grid ? 'grid' : 'linear',
        ...(unit.grid ? { grid: unit.grid } : {}),
        hasScenes: true,
        sceneCount: unit.scenes,
        hasChannels: true,
        channelNames: unit.channels,
        presets: { count: unit.slots, canScanNames: false },
        /* No cab block on a VP4, so no impulse responses to offer either. */
        cabIrs: unit.amps,
        tuner: true,
        supportsSave: false
      },
      port: 'simulated'
    }),

    preset: () => ({ number: state.presetNumber, name: state.presetName }),

    presetBlocks: () =>
      state.blocks.map((b) => ({
        slug: b.slug,
        name: b.name,
        effectId: b.effectId,
        row: b.row,
        col: b.col,
        fromRows: b.fromRows,
        bypassed: off(b.effectId),
        channel: chan(b.effectId)
      })),

    blockParams: (eid) => {
      const block = state.blocks.find((b) => b.effectId === eid)
      if (!block) return { block: '', slug: '', page: -1, named: [], enums: [], type: null }
      // `type` is how the device says which model this block is on. It is the
      // only place that answers it — /preset/blocks does not carry a typeName,
      // which is why the model picker showed "331 models…" and never a model.
      const roster = ROSTERS[block.slug] || []
      const chosen = roster.find((m) => m.value === typeOf(eid)) || roster[0] || null
      return {
        block: block.name,
        slug: block.slug,
        page: eid,
        named: clone(paramsOf(eid)),
        enums: [],
        type: chosen ? { value: chosen.value, name: chosen.name } : null
      }
    },

    blockTypes: (slug) => clone(ROSTERS[slug] || []),

    /** Normalised in, clamped silently, stored as real units. */
    setParam: (eid, paramId, norm) => {
      const list = paramsOf(eid)
      const param = list?.find((p) => p.id === paramId)
      if (!param) return { ok: true } // the device doesn't complain either
      const clamped = Math.max(0, Math.min(1, norm))
      param.value = round3(fromNormalized(clamped, param))
      param.norm = clamped
      return { ok: true }
    },

    setType: (eid, value) => {
      const block = state.blocks.find((b) => b.effectId === eid)
      if (block) {
        // The model belongs to the channel this scene is playing, so switching
        // the lead scene's amp to a different model leaves the rhythm one be.
        state.models.set(`${eid}:${chan(eid)}`, value)
        applyModelSwap(eid, block.slug, value)
      }
      return { ok: true }
    },

    /* Per scene, like the hardware: a bypass written in scene 2 is scene 2's. */
    setBypass: (eid, bypassed) => {
      if (state.blocks.some((b) => b.effectId === eid)) state.scenes.set(state.scene, eid, !!bypassed)
      return { ok: true }
    },

    /* Per scene too: the channel a scene plays is part of what the scene is. */
    setChannel: (eid, channel) => {
      if (state.blocks.some((b) => b.effectId === eid))
        state.scenes.setChannel(state.scene, eid, channel)
      return { ok: true }
    },

    selectPreset: (number) => {
      state.presetNumber = number
      state.presetName = state.stored.get(number) || ''
      loadRig(number)
      return { ok: true }
    },

    /*
     * The gen-3 stub, reproduced deliberately.
     *
     * ForgeFX answers GET /presets/{n} on every gen-3 unit with an empty name,
     * because the firmware has no query for a stored name — 200 OK and nothing
     * in it. This mock used to answer with the real name, so the preset list
     * looked right in demo and showed 512 empties on an actual FM3. The name
     * lives in the dump, and presetSummary is where it comes from.
     */
    presetName: (number) => ({ number, name: '' }),

    /*
     * ...AND THE WAY ROUND IT, which the demo needs and hardware does not.
     *
     * The stub above is right: a gen-3 unit genuinely cannot answer "what is
     * the name of slot 41" and the mock must not pretend otherwise. On real
     * hardware the phone gets the names from the COMPUTER instead — the
     * browser at the cable reads them in the background and files them, and
     * device.storedNames fetches that file in one request.
     *
     * The demo has no computer, so that read returned null and the per-slot
     * read returned '' — which left the phone's preset list showing 512 rows
     * of "Empty" with a real bank sitting right here. "All presets are blank
     * in the demo."
     *
     * This is the demo's answer to the same question the computer's file
     * answers: every name this unit would report, in one go. Slot number to
     * name, exactly the shape storedNames already returns.
     */
    storedNames: () => Object.fromEntries(state.stored),

    setPresetName: (name) => {
      state.presetName = name
      return { ok: true }
    },

    storePreset: (number) => {
      state.stored.set(number, state.presetName)
      return { ok: true }
    },

    setEnum: (eid, paramId, ordinal) => {
      const list = paramsOf(eid)
      const param = list?.find((p) => p.id === paramId)
      if (param) param.value = ordinal
      return { ok: true }
    },

    /*
     * The shape ForgeFX actually serves.
     *
     * This used to invent `mode: 'STEREO'` and `slots[].bank/ir/name` — flat
     * strings and numbers that read beautifully in demo and exist nowhere on a
     * real unit, which serves `mode` and `bank` as {value,label} objects and
     * the IR as irIndex/irName. The panel therefore handed React an object as a
     * child and threw, on hardware only. A mock that invents its own shapes is
     * worse than no mock: it makes the broken path the only one anyone tests.
     */
    cabState: (eid) => {
      const banks = Object.keys(IR_BANKS)
      const names = IR_BANKS[banks[0]] || []
      return {
        modeParam: 31,
        mode: { value: 1, label: 'Stereo' },
        modeOptions: [
          { value: 0, label: 'Mono' },
          { value: 1, label: 'Stereo' }
        ],
        bankOptions: banks,
        dynaOptions: [{ value: 0, label: 'None' }],
        slots: [
          {
            slot: 1,
            bankParam: 1,
            irParam: 4,
            dynaParam: 85,
            bank: { value: 0, label: banks[0] },
            irIndex: 12,
            irName: names[12] || '#12',
            dyna: { value: 0, label: 'None' }
          },
          {
            slot: 2,
            bankParam: 2,
            irParam: 5,
            dynaParam: 86,
            bank: { value: 0, label: banks[0] },
            irIndex: 34,
            irName: names[34] || '#34',
            dyna: { value: 0, label: 'None' }
          }
        ],
        eid
      }
    },

    /* GET /cab/irs is a bare bank→names map. There is no `banks` wrapper; the
       one this mock used to add is why the IR count line never appeared. */
    irs: () => clone(IR_BANKS),

    backup: (location) => ({
      location: location ?? state.presetNumber,
      name: state.presetName,
      // A plausible SysEx envelope: F0 00 01 74 11 ... F7
      bytes: [0xf0, 0x00, 0x01, 0x74, 0x11, 0x01, ...Array(64).fill(0x00), 0xf7]
    }),

    loadBytes: () => ({ ok: true, loaded: true }),

    /*
     * GET /preset/monitors/live, in the shape the device answers with:
     * one row per monitored parameter, not one per block, and the level is
     * `norm` — not `level`, which never existed. Reading the invented names
     * gave every meter a blank label, a zero-width bar and an undefined React
     * key, on hardware, forever.
     */
    meters: () =>
      state.blocks
        .filter((b) => !off(b.effectId) && !['input'].includes(b.slug))
        .map((b) => {
          const norm = Math.random() * 0.7 + 0.15
          return {
            effectId: b.effectId,
            family: b.slug.toUpperCase(),
            paramName: b.slug === 'output' ? 'Output VU' : `${b.name} Level`,
            role: 'level',
            norm,
            db: Math.round((norm * 80 - 80) * 10) / 10,
            minDb: -80,
            maxDb: 0
          }
        }),

    /*
     * Which shape /ports answers with.
     *
     * A unit reached over USB-MIDI with nothing on a serial port is a real and
     * common setup — it is how an AM4 usually arrives — and this device could
     * not produce it, so the connection panel's behaviour there was untestable
     * without hardware. It opened with "No Fractal units found on a serial
     * port" while the bar above it said the unit was connected.
     */
    ports: () => clone(midiCarried() ? MIDI_PORTS : SERIAL_PORTS),

    /* Only what this unit could place: no amp on a VP4, and no separate cab
       on a unit whose amp carries its own — the AM4 and the VP4. */
    blockCatalog: () =>
      LAYOUT.filter(
        (l) =>
          !['input', 'output'].includes(l.slug) &&
          !(l.slug === 'amp' && !unit.amps) &&
          !(l.slug === 'cab' && !unit.grid)
      ).map((l) => ({
        slug: l.slug,
        family: l.slug,
        instance: 1,
        name: l.name,
        page: l.effectId,
        paramCount: 0,
        typeCount: 0
      })),

    placeBlock: (row, col, blockId) => {
      const existing = state.blocks.findIndex((b) => b.row === row && b.col === col)
      if (blockId === 0) {
        if (existing >= 0) state.blocks.splice(existing, 1)
        return { ok: true }
      }
      const known = LAYOUT.find((l) => l.effectId === blockId)
      const block = {
        slug: known?.slug || 'unknown',
        name: known?.name || `Block ${blockId}`,
        effectId: blockId,
        row,
        col,
        fromRows: [row],
        channel: 'A',
        type: 0
      }
      if (existing >= 0) state.blocks[existing] = block
      else state.blocks.push(block)
      // A block just placed is on in every scene.
      state.scenes.forget(blockId)
      if (!state.params.has(`${blockId}:A`))
        state.params.set(`${blockId}:A`, paramsFor(block.slug))
      return { ok: true }
    },

    grid: () => ({
      rows: GRID.rows,
      cols: GRID.cols,
      cells: state.blocks.map((b) => ({ row: b.row, col: b.col, effectId: b.effectId, name: b.name }))
    }),

    versions: () => ({
      versions: [
        { id: 'v1', location: 500, name: 'DEMO', at: Date.now() - 3600_000, label: 'Before edit' },
        { id: 'v2', location: 500, name: 'DEMO', at: Date.now() - 600_000, label: 'After metal pass' }
      ]
    }),

    /*
     * What slot n holds, WITHOUT going there.
     *
     * This used to answer with the chain of whatever preset was loaded, for
     * every n, which was invisible while the demo had one preset and wrong the
     * moment it had twelve: the list would have shown every slot holding the
     * same blocks. It reads the asked-for preset's own rig, building it if
     * nobody has visited it — which is what a summary is for.
     */
    presetSummary: (n) => {
      const name = state.stored.get(n) || ''
      if (n === state.presetNumber)
        return { number: n, name, blocks: state.blocks.filter((b) => !off(b.effectId)).map((b) => b.name) }
      /* A factory slot nobody has built a rig for: the name is real and the
         block list is genuinely unknown until it is loaded, which is what an
         empty array says. */
      if (!rigSeeds.has(n)) return { number: n, name, blocks: [] }
      /* Another slot, so there is no scene to be in: scene one, the one it
         would load on. */
      if (!rigs.has(n)) rigs.set(n, buildRig(n))
      const rig = rigs.get(n)
      return {
        number: n,
        name,
        blocks: rig.blocks.filter((b) => !rig.scenes.isOff(0, b.effectId)).map((b) => b.name)
      }
    },

    /*
     * GET /mod/model, in the device's shape: `slotCount` not `slots`,
     * `bindingSupported` not `bindable`, and sources keyed by `ordinal` —
     * the enum value the wire actually carries. The invented `value` meant
     * every source option rendered without one, so picking a source sent the
     * device NaN.
     */
    modModel: () => ({
      /*
       * The AM4 serves the modifier data and reports the wire binding
       * unsupported — the data is there, the binding is not. The demo said
       * "supported" whichever unit it was pretending to be, so the one screen
       * that behaves differently between the two could not be seen in it.
       */
      bindingSupported: !midiCarried(),
      effectId: 190,
      slotCount: 4,
      fields: { source: { pid: 0 }, targetEffectId: { pid: 8 }, targetParam: { pid: 9 } },
      sources: [
        { ordinal: 0, name: 'None' },
        { ordinal: 1, name: 'LFO 1' },
        { ordinal: 2, name: 'LFO 2' },
        { ordinal: 3, name: 'ADSR 1' },
        { ordinal: 4, name: 'Envelope' },
        { ordinal: 5, name: 'Expression 1' },
        { ordinal: 6, name: 'External 1' }
      ]
    }),

    bindModifier: () => ({ ok: true }),

    /* The same store the chain is drawn from, so the scene map and Play agree. */
    sceneStateNow: () =>
      state.blocks
        .filter((b) => !['input', 'output'].includes(b.slug))
        .map((b) => ({
          effectId: b.effectId,
          bypassed: off(b.effectId),
          channel: chan(b.effectId)
        })),

    /* Every scene's channel for every block, by effect id — what the chat's
       plan check uses to say which scenes a value write reaches. */
    sceneChannelsNow: () =>
      Object.fromEntries(
        state.blocks
          .filter((b) => !['input', 'output'].includes(b.slug))
          .map((b) => [
            b.effectId,
            Array.from(
              { length: state.scenes.count },
              (_, i) => state.scenes.channelOf(i, b.effectId) || b.channel || 'A'
            )
          ])
      ),

    tempo: () => ({ bpm: state.bpm ?? 120 }),
    setTempo: (bpm) => {
      state.bpm = bpm
      return { ok: true }
    },
    /*
     * Like the hardware: a tap registers, the tempo is computed from the
     * spacing between taps, and the answer is only {ok} — reading the result
     * is the client's job (the real /tempo/tap returns no bpm either, which is
     * exactly the contract that made the Tap button look broken).
     */
    tapTempo: () => {
      const now = Date.now()
      const gap = state.lastTapAt ? now - state.lastTapAt : null
      state.lastTapAt = now
      // 150ms..3s covers 20-400 BPM; outside that it's a first tap, not a beat.
      if (gap && gap >= 150 && gap <= 3000) {
        state.bpm = Math.max(20, Math.min(400, Math.round(60000 / gap)))
      }
      return { ok: true }
    },

    getScene: () => ({ index: state.scene, names: state.sceneNames.slice() }),

    setScene: (index) => {
      state.scene = index
      return { ok: true }
    },

    setSceneName: (index, name) => {
      state.sceneNames[index] = name
      keepSceneNames(state.presetNumber, state.sceneNames)
      return { ok: true }
    },

    tunerStream: () => createTunerStream()
  }
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
