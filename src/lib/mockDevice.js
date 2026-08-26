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

export function createMockDevice() {
  const state = {
    presetNumber: 500,
    presetName: 'DEMO',
    scene: 0,
    sceneNames: ['Rhythm', 'Lead', 'Clean', '', '', '', '', ''],
    blocks: LAYOUT.map((b, i) => ({
      ...b,
      row: 1,
      fromRows: i === 0 ? [] : [1],
      bypassed: !!b.bypassed,
      channel: b.channel || 'A',
      type: 0
    })),
    params: new Map(),
    stored: new Map([
      [0, 'Justin'],
      [1, 'Mia'],
      [500, 'DEMO']
    ])
  }

  for (const block of state.blocks) {
    state.params.set(block.effectId, paramsFor(block.slug))
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
    state.params.set(eid, fresh)
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
        bypassed: b.bypassed,
        channel: b.channel
      })),

    blockParams: (eid) => {
      const block = state.blocks.find((b) => b.effectId === eid)
      if (!block) return { block: '', slug: '', page: -1, named: [], enums: [] }
      return {
        block: block.name,
        slug: block.slug,
        page: eid,
        named: clone(state.params.get(eid) || []),
        enums: []
      }
    },

    blockTypes: (slug) => clone(ROSTERS[slug] || []),

    /** Normalised in, clamped silently, stored as real units. */
    setParam: (eid, paramId, norm) => {
      const list = state.params.get(eid)
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
        block.type = value
        applyModelSwap(eid, block.slug, value)
      }
      return { ok: true }
    },

    setBypass: (eid, bypassed) => {
      const block = state.blocks.find((b) => b.effectId === eid)
      if (block) block.bypassed = bypassed
      return { ok: true }
    },

    setChannel: (eid, channel) => {
      const block = state.blocks.find((b) => b.effectId === eid)
      if (block) block.channel = channel
      return { ok: true }
    },

    selectPreset: (number) => {
      state.presetNumber = number
      state.presetName = state.stored.get(number) || ''
      return { ok: true }
    },

    presetName: (number) => ({ number, name: state.stored.get(number) || '' }),

    setPresetName: (name) => {
      state.presetName = name
      return { ok: true }
    },

    storePreset: (number) => {
      state.stored.set(number, state.presetName)
      return { ok: true }
    },

    setEnum: (eid, paramId, ordinal) => {
      const list = state.params.get(eid)
      const param = list?.find((p) => p.id === paramId)
      if (param) param.value = ordinal
      return { ok: true }
    },

    cabState: (eid) => ({
      eid,
      mode: 'STEREO',
      slots: [
        { slot: 1, bank: 'Factory 1', ir: 12, name: '4x12 5153' },
        { slot: 2, bank: 'Factory 1', ir: 34, name: '4x12 CITRUS' }
      ]
    }),

    irs: () => ({
      banks: {
        'Factory 1': cabTypes.map((c) => ({ value: c.value, name: c.name })),
        Scratchpad: []
      }
    }),

    backup: (location) => ({
      location: location ?? state.presetNumber,
      name: state.presetName,
      // A plausible SysEx envelope: F0 00 01 74 11 ... F7
      bytes: [0xf0, 0x00, 0x01, 0x74, 0x11, 0x01, ...Array(64).fill(0x00), 0xf7]
    }),

    loadBytes: () => ({ ok: true, loaded: true }),

    meters: () =>
      state.blocks
        .filter((b) => !b.bypassed)
        .map((b) => ({
          eid: b.effectId,
          name: b.name,
          level: Math.random() * 0.7 + 0.15
        })),

    versions: () => ({
      versions: [
        { id: 'v1', location: 500, name: 'DEMO', at: Date.now() - 3600_000, label: 'Before edit' },
        { id: 'v2', location: 500, name: 'DEMO', at: Date.now() - 600_000, label: 'After metal pass' }
      ]
    }),

    presetSummary: (n) => ({
      number: n,
      name: state.stored.get(n) || '',
      blocks: state.blocks.filter((b) => !b.bypassed).map((b) => b.name)
    }),

    modModel: () => ({
      slots: 4,
      sources: [
        { value: 0, name: 'None' },
        { value: 1, name: 'LFO 1' },
        { value: 2, name: 'LFO 2' },
        { value: 3, name: 'ADSR 1' },
        { value: 4, name: 'Envelope' },
        { value: 5, name: 'Expression 1' },
        { value: 6, name: 'External 1' }
      ],
      bound: []
    }),

    bindModifier: () => ({ ok: true }),

    sceneState: () => ({
      scenes: state.sceneNames.map((name, i) => ({
        index: i,
        name,
        blocks: state.blocks.map((b) => ({
          eid: b.effectId,
          name: b.name,
          bypassed: i === 0 ? b.bypassed : (b.effectId + i) % 3 === 0,
          channel: b.channel
        }))
      }))
    }),

    tempo: () => ({ bpm: state.bpm ?? 120 }),
    setTempo: (bpm) => {
      state.bpm = bpm
      return { ok: true }
    },
    tapTempo: () => ({ bpm: state.bpm ?? 120 }),

    getScene: () => ({ index: state.scene, names: state.sceneNames.slice() }),

    setScene: (index) => {
      state.scene = index
      return { ok: true }
    },

    setSceneName: (index, name) => {
      state.sceneNames[index] = name
      return { ok: true }
    }
  }
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
