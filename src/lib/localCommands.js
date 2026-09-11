/**
 * The requests that never needed a model.
 *
 * "Scene 3." "Bypass the delay." "Tempo 120." Every one of those goes to
 * Sonnet 5 today, costs real money, and takes as long as the round trip —
 * for a sentence with exactly one reading and no judgement in it at all.
 *
 * This is the matcher that catches them. It is deliberately timid, because
 * the cost of the two mistakes is not symmetric: failing to match costs
 * nothing (the request goes to the model, exactly as it does now), and
 * matching wrongly writes something to a unit somebody is about to play.
 * So every rule below is written to bail rather than guess.
 *
 * Three rules hold it shut:
 *
 *   1. THE WHOLE SENTENCE MUST BE CONSUMED. A pattern that matches the front
 *      of "bypass the delay and make it brighter" and ignores the rest is how
 *      half a request gets carried out. Every matcher is anchored at both
 *      ends.
 *   2. EXACTLY ONE THING MAY MATCH. Two delays, or a Gain on the amp and a
 *      Gain on the drive, means the sentence is ambiguous to this app whatever
 *      it meant to the player. Ambiguous is a miss.
 *   3. THE VALUE MUST BE IN RANGE. Out of range is a thing worth being told
 *      about in words, which is the model's job, not a thing to clamp
 *      silently.
 *
 * Pure on purpose: no device calls, no imports from the app, nothing but the
 * text and a description of what is on the unit. That is what makes it
 * testable against no hardware, and what lets it run before the request is
 * sent rather than after.
 */

/** Lowercase, punctuation out, spacing normal — the shape rules are written against. */
const clean = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9.\-+% ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/*
 * Words that carry no instruction. Stripped so "can you please bypass the
 * delay" reaches the same matcher as "bypass the delay" — politeness is not
 * ambiguity, and sending it to the model because somebody said please would
 * be a silly reason to spend a cent.
 */
/* No bare "go" here: it swallows the "go" of "go to scene 2" and leaves a
   sentence none of the rules below is anchored for. Politeness only. */
const LEAD = /^(?:hey |hi |ok |okay |right |so |now |please |can you |could you |would you |will you |i want you to |i want to |i'd like to |i'd like you to |lets |let's |just )+/
const TAIL = /(?: please| thanks| thank you| for me| mate| man)+$/

const strip = (s) => {
  let out = clean(s)
  let before
  do {
    before = out
    out = out.replace(LEAD, '').replace(TAIL, '').trim()
  } while (out !== before)
  return out
}

/** How much of a control's range one unqualified "a bit" moves, when nothing better is known. */
export const DEFAULT_NUDGE = 0.08

/**
 * One match, or nothing.
 *
 * Candidates are scored in tiers — an exact name, then a name the request is
 * the start of ("gain" for "Gain 1"), then a name that merely contains it —
 * and a tier with more than one winner is a miss rather than a coin toss.
 */
function only(candidates, wanted, nameOf) {
  const want = clean(wanted)
  if (!want) return null

  const base = (s) => s.replace(/ \d+$/, '')
  const named = candidates
    .map((c) => ({ c, full: clean(nameOf(c)) }))
    .filter((x) => x.full)
  const pick = (list) => (list.length === 1 ? list[0].c : null)

  /*
   * The instance number is the player's to supply, and everything turns on
   * whether they did.
   *
   * Said with one — "delay 2" — it IS the disambiguation, and the block of
   * that exact name is the answer or there is none: a preset holding only
   * Delay 1 must not answer "bypass delay 2" by bypassing Delay 1.
   *
   * Said without one — "gain" — the suffix is a position rather than a
   * distinction, and a preset holding an amp "Gain 1" and a drive "Gain" has
   * two controls by that name however they are spelled. Matching the drive
   * because its name happens to carry no number would be a confident wrong
   * answer, and the amp is what a player means nine times in ten. So the
   * comparison happens with the suffix off and the collision that produces is
   * the whole point: it misses, and the model is asked instead.
   */
  if (/ \d+$/.test(want)) return pick(named.filter((x) => x.full === want))

  const exact = named.filter((x) => base(x.full) === want)
  if (exact.length) return pick(exact)

  const starts = named.filter((x) => base(x.full).startsWith(want + ' '))
  if (starts.length) return pick(starts)

  const has = named.filter((x) => base(x.full).includes(want))
  if (has.length) return pick(has)

  return null
}

const blockName = (b) => `${b?.name ?? ''}`
const blockSlug = (b) => `${b?.slug ?? ''}`

/** A block by either the name printed on it or the family it belongs to. */
function findBlock(text, blocks) {
  return only(blocks, text, blockName) || only(blocks, text, blockSlug)
}

/**
 * A control, optionally with a block named in front of it.
 *
 * "gain to 7" on a preset holding both an amp Gain and a drive Gain is a
 * sentence this app cannot resolve, and it says so by missing. "amp gain to 7"
 * is not, so the block half is tried first and the control looked up inside it.
 */
function findControl(text, controls) {
  const direct = only(controls, text, (c) => c.param?.name)
  if (direct) return direct

  const words = clean(text).split(' ')
  for (let cut = 1; cut < words.length; cut++) {
    const blocks = [...new Map(controls.map((c) => [c.block?.eid, c.block])).values()]
    const block = findBlock(words.slice(0, cut).join(' '), blocks)
    if (!block) continue
    const inBlock = controls.filter((c) => c.block?.eid === block.eid)
    const hit = only(inBlock, words.slice(cut).join(' '), (c) => c.param?.name)
    if (hit) return hit
  }
  return null
}

const num = (s) => {
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

const inRange = (v, p) =>
  typeof p?.min !== 'number' || typeof p?.max !== 'number' || (v >= p.min && v <= p.max)

/**
 * What one step on this control is, for a request that named a direction and
 * not a number.
 *
 * The player's own habit first: corrections.js has been watching which
 * controls get reached for after a generation and by how much, and a median
 * of somebody's own past moves is a far better answer to "a bit more treble"
 * than a fraction of the range. The fraction is only the fallback.
 */
function stepFor(param, learned) {
  const span =
    typeof param?.min === 'number' && typeof param?.max === 'number' ? param.max - param.min : null
  const habit = learned?.(param?.name)
  if (typeof habit === 'number' && habit > 0) return habit
  return span ? Math.abs(span) * DEFAULT_NUDGE : null
}

/*
 * The matchers, tried in order. Each takes the stripped text and returns a
 * plan or null; the first that answers wins, and an answer is always a whole
 * sentence understood.
 */
const RULES = [
  /* Scene. Zero-based on the wire, one-based in every sentence anybody says. */
  (t, ctx) => {
    const m = /^(?:go to |switch to |change to |select |use |jump to )?scene (\d+)$/.exec(t)
    if (!m) return null
    const index = Number(m[1]) - 1
    const count = ctx.sceneCount ?? 8
    if (!Number.isInteger(index) || index < 0 || index >= count) return null
    return { kind: 'setScene', value: index, why: `Scene ${index + 1}.` }
  },

  /* Tempo. Bounded to what a unit will take, so "tempo 5000" is the model's to explain. */
  (t) => {
    const m =
      /^(?:set (?:the )?)?tempo (?:to |at )?(\d+(?:\.\d+)?)$/.exec(t) ||
      /^(\d+(?:\.\d+)?) ?bpm$/.exec(t)
    if (!m) return null
    const bpm = num(m[1])
    if (bpm === null || bpm < 20 || bpm > 400) return null
    return { kind: 'setTempo', value: bpm, why: `Tempo ${bpm}.` }
  },

  /* On and off, in the several ways people say it. */
  (t, ctx) => {
    let name = null
    let bypassed = null
    let m = /^(bypass|engage|enable|disable|mute|unmute) (?:the )?(.+)$/.exec(t)
    if (m) {
      name = m[2]
      bypassed = m[1] === 'bypass' || m[1] === 'disable' || m[1] === 'mute'
    } else {
      m = /^(?:turn |switch |put )?(?:the )?(.+?) (on|off)$/.exec(t)
      if (!m) return null
      name = m[1]
      bypassed = m[2] === 'off'
    }
    const block = findBlock(name, ctx.blocks || [])
    if (!block) return null
    return {
      kind: 'setBypass',
      eid: block.eid,
      flag: bypassed,
      why: `${block.name} ${bypassed ? 'off' : 'on'}.`
    }
  },

  /* A channel, on a block that was named. "Channel B" alone names no block. */
  (t, ctx) => {
    const m = /^(?:put |set |switch |move |change |make )?(?:the )?(.+?) (?:to |on |onto |to be )?channel ([a-d])$/.exec(t)
    if (!m) return null
    const block = findBlock(m[1], ctx.blocks || [])
    if (!block) return null
    const letter = m[2].toUpperCase()
    return {
      kind: 'setChannel',
      eid: block.eid,
      text: letter,
      why: `${block.name} to channel ${letter}.`
    }
  },

  /* A control set to a number it can actually hold. */
  (t, ctx) => {
    const m = /^(?:set |put |make )?(?:the )?(.+?) (?:to|at) (-?\d+(?:\.\d+)?) ?(db|hz|khz|ms|s|%)?$/.exec(t)
    if (!m) return null
    const hit = findControl(m[1], ctx.controls || [])
    if (!hit) return null
    const value = num(m[2])
    if (value === null || !inRange(value, hit.param)) return null
    return {
      kind: 'setParam',
      eid: hit.block.eid,
      paramId: hit.param.id,
      value,
      why: `${hit.block.name} ${hit.param.name} to ${value}${hit.param.unit || ''}.`
    }
  },

  /* A direction on a named control, by the player's own usual amount. */
  (t, ctx) => {
    let name = null
    let up = null
    let m = /^(?:turn |bring |nudge )?(?:the )?(.+?) (up|down)(?: a (?:bit|touch|little|hair|smidge))?$/.exec(t)
    if (m) {
      name = m[1]
      up = m[2] === 'up'
    } else {
      m = /^(?:a (?:bit|touch|little|hair) )?(more|less) (.+)$/.exec(t)
      if (!m) return null
      name = m[2]
      up = m[1] === 'more'
    }
    const hit = findControl(name, ctx.controls || [])
    if (!hit) return null
    const now = Number(hit.param?.value)
    if (!Number.isFinite(now)) return null
    const step = stepFor(hit.param, ctx.learnedStep)
    if (!step) return null
    const raw = up ? now + step : now - step
    const value = Math.round(raw * 100) / 100
    if (!inRange(value, hit.param)) return null
    return {
      kind: 'setParam',
      eid: hit.block.eid,
      paramId: hit.param.id,
      value,
      why: `${hit.block.name} ${hit.param.name} ${up ? 'up' : 'down'} to ${value}${hit.param.unit || ''}.`
    }
  }
]

/**
 * What this request would do, if it is one of the plain ones.
 *
 * `null` means "not one of mine" and is the common answer — it is what every
 * request that carries any judgement gets, and it costs the caller nothing
 * but the microseconds spent asking.
 */
export function matchLocal(instruction, ctx = {}) {
  const t = strip(instruction)
  if (!t || t.length > 120) return null
  for (const rule of RULES) {
    let plan = null
    try {
      plan = rule(t, ctx)
    } catch {
      plan = null // a matcher that throws is a matcher that did not match
    }
    if (plan) return plan
  }
  return null
}

/**
 * Renaming, kept apart because it is the one thing whose argument is not
 * lowercase. "Call it Black Album" has to keep the capitals the player typed,
 * so these read the original string rather than the stripped one.
 *
 * Both shapes are here because both are things people say, and the scene one
 * was missing entirely — a watch-only run caught "Rename scene 2 to Lithium"
 * going to the model for want of six lines of regex.
 */
export function matchRename(instruction, ctx = {}) {
  const raw = String(instruction ?? '').trim()

  /* A scene first: "rename scene 2 to Lithium" also matches the preset shape
     below if the preset rule is tried first, and would name the PRESET
     "scene 2 to Lithium". */
  const scene = /^(?:please\s+)?(?:re)?name\s+scene\s+(\d+)\s+(?:to|as)\s+(.+?)[.!]?$/i.exec(raw) ||
    /^(?:please\s+)?call\s+scene\s+(\d+)\s+(.+?)[.!]?$/i.exec(raw)
  if (scene) {
    const index = Number(scene[1]) - 1
    const count = ctx.sceneCount ?? 8
    if (!Number.isInteger(index) || index < 0 || index >= count) return null
    const name = tidy(scene[2])
    if (!name) return null
    return { kind: 'renameScene', scene: index, text: name, why: `Scene ${index + 1} renamed to ${name}.` }
  }

  const m = /^(?:please\s+)?(?:name|call|rename)\s+(?:it|this|the preset)\s+(.+?)[.!]?$/i.exec(raw)
  if (!m) return null
  const name = tidy(m[1])
  if (!name) return null
  return { kind: 'renamePreset', text: name, why: `Renamed to ${name}.` }
}

/** A name the unit can hold: quotes off, trimmed, and short enough to store. */
function tidy(text) {
  const name = String(text ?? '').trim().replace(/^["']|["']$/g, '').trim()
  return name && name.length <= 31 ? name : null
}
