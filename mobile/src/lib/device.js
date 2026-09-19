/**
 * The unit, as the phone can reach it.
 *
 * Deliberately a fraction of `src/lib/forgefx.js`. That module drives
 * generation, grid editing, backups and saves — none of which travel the relay,
 * and none of which belong under a thumb on a dark stage. What is here is what
 * a player reaches for between songs: which preset, which scene, what's on,
 * what tempo, and is it in tune.
 *
 * Every call goes through the relay, so every call can be refused by the host
 * or answered slowly by a unit dumping a preset down a serial port. Callers get
 * the error and decide; nothing here retries or invents a value, because a
 * screen showing something plausible it made up is the failure this whole app
 * exists to stop.
 *
 * What a unit is — how an empty slot reads, how many slots it has, which blocks
 * are not stage controls — is in unit.mjs, where the tests can reach it.
 */
import { remoteRequest as overTheWire } from './relay'
import { firmwareOf } from './firmware'
import { demoDevice } from './demo'
import { demoRequest } from './demoWire'
import { logDebug } from './debugLog'

/**
 * Every question this app asks a unit, and the one place the demo answers.
 *
 * "Yes I want the demo mode on the phone as well." One seam rather than
 * twenty-eight, because a demo wired in at each call site is a second
 * implementation of the app — and a second implementation is how a demo starts
 * telling you things that are not true about the real one.
 *
 * Nothing below this line knows which it is talking to, which is the property
 * worth having: the screens are the same screens.
 */
const remoteRequest = (path, options) => {
  const demo = demoDevice()
  return demo ? demoRequest(demo, path, options) : overTheWire(path, options)
}
import { withLineage } from './lineage'
import { cableColumns, toWireCable, toWireCell } from './grid-plan'
import { cleanPresetName, isEmptySlotName } from './unit.mjs'
import { preferredEncoding, rememberEncoding } from './encoding'
import { toNormalized } from './scale'

export {
  EXCLUDED_BLOCKS,
  idOf,
  isBanked,
  presetLabel,
  sceneShape,
  slotCount,
  sameBlock,
  slotLabel,
  stepSlot
} from './unit.mjs'
import { EXCLUDED_BLOCKS } from './unit.mjs'

const post = (path, body) =>
  remoteRequest(path, { method: 'POST', body: body === undefined ? null : JSON.stringify(body) })

const put = (path, body) => remoteRequest(path, { method: 'PUT', body: JSON.stringify(body) })

/*
 * EVERY WRITE IS IN THE LOG WITH THE UNIT'S ANSWER.
 *
 * "Is the log showing all the edit failures?" It was not. It had every step
 * of a chain move and a knob that did not take, and nothing about a scene, a
 * bypass, a channel, a model change, a rename, a modifier or a tap of the
 * tempo -- so a preset that came out wrong had no line to point at. Now each
 * of those is one line: what was asked, and ok, refused, no answer, or the
 * error. The wire's own line still says the path and how long it took.
 */
const told = (what, req) =>
  req.then(
    (r) => {
      logDebug('write', what, r?.ok === false ? 'refused' : r?.ok === true ? 'ok' : 'no answer')
      return r
    },
    (err) => {
      logDebug('write', what, `failed — ${err?.message || err}`)
      throw err
    }
  )

/* ---------------------------------------------------------------- */
/* Reading                                                           */
/* ---------------------------------------------------------------- */

/**
 * What the unit is and what it can do — grid shape, scene count, channel names.
 *
 * Read rather than assumed, because Fractal units don't agree on what a preset
 * is. An AM4 is four slots in a chain with no routing; an FM3 is a matrix with
 * eight scenes. The shape of every other answer depends on this one.
 */
export const detect = async () => {
  const res = await remoteRequest('/device/detect')
  /*
   * AND THE FIRMWARE, WHICH IS ON THE OTHER ENDPOINT. `/device/detect` answers
   * with the capabilities rather than the whole unit, so a version read only
   * from here is a version this app never sees. Best-effort: the capabilities
   * above decide what every screen draws and are already in hand, while the
   * firmware is one line on Setup — a host too old to answer, or a relay that
   * drops it, costs that line and never the connection. The browser does the
   * same thing for the same reason; see src/lib/forgefx.js.
   */
  try {
    const whole = await remoteRequest('/device')
    return { ...whole, ...res, firmware: firmwareOf(whole) ?? firmwareOf(res) }
  } catch {
    return res
  }
}

/** The loaded preset, with the empty marker read rather than printed. */
export async function currentPreset() {
  const res = await remoteRequest('/preset')
  if (!res || typeof res.name !== 'string') return res
  return { ...res, name: cleanPresetName(res.name), empty: isEmptySlotName(res.name) }
}

/**
 * Every block in the loaded preset, exactly as the unit reports it.
 *
 * A slow read on purpose — on an AM4 this makes the unit dump its whole preset
 * over serial before answering, which is why the relay allows it 45 seconds
 * rather than the usual 20. Giving up early here is what once showed a preset
 * with nothing in it.
 *
 * NOT FILTERED HERE ANY MORE, and the distinction is the point. The stage
 * screen hides the input, the output, the looper and the gate, because nobody
 * kicks an input block between two bars. The edit screen shows them, because
 * that screen is the chain being LOOKED at — and a diagram that silently drops
 * two of its blocks disagrees with the unit about what the preset is. Which
 * ones a screen wants is that screen's business; see `stageBlocks`.
 */
export async function presetBlocks() {
  const list = await remoteRequest('/preset/blocks')
  if (!Array.isArray(list)) return []
  return list.filter((b) => b?.slug)
}

/**
 * Just what a scene changes: each block's bypass and channel.
 *
 * A scene switch never moves a block; it only changes which are on and which
 * channel each is set to. The full chain read makes the unit dump its whole
 * preset, which takes seconds and, asked for right after a scene switch,
 * lands while the unit is still rebuilding and comes back without its header:
 * "PRESET_DUMP_HEADER: expected func 0x77 at offset 0, got 0x78", four times
 * in a row in one log, each one leaving the chain "out of date" on screen.
 * This is one small status read instead. Empty when the computer is too old
 * to answer it, and the caller falls back to the full read.
 */
export async function sceneState() {
  const list = await remoteRequest('/preset/scene-state')
  return Array.isArray(list) ? list : []
}

/** The ones that belong on a stage: everything but the four you never kick. */
export const stageBlocks = (blocks) =>
  (blocks || []).filter((b) => !EXCLUDED_BLOCKS.includes(b.slug))

/**
 * What this preset's scenes are called.
 *
 * WHY THIS IS NOT JUST `getScene().names`, which is what the phone used to ask
 * and why its scene tiles were numbered squares with nothing on them.
 *
 * A gen-3 unit does not hand over scene names with the current scene. They live
 * in the preset, and the host will read them out of it — `/presets/{n}/summary`
 * answers with a `scenes` array — but only if somebody asks. The browser has
 * always asked. The phone never did, so it drew "1" through "8" while the Mac
 * two feet away drew DETUNERS, TRI CHORUS, WALL DELAY.
 *
 * Which matters more on the phone than on the Mac: the whole reason the tiles
 * are two across rather than four is to leave room for the NAME, because a name
 * is what a player thinks in between two bars. Without it the extra width buys
 * nothing.
 *
 * Empty rather than a throw. A unit that has no scene names — an AM4 has none —
 * gets numbered tiles, which is the honest answer and the one they had before.
 */
export async function sceneNames(number) {
  if (!Number.isInteger(number)) return []
  try {
    const summary = await remoteRequest(`/presets/${number}/summary`)
    /*
     * The answer has to be about the preset we asked for. The host serves this
     * from whatever the unit last dumped, and a slow unit can answer for the
     * preset before this one — which would put the last song's scene names on
     * this song's tiles.
     */
    if (Number.isInteger(summary?.number) && summary.number !== number) return []
    const names = summary?.scenes
    if (!Array.isArray(names)) return []
    const clean = names.map((n) => (typeof n === 'string' ? n.trim() : ''))
    return clean.some((n) => n) ? clean : []
  } catch {
    return []
  }
}

/** Which scene is live. Bypass states are per-scene, so this changes what else is true. */
export const getScene = () => remoteRequest('/scene')

/** Current tempo, in BPM. */
export const getTempo = () => remoteRequest('/tempo')

/**
 * Every knob on one block, with the range each one moves over.
 *
 * The read a tone is designed against, and the one the write check below reads
 * back through. Live off the hardware rather than out of the host's grid cache
 * — gen3's blockParams opens a connection rather than reusing the dump — which
 * is what makes confirming a write mean anything from a phone, where the cache
 * cannot be cleared.
 */
export const blockParams = (eid) => remoteRequest(`/preset/blocks/${eid}/params`)

/** One knob's current value, read back off the unit. */
async function readParamValue(eid, paramId) {
  const res = await blockParams(eid)
  return (res?.named || []).find((p) => p.id === paramId)?.value
}

/* ---------------------------------------------------------------- */
/* Changing                                                          */
/* ---------------------------------------------------------------- */

/** Load a stored slot into the edit buffer. Nothing is committed by doing this. */
export const selectPreset = (number) => told(`select preset ${number}`, post('/preset/select', { number }))

/**
 * What a stored slot is called, without loading it.
 *
 * The one thing that turns Previous and Next into a preset list. Stepping
 * blind is fine for the slot either side of the one you are on and useless for
 * "get me to the one called SCHISM", which between songs is the whole question.
 *
 * `/presets/{n}` is the short read and the host allows it over the relay —
 * `relay-rules` lists it among the SLOW_READS, because on some units answering
 * means dumping the preset over serial first. That is why this is asked for one
 * slot at a time by the caller rather than in a loop here: a unit with 512
 * slots would be 512 serial reads, and the screen wants the first twenty.
 *
 * An empty slot is named as such rather than left blank, the same way the
 * loaded preset is, so a list of slots reads the same as the header does.
 */
export async function presetName(number) {
  const res = await remoteRequest(`/presets/${number}`)
  const name = typeof res?.name === 'string' ? res.name : null
  if (name === null) return { number, name: null, empty: false }
  return { number, name: cleanPresetName(name), empty: isEmptySlotName(name) }
}

/**
 * Every name the computer has learned for this unit, in one request.
 *
 * The browser at the computer reads the stored names in the background — it
 * has the cable, and it leaves the port alone between slots — and writes the
 * lot into the computer's own document store as `preset-names-{unit}`. That
 * read costs the unit nothing at all: it never touches the serial port. Slot
 * number → name, where '' is a slot the unit said is empty. Null when the
 * computer has no list yet (an older app, or a unit it has not scanned), and
 * in the demo, which has no computer.
 */
export async function storedNames(slug) {
  if (!slug || demoDevice()) return null
  const doc = await remoteRequest(`/store/config/preset-names-${encodeURIComponent(slug)}`)
  const data = doc && typeof doc === 'object' && 'data' in doc ? doc.data : doc
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null
}

/**
 * The scene names the computer has kept for one slot, or null.
 *
 * The browser writes them into the computer's store the moment it reads them —
 * `scene-names-{unit}:{slot}` — precisely so a phone can have them without the
 * dump. One small request; the unit is not involved.
 */
export async function storedSceneNames(slug, number) {
  /* A unit mid-switch can report slot -1; there is nothing filed under it. */
  if (!slug || !Number.isInteger(number) || number < 0 || demoDevice()) return null
  const doc = await remoteRequest(`/store/config/${encodeURIComponent(`scene-names-${slug}:${number}`)}`)
  const data = doc && typeof doc === 'object' && 'data' in doc ? doc.data : doc
  if (!Array.isArray(data)) return null
  const names = data.map((n) => (typeof n === 'string' ? n.trim() : ''))
  return names.some((n) => n) ? names : null
}

/**
 * Give the computer a slot's scene names this phone had to read the slow way,
 * so the next device to load the slot — this one included — gets them at once.
 * The same document the browser writes, in the same shape. Never awaited and
 * never fails anything: it only helps a later load.
 */
export function keepSceneNames(slug, number, names) {
  if (!slug || !Number.isInteger(number) || number < 0 || demoDevice()) return
  if (!Array.isArray(names) || !names.some((n) => n)) return
  put(`/store/config/${encodeURIComponent(`scene-names-${slug}:${number}`)}`, { data: names, origin: 'fractal' }).catch(
    () => {}
  )
}

/**
 * The save handshake with the computer. See lib/saveViaComputer.
 *
 * A phone cannot write a slot — the computer refuses it — so it leaves the
 * request in the computer's store, and reads the computer's answer back from
 * the store. Both documents are the ones the browser has used for this since
 * the Save sheet learned to say "the computer writes it".
 */
export function parkSave(slug, request) {
  if (!slug) throw new Error('No unit to save on.')
  return put(`/store/config/${encodeURIComponent(`fractal.pendingSave.${slug}`)}`, {
    data: { ...request, at: Date.now() },
    origin: 'fractal'
  })
}

export async function readSaveResult(slug) {
  if (!slug) return null
  const doc = await remoteRequest(`/store/config/${encodeURIComponent(`fractal.saveResult.${slug}`)}`)
  const data = doc && typeof doc === 'object' && 'data' in doc ? doc.data : doc
  return data && typeof data === 'object' ? data : null
}

/**
 * Whose names these are, on disk. The demo's are kept apart from the real
 * unit's — the browser does the same — so a look around the demo never leaves
 * a made-up name over a real slot.
 */
export const nameOwner = (slug) => (slug ? (demoDevice() ? `${slug}:demo` : slug) : null)

/** Switch scenes. */
export const setScene = (index) => told(`scene ${index + 1}`, post('/scene', { index }))

/** Engage or bypass a block. The live scene is what remembers it. */
export const setBypass = (eid, bypassed) =>
  told(`block ${eid} ${bypassed ? 'off' : 'on'}`, post(`/preset/blocks/${eid}/bypass`, { bypassed }))

/** Switch a block's channel. Channels are A–D and hold independent settings. */
export const setChannel = (eid, channel) =>
  told(`block ${eid} channel ${channel}`, post(`/preset/blocks/${eid}/channel`, { channel }))

/** Set the tempo outright. */
export const setTempo = (bpm) => told(`tempo ${bpm}`, post('/tempo', { bpm }))

/**
 * One tap of the tempo.
 *
 * The single relayed request that must never be sent twice — it is a beat, and
 * a resend is a beat that never happened. The relay knows; see `repeatable` in
 * the rules.
 */
export const tapTempo = () => told('tap tempo', post('/tempo/tap'))

/**
 * Start or stop the unit's tuner.
 *
 * Starting it is allowed remotely and works. Seeing the readings is a different
 * question, and the answer is at the Mac rather than here: the host bridges
 * discrete change events and filters the roughly eight-per-second telemetry
 * streams, the tuner among them. So a phone can start the poll and then never
 * see a needle move. The tuner says exactly that after five silent seconds.
 */
export const setTuner = (on) => post('/tuner', { on })

/**
 * The demo's tuner readings, for the phone to drive itself.
 *
 * Null on a real rig, where the readings arrive off the relay and a second
 * source would fight them. See rig.writeTuner for why the phone needs this at
 * all and the browser does not.
 */
export const demoTuner = () => demoDevice()?.tunerStream?.() || null


/* ---------------------------------------------------------------- */
/* Writing a tone                                                    */
/* ---------------------------------------------------------------- */

/**
 * Swap the model on a block — a Plexi for a Recto.
 *
 * Discrete by nature: a model is an ordinal out of a fixed list, and
 * normalising one would be meaningless. Option 2 of 5 is not "40% of the way
 * along".
 */
export const setType = (eid, value) => told(`block ${eid} model ${value}`, post(`/preset/blocks/${eid}/type`, { value }))

/**
 * Every model a block family offers, with what each one is modelled on.
 *
 * The lineage is put on here rather than asked for: an FM3 reading from its own
 * device cache does carry it and wins, and an AM4 carries none of it at all. So
 * the catalog fills in the nulls — the same catalog the browser uses, copied by
 * `npm run sync:rules`, because the same amp being two amps on two screens is
 * worse than it being a code word on both.
 */
export const blockTypes = async (slug) =>
  withLineage(slug, (await remoteRequest(`/blocks/${slug}/types`)) || [])

/* ---------------------------------------------------------------- */
/* Changing the chain itself                                         */
/* ---------------------------------------------------------------- */

/**
 * Placeable blocks for whichever unit is attached.
 *
 * It has to come from the unit: an FM3 and an AM4 use entirely different type
 * numbering, so a hardcoded list would place the wrong blocks on the wrong unit
 * while looking like it worked. `page` is the block's own type code and goes
 * straight back to `placeBlock`.
 */
export const blockCatalog = async () => {
  const res = await remoteRequest('/blocks')
  return Array.isArray(res) ? res : []
}

/**
 * Put a block in a cell, or clear it with blockId 0.
 *
 * THIS WRITES STRUCTURE RATHER THAN A VALUE, which is the reason everything
 * around it is careful. A knob written wrongly sounds wrong and is one drag
 * from right; a block placed in the wrong cell is a preset somebody has to
 * rebuild. The row and column are DISPLAY coordinates — the ones /preset/blocks
 * reports — and the wire's own numbering is added once, here, by the shared
 * rule both apps are handed.
 *
 * The unit answers `ok:false` to writes that landed. See `doubtfulWrite`: that
 * answer is reported and never acted on.
 */
export const placeBlock = (row, col, blockId) =>
  put('/preset/grid/cell', { ...toWireCell(row, col), blockId })

export const clearCell = (row, col) => placeBlock(row, col, 0)

/** Connect or cut a cable from one cell to a row in the next column. */
export const setCable = (srcRow, srcCol, destRow, connect = true) =>
  told(
    `cable row ${srcRow + 1} column ${srcCol + 1} → row ${destRow + 1}${connect ? '' : ' cut'}`,
    post('/preset/grid/cable', {
      ...toWireCable(srcRow, srcCol, destRow),
      connect
    })
  )

/**
 * Run a wire the length of a row: every cell through to the one feeding the
 * output.
 *
 * WITHOUT THIS A BUILT CHAIN MAKES NO SOUND. Placing a block fills a cell; it
 * does not join that cell to anything, and an empty slot has no cabling in it
 * at all. Five blocks went in, every value landed, the unit read them back, the
 * preset saved — and none of it was in the signal path.
 *
 * Every answer is collected rather than thrown: a refusal is worth saying out
 * loud, but it must not undo a placement that worked, and re-asserting a cable
 * that already exists is not an error either.
 */
export async function wireRow(row, lastCol) {
  const results = []
  for (const col of cableColumns(lastCol)) {
    try {
      const res = await setCable(row, col, row)
      results.push({ col, ok: res?.ok !== false })
    } catch {
      results.push({ col, ok: false })
    }
  }
  const refused = results.filter((r) => !r.ok).length
  return { cables: results.length, refused }
}

/**
 * What this unit can attach to a control, and where.
 *
 * A modifier is what makes a preset RESPOND rather than sit still: an envelope
 * follower on drive so it cleans up when you back off, an expression pedal on
 * delay mix. Everything else this app writes is a static value.
 *
 * The answer carries `bindingSupported`. An AM4 serves the modifier list and
 * reports the wire binding unsupported — the data is there, the binding is not —
 * so the screen that offers this has to read that flag rather than assume. An
 * Attach button that cannot attach is worse than no Attach button.
 */
export const modifierModel = () => remoteRequest('/mod/model')

/** Attach a source to a control, in one of the unit's modifier slots. */
export const bindModifier = (slot, targetEffectId, targetParam, source) =>
  told(
    `modifier ${slot}: ${source} → block ${targetEffectId} param ${targetParam}`,
    post('/mod/bind', { slot, targetEffectId, targetParam, source })
  )

/** Name the preset, and name a scene. Both land in the edit buffer only. */
export const setPresetName = (name) => told(`preset name “${name}”`, post('/preset/name', { name }))
export const setSceneName = (index, name) => told(`scene ${index + 1} name “${name}”`, post('/scene/name', { index, name }))

/**
 * Write one knob and do not wait to be told it landed.
 *
 * `setParamConfirmed` below is the right call for a knob somebody let go of:
 * it reads the value back, because this hardware accepts a write it then
 * ignores and reports success either way.
 *
 * It is the WRONG call for a slider being dragged. Confirming costs a second
 * round trip per value, and the volume slider sends one per frame — so the
 * read-backs alone would put the unit minutes behind a thumb. The volume
 * control uses this instead and coalesces on the way in (see lib/volume's
 * `latestWriter`, shared with the Mac): one write on the wire, newest value
 * wins, and the last one is confirmed when the drag ends.
 */
export function setParam(eid, paramId, value, param, continuous) {
  const norm = toNormalized(value, param)
  if (norm === null) {
    // A guessed value is worse than no value: it lands somewhere real and
    // sounds like a decision somebody made.
    return Promise.reject(new Error(`No range known for ${param?.name || `parameter ${paramId}`}.`))
  }
  return put(`/preset/blocks/${eid}/params/${paramId}`, {
    value: norm,
    continuous: continuous ?? preferredEncoding(eid, paramId)
  })
}

/**
 * Write one knob, on whichever of the two paths the unit actually honours.
 *
 * The device accepts a write it then ignores, and reports success either way,
 * so confirming is the only way to know it landed. Tolerance is proportional
 * because the unit rounds — asking for 40 Hz can read back 39.998.
 *
 * Which path to try first is not a guess: encoding.js records that starting on
 * the discrete path slams every AM4 knob to its minimum before the retry
 * corrects it, which is audible. That file is generated from the browser's copy
 * so the two apps cannot drift on it.
 *
 * THE READ-BACK CAN BE ONE WRITE BEHIND, and a check that reads once and
 * believes it calls a write that landed a write that did not. The browser has
 * a log from an iPhone with five knobs in a row "not taking", each one reading
 * back the value of the write BEFORE it; and "The volume didn't take" on a
 * slider whose level was exactly where it had been put. So the check does what
 * the browser does — asks the computer to forget what it last read, which the
 * relay allows since the pinned fork — and then, if the number still does not
 * agree, waits a moment and reads once more before saying so. A miss costs
 * two reads and half a second. A false "didn't take" costs trust in the one
 * screen that has to be believed.
 */

/** How long to give the unit before the second read of a value that came back wrong. */
export const READ_BACK_AGAIN_MS = 400

/* A computer that refuses the cache drop will keep refusing while it is the
   computer; a dropped relay is about this moment and is asked again. */
let cacheDropRefused = false
/** True when the computer took the drop; false when it refused or could not be reached. */
export async function dropReadCache() {
  if (cacheDropRefused) return false
  try {
    await remoteRequest('/device/cache', { method: 'DELETE' })
    return true
  } catch (err) {
    if (err?.status === 403 || err?.remoteBlocked) cacheDropRefused = true
    logDebug('set', 'cache drop failed', err?.message || String(err))
    return false
  }
}

export async function setParamConfirmed(eid, paramId, value, param) {
  const norm = toNormalized(value, param)
  if (norm === null) {
    // A guessed value is worse than no value: it lands somewhere real and
    // sounds like a decision somebody made.
    throw new Error(`No range known for ${param?.name || `parameter ${paramId}`}.`)
  }

  const write = (continuous) =>
    put(`/preset/blocks/${eid}/params/${paramId}`, { value: norm, continuous })

  /* What the unit read back last, so a write that did not take can say what
     the unit is holding instead — which is the difference between "the app
     is broken" and "the unit is setting this itself". */
  let actual = null
  const agrees = () =>
    typeof actual === 'number' && Math.abs(actual - value) <= Math.max(0.05, Math.abs(value) * 0.02)
  const who = `${param?.name || `param ${paramId}`} on block ${eid}`
  /*
   * WRITTEN TO THE LOG WHEN IT MISSES, in numbers. "The volume didn't take.
   * The unit is holding it at +0.8 dB" — and nothing said what had been
   * asked for, which encoding went, whether the cache drop was accepted, or
   * what the second read saw. Every miss now leaves that line, so the next
   * log says which of those it was instead of leaving it to be guessed.
   */
  const landed = async (continuous) => {
    for (let go = 0; go < 2; go++) {
      if (go) await new Promise((r) => setTimeout(r, READ_BACK_AGAIN_MS))
      let dropped = false
      try {
        dropped = await dropReadCache()
        actual = await readParamValue(eid, paramId)
      } catch {
        actual = null
      }
      if (agrees()) return true
      logDebug(
        'set',
        `${who}: asked ${value}, read ${actual === null ? 'nothing' : actual}`,
        `${continuous ? 'continuous' : 'discrete'}, read ${go + 1} of 2, cache drop ${dropped ? 'taken' : 'not taken'}`
      )
    }
    return false
  }

  const first = preferredEncoding(eid, paramId)
  await write(first)
  if (await landed(first)) {
    rememberEncoding(eid, paramId, first)
    return { ok: true, continuous: first, retried: false }
  }

  await write(!first)
  if (await landed(!first)) {
    rememberEncoding(eid, paramId, !first)
    return { ok: true, continuous: !first, retried: true }
  }
  logDebug('set', `${who} did not take`, `asked ${value}, unit holds ${actual === null ? 'nothing readable' : actual}`)

  return { ok: false, continuous: null, retried: true, actual }
}
