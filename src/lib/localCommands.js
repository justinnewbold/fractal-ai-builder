/**
 * The requests that never needed a model.
 *
 * "Scene 3." "Bypass the delay." "Tempo 120." "Save this to 67." Every one of
 * those used to go to Sonnet 5, cost real money, and take as long as the round
 * trip — for a sentence with exactly one reading and no judgement in it at all.
 *
 * This is the matcher that catches them. It began timid and watch-only, and
 * the reason still stands: failing to match costs nothing (the request goes to
 * the model, exactly as before), and matching wrongly writes something to a
 * unit somebody is about to play. So every rule below is written to bail
 * rather than guess. What changed is the brief:
 *
 *   "The app should be able to handle local commands like adjusting settings
 *    on controls and knobs and things like that without using the AI model.
 *    ... if I wanted to make this app completely without an AI model, let's
 *    set it up that way."
 *
 * So this now covers every kind of change the plan runner (lib/actions.js)
 * knows how to make, wherever the sentence has one plain reading: scenes by
 * number or name, tempo, a block on or off (in any scene), a channel (in any
 * scene), a control to a number, up or down by an amount or to its ends, a
 * block's model by name, adding, removing and moving blocks, renaming, saving,
 * loading, backing up, keeping to the library, building a chain — and the
 * plain factual questions the app can answer from what it has already read.
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
 *
 * What a match is: a plan action in the same shape the model returns, so it
 * goes through validatePlan and runPlan exactly as a model's plan does — the
 * same range checks, the same "this overwrites a slot, are you sure", the same
 * Done line. Plus one shape of its own, `answer`, for a question: no write,
 * just words.
 */

/** Lowercase, punctuation out, spacing normal — the shape rules are written against. */
const clean = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9.\-+%#' ]+/g, ' ')
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
const LEAD = /^(?:hey |hi |ok |okay |right |so |now |please |can you |could you |would you |will you |can we |i want you to |i want to |i'd like to |i'd like you to |lets |let's |just )+/
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

/**
 * The strict half of `only`: the name itself, or the name with its instance
 * number off, and nothing looser. For a question — "what is the gain" — a
 * control that merely CONTAINS the word ("Amp1 Level" contains "amp") would
 * be read back as the answer with full confidence, which is worse than "I
 * don't know which one you mean".
 */
function exactly(candidates, wanted, nameOf) {
  const want = clean(wanted)
  if (!want) return null
  const base = (s) => s.replace(/ \d+$/, '')
  const hits = candidates.filter((c) => {
    const full = clean(nameOf(c))
    return full && (full === want || base(full) === want)
  })
  return hits.length === 1 ? hits[0] : null
}

const blockName = (b) => `${b?.name ?? ''}`
const blockSlug = (b) => `${b?.slug ?? ''}`

/** A block by either the name printed on it or the family it belongs to. */
function findBlock(text, blocks) {
  const t = clean(text).replace(/ block$/, '')
  /* Two letters is a word out of a sentence, not a block: "switch to channel
     b" must not find Tone Match because "to" is inside it. */
  if (t.length < 3) return null
  return only(blocks, t, blockName) || only(blocks, t, blockSlug)
}

/**
 * A control, optionally with a block named in front of it.
 *
 * "gain to 7" on a preset holding both an amp Gain and a drive Gain is a
 * sentence this app cannot resolve, and it says so by missing. "amp gain to 7"
 * is not, so the block half is tried first and the control looked up inside it.
 */
function findControl(text, controls, match = only) {
  const direct = match(controls, text, (c) => c.param?.name)
  if (direct) return direct

  const words = clean(text).split(' ')
  for (let cut = 1; cut < words.length; cut++) {
    const blocks = [...new Map(controls.map((c) => [c.block?.eid, c.block])).values()]
    const block = findBlock(words.slice(0, cut).join(' '), blocks)
    if (!block) continue
    const inBlock = controls.filter((c) => c.block?.eid === block.eid)
    const hit = match(inBlock, words.slice(cut).join(' '), (c) => c.param?.name)
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

const round = (v) => Math.round(v * 100) / 100

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

/* ───────────────────────────── scenes ───────────────────────────── */

/**
 * Which scene a phrase means: "scene 3", "the lead scene", "lead", "scene lead".
 * Numbers are one-based in every sentence anybody says and zero-based on the
 * wire. A name has to belong to exactly one scene.
 */
function sceneRef(text, ctx) {
  const t = clean(text).replace(/^the /, '').replace(/ scene$/, '').replace(/^scene /, '')
  if (!t) return null
  const count = ctx.sceneCount ?? 8
  if (/^\d+$/.test(t)) {
    const index = Number(t) - 1
    return Number.isInteger(index) && index >= 0 && index < count ? index : null
  }
  const names = Array.isArray(ctx.sceneNames) ? ctx.sceneNames : []
  const hits = []
  names.forEach((name, i) => {
    if (i < count && name && clean(name) === t) hits.push(i)
  })
  return hits.length === 1 ? hits[0] : null
}

const sceneWord = (i, ctx) => {
  const name = Array.isArray(ctx.sceneNames) ? ctx.sceneNames[i] : null
  return name ? `scene ${i + 1} (${name})` : `scene ${i + 1}`
}

/**
 * A trailing "in scene 2" / "on the lead scene" / "for scene 3", split off a
 * sentence so the rule in front of it can read the rest. Returns the sentence
 * as it was when nothing of the kind is there, and null for a scene named that
 * the unit does not have — that is the model's to explain, not ours to guess at.
 */
function splitScene(t, ctx) {
  const sep = / (?:in|on|for|at) /g
  const cuts = []
  let m
  while ((m = sep.exec(t))) {
    cuts.push({ at: m.index, after: m.index + m[0].length })
    sep.lastIndex = m.index + 1 // "amp on in scene 2": the two share a space
  }
  /* From the right, so the scene phrase is the shortest tail that resolves:
     "put the amp on channel c in the lead scene" has two separators and only
     the last one is followed by a scene. */
  for (const cut of cuts.reverse()) {
    const tail = t.slice(cut.after).replace(/^the /, '')
    if (!/^(?:scene \d+|.+ scene)$/.test(tail)) continue
    const scene = sceneRef(tail, ctx)
    if (scene !== null) return { rest: t.slice(0, cut.at), scene }
  }
  /* A scene was named and the unit has no such scene — the model's to
     explain, not ours to guess at. Anything else is a sentence with no scene
     in it, handed back whole. */
  if (cuts.length && /(?:scene \d+|\S+ scene)$/.test(t) && sceneRef(/(?:scene \d+|\S+ scene)$/.exec(t)[0], ctx) === null) return null
  return { rest: t, scene: null }
}

/* ───────────────────────────── block families ───────────────────────────── */

/*
 * The words that mean "a block of that kind" — the unit's own family names and
 * the things players call them. Used to tell "add a reverb" (a block) from
 * "add a bit more gain" (not one). Resolution against the unit's actual list
 * happens at run time in actions.js, which knows every alias; this is only the
 * gate that keeps the rule from firing on a noun that is not a block at all.
 */
const FAMILIES = new Set([
  'amp', 'amplifier', 'cab', 'cabinet', 'drive', 'overdrive', 'distortion', 'fuzz',
  'delay', 'reverb', 'verb', 'pitch', 'whammy', 'pitch shifter', 'pitchshifter', 'harmonizer',
  'octaver', 'octave', 'chorus', 'flanger', 'phaser', 'tremolo', 'trem', 'vibrato', 'rotary',
  'compressor', 'comp', 'compression', 'gate', 'noise gate', 'eq', 'equalizer', 'graphic eq',
  'parametric eq', 'filter', 'wah', 'volume', 'vol', 'vol/pan', 'volume pedal', 'multitap',
  'multitap delay', 'plex', 'plex delay', 'megatap', 'looper', 'synth', 'formant', 'ring mod',
  'ringmod', 'ring modulator', 'crossover', 'mixer', 'enhancer', 'resonator', 'vocoder',
  'tone match', 'send', 'return', 'feedback send', 'feedback return', 'shunt'
])

const isFamily = (word) => FAMILIES.has(clean(word).replace(/ block$/, ''))

/* ───────────────────────────── the rules ───────────────────────────── */

const SLOT_WORD = '(?:preset |slot |patch |number |# ?|no\\.? ?)?'

/**
 * A slot number the unit has. The count is known on a unit that has said, and
 * on one that has not the number is taken as given — the runner checks again.
 */
const slotOk = (n, ctx) =>
  Number.isInteger(n) && n >= 0 && (typeof ctx.slotCount !== 'number' || n < ctx.slotCount)

/**
 * A model by the name the unit prints or the real amplifier it is modelled on.
 * One or nothing: "brit 800" on a unit with eleven Brit 800 variants is a miss,
 * and the player says which one.
 */
function findModel(block, text) {
  const models = Array.isArray(block?.models) ? block.models : []
  if (!models.length) return null
  return (
    only(models, text, (m) => m.name) ||
    only(models, text, (m) => m.basedOn) ||
    null
  )
}

/*
 * The matchers, tried in order. Each takes the stripped text, the context and
 * the sentence as typed (for the names whose capitals matter), and returns a
 * plan or null; the first that answers wins, and an answer is always a whole
 * sentence understood.
 */
const RULES = [
  /* Scene, by number or by name. Zero-based on the wire, one-based in every sentence anybody says. */
  (t, ctx) => {
    let m = /^(?:go to |switch to |change to |select |use |jump to |load )?scene (\d+)$/.exec(t)
    if (m) {
      const index = Number(m[1]) - 1
      const count = ctx.sceneCount ?? 8
      if (!Number.isInteger(index) || index < 0 || index >= count) return null
      return { kind: 'setScene', value: index, why: `Scene ${index + 1}.` }
    }
    m = /^(?:go to |switch to |change to |select |use |jump to |load )?(?:the )?(next|previous|prev|last) scene$/.exec(t)
    if (m) {
      const now = ctx.activeScene
      if (typeof now !== 'number') return null
      const count = ctx.sceneCount ?? 8
      const index = m[1] === 'next' ? now + 1 : now - 1
      if (index < 0 || index >= count) return null
      return { kind: 'setScene', value: index, why: `${sceneWord(index, ctx)}.` }
    }
    m = /^(?:go to |switch to |change to |select |use |jump to |load )(?:the )?(.+?)(?: scene)?$/.exec(t) ||
      /^(?:the )?(.+?) scene$/.exec(t)
    if (m) {
      const names = Array.isArray(ctx.sceneNames) ? ctx.sceneNames : []
      if (!names.some(Boolean)) return null
      const index = sceneRef(m[1], ctx)
      if (index === null) return null
      return { kind: 'setScene', value: index, why: `${sceneWord(index, ctx)}.` }
    }
    return null
  },

  /* Tempo. Bounded to what a unit will take, so "tempo 5000" is the model's to explain. */
  (t) => {
    const m =
      /^(?:set (?:the )?|change (?:the )?)?tempo (?:to |at |of )?(\d+(?:\.\d+)?)(?: ?bpm)?$/.exec(t) ||
      /^(\d+(?:\.\d+)?) ?bpm$/.exec(t) ||
      /^(?:set (?:the )?)?bpm (?:to |at )?(\d+(?:\.\d+)?)$/.exec(t)
    if (!m) return null
    const bpm = num(m[1])
    if (bpm === null || bpm < 20 || bpm > 400) return null
    return { kind: 'setTempo', value: bpm, why: `Tempo ${bpm}.` }
  },

  /*
   * Saving. Overwrites a slot, so the runner marks it destructive and the
   * app asks first — exactly as it does when the model proposes one. Plain
   * "save" is the slot that is loaded; a number is that slot; a name keeps
   * the capitals the player typed.
   */
  (t, ctx, raw) => {
    const here = ctx.presetNumber
    let m = /^save(?: it| this| that| the preset| this preset| preset| the patch| changes| my changes)?$/.exec(t)
    if (m) {
      if (!slotOk(here, ctx)) return null
      return { kind: 'savePreset', value: here, text: '', why: `Save to slot ${here}.` }
    }
    m = new RegExp(`^save(?: it| this| that| the preset| this preset)? (?:to|in|into|at|on|as) ${SLOT_WORD}(\\d+)$`).exec(t)
    if (m) {
      const n = Number(m[1])
      if (!slotOk(n, ctx)) return null
      return { kind: 'savePreset', value: n, text: '', why: `Save to slot ${n}.` }
    }
    const r = String(raw ?? '').trim().replace(/[.!]+$/, '')
    m = /^(?:please\s+)?save(?:\s+(?:it|this|that|the preset|this preset))?\s+(?:as|called|named)\s+(.+?)(?:\s+(?:to|in|into|at)\s+(?:slot\s+|preset\s+|#\s*)?(\d+))?$/i.exec(r) ||
      /^(?:please\s+)?save(?:\s+(?:it|this|that|the preset|this preset))?\s+(?:to|in|into|at)\s+(?:slot\s+|preset\s+|#\s*)?(\d+)\s+(?:as|called|named)\s+(.+)$/i.exec(r)
    if (m) {
      const [a, b] = m.slice(1)
      const name = tidy(/^\d+$/.test(a || '') ? b : a)
      const said = /^\d+$/.test(a || '') ? Number(a) : b !== undefined ? Number(b) : here
      if (!name || /\b(?:library|my library|the library)\b/i.test(name)) return null
      if (!slotOk(said, ctx)) return null
      return { kind: 'savePreset', value: said, text: name, why: `Save "${name}" to slot ${said}.` }
    }
    return null
  },

  /*
   * Keeping a tone as a file in the library folder, and backing up to a file.
   * Neither overwrites anything on the unit; both only work at the Mac, and
   * the runner says so if asked from the phone.
   */
  (t, ctx, raw) => {
    if (/^(?:keep|save|store|put|add) (?:this |it |that |this preset |the preset )?(?:in|to|into) (?:my |the )?library$/.test(t)) {
      return { kind: 'keepInLibrary', text: '', why: 'Keep this preset as a file in the library.' }
    }
    const r = String(raw ?? '').trim().replace(/[.!]+$/, '')
    const m = /^(?:please\s+)?keep\s+(?:this|it|that)?\s*as\s+(.+)$/i.exec(r) ||
      /^(?:please\s+)?(?:save|keep|store|put)\s+(?:this|it|that|this preset)?\s*(?:in|to|into)\s+(?:my|the)\s+library\s+as\s+(.+)$/i.exec(r)
    if (m) {
      const name = tidy(m[1])
      if (!name) return null
      return { kind: 'keepInLibrary', text: name, why: `Keep "${name}" as a file in the library.` }
    }
    if (/^(?:back ?up|back (?:this|it|that) up|back ?up (?:this|the) preset|make a backup|export (?:this|the) preset|download (?:this|the) preset)$/.test(t)) {
      const here = ctx.presetNumber
      return { kind: 'backupPreset', value: Number.isInteger(here) ? here : null, why: 'Back this preset up to a file.' }
    }
    return null
  },

  /*
   * Loading. Discards unsaved work, so the runner marks it destructive and the
   * app asks first. By number, by the name of a slot this app has learned
   * (one slot of that name, or it is a miss), or the one next door.
   */
  (t, ctx) => {
    let m = new RegExp(`^(?:load|open|go to|switch to|select|pull up|bring up|jump to|change to)(?: the| my)? ${SLOT_WORD}(\\d+)$`).exec(t) ||
      /^(?:preset|slot|patch) (\d+)$/.exec(t)
    if (m) {
      const n = Number(m[1])
      if (!slotOk(n, ctx)) return null
      return { kind: 'loadPreset', value: n, why: `Load slot ${n}.` }
    }
    m = /^(next|previous|prev|last) preset$/.exec(t)
    if (m) {
      const here = ctx.presetNumber
      if (!Number.isInteger(here)) return null
      const n = m[1] === 'next' ? here + 1 : here - 1
      if (!slotOk(n, ctx)) return null
      return { kind: 'loadPreset', value: n, why: `Load slot ${n}.` }
    }
    m = /^(?:load|open|pull up|bring up|switch to|go to|select)(?: the| my)? (.+?)(?: preset| patch)?$/.exec(t)
    if (m && !/^\d+$/.test(m[1])) {
      const slots = Array.isArray(ctx.slots) ? ctx.slots.filter((s) => Number.isInteger(s?.number) && s?.name) : []
      if (!slots.length) return null
      const hit = exactly(slots, m[1], (s) => s.name)
      if (!hit) return null
      return { kind: 'loadPreset', value: hit.number, why: `Load slot ${hit.number} · ${hit.name}.` }
    }
    return null
  },

  /*
   * A chain into an empty preset — named blocks in signal order, or the
   * sensible default when none are named. The runner resolves the names
   * against the unit and places between the input and the output.
   */
  (t) => {
    if (/^(?:build|make|create|set up|lay down|put down|give me) (?:me )?(?:a |the )?(?:default |basic |standard |simple |new )?chain$/.test(t)) {
      return { kind: 'buildChain', text: '', why: 'Build the default chain.' }
    }
    const m = /^(?:build|make|create|set up|lay down|put down) (?:me )?(?:a |the )?(.+?) chain$/.exec(t)
    if (!m) return null
    const words = m[1].split(/[,>]+|\s+(?:and|then|into|to)\s+|\s+/).map((w) => w.trim()).filter(Boolean)
    if (!words.length || !words.every(isFamily)) return null
    return { kind: 'buildChain', text: words.join(' '), why: `Build a chain: ${words.join(' → ')}.` }
  },

  /*
   * Adding a block. The name goes as the player said it; actions.js resolves
   * it against the unit's own list and its aliases ("whammy" is Pitch) and
   * picks the free slot. A place named ("after the amp") is the model's — it
   * is grid arithmetic with a judgement in it.
   */
  (t) => {
    const m = /^(?:add|place|insert|drop in|put in|put down|stick in|give me|i need|i want) (?:a |an |another |me a |me an )?(.+?)(?: block)?(?: (?:to|on|in|into) (?:the |this )?(?:grid|chain|preset))?$/.exec(t)
    if (!m || !isFamily(m[1])) return null
    const text = clean(m[1]).replace(/ block$/, '')
    return { kind: 'placeBlock', text, value: null, row: null, col: null, why: `Add a ${text}.` }
  },

  /*
   * Removing a block. Destructive: the runner marks it and the app asks
   * first. The block has to be one on the grid, and one only.
   */
  (t, ctx) => {
    const m = /^(?:remove|delete|take out|take off|take away|get rid of|drop|clear|kill) (?:the |that |this )?(.+?)(?: block)?(?: (?:from|off|out of) (?:the |this )?(?:grid|chain|preset))?$/.exec(t)
    if (!m) return null
    const block = findBlock(m[1], ctx.blocks || [])
    if (!block || typeof block.row !== 'number' || typeof block.col !== 'number') return null
    return { kind: 'clearCell', row: block.row, col: block.col, eid: block.eid, why: `Remove ${block.name}.` }
  },

  /*
   * Moving a block to sit right before or after another one, into the free
   * cell beside it on the same row. That cell being taken is a miss, not a
   * shuffle: rearranging a row is judgement, and the model's.
   */
  (t, ctx) => {
    const m = /^(?:move|put|shift|drag) (?:the )?(.+?) (?:to )?(before|after|in front of|behind|ahead of|right before|right after|just before|just after) (?:the )?(.+)$/.exec(t)
    if (!m) return null
    const blocks = ctx.blocks || []
    const mover = findBlock(m[1], blocks)
    const anchor = findBlock(m[3], blocks)
    if (!mover || !anchor || mover.eid === anchor.eid) return null
    if ([mover.row, mover.col, anchor.row, anchor.col].some((v) => typeof v !== 'number')) return null
    const before = /before|front|ahead/.test(m[2])
    const col = before ? anchor.col - 1 : anchor.col + 1
    const row = anchor.row
    const cols = ctx.grid?.cols
    if (col < 0 || (typeof cols === 'number' && col >= cols)) return null
    if (mover.row === row && mover.col === col) {
      return { kind: 'answer', text: `${mover.name} is already right ${before ? 'before' : 'after'} ${anchor.name}.` }
    }
    const taken = (ctx.occupied || blocks).some((b) => b.row === row && b.col === col && (b.eid ?? b.effectId) !== mover.eid)
    if (taken) return null
    return {
      kind: 'moveBlock',
      eid: mover.eid,
      row,
      col,
      why: `Move ${mover.name} ${before ? 'before' : 'after'} ${anchor.name}.`
    }
  },

  /* On and off, in the several ways people say it — in this scene or a named one. */
  (t, ctx) => {
    const split = splitScene(t, ctx)
    if (!split) return null
    const s = split.rest
    let name = null
    let bypassed = null
    let m = /^(bypass|engage|enable|disable|mute|unmute|activate|deactivate|kill) (?:the )?(.+)$/.exec(s)
    if (m) {
      name = m[2]
      bypassed = ['bypass', 'disable', 'mute', 'deactivate', 'kill'].includes(m[1])
    } else {
      m = /^(?:turn |switch |put |flip |kick )?(?:the )?(.+?) (on|off)$/.exec(s) ||
        /^(?:turn |switch |flip |kick )(on|off) (?:the )?(.+)$/.exec(s)
      if (!m) return null
      const onOff = /^(on|off)$/.test(m[1]) ? m[1] : m[2]
      name = /^(on|off)$/.test(m[1]) ? m[2] : m[1]
      bypassed = onOff === 'off'
    }
    const block = findBlock(name, ctx.blocks || [])
    if (!block) return null
    const plan = {
      kind: 'setBypass',
      eid: block.eid,
      flag: bypassed,
      why: `${block.name} ${bypassed ? 'off' : 'on'}${split.scene !== null ? ` in ${sceneWord(split.scene, ctx)}` : ''}.`
    }
    if (split.scene !== null) plan.scene = split.scene
    return plan
  },

  /* A channel, on a block that was named — in this scene or a named one. "Channel B" alone names no block. */
  (t, ctx) => {
    const split = splitScene(t, ctx)
    if (!split) return null
    const m = /^(?:put |set |switch |move |change |make |flip )?(?:the )?(.+?) (?:to |on |onto |to be |over to )?(?:channel|chan|ch) ([a-d])$/.exec(split.rest)
    if (!m) return null
    const block = findBlock(m[1], ctx.blocks || [])
    if (!block) return null
    const letter = m[2].toUpperCase()
    const plan = {
      kind: 'setChannel',
      eid: block.eid,
      text: letter,
      why: `${block.name} to channel ${letter}${split.scene !== null ? ` in ${sceneWord(split.scene, ctx)}` : ''}.`
    }
    if (split.scene !== null) plan.scene = split.scene
    return plan
  },

  /* A control set to a number it can actually hold. */
  (t, ctx) => {
    const split = splitScene(t, ctx)
    if (!split) return null
    const m = /^(?:set |put |make |dial |change )?(?:the )?(.+?) (?:to|at|=) (-?\d+(?:\.\d+)?) ?(db|hz|khz|ms|s|%)?$/.exec(split.rest)
    if (!m) return null
    const hit = findControl(m[1], ctx.controls || [])
    if (!hit) return null
    const value = num(m[2])
    if (value === null || !inRange(value, hit.param)) return null
    return withScene(
      {
        kind: 'setParam',
        eid: hit.block.eid,
        paramId: hit.param.id,
        value,
        why: `${hit.block.name} ${hit.param.name} to ${value}${hit.param.unit || ''}.`
      },
      split.scene,
      ctx
    )
  },

  /* A control to either end of its range. */
  (t, ctx) => {
    const split = splitScene(t, ctx)
    if (!split) return null
    const m = /^(?:set |put |turn |crank |dime |run |take )?(?:the )?(.+?) (?:to (?:the |its )?)?(max|maximum|all the way up|full|wide open|min|minimum|all the way down|zero|off completely|to zero)$/.exec(split.rest)
    if (!m) return null
    const hit = findControl(m[1], ctx.controls || [])
    if (!hit) return null
    const up = /^(max|maximum|all the way up|full|wide open)$/.test(m[2])
    const value = up ? hit.param?.max : hit.param?.min
    if (typeof value !== 'number') return null
    return withScene(
      {
        kind: 'setParam',
        eid: hit.block.eid,
        paramId: hit.param.id,
        value,
        why: `${hit.block.name} ${hit.param.name} ${up ? 'all the way up' : 'all the way down'} to ${value}${hit.param.unit || ''}.`
      },
      split.scene,
      ctx
    )
  },

  /*
   * A direction on a named control: by the amount said, or by the player's own
   * usual amount when none was.
   */
  (t, ctx) => {
    const split = splitScene(t, ctx)
    if (!split) return null
    const s = split.rest
    const AMOUNT = '(?: (?:by |a )?(?:(\\d+(?:\\.\\d+)?) ?(?:db|%|hz|ms|points?|steps?|clicks?|notches?)?|(bit|touch|little|hair|smidge|tad|lot|bunch)(?: more| less)?))?'
    let name = null
    let up = null
    let said = null
    let word = null
    let m = new RegExp(`^(?:turn |bring |nudge |push |pull |bump |take |move |crank |back |roll )?(?:the )?(.+?) (up|down)${AMOUNT}$`).exec(s)
    if (m) {
      ;[name, up, said, word] = [m[1], m[2] === 'up', m[3], m[4]]
    } else {
      m = new RegExp(`^(raise|increase|boost|add|lower|reduce|cut|drop|decrease|back off|roll off|dial back|ease off) (?:the )?(.+?)${AMOUNT}$`).exec(s)
      if (m) {
        ;[up, name, said, word] = [['raise', 'increase', 'boost', 'add'].includes(m[1]), m[2], m[3], m[4]]
      } else {
        m = /^(?:a (?:bit|touch|little|hair|tad|lot|bunch) )?(more|less) (.+)$/.exec(s)
        if (!m) return null
        ;[up, name] = [m[1] === 'more', m[2]]
        word = /^a (bit|touch|little|hair|tad|lot|bunch)/.exec(s)?.[1] || null
      }
    }
    const hit = findControl(name, ctx.controls || [])
    if (!hit) return null
    const now = Number(hit.param?.value)
    if (!Number.isFinite(now)) return null
    let step
    if (said !== undefined && said !== null) {
      step = num(said)
      if (step === null || step <= 0) return null
    } else {
      step = stepFor(hit.param, ctx.learnedStep)
      if (!step) return null
      if (word === 'lot' || word === 'bunch') step *= 3
    }
    const value = round(up ? now + step : now - step)
    if (!inRange(value, hit.param)) return null
    return withScene(
      {
        kind: 'setParam',
        eid: hit.block.eid,
        paramId: hit.param.id,
        value,
        why: `${hit.block.name} ${hit.param.name} ${up ? 'up' : 'down'} to ${value}${hit.param.unit || ''}.`
      },
      split.scene,
      ctx
    )
  },

  /*
   * A block's model, by the name the unit prints or the amplifier it is based
   * on. One model only: a name eleven variants share is a miss, and the player
   * says which. Tried after the channel and control rules, so "amp to channel
   * b" and "treble to 7" are never read as models.
   */
  (t, ctx) => {
    const m = /^(?:set |change |switch |swap |make |put |flip )?(?:the )?(.+?) (?:model )?(?:to|onto|over to|=) (?:the |a |an )?(.+)$/.exec(t) ||
      /^(?:use |try |load |pick |select )(?:the |a |an )?(.+?) (?:on|for|in) (?:the )?(.+)$/.exec(t)
    if (!m) return null
    const blocks = ctx.blocks || []
    /* Both readings of the two halves: "amp to Plexi" and "Plexi on the amp". */
    for (const [b, mod] of [[m[1], m[2]], [m[2], m[1]]]) {
      const block = findBlock(b, blocks)
      if (!block || !Array.isArray(block.models) || !block.models.length) continue
      if (/^-?\d/.test(mod) || /^(?:channel|chan|ch) [a-d]$/.test(mod)) return null
      const model = findModel(block, mod)
      if (!model) continue
      const gear = model.basedOn || model.manufacturer || null
      return {
        kind: 'setModel',
        eid: block.eid,
        value: model.value,
        why: `${block.name} → ${model.name}${gear ? ` (${gear})` : ''}.`
      }
    }
    return null
  }
]

/** A setParam aimed at a scene carries the scene; the runner decides whether that reaches others. */
function withScene(plan, scene, ctx) {
  if (scene === null || scene === undefined) return plan
  return { ...plan, scene, why: plan.why.replace(/\.$/, '') + ` in ${sceneWord(scene, ctx)}.` }
}

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
      plan = rule(t, ctx, instruction)
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
 * going to the model for want of six lines of regex. "This scene" is the one
 * the unit is in, which the runner knows.
 */
export function matchRename(instruction, ctx = {}) {
  const raw = String(instruction ?? '').trim().replace(/^(?:please|can you|could you)\s+/i, '')

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

  const thisScene = /^(?:please\s+)?(?:(?:re)?name|call)\s+(?:this|the|the current|the active)\s+scene\s+(?:(?:to|as)\s+)?(.+?)[.!]?$/i.exec(raw)
  if (thisScene) {
    const name = tidy(thisScene[1])
    if (!name) return null
    return { kind: 'renameScene', scene: null, text: name, why: `This scene renamed to ${name}.` }
  }

  const m = /^(?:please\s+)?(?:name|call|rename)\s+(?:it|this|that|this preset|the preset|preset)\s+(?:(?:to|as)\s+)?(.+?)[.!]?$/i.exec(raw)
  if (!m) return null
  const name = tidy(m[1])
  if (!name || /^(?:to|as)$/i.test(name)) return null
  return { kind: 'renamePreset', text: name, why: `Renamed to ${name}.` }
}

/** A name the unit can hold: quotes off, trimmed, and short enough to store. */
function tidy(text) {
  const name = String(text ?? '').trim().replace(/^["']|["']$/g, '').trim()
  return name && name.length <= 31 ? name : null
}

/*
 * Whole-preset volume, without a block named.
 *
 * "Turn up the volume on this preset by 4 dB" and "pump it up a little more"
 * both went to the model — seven to ten seconds and a chat turn's worth of
 * tokens each — and the model, which never sees the Output block (rule 4 of
 * its instructions, and the guardrails strip it), answered with the amp's
 * Level on whichever channel the amp was sitting on. Scenes on another
 * channel did not move. The control that every scene passes through is the
 * Output block's Level, the same one the speaker slider moves, and moving it
 * by a number of dB is arithmetic, not judgement. So this is caught here.
 *
 * This began as a list of sentence shapes and lost twice to sentences that
 * were plainly volume requests and not on the list: "Lower the volume by 10"
 * (no "lower", no bare number), then another the same week. A list of shapes
 * is the wrong tool for a sentence with this little in it. So it is a
 * VOCABULARY now: every word in the sentence has to be one that belongs in a
 * volume request — a verb, a volume word, a direction, an amount word, or a
 * number — and there has to be a direction in it. One word from outside that
 * list, "delay" or "scene" or "amp", and it is not the whole preset and it
 * misses, exactly as before. That is the same whole-sentence rule the other
 * matchers keep, applied word by word instead of shape by shape.
 *
 * The amount is the dB asked for — a bare number counts as dB — two for "a
 * bit", three with none said, and never more than twelve: past that somebody
 * should be told in words what they are about to do.
 */
const VOL_VERBS = new Set(['turn', 'bring', 'pump', 'crank', 'take', 'bump', 'push', 'make', 'set', 'get', 'move', 'knock', 'back', 'roll', 'dial', 'go', 'put'])
const VOL_NOUNS = new Set(['volume', 'loudness', 'level', 'levels', 'master', 'output', 'sound'])
/* Not "gain": "turn the gain down" is the amp's gain to every guitarist alive,
   and it is a control the nudge rule below already knows how to move. */
const VOL_WHOLE = new Set(['it', 'this', 'that', 'everything', 'whole', 'entire', 'overall', 'preset', 'patch', 'rig', 'thing', 'all'])
const VOL_UP = new Set(['up', 'louder', 'raise', 'increase', 'boost', 'higher', 'more'])
const VOL_DOWN = new Set(['down', 'quieter', 'softer', 'lower', 'reduce', 'drop', 'decrease', 'cut', 'less', 'quiet', 'soft', 'quieten'])
const VOL_FILL = new Set(['the', 'a', 'an', 'of', 'on', 'for', 'to', 'by', 'in', 'and', 'little', 'bit', 'touch', 'hair', 'smidge', 'tad', 'notch', 'notches', 'some', 'db', 'decibel', 'decibels', 'dbs', 'about', 'around', 'like', 'please', 'volume-wise'])
const VOL_LITTLE = new Set(['bit', 'touch', 'hair', 'smidge', 'tad', 'little', 'notch'])
const VOL_LOT = new Set(['lot', 'bunch', 'way', 'much'])

export function matchVolume(instruction) {
  const t = strip(instruction)
  if (!t || t.length > 80) return null
  const words = t.replace(/(\d)(db|dbs)\b/g, '$1 $2').split(' ').filter(Boolean)
  let up = null
  let down = null
  let noun = false
  let whole = false
  let said = null
  let little = false
  let lot = false
  for (const w of words) {
    if (/^[-+]?\d+(?:\.\d+)?$/.test(w)) {
      if (said !== null) return null // two numbers is not one request
      said = Math.abs(num(w))
      if (w.startsWith('-')) down = true
      if (w.startsWith('+')) up = true
      continue
    }
    if (VOL_UP.has(w)) up = true
    else if (VOL_DOWN.has(w)) down = true
    /* "louder" and "quieter" are the noun and the direction in one word. */
    if (/^(louder|quieter|softer|quiet|soft|quieten)$/.test(w)) noun = true
    if (VOL_UP.has(w) || VOL_DOWN.has(w)) continue
    if (VOL_NOUNS.has(w)) noun = true
    else if (VOL_WHOLE.has(w)) whole = true
    else if (VOL_LITTLE.has(w)) little = true
    else if (VOL_LOT.has(w)) lot = true
    else if (VOL_VERBS.has(w) || VOL_FILL.has(w)) continue
    else return null // a word from outside the request: a block, a scene, a control — not the whole preset
  }
  /* A direction, one only; and something to move — a volume word, or "it" /
     "everything" standing for the whole preset. A bare "more" has neither. */
  if (up === down) return null
  if (!noun && !whole) return null
  const amount = said !== null ? said : little ? 2 : lot ? 6 : 3
  if (!Number.isFinite(amount) || amount <= 0 || amount > 12) return null
  const by = up ? amount : -amount
  return { kind: 'setVolume', by, why: `Whole preset ${up ? 'up' : 'down'} ${amount} dB.` }
}

/*
 * A plain request for a whole new tone.
 *
 * "Make a Breaking Benjamin rig" went to the chat model first, which read it,
 * thought about it at medium effort, and answered "this is a design" — a
 * thirteen-cent, ten-second turn to decide the one thing the sentence already
 * said. The designer takes the player's own words, so the chat turn added
 * nothing but the roster it carried.
 *
 * Deliberately narrow, the same way the matcher above is: a verb, a thing, and
 * a noun that means "a tone", with nothing after it. "Make the delay sound
 * bigger" does not end in the noun; "make a scene modeled after Heart-Shaped
 * Box" does not either. Anything with more in it — a song list, a chain of
 * clauses — is the model's, exactly as before. A subject that is one of the
 * blocks on the grid ("make the amp tone brighter" is caught by the ending,
 * but "make the amp tone" is not) is not a band and not a design.
 */
export function plainDesignRequest(instruction, ctx = {}) {
  const t = strip(instruction)
  if (!t || t.length > 80) return null
  const m = /^(?:make|build|design|create|give me|dial in|dial up|set up|do) (?:me )?(?:a |an |the )?(.+?) (rig|tone|preset|sound|patch)$/.exec(t)
  if (!m) return null
  const subject = m[1].trim()
  if (!subject || /^(?:this|that|it|my|current|the current|new|another|a new)$/.test(subject)) return null
  if (findBlock(subject, ctx.blocks || [])) return null
  const text = String(instruction ?? '').trim()
  return { kind: 'designTone', text, why: `A ${subject} ${m[2]} — straight to the designer.` }
}

/* ───────────────────────────── questions ───────────────────────────── */

/**
 * What the app can do by itself, in the player's words. Shown for "what can
 * you do", and when the model is off and a sentence was not one of these.
 */
export const LOCAL_HELP =
  'Things the app does by itself, no AI model needed: ' +
  'switch scenes ("scene 3", "go to the lead scene", "next scene") · ' +
  'set the tempo ("tempo 120") · ' +
  'a block on or off, here or in a named scene ("bypass the delay", "reverb on in scene 2") · ' +
  'a channel ("amp to channel B", "drive to channel C in the lead scene") · ' +
  'a control to a number, up or down by an amount, or all the way ("treble to 7", "gain up 1.5", "bass all the way down") · ' +
  'the whole preset’s volume ("lower the volume by 4") · ' +
  'a block’s model by name ("amp to Brit 800 2204 High") · ' +
  'add, remove or move a block ("add a reverb", "remove the chorus", "move the drive before the amp") · ' +
  'rename the preset or a scene ("call it Black Album", "rename scene 2 to Lithium") · ' +
  'save, load, back up, keep to the library ("save", "save to 67 as Heavy", "load 45", "load the Metallica preset", "back this up") · ' +
  'build a chain on an empty preset ("build a drive amp cab delay chain") · ' +
  'and answer what is loaded: which amp or cab, which scene, which preset, the tempo, whether a block is on, what channel it is on, what a control is set to.'

const onOff = (b) => (b?.bypassed === true ? 'off' : b?.bypassed === false ? 'on' : null)

/**
 * A question the app can answer from what it has already read, without a
 * model and without touching the unit. Returns `{ kind: 'answer', text }`, or
 * `{ kind: 'answer', topic: 'model', eid }` for the one answer — which model a
 * block is on — that the schema does not carry and the app has to read.
 *
 * Only the factual ones. "Why did you pick that amp" is not a fact this app
 * holds, and goes to the model exactly as before.
 */
export function matchQuestion(instruction, ctx = {}) {
  const t = strip(instruction).replace(/\?+$/, '').trim()
  if (!t || t.length > 100) return null
  const blocks = ctx.blocks || []
  const say = (text) => ({ kind: 'answer', text })

  if (/^(?:help|what can you do|what can i say|what can i ask|what can i ask for|what do you do|what can the app do(?: by itself| on its own| without (?:the )?ai)?|commands|list (?:the )?commands|what works without (?:the )?(?:ai|model))$/.test(t)) {
    return say(LOCAL_HELP)
  }

  /* Which model a block is on — needs a read, so it is handed back as a topic. */
  let m = /^(?:what|which) (.+?)(?: model)? (?:is this|is that|is it|am i (?:on|using|running)|is loaded|is in use|is on|is in (?:this|the) preset|do i have|is (?:this|the) preset (?:on|using))$/.exec(t) ||
    /^what(?:'s| is) (?:the |this |my )?(.+?)(?: model| set to| on)?$/.exec(t) ||
    /^(?:what|which) (.+?) model(?: is this| is it)?$/.exec(t)
  if (m && isFamily(m[1])) {
    const block = findBlock(m[1], blocks)
    if (block) return { kind: 'answer', topic: 'model', eid: block.eid, block: block.name }
  }

  if (/^(?:(?:what|which) scene (?:am i (?:on|in)|is this|is it|is active|is loaded|is that|are we (?:on|in))|what(?:'s| is) the (?:current |active )?scene|current scene|scene)$/.test(t)) {
    const i = ctx.activeScene
    if (typeof i !== 'number') return say('I can’t tell which scene the unit is in yet.')
    return say(`${sceneWord(i, ctx).replace(/^s/, 'S')}.`)
  }

  if (/^(?:(?:what|which) preset (?:is this|is loaded|am i on|is it|is that|are we on)|what(?:'s| is) (?:this preset|loaded|the (?:current |loaded )?preset|this)(?: called)?|what(?:'s| is) the (?:preset|patch) (?:name|number|called)|current preset|which slot(?: is this| am i on)?)$/.test(t)) {
    const n = ctx.presetNumber
    const name = ctx.presetName
    if (!Number.isInteger(n) && !name) return say('Nothing is loaded that I can see.')
    return say(`Slot ${Number.isInteger(n) ? n : '?'}${name ? ` · ${name}` : ''}.`)
  }

  if (/^(?:what(?:'s| is) the (?:current )?(?:tempo|bpm)|what tempo(?: is this| is it)?|what bpm|tempo|bpm|how fast is (?:it|the tempo))$/.test(t)) {
    return typeof ctx.bpm === 'number' ? say(`Tempo ${ctx.bpm} BPM.`) : say('I haven’t read the tempo yet.')
  }

  if (/^(?:what (?:are the )?scenes(?: are there| do i have| are in this preset)?|list (?:the )?scenes|scene names|what are the scene names|which scenes (?:are there|do i have))$/.test(t)) {
    const names = Array.isArray(ctx.sceneNames) ? ctx.sceneNames : []
    const count = ctx.sceneCount ?? names.length
    if (!count) return say('I haven’t read the scenes yet.')
    const lines = []
    for (let i = 0; i < count; i++) lines.push(`${i + 1} ${names[i] || '(unnamed)'}${ctx.activeScene === i ? ' ← here' : ''}`)
    return say(`Scenes: ${lines.join(' · ')}.`)
  }

  if (/^(?:what(?:'s| is) (?:on |in )?(?:the |this )?(?:grid|chain|preset|signal chain)|what blocks (?:are there|do i have|are in (?:this|the) preset|are on the grid|are placed)|list (?:the )?blocks|show me the (?:chain|blocks|grid)|what(?:'s| is) in (?:here|it))$/.test(t)) {
    if (!blocks.length) return say('The grid is empty — nothing placed yet.')
    const sorted = [...blocks].sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0))
    return say(`On the grid: ${sorted.map((b) => `${b.name}${onOff(b) ? ` (${onOff(b)})` : ''}${b.channel ? ` ch ${b.channel}` : ''}`).join(' · ')}.`)
  }

  m = /^is (?:the )?(.+?) (?:on|off|bypassed|engaged|active|enabled|disabled|muted)$/.exec(t) ||
    /^(?:what|which) channel is (?:the )?(.+?) (?:on|in|using|playing)$/.exec(t) ||
    /^(?:what|which) channel(?:'s| is) (?:the )?(.+)$/.exec(t)
  if (m) {
    const block = findBlock(m[1], blocks)
    if (block) {
      const asked = /channel/.test(t) ? 'channel' : 'state'
      if (asked === 'channel') {
        return block.channel ? say(`${block.name} is on channel ${block.channel}.`) : say(`I haven’t read which channel ${block.name} is on.`)
      }
      const state = onOff(block)
      return state ? say(`${block.name} is ${state}${block.channel ? `, channel ${block.channel}` : ''}.`) : say(`I haven’t read whether ${block.name} is on.`)
    }
  }

  /* A control's value. Strict on the name: "what is the gain" answers only a
     control called Gain, never one whose name happens to contain the word. */
  m = /^(?:what(?:'s| is| does) (?:the )?(.+?)(?: (?:at|set to|set at|sitting at|on|value|reading))?|where(?:'s| is) (?:the )?(.+?)(?: (?:at|set|sitting))?|how (?:much|high|low) is (?:the )?(.+?)|(.+?) value)$/.exec(t)
  if (m) {
    const name = m.slice(1).find(Boolean)
    if (name && !isFamily(name)) {
      const hit = findControl(name, ctx.controls || [], exactly)
      if (hit && hit.param?.value !== undefined && hit.param?.value !== null) {
        return say(`${hit.block.name} ${hit.param.name} is ${hit.param.value}${hit.param.unit || ''}.`)
      }
    }
  }

  return null
}
