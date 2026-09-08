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
import { remoteRequest } from './relay'
import { cleanPresetName, isEmptySlotName } from './unit.mjs'
import { preferredEncoding, rememberEncoding } from './encoding'
import { toNormalized } from './scale'

export {
  EXCLUDED_BLOCKS,
  presetLabel,
  sceneShape,
  slotCount,
  stepSlot
} from './unit.mjs'
import { EXCLUDED_BLOCKS } from './unit.mjs'

const post = (path, body) =>
  remoteRequest(path, { method: 'POST', body: body === undefined ? null : JSON.stringify(body) })

const put = (path, body) => remoteRequest(path, { method: 'PUT', body: JSON.stringify(body) })

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
export const detect = () => remoteRequest('/device/detect')

/** The loaded preset, with the empty marker read rather than printed. */
export async function currentPreset() {
  const res = await remoteRequest('/preset')
  if (!res || typeof res.name !== 'string') return res
  return { ...res, name: cleanPresetName(res.name), empty: isEmptySlotName(res.name) }
}

/**
 * Every block in the loaded preset that is worth a button.
 *
 * A slow read on purpose — on an AM4 this makes the unit dump its whole preset
 * over serial before answering, which is why the relay allows it 45 seconds
 * rather than the usual 20. Giving up early here is what once showed a preset
 * with nothing in it.
 */
export async function presetBlocks() {
  const list = await remoteRequest('/preset/blocks')
  if (!Array.isArray(list)) return []
  return list.filter((b) => b?.slug && !EXCLUDED_BLOCKS.includes(b.slug))
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
export const selectPreset = (number) => post('/preset/select', { number })

/** Switch scenes. */
export const setScene = (index) => post('/scene', { index })

/** Engage or bypass a block. The live scene is what remembers it. */
export const setBypass = (eid, bypassed) => post(`/preset/blocks/${eid}/bypass`, { bypassed })

/** Switch a block's channel. Channels are A–D and hold independent settings. */
export const setChannel = (eid, channel) => post(`/preset/blocks/${eid}/channel`, { channel })

/** Set the tempo outright. */
export const setTempo = (bpm) => post('/tempo', { bpm })

/**
 * One tap of the tempo.
 *
 * The single relayed request that must never be sent twice — it is a beat, and
 * a resend is a beat that never happened. The relay knows; see `repeatable` in
 * the rules.
 */
export const tapTempo = () => post('/tempo/tap')

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
export const setType = (eid, value) => post(`/preset/blocks/${eid}/type`, { value })

/** Every model a block family offers, so a tone can ask for one by name. */
export const blockTypes = async (slug) => (await remoteRequest(`/blocks/${slug}/types`)) || []

/** Name the preset, and name a scene. Both land in the edit buffer only. */
export const setPresetName = (name) => post('/preset/name', { name })
export const setSceneName = (index, name) => post('/scene/name', { index, name })

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
 * The browser clears the host's editor cache before each read-back. A phone
 * cannot — DELETE is not on the relay allowlist — and does not need to: the
 * value comes back off the hardware, not out of the dump the host holds for
 * fifteen seconds.
 */
export async function setParamConfirmed(eid, paramId, value, param) {
  const norm = toNormalized(value, param)
  if (norm === null) {
    // A guessed value is worse than no value: it lands somewhere real and
    // sounds like a decision somebody made.
    throw new Error(`No range known for ${param?.name || `parameter ${paramId}`}.`)
  }

  const write = (continuous) =>
    put(`/preset/blocks/${eid}/params/${paramId}`, { value: norm, continuous })

  const landed = async () => {
    try {
      const actual = await readParamValue(eid, paramId)
      if (typeof actual !== 'number') return false
      return Math.abs(actual - value) <= Math.max(0.05, Math.abs(value) * 0.02)
    } catch {
      return false
    }
  }

  const first = preferredEncoding(eid, paramId)
  await write(first)
  if (await landed()) {
    rememberEncoding(eid, paramId, first)
    return { ok: true, continuous: first, retried: false }
  }

  await write(!first)
  if (await landed()) {
    rememberEncoding(eid, paramId, !first)
    return { ok: true, continuous: !first, retried: true }
  }

  return { ok: false, continuous: null, retried: true }
}
