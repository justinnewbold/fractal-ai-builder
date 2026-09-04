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
import ampTypes from '../data/amp-types.json'
import driveTypes from '../data/drive-types.json'
import cabTypes from '../data/cab-types.json'
import ampParams from '../data/amp-params.json'
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
 * GET /cab/irs, as the device serves it: bank name → a plain list of IR names.
 * Not objects, and not wrapped in anything.
 */
const IR_BANKS = {
  'Factory 1': cabTypes.map((c) => c.name),
  'Factory 2': cabTypes.slice(0, 40).map((c) => c.name),
  Scratchpad: []
}

/** Generic controls for blocks whose real parameter list wasn't captured. */
const GENERIC = [
  { id: 1, name: 'Level', value: 0, min: -80, max: 20, unit: 'dB' },
  { id: 2, name: 'Balance', value: 0, min: -100, max: 100, unit: '%' },
  { id: 3, name: 'Mix', value: 100, min: 0, max: 100, unit: '%' },
  { id: 7, name: 'Drive 1', value: 5, min: 0, max: 10 },
  { id: 8, name: 'Tone', value: 5, min: 0, max: 10 },
  { id: 9, name: 'Bass', value: 5, min: 0, max: 10 },
  { id: 10, name: 'Mid', value: 5, min: 0, max: 10 },
  { id: 11, name: 'Treble', value: 5, min: 0, max: 10 },
  { id: 12, name: 'Low Cut', value: 20, min: 20, max: 2000, log: true, unit: 'Hz' },
  { id: 13, name: 'High Cut', value: 20000, min: 200, max: 20000, log: true, unit: 'Hz' },
  { id: 20, name: 'Time', value: 0.5, min: 0.1, max: 10, unit: 's' }
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

export function createMockDevice() {
  const state = {
    presetNumber: 500,
    presetName: 'DEMO',
    scene: 0,
    sceneNames: storedSceneNames() || DEFAULT_SCENE_NAMES.slice(),
    // Bypass and channel both live per scene, not on the block — see sceneState.js.
    scenes: createSceneState({ count: 8, seeds: SCENE_SEEDS, channels: SCENE_CHANNELS }),
    blocks: LAYOUT.map((b, i) => ({
      slug: b.slug,
      name: b.name,
      effectId: b.effectId,
      col: b.col,
      row: 1,
      fromRows: i === 0 ? [] : [1],
      channel: b.channel || 'A'
    })),
    // Both keyed "effectId:channel", because that is where a value lives.
    params: new Map(),
    models: new Map(),
    stored: new Map([
      [0, 'Justin'],
      [1, 'Mia'],
      [500, 'DEMO']
    ])
  }

  for (const block of state.blocks) {
    state.params.set(`${block.effectId}:${block.channel}`, paramsFor(block.slug))
  }

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
      modelId: 17,
      name: 'FM3 (simulated)',
      short: 'FM3',
      gen: 3,
      supported: true,
      simulated: true,
      capabilities: {
        slotModel: 'grid',
        grid: GRID,
        hasScenes: true,
        sceneCount: 8,
        hasChannels: true,
        channelNames: ['A', 'B', 'C', 'D'],
        presets: { count: 512, canScanNames: false },
        cabIrs: true,
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

    blockCatalog: () =>
      LAYOUT.filter((l) => !['input', 'output'].includes(l.slug)).map((l) => ({
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

    presetSummary: (n) => ({
      number: n,
      name: state.stored.get(n) || '',
      blocks: state.blocks.filter((b) => !off(b.effectId)).map((b) => b.name)
    }),

    /*
     * GET /mod/model, in the device's shape: `slotCount` not `slots`,
     * `bindingSupported` not `bindable`, and sources keyed by `ordinal` —
     * the enum value the wire actually carries. The invented `value` meant
     * every source option rendered without one, so picking a source sent the
     * device NaN.
     */
    modModel: () => ({
      bindingSupported: true,
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
      keepSceneNames(state.sceneNames)
      return { ok: true }
    },

    tunerStream: () => createTunerStream()
  }
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
