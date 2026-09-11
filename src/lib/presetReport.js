/**
 * Everything the unit says about the preset in front of you, and what in it
 * would stop it making a sound.
 *
 * "Can we set up a way to read the parameters of the current scene to
 * investigate why there is no sound on any of the scenes in this preset?"
 *
 * A preset that is silent is silent for a reason the unit can be asked about:
 * a block nothing is wired into, no output block at all, everything bypassed
 * in this scene, a level sitting on its minimum. Each of those is a fact in a
 * read the app already makes — they were just never gathered in one place and
 * never held up against the question.
 *
 * The judging is here, apart from the reading, so it can be tested without a
 * device: give it blocks, values and a grid and it says what is wrong in
 * words a player would use. The reading is in components/PresetReport.jsx.
 */
import { isLevelParam } from './guardrails.js'

/** Blocks that are structure rather than sound. */
const PLUMBING = ['input', 'output']

const named = (blocks) => blocks.map((b) => b.name || b.slug).join(', ')

const isNumber = (n) => typeof n === 'number' && Number.isFinite(n)

/**
 * A value sitting on the bottom of its own range.
 *
 * Proportional, not exact: a unit that stores -80.0001 dB for "all the way
 * down" is still all the way down, and a level a thousandth of the way up
 * from the floor is not a level anybody set on purpose.
 */
export function atMinimum(param) {
  if (!param || !isNumber(param.value) || !isNumber(param.min) || !isNumber(param.max)) return false
  if (param.max <= param.min) return false
  return param.value <= param.min + (param.max - param.min) * 0.001
}

/**
 * What in this preset would keep it quiet, in the order it would be noticed.
 *
 * Every line is a fact read off the unit, phrased as the thing to go and look
 * at. An empty list is worth saying too: it means the silence is somewhere
 * this cannot see, and that is a different search.
 */
export function silenceFaults({ blocks = [], params = {}, sceneName = '' } = {}) {
  const list = (Array.isArray(blocks) ? blocks : []).filter((b) => b && b.slug)
  if (!list.length) return ['There are no blocks in this preset at all.']

  const faults = []
  const where = sceneName ? ` in ${sceneName}` : ' in this scene'

  if (!list.some((b) => b.slug === 'output')) {
    faults.push(
      'There is no Output block in this preset, so nothing reaches your amp — and there is no volume to move on the Play screen either.'
    )
  }

  /*
   * And the same question from the other end.
   *
   * The output half of this was here from the start; the input half was not,
   * and it is the fault that makes a chain built into a genuinely empty preset
   * silent — the blocks are all there, all set, and the guitar never reaches
   * the first one. Only asked of a grid unit: a block list with no Input in it
   * on a four-slot unit means that unit takes its signal in some other way,
   * not that the preset is broken.
   */
  if (list.some((b) => isNumber(b.col)) && !list.some((b) => b.slug === 'input')) {
    faults.push(
      'There is no Input block in this preset, so your guitar never reaches the chain.'
    )
  }

  /*
   * A block with nothing feeding it.
   *
   * `fromRows` is what the unit reports as wired INTO a block. The leftmost
   * block is fed by the input rather than by a row, so it is not asked; a
   * driver that doesn't report the field at all is not accused of anything.
   */
  const wired = list.filter((b) => Array.isArray(b.fromRows) && isNumber(b.col))
  if (wired.length) {
    const leftmost = Math.min(...wired.map((b) => b.col))
    const orphans = wired.filter(
      (b) => b.col > leftmost && !b.fromRows.length && b.slug !== 'input'
    )
    if (orphans.length) {
      faults.push(
        `Nothing is wired into ${named(orphans)} — ${
          orphans.length === 1 ? 'that block is' : 'those blocks are'
        } sitting on the grid outside the signal path.`
      )
    }
  }

  const playable = list.filter((b) => !PLUMBING.includes(b.slug))
  if (playable.length && playable.every((b) => b.bypassed)) {
    faults.push(`Every block is off${where}.`)
  } else {
    const amp = playable.find((b) => b.slug === 'amp' && b.bypassed)
    if (amp) faults.push(`${amp.name || 'The amp'} is off${where}.`)
  }

  /* A level on its floor is silence with the preset otherwise perfect. */
  for (const block of list) {
    for (const param of params[block.effectId] || []) {
      if (!isLevelParam(param?.name) || !atMinimum(param)) continue
      faults.push(
        `${block.name || block.slug} — ${param.name} is all the way down at ${param.value}${
          param.unit || ''
        }.`
      )
    }
  }

  return faults
}

const cell = (block) =>
  isNumber(block.row) && isNumber(block.col) ? `row ${block.row} col ${block.col}` : '—'

const fed = (block) =>
  Array.isArray(block.fromRows)
    ? block.fromRows.length
      ? `rows ${block.fromRows.join(', ')}`
      : 'nothing'
    : 'not reported'

const value = (param) => {
  if (!isNumber(param.value)) return String(param.value ?? '—')
  const rounded = Math.abs(param.value) >= 100 ? Math.round(param.value) : Math.round(param.value * 1000) / 1000
  return `${rounded}${param.unit || ''}`
}

const range = (param) =>
  isNumber(param.min) && isNumber(param.max) ? `${param.min}–${param.max}` : '—'

/**
 * The whole read, as one piece of text to paste into the chat.
 *
 * The grid comes through as the unit's own JSON rather than as a summary. Its
 * shape is the one thing this app has never seen the inside of — block
 * placement is worked out from the protocol rather than confirmed on hardware
 * — so a report that paraphrased it would throw away the answer to the
 * question it exists to ask.
 */
export function formatPresetReport({
  header = {},
  preset = null,
  sceneIndex = null,
  sceneName = '',
  blocks = [],
  params = {},
  grid = null,
  faults = []
} = {}) {
  const list = (Array.isArray(blocks) ? blocks : []).filter((b) => b && b.slug)
  const lines = []

  for (const [key, text] of Object.entries(header)) {
    if (text) lines.push(`${key}: ${text}`)
  }
  lines.push(
    `preset: ${preset?.number ?? '--'} ${preset?.name || ''}`.trim(),
    `scene: ${sceneIndex === null || sceneIndex === undefined ? '—' : sceneIndex + 1}${
      sceneName ? ` ${sceneName}` : ''
    }`,
    ''
  )

  lines.push('WHAT WOULD STOP THIS MAKING A SOUND')
  if (faults.length) lines.push(...faults.map((f) => `- ${f}`))
  else lines.push('- Nothing this read can see. Every block is connected, on, and above its floor.')
  lines.push('')

  lines.push('BLOCKS — name | where | this scene | channel | fed by')
  for (const b of list) {
    lines.push(
      `${b.name || b.slug} | ${cell(b)} | ${b.bypassed ? 'off' : 'on'} | ${b.channel || '—'} | ${fed(b)}`
    )
  }
  lines.push('')

  lines.push('VALUES — block | parameter | value | range')
  for (const b of list) {
    const own = params[b.effectId]
    if (!own) {
      lines.push(`${b.name || b.slug} | (not read)`)
      continue
    }
    if (!own.length) lines.push(`${b.name || b.slug} | (no parameters)`)
    for (const p of own) {
      lines.push(`${b.name || b.slug} | ${p.name} | ${value(p)} | ${range(p)}`)
    }
  }
  lines.push('')

  lines.push('GRID — as the unit reports it, its own words')
  lines.push(grid ? JSON.stringify(grid).slice(0, 4000) : '(the unit did not answer)')

  return lines.join('\n')
}
