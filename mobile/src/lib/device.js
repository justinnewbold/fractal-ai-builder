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
