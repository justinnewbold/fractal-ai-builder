/**
 * What the player changes after a generation, and what that teaches.
 *
 * "How can we set the AI up to learn from user feedback and adjust how it
 * interacts based on feedback?"
 *
 * There was already one channel for that — lib/taste.js, which reads what a
 * player has *kept*. It is real, and it is weak: keeping a preset says the
 * whole tone was good enough, without saying which part was wrong. The strong
 * signal was being thrown away. Every time a tone comes back and the player
 * reaches for the Presence knob, that is a labelled before-and-after: the model
 * said 6, the player wanted 4. Nothing recorded it, so the same correction
 * happened again on the next generation, and the one after.
 *
 * This records them, and only claims a pattern once one exists. Three
 * corrections to the same control, mostly the same way, is a habit worth
 * telling the model about. Two is an accident, and a confident line built from
 * an accident steers every future generation wrong — the same reasoning, and
 * the same failure mode, as taste.js's ENOUGH.
 *
 * Grouped by control *name* rather than by block and id, because that is the
 * grain the habit lives at. "This player runs less Presence than I would" is
 * true of their amps in general; it is not a fact about effect id 58.
 *
 * Nothing is trained and no weights move. Like the taste profile, this is a
 * few lines of prose assembled from the player's own history and sent with the
 * next request. It stays on this device: it is a record of one person's hands
 * on one rig, and it is worth nothing to anyone else's.
 */
const KEY = 'fab.corrections.v1'

/**
 * How many corrections to keep.
 *
 * Enough that a habit is visible across many sessions, few enough that a habit
 * the player has grown out of falls off the end. Oldest are dropped first, so
 * the profile follows a player who changes their mind rather than holding them
 * to what they wanted a year ago.
 */
const MAX = 200

/** Corrections to one control before it is called a habit rather than a mood. */
export const ENOUGH = 3

/** How lopsided a habit has to be. Two out of three the same way is a habit. */
const CLEAR = 2 / 3

/** How many of each list is worth sending. Beyond this it is padding. */
const TOP_CONTROLS = 6
const TOP_WORDS = 5

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // No store, or something else wrote nonsense here. No history is not an
    // error; it is a player who has not corrected anything yet.
    return []
  }
}

function write(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX)))
    return true
  } catch {
    // Quota or private browsing. Losing this is not worth interrupting anyone.
    return false
  }
}

/** Every correction, oldest first. */
export function listCorrections() {
  return read()
}

export function clearCorrections() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Already gone, as far as anyone can tell.
  }
}

/**
 * Record one hand correction of a generated value.
 *
 * Only called when a generation is what is being corrected. A knob turned on a
 * preset the player built themselves is not a correction of anything, and
 * counting it would teach the model about the player's rig rather than about
 * its own mistakes.
 *
 * What is kept is a control name and two numbers. The request that produced
 * the tone is deliberately not stored with it: nothing here reads it, and a
 * local record of what somebody typed, held for a purpose that does not exist
 * yet, is a liability rather than a feature. rememberNote keeps the words that
 * are actually used, and only those.
 */
export function rememberCorrection({ block, slug, param, from, to, min, max }) {
  const a = Number(from)
  const b = Number(to)
  if (!param || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return false
  return write([
    ...read(),
    {
      at: Date.now(),
      block: block || '',
      slug: slug || '',
      param,
      from: a,
      to: b,
      min: Number.isFinite(Number(min)) ? Number(min) : null,
      max: Number.isFinite(Number(max)) ? Number(max) : null
    }
  ])
}

/**
 * Record the words used to correct a tone.
 *
 * Kept apart from the numbers because it answers a different question. The
 * numbers say where this player lands; the words say what the first attempt
 * keeps getting wrong. "Darker" three times running is the model being told,
 * three times, to have started darker.
 */
export function rememberNote(text) {
  const words = (text || '').trim()
  if (!words) return false
  return write([...read(), { at: Date.now(), note: words.slice(0, 200) }])
}

const median = (list) => {
  const sorted = [...list].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const round = (n) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10)

/**
 * The habits in a list of corrections, or null if there are none yet.
 *
 * A control qualifies on two counts: enough corrections, and enough agreement
 * about which way. A control the player pushes up as often as down is a control
 * they are fiddling with, not one the model is getting wrong, and saying
 * anything about it would be worse than silence.
 */
export function patternsFrom(entries) {
  const list = Array.isArray(entries) ? entries : []
  const byParam = new Map()
  const notes = new Map()

  for (const e of list) {
    if (e?.note) {
      const key = e.note.toLowerCase()
      notes.set(key, (notes.get(key) || 0) + 1)
      continue
    }
    /*
     * A value that did not move is not a correction, whatever wrote it here.
     * rememberCorrection refuses them, but this reads a store that has been on
     * disk across many versions of this app, and a group of them would divide
     * by nothing and report a habit of turning something "up by NaN".
     */
    if (!e?.param || !(Number(e.to) !== Number(e.from))) continue
    const key = e.param.toLowerCase()
    if (!byParam.has(key)) byParam.set(key, [])
    byParam.get(key).push(e)
  }

  const controls = []
  for (const group of byParam.values()) {
    if (group.length < ENOUGH) continue
    const down = group.filter((e) => e.to < e.from).length
    const up = group.length - down
    const share = Math.max(up, down) / group.length
    if (share < CLEAR) continue
    const way = up >= down ? 'up' : 'down'
    const agreeing = group.filter((e) => (way === 'up' ? e.to > e.from : e.to < e.from))
    const spans = new Set(agreeing.map((e) => (e.min === null ? '' : `${e.min}-${e.max}`)))
    controls.push({
      name: group[0].param,
      way,
      count: agreeing.length,
      of: group.length,
      by: round(median(agreeing.map((e) => Math.abs(e.to - e.from)))),
      // Only quoted when every one of them was the same control range, or the
      // figure is an average of things that were never comparable.
      range: spans.size === 1 && !spans.has('') ? [...spans][0] : null
    })
  }

  const words = [...notes.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_WORDS)
    .map(([text, count]) => ({ text, count }))

  controls.sort((a, b) => b.count - a.count)
  if (!controls.length && !words.length) return null
  return { controls: controls.slice(0, TOP_CONTROLS), words, total: list.length }
}

/**
 * The habits as prose for the model.
 *
 * Written as instruction rather than as data, because a paragraph of statistics
 * gets acknowledged and ignored. The last line is the point of the whole
 * feature: land there on the first attempt instead of waiting to be corrected.
 */
export function describeCorrections(patterns) {
  if (!patterns) return ''
  const lines = []
  for (const c of patterns.controls) {
    const range = c.range ? ` on a ${c.range} control` : ''
    lines.push(
      `- After a generation they usually turn ${c.name} ${c.way} ` +
        `(${c.count} of ${c.of} times, by about ${c.by}${range}).`
    )
  }
  if (patterns.words.length) {
    lines.push(
      `- What they say when a first attempt is wrong: ` +
        patterns.words.map((w) => `"${w.text}" (${w.count}x)`).join(', ') +
        `.`
    )
  }
  if (!lines.length) return ''
  return (
    `HOW THIS PLAYER CORRECTS YOUR WORK\n` +
    `${lines.join('\n')}\n` +
    `Aim there on the first attempt. These are your own past misses with this ` +
    `player, not their instructions — do not mention them, and never let one ` +
    `override what they have actually asked for this time.`
  )
}

/** The one line shown in Setup, so it is never a secret what is being sent. */
export function summariseCorrections(patterns) {
  if (!patterns) {
    return `Nothing yet. Change a value by hand after a tone is generated and it is noted here — once the same control is changed the same way ${ENOUGH} times, the AI is told to start there.`
  }
  const bits = []
  if (patterns.controls.length)
    bits.push(
      `${patterns.controls.length} control${patterns.controls.length === 1 ? '' : 's'} you keep adjusting`
    )
  if (patterns.words.length) bits.push(`${patterns.words.length} things you keep asking for`)
  return `${bits.join(' and ')}, from ${patterns.total} note${patterns.total === 1 ? '' : 's'}. The AI is told to start there rather than wait to be corrected.`
}
