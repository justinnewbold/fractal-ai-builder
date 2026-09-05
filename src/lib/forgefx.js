// Client for the ForgeFX device API (https://github.com/sKuhLight/ForgeFX).
//
// ForgeFX runs on the player's own machine and owns the USB serial port to the
// Fractal unit. This app is served from the cloud but every device call goes to
// localhost — the audio hardware is on their desk, not ours.
//
// Verified against FM3 firmware via ForgeFX 0.6.29-beta:
//   - blocks are addressed by effect id (the `page` field), NOT by slug
//   - parameter writes take real units ({"value": 9} for a 0-10 gain), not 0-1
//   - /preset/store commits to a slot even when capabilities report supportsSave:false

import { EXCLUDED_BLOCKS, safeParams } from './guardrails.js'
import { cleanPresetName, isEmptySlotName } from './presetName.js'
import { zeroBasedChain, wrongSlot } from './slots.js'
import { toNormalized } from './scale.js'
import { remoteActive, remoteRequest, subscribeRemoteEvents } from './remote.js'
import {
  rosterCache,
  helpTextCache,
  paramCache,
  invalidateSchema,
  patchSchemaValue,
  resetSchemaCache,
  seedSchemaCache,
  cachedSchema
} from './schemaCache.js'

export { invalidateSchema, patchSchemaValue, resetSchemaCache }
import { preferredEncoding, rememberEncoding, getEncodingMap, disambiguate } from './encoding.js'

export { preferredEncoding, rememberEncoding, getEncodingMap, disambiguate }
import { createMockDevice } from './mockDevice.js'

/**
 * Where the device server is, when nobody has said otherwise.
 *
 * This was the constant `http://localhost:5056`, which is right for every way
 * the app has run until now: the browser is on the machine with the cable, and
 * localhost is the device server.
 *
 * It is wrong in exactly the case local mode exists for. When ForgeFX serves
 * this app over the network, the page arrives on a phone — and localhost on a
 * phone is the phone. The default has to be the origin the page came from,
 * because in that case the only thing that could have served it IS the device
 * server.
 *
 * The test is the protocol plus the build. A production build reached over
 * plain http was served by ForgeFX; the hosted app is https and keeps
 * localhost, which is the browser exemption that makes it work on the Mac at
 * all; a dev server is neither and keeps localhost too.
 *
 * Worth naming because of how it would have failed: on the Mac, where local
 * mode gets tested, localhost and the origin are the same machine and both
 * work. It would only have broken on the phone.
 */
const LOOPBACK = 'http://localhost:5056'

function defaultHost() {
  if (typeof window === 'undefined') return LOOPBACK
  if (import.meta.env?.DEV) return LOOPBACK
  return window.location.protocol === 'http:' ? window.location.origin : LOOPBACK
}

/**
 * Demo mode routes every device call to a simulated FM3 instead of the wire.
 *
 * Kept in the same module as the real client, and behind the same functions, so
 * there is no second code path to drift — the app cannot tell the difference,
 * which is the only way a simulator is worth having.
 */
let mock = null

export const isDemo = () => mock !== null

export function setDemo(on) {
  mock = on ? createMockDevice() : null
  if (on) localStorage.setItem('forgefx.demo', '1')
  else localStorage.removeItem('forgefx.demo')
}

if (typeof localStorage !== 'undefined' && localStorage.getItem('forgefx.demo') === '1') {
  mock = createMockDevice()
}

/** Simulated latency, so progress indicators behave as they do on real serial. */
const tick = () => new Promise((r) => setTimeout(r, 12))

export function getHost() {
  return localStorage.getItem('forgefx.host') || defaultHost()
}

/** The default, exported so the UI can say what it would fall back to. */
export { defaultHost }

export function setHost(host) {
  localStorage.setItem('forgefx.host', host.replace(/\/+$/, ''))
}

class ForgeError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message)
    this.name = 'ForgeError'
    this.status = status
    this.cause = cause
  }
}

async function request(path, options = {}) {
  // With a remote session up, everything travels the relay instead. This is the
  // one place that has to know, which is why it was worth keeping a single
  // chokepoint for every call the app makes.
  if (remoteActive()) {
    try {
      return await remoteRequest(path, options)
    } catch (err) {
      throw new ForgeError(err.message, { status: err.status, cause: err })
    }
  }

  return directRequest(path, options)
}

/**
 * Straight to this machine, whatever the relay is doing.
 *
 * A few routes are local by definition — the helper's own sign-in, and the
 * switch that puts it on the channel. ForgeFX refuses both from a distance and
 * is right to. But every call went through the relay whenever a remote session
 * was up, and at the Mac a remote session is an ordinary thing to have: the
 * page there had been relaying to a host that wasn't on, so the panel holding
 * the switch to turn it on couldn't be read, and wasn't even drawn. The one
 * control that fixes the problem hid itself exactly when it was the answer.
 */
async function directRequest(path, options = {}) {
  const url = `${getHost()}${path}`
  let res
  try {
    // A machine that isn't running the helper refuses instantly, but a machine
    // that is busy or asleep can leave a fetch hanging, and the callers here
    // are asking a yes/no question someone is waiting on.
    const stop = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined
    res = await fetch(url, {
      ...options,
      signal: stop,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    })
  } catch (cause) {
    /*
     * Two different failures, and telling someone the wrong one sends them to
     * check a machine that was never the problem. In the demo there is no
     * helper anywhere by definition, so blaming their Mac is simply false —
     * and it is the exact sentence a phone stuck in the demo used to show.
     */
    throw new ForgeError(
      mock
        ? 'This is the demo, so there is no Fractal app to reach. Switch to a real device to connect.'
        : 'Can’t reach the Fractal app on your Mac. Check that it is open and the Fractal unit is connected.',
      { cause }
    )
  }

  const body = await res.text()
  let parsed = null
  if (body) {
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = body
    }
  }

  if (!res.ok) {
    const detail = parsed?.message || parsed?.error || res.statusText
    throw new ForgeError(detail, { status: res.status })
  }
  return parsed
}

/**
 * Whether the helper is running on this very machine.
 *
 * The question the app never asked: a browser at the Mac and a browser on a
 * phone are told apart today by guessing from the user agent, when the honest
 * test is whether localhost answers. It decides whether the host switch is
 * yours to throw, and whether a remote session on this machine is a relay to
 * somewhere else or a relay to the desk you're sitting at.
 */
/**
 * Could this browser ever be the machine with the cable in it?
 *
 * `localHelperAlive` answers false in the demo on purpose — the demo has no
 * helper and nothing should try to reach one. But "no helper because we are
 * pretending" and "no helper because this is a phone" are different facts, and
 * only the second one is permanent. Asked separately, and past the mock, so
 * the demo can be left for the right reason rather than trapping a phone in it.
 */
export async function canReachHelper() {
  try {
    const res = await fetch(`${getHost()}/healthz`, { signal: AbortSignal.timeout(2500) })
    return res.ok
  } catch {
    return false
  }
}

export async function localHelperAlive() {
  if (mock) return false
  try {
    await directRequest('/healthz', { timeoutMs: 2500 })
    return true
  } catch {
    return false
  }
}

/** Liveness plus the model ForgeFX thinks is attached. */
export const health = async () => (mock ? (await tick(), mock.healthz()) : request('/healthz'))

/**
 * Which unit is on the other end, as a key.
 *
 * Two units share one slot numbering. An AM4 and an FM3 both have a slot 97 and
 * they are not the same preset, so anything cached per preset has to be told
 * them apart or the FM3's scene names turn up on the AM4.
 */
let deviceSlug = 'device'

export const currentDeviceSlug = () => deviceSlug

/*
 * What the last detect said about how this unit numbers its chain.
 *
 * Cached beside the slug, and for the same reason: it is a fact about the
 * attached unit that a dozen callers need and none of them are holding. See
 * zeroBasedChain — the AM4 reports its four slots from one while the app counts
 * from zero, and the correction has to happen where the list arrives.
 */
let lastCaps = null

/** Full capability report: grid size, scene count, preset count, what writes are allowed. */
export const detect = async () => {
  const res = mock ? (await tick(), mock.detect()) : await request('/device/detect')
  const label = res?.short || res?.name
  if (label) deviceSlug = String(label).toLowerCase().replace(/[^a-z0-9]/g, '') || 'device'
  lastCaps = res?.capabilities ?? null
  return res
}

/**
 * Small documents the host holds on behalf of every browser that talks to it.
 *
 * localStorage is per-browser by definition, which is exactly the wrong shape
 * for something the Mac learns and the phone needs. ForgeFX already keeps a
 * document store for app config, it survives restarts, and writes to its config
 * collection are one of the few things allowed over the remote relay — so both
 * ends of a gig can read and write it.
 *
 * Never load-bearing. Every caller treats a miss as "not known yet", because a
 * host that has never been written to returns 404 and that is normal.
 */
export async function readHostDoc(id) {
  if (mock) return null
  try {
    const doc = await request(`/store/config/${encodeURIComponent(id)}`)
    return doc?.data ?? null
  } catch {
    return null
  }
}

export async function deleteHostDoc(id) {
  if (mock) return false
  try {
    await request(`/store/config/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return true
  } catch {
    // Deletes don't travel the relay, and a doc that was never written is
    // already in the state we wanted.
    return false
  }
}

export async function writeHostDoc(id, data) {
  if (mock) return false
  try {
    await request(`/store/config/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ data, origin: 'fractal' })
    })
    return true
  } catch {
    // Read-only or unreachable host: the local cache still works, for this browser.
    return false
  }
}

/**
 * A name that wants to be on the unit but couldn't be written yet.
 *
 * Renames are one of the things ForgeFX refuses over the remote relay, and it
 * is right to: a phone shouldn't rewrite what's in a slot. But a preset
 * generated from the phone comes with a name, and dropping it on the floor
 * meant every remote generation kept whatever the slot was called before.
 *
 * The host's own document store is the way across — writes to it are allowed
 * remotely, it survives restarts, and it is already how scene names reach the
 * phone. So the phone parks the name here, and the app at the Mac — where a
 * rename is allowed — picks it up and writes it. Keyed per unit and slot,
 * because an AM4 slot 97 and an FM3 slot 97 are different presets.
 */
const pendingNameKey = (slot) => `fractal.pendingName.${deviceSlug}.${slot}`

export const parkPresetName = (slot, name) =>
  writeHostDoc(pendingNameKey(slot), { name, at: Date.now() })

export const takeParkedPresetName = async (slot) => {
  const doc = await readHostDoc(pendingNameKey(slot))
  return typeof doc?.name === 'string' && doc.name.trim() ? doc.name.trim() : null
}

export const clearParkedPresetName = (slot) => deleteHostDoc(pendingNameKey(slot))

/**
 * A slot write asked for from the phone, and carried out at the Mac.
 *
 * ForgeFX will not take a store over the relay, and that is not a bug to work
 * around: its allowlist names it, and a phone at the far side of a room that
 * can overwrite slot 67 with a mis-tap is a worse app than one that can't. But
 * "you cannot save from here" is the wrong answer to someone who has just spent
 * ten minutes on a tone with the amp across the room.
 *
 * So the request travels the one road that is open — the host's document store,
 * which the relay does allow — and the Mac does the writing, which is where the
 * writing was always allowed to happen. It carries the slot it came from, so
 * the Mac can tell "save what is loaded" from "save something the unit has
 * since moved on from", and an id, so the phone can be told what became of it
 * rather than being left to wonder.
 */
const pendingSaveKey = () => `fractal.pendingSave.${deviceSlug}`
const saveResultKey = () => `fractal.saveResult.${deviceSlug}`

export const parkSave = (request) => writeHostDoc(pendingSaveKey(), { ...request, at: Date.now() })
export const takeParkedSave = () => readHostDoc(pendingSaveKey())
export const clearParkedSave = () => deleteHostDoc(pendingSaveKey())

export const reportSave = (result) => writeHostDoc(saveResultKey(), { ...result, at: Date.now() })
export const readSaveResult = () => readHostDoc(saveResultKey())

/** The preset currently loaded on the unit. */
/**
 * The preset loaded on the unit.
 *
 * The name is cleaned on the way in rather than at each place it is shown.
 * An empty gen-3 slot reports `<EMPTY>` written over the front of whatever name
 * was in the buffer before, so the tail of the old one comes back attached —
 * "<EMPTY>k Album Chug" on slot 495. Every consumer of this, from the top bar
 * to the model's context to the name a save is offered under, would otherwise
 * repeat it. See lib/presetName.js.
 */
export const currentPreset = async () => {
  const res = mock ? (await tick(), mock.preset()) : await request('/preset')
  if (res && typeof res.name === 'string') {
    // The fact travels with the cleaning: past here nobody can tell an empty
    // slot from a preset somebody made and never named, and those read
    // differently on a screen you look at from arm's length.
    return { ...res, name: cleanPresetName(res.name), empty: isEmptySlotName(res.name) }
  }
  return res
}

/** Every block placed in the current preset, with grid position, bypass state and channel. */
export const presetBlocks = async () => {
  const list = mock ? (await tick(), mock.presetBlocks()) : await request('/preset/blocks')
  /* One convention inside the app, whatever the driver answered. */
  return zeroBasedChain(list, lastCaps)
}

/** Named parameters for one placed block. `eid` is the effect id from presetBlocks(). */
export const blockParams = async (eid) =>
  mock ? (await tick(), mock.blockParams(eid)) : request(`/preset/blocks/${eid}/params`)

/** ForgeFX's own reference material for a block family. */
export const blockHelp = (slug) =>
  mock ? tick().then(() => null) : request(`/help/blocks/${slug}`)

/** Model roster for a block family, e.g. 'amp' -> 331 amp models. */
export const blockTypes = async (slug) =>
  mock ? (await tick(), mock.blockTypes(slug)) : request(`/blocks/${slug}/types`)

/**
 * Set one parameter.
 *
 * `value` is in the parameter's own units — that is what the generator produces
 * and what the player sees. `param` carries the min/max/log the device reported,
 * and is required, because the wire format is normalised 0-1 and there is no way
 * to convert without the range.
 *
 * This matters more than it looks: an out-of-range write does not error. It
 * clamps and returns {"ok":true}. Sending 7.5 for a 0-10 gain pins it at 10 and
 * reports success.
 */

export const setParam = (eid, paramId, value, param, continuous) => {
  const norm = toNormalized(value, param)

  // Recorded so the app can show what it actually put on the wire. Reading this
  // off a diagnostics panel beats asking someone to open browser devtools, and
  // it is the one piece of evidence that does not depend on which parameters a
  // given generation happened to pick.
  const outOfRange =
    param && typeof param.min === 'number' && (value < param.min || value > param.max)

  recordWire({
    eid,
    paramId,
    name: param?.name,
    wanted: value,
    sent: norm,
    outOfRange,
    continuous: continuous ?? preferredEncoding(eid, paramId),
    range: param ? { min: param.min, max: param.max, log: !!param.log } : null
  })

  if (norm === null) {
    return Promise.reject(
      new ForgeError(`No range known for parameter ${paramId}; refusing to write a guessed value.`)
    )
  }
  if (mock) return tick().then(() => mock.setParam(eid, paramId, norm))

  return request(`/preset/blocks/${eid}/params/${paramId}`, {
    method: 'PUT',
    body: JSON.stringify({
      value: norm,
      continuous: continuous ?? preferredEncoding(eid, paramId)
    })
  })
}

/**
 * Set a discrete selector — bypass mode, input select, cab IR slot.
 *
 * These are not knobs. They carry an ordinal from a fixed option list, and
 * normalising one would be meaningless: option 2 of 5 is not "40% of the way
 * along". They go out on the discrete path with the ordinal intact, which is
 * the same path a model change uses.
 */
export const setEnum = (eid, paramId, ordinal) => {
  recordWire({
    eid,
    paramId,
    wanted: ordinal,
    sent: ordinal,
    enum: true,
    continuous: false,
    range: null
  })
  if (mock) return tick().then(() => mock.setEnum(eid, paramId, ordinal))
  return request(`/preset/blocks/${eid}/params/${paramId}`, {
    method: 'PUT',
    body: JSON.stringify({ value: ordinal, continuous: false })
  })
}

/** Cab block state for the IR picker: mode, per-slot bank and IR selection. */
export const cabState = (eid) =>
  mock ? tick().then(() => mock.cabState(eid)) : request(`/preset/blocks/${eid}/cab`)

/** IR names by bank — Factory 1/2, Legacy, Scratchpad. */
export const listIrBanks = () => (mock ? tick().then(() => mock.irs()) : request('/cab/irs'))

/**
 * Verbatim .syx dump of a preset. Omit the location for the working buffer.
 *
 * This is the only real backup — history stores generated specs, which describe
 * an intent rather than a preset. A dump is the preset.
 */
export const backupPreset = (location) =>
  mock
    ? tick().then(() => mock.backup(location))
    : request('/preset/backup', {
        method: 'POST',
        body: JSON.stringify(location === undefined ? {} : { location })
      })

/**
 * Push raw .syx back to the unit.
 *
 * The FM3 reports restoreDump: false, so /preset/restore is refused. /preset/load
 * takes the same bytes into the edit buffer instead, and storing is a separate
 * step — which is arguably better, since it lands somewhere you can hear before
 * it overwrites anything.
 */
export async function loadPresetBytes(bytes) {
  if (mock) return tick().then(() => mock.loadBytes(bytes))
  const res = await fetch(`${getHost()}/preset/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(bytes)
  })
  const body = await res.text()
  let parsed = null
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    parsed = body
  }
  if (!res.ok) throw new ForgeError(parsed?.error || parsed?.message || res.statusText)
  return parsed
}

/** Live per-block output meters, for showing where signal actually is. */
export const liveMeters = () =>
  mock ? tick().then(() => mock.meters()) : request('/preset/monitors/live')


/** Read one parameter's current value, for confirming a write landed. */
async function readParamValue(eid, paramId) {
  const res = await blockParams(eid)
  return (res?.named || []).find((p) => p.id === paramId)?.value
}

/**
 * Write a value and confirm it took, retrying on the other encoding if not.
 *
 * The device accepts a write it then ignores, and reports success either way,
 * so confirming is the only way to know. Tolerance is proportional because
 * the device rounds — asking for 40 Hz can read back 39.998.
 */
export async function setParamConfirmed(eid, paramId, value, param) {
  const first = preferredEncoding(eid, paramId)

  const a = await setParam(eid, paramId, value, param, first)
  const checkA = await landed(eid, paramId, value)
  recordCheck({
    eid,
    paramId,
    name: param?.name,
    wanted: value,
    readBack: checkA.actual,
    landed: checkA.ok,
    encoding: first,
    attempt: 1,
    deviceOk: a?.ok
  })
  if (checkA.ok) {
    rememberEncoding(eid, paramId, first)
    return { ok: true, continuous: first, retried: false }
  }

  const b = await setParam(eid, paramId, value, param, !first)
  const checkB = await landed(eid, paramId, value)
  recordCheck({
    eid,
    paramId,
    name: param?.name,
    wanted: value,
    readBack: checkB.actual,
    landed: checkB.ok,
    encoding: !first,
    attempt: 2,
    deviceOk: b?.ok
  })
  if (checkB.ok) {
    rememberEncoding(eid, paramId, !first)
    return { ok: true, continuous: !first, retried: true }
  }

  return { ok: false, continuous: null, retried: true }
}

/**
 * Read the value back and say whether it matches, returning what was actually
 * there either way.
 *
 * The read-back is the only trustworthy signal. An AM4 reports {"ok": false} on
 * a continuous write that landed correctly — its driver waits 600ms for a
 * command acknowledgement and calls the write failed when none arrives, while
 * the frame goes out regardless. So the device's own answer is recorded for
 * interest but never believed.
 */
async function landed(eid, paramId, wanted) {
  try {
    // Without this the read can return the value we just sent from cache,
    // confirming a write that never reached the hardware.
    await clearDeviceCache().catch(() => {})
    const actual = await readParamValue(eid, paramId)
    if (typeof actual !== 'number') return { ok: false, actual: null }
    const tolerance = Math.max(0.05, Math.abs(wanted) * 0.02)
    return { ok: Math.abs(actual - wanted) <= tolerance, actual }
  } catch {
    return { ok: false, actual: null }
  }
}

const wireLog = []

function recordWire(entry) {
  wireLog.unshift({ ...entry, at: new Date() })
  if (wireLog.length > 120) wireLog.length = 120
}

const checkLog = []

/**
 * What came back when a write was verified.
 *
 * The wire log says what went out; on its own it can't distinguish a value that
 * landed from one the device quietly ignored. Recording the read-back next to
 * what was asked for makes the diagnostics panel answer that without anyone
 * running curl against localhost.
 */
function recordCheck(entry) {
  checkLog.unshift({ ...entry, at: new Date() })
  if (checkLog.length > 120) checkLog.length = 120
}

/** Every verified write, newest first. */
export const getCheckLog = () => checkLog.slice()
export const clearCheckLog = () => {
  checkLog.length = 0
}

/** Everything this app has put on the wire, newest first. */
export const getWireLog = () => wireLog.slice()
export const clearWireLog = () => {
  wireLog.length = 0
}


/** Engage or bypass a block. */
export const setBypass = (eid, bypassed) =>
  mock
    ? tick().then(() => mock.setBypass(eid, bypassed))
    : request(`/preset/blocks/${eid}/bypass`, {
    method: 'POST',
    body: JSON.stringify({ bypassed })
  })

/** Swap the model loaded in a block. */
export const setType = (eid, value) =>
  mock
    ? tick().then(() => mock.setType(eid, value))
    : request(`/preset/blocks/${eid}/type`, {
    method: 'POST',
    body: JSON.stringify({ value })
  })

/** Commit the working preset to a numbered slot. Overwrites whatever is there. */
export const storePreset = (number) =>
  mock ? tick().then(() => mock.storePreset(number)) : request('/preset/store', {
    method: 'POST',
    body: JSON.stringify({ number })
  })

export { ForgeError }

/**
 * Build the generation context: for every placed block, its live parameters and
 * the model roster its family offers.
 *
 * Read from the device rather than from a committed catalog, so it always
 * matches the firmware in front of the player. Sequential on purpose — the
 * transport is a single serial port and parallel reads collide.
 */
export async function readSchema(blocks, onProgress, { force = false } = {}) {
  if (force) paramCache.clear()

  // The generation about to happen is computed against these ranges, so a stale
  // read here produces values that are wrong from the start. Only worth the
  // round trip when something is actually going to be read.
  const needsRead = blocks.some(
    (b) => !EXCLUDED_BLOCKS.includes(b.slug) && !paramCache.has(b.effectId)
  )
  if (needsRead) {
    try {
      await clearDeviceCache()
    } catch {
      // Older builds may not expose it; a stale read is better than no schema.
    }
  }

  const editable = blocks.filter((b) => !EXCLUDED_BLOCKS.includes(b.slug))
  const typeCache = rosterCache
  const helpCache = helpTextCache
  const schema = []

  for (let i = 0; i < editable.length; i++) {
    const block = editable[i]
    onProgress?.(i + 1, editable.length, block.name)

    let params = paramCache.get(block.effectId)
    if (!params) {
      params = []
      try {
        const res = await blockParams(block.effectId)
        params = safeParams(disambiguate(res?.named || []))
      } catch {
        // A block with no readable parameters is not a failure — skip it.
      }
      paramCache.set(block.effectId, params)
    }

    let models = []
    if (!typeCache.has(block.slug)) {
      try {
        typeCache.set(block.slug, (await blockTypes(block.slug)) || [])
      } catch {
        typeCache.set(block.slug, [])
      }
    }
    models = typeCache.get(block.slug)

    // ForgeFX ships reference copy for each block family and each of its
    // parameters. Without it the generator is inferring what a control does from
    // its name, which is how "Amp1 Level" got dialled like a tone control.
    // Stable per family, so it caches with the rosters rather than costing
    // tokens every run.
    if (!helpCache.has(block.slug)) {
      try {
        helpCache.set(block.slug, await blockHelp(block.slug))
      } catch {
        helpCache.set(block.slug, null)
      }
    }
    const help = helpCache.get(block.slug)

    schema.push({
      eid: block.effectId,
      name: block.name,
      slug: block.slug,
      bypassed: block.bypassed,
      channel: block.channel,
      params: params.map((p) => {
        const blurb = help?.params?.[p.id]
        const text = typeof blurb === 'string' ? blurb : blurb?.summary || blurb?.text
        return text ? { ...p, does: text } : p
      }),
      models,
      about: help?.summary || null
    })
  }

  return schema
}

/**
 * Apply a validated set of changes, one write at a time.
 *
 * Sequential is a requirement, not a style choice: these all travel down one
 * serial port.
 *
 * Each block is finished before the next is started, because everything here
 * is relative to two things the write itself moves: the channel the block is
 * on, and the model that channel is playing.
 *
 * A channel selection goes first. Values belong to a channel, not to a block,
 * so a change carrying one is a change to *that* channel and has to be sitting
 * on it before anything is set — otherwise the lead settings land on top of
 * the rhythm ones. A model swap goes next, because changing a model resets
 * that block's parameters and would otherwise undo the values just written.
 *
 * Both also change the parameter *ranges* — different amp models have
 * different low-cut spans, and a channel is free to be on a different model
 * entirely — and values were normalised against the ranges read beforehand. So
 * after either, that block's parameters are re-read and the conversion redone
 * against what the unit now reports. Without this, a frequency asked for in
 * the middle of the old range can land pinned at the floor of the new one.
 */
export async function applyChanges(changes, onProgress) {
  const failures = []
  let step = 0
  const total = changes.reduce((n, c) => {
    // A channel or a model move costs its own write plus the re-read after it.
    const moved = c.channel !== undefined || c.type !== undefined
    return (
      n +
      c.params.length +
      (c.channel !== undefined ? 1 : 0) +
      (c.type !== undefined ? 1 : 0) +
      (moved ? 1 : 0) +
      (c.bypassed !== undefined ? 1 : 0)
    )
  }, 0)

  const advance = (label) => onProgress?.(++step, total, label)

  for (const change of changes) {
    // 1. the channel these values belong to
    let moved = false
    if (change.channel !== undefined) {
      advance(`${change.name} → channel ${change.channel}`)
      try {
        await setChannel(change.eid, change.channel)
        moved = true
      } catch (err) {
        failures.push(`${change.name} channel — ${err.message}`)
      }
    }

    // 2. the model on it
    if (change.type !== undefined) {
      advance(`${change.name} → ${change.typeName}`)
      try {
        await setType(change.eid, change.type)
        moved = true
      } catch (err) {
        failures.push(`${change.name} model — ${err.message}`)
      }
    }

    // 3. re-read ranges if either moved
    let fresh = null
    if (moved) {
      advance(`Re-reading ${change.name}`)
      try {
        const res = await blockParams(change.eid)
        fresh = new Map(
          (res?.named || []).map((p) => [p.id, { min: p.min, max: p.max, log: !!p.log }])
        )
      } catch {
        // Fall back to the ranges read before the move rather than skipping
        // the writes entirely.
      }
    }

    // 4. parameters, then bypass
    for (const param of change.params) {
      const range = fresh?.get(param.id) ?? param.range
      advance(`${change.name} · ${param.name} → ${param.to}${param.unit}`)
      try {
        const res = await setParamConfirmed(change.eid, param.id, param.to, {
          ...range,
          name: param.name
        })
        if (!res.ok) {
          failures.push(
            `${change.name} · ${param.name} — device ignored both write encodings`
          )
        }
      } catch (err) {
        failures.push(`${change.name} · ${param.name} — ${err.message}`)
      }
    }
    if (change.bypassed !== undefined) {
      advance(`${change.name} ${change.bypassed ? 'bypassed' : 'engaged'}`)
      try {
        await setBypass(change.eid, change.bypassed)
      } catch (err) {
        failures.push(`${change.name} bypass — ${err.message}`)
      }
    }
  }

  return failures
}

/**
 * Write a scene plan: one rig, several states of it.
 *
 * A scene carries two things per block — whether it is on, and which channel it
 * plays — and both are written here. What a channel *sounds* like is not: those
 * values belong to the channel and are written once by applyChanges. That is
 * the whole reason this is a separate pass rather than part of one: the rig,
 * and every channel of it that this preset uses, has to exist before the states
 * over it mean anything.
 *
 * The player's own scene is put back at the end. Writing scenes moves the unit
 * through all of them, and finishing on scene 6 because that was the last one
 * in the list would be the app rearranging the stage while your back is turned.
 */
export async function applyScenes(scenes, onProgress) {
  const failures = []
  if (!scenes?.length) return failures

  // Where the player was, so they can be put back. If this read fails the
  // scenes are still worth writing — we just cannot restore, so we do not
  // pretend to by guessing zero.
  let cameFrom = null
  try {
    const now = await getScene()
    cameFrom = typeof now?.index === 'number' ? now.index : null
  } catch {
    cameFrom = null
  }

  let step = 0
  const total = scenes.reduce(
    (n, s) => n + 1 + s.blocks.length + s.blocks.filter((b) => b.channel).length,
    0
  )
  const advance = (label) => onProgress?.(++step, total, label)

  for (const scene of scenes) {
    const label = scene.name || `Scene ${scene.index + 1}`
    advance(`Scene ${scene.index + 1} — ${label}`)
    try {
      await setScene(scene.index)
    } catch (err) {
      failures.push(`Scene ${scene.index + 1} — ${err.message}`)
      continue
    }

    if (scene.name) {
      try {
        await setSceneName(scene.index, scene.name)
      } catch (err) {
        /*
         * Said out loud rather than swallowed.
         *
         * This used to be an empty catch, on the reasoning that a scene which
         * works but keeps its old name is not worth failing the build over.
         * That reasoning is fine and the silence was not: naming was refused
         * outright over a remote session for months, and because nothing here
         * said so, it read as the feature simply not working. "The scene name
         * generation and saving is also still not working. I thought we
         * addressed that?"
         *
         * Still not a failure — the scene itself was written and the preset is
         * good. It goes in the same list the caller already shows, so the
         * person is told which names did not land and can see why.
         */
        failures.push(`Scene ${scene.index + 1} — kept its old name: ${err.message}`)
      }
    }

    for (const block of scene.blocks) {
      advance(`${label} · ${block.name} ${block.bypassed ? 'off' : 'on'}`)
      try {
        await setBypass(block.eid, block.bypassed)
      } catch (err) {
        failures.push(`${label} · ${block.name} — ${err.message}`)
      }
      // The channel this scene plays. Written while standing in the scene, for
      // the same reason the bypass is: it is the scene that remembers it.
      if (block.channel) {
        advance(`${label} · ${block.name} → channel ${block.channel}`)
        try {
          await setChannel(block.eid, block.channel)
        } catch (err) {
          failures.push(`${label} · ${block.name} channel — ${err.message}`)
        }
      }
    }
  }

  if (cameFrom !== null) {
    try {
      await setScene(cameFrom)
    } catch {
      failures.push(`Wrote the scenes but could not switch back to scene ${cameFrom + 1}.`)
    }
  }

  return failures
}

/** Load a preset by slot number on the hardware. */
export const selectPreset = (number) =>
  mock ? tick().then(() => mock.selectPreset(number)) : request('/preset/select', { method: 'POST', body: JSON.stringify({ number }) })

/** Name of a stored preset, without loading it. */
export const presetName = async (number) =>
  mock ? (await tick(), mock.presetName(number)) : request(`/presets/${number}`)

/** Rename the working buffer. Visible immediately; persist with storePreset. */
export const setPresetName = (name) =>
  mock ? tick().then(() => mock.setPresetName(name)) : request('/preset/name', { method: 'POST', body: JSON.stringify({ name }) })

/**
 * Fetch names for a range of slots.
 *
 * The bulk scan endpoint needs the canScanNames capability, which the FM3
 * doesn't report, so this walks slots one at a time. Sequential and paged
 * on purpose: 512 slots down one serial port is not something to do eagerly.
 *
 * Each slot goes through the same two-route read as the full scan, and shares
 * its cache — a page of a browser you've already scanned costs nothing.
 */
export async function presetRange(start, count, onProgress) {
  const out = []
  for (let i = 0; i < count; i++) {
    const number = start + i
    onProgress?.(i + 1, count)
    out.push({ number, name: await rememberedName(number) })
  }
  return out
}

/**
 * Read back what was just written and report anything that didn't stick.
 *
 * Worth the extra traffic. ForgeFX caches block parameters and has no
 * invalidation hook, so a read can report a value the hardware doesn't hold —
 * which once sent us chasing a silent preset that was never broken. A write
 * that silently didn't land looks identical to one that did, unless something
 * checks.
 */
export async function verifyChanges(changes, onProgress) {
  const mismatches = []
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    if (!change.params.length) continue
    onProgress?.(i + 1, changes.length, change.name)

    let live
    try {
      live = await blockParams(change.eid)
    } catch {
      continue
    }
    const byId = new Map((live?.named || []).map((p) => [p.id, p]))

    for (const param of change.params) {
      const actual = byId.get(param.id)
      if (!actual) continue
      const drift = Math.abs((actual.value ?? 0) - param.to)
      const tolerance = Math.max(0.05, Math.abs(param.to) * 0.02)
      if (drift > tolerance) {
        mismatches.push({
          block: change.name,
          param: param.name,
          wanted: param.to,
          got: actual.value
        })
      }
    }
  }
  return mismatches
}

/** Current scene index and names. */
export const getScene = async () => (mock ? (await tick(), mock.getScene()) : request('/scene'))

/** Switch scenes. The FM3 has eight. */
export const setScene = (index) =>
  mock ? tick().then(() => mock.setScene(index)) : request('/scene', { method: 'POST', body: JSON.stringify({ index }) })

export const setSceneName = (index, name) =>
  mock ? tick().then(() => mock.setSceneName(index, name)) : request('/scene/name', { method: 'POST', body: JSON.stringify({ index, name }) })

/** Switch a block's channel. Channels are A-D and hold independent settings. */
export const setChannel = (eid, channel) =>
  mock
    ? tick().then(() => mock.setChannel(eid, channel))
    : request(`/preset/blocks/${eid}/channel`, {
    method: 'POST',
    body: JSON.stringify({ channel })
  })

/** Cab block's current IR assignment. */
export const getCab = (eid) => request(`/preset/blocks/${eid}/cab`)

/** Impulse responses available on the unit. */
export const listIrs = () => request('/cab/irs')


/**
 * Clear ForgeFX's parameter cache.
 *
 * There is an invalidation hook after all. ForgeFX caches block parameters, and
 * after a busy session a read can report a value the hardware doesn't hold —
 * which once had us chasing a preset that read Amp1 Level = -80 and was actually
 * at -8, with a server restart the only known cure. This is the supported cure.
 *
 * Called before any read whose accuracy decides something: verifying a write,
 * or building the schema a generation will be computed against.
 */
export const clearDeviceCache = () =>
  mock ? tick().then(() => ({ ok: true })) : request('/device/cache', { method: 'DELETE' })

/**
 * One stored version's exact bytes, as a plain array.
 *
 * The route answers with an octet-stream rather than JSON, so this goes through
 * fetch directly. Local-only by nature: it exists to write files into a folder
 * this Mac chose, so it never needs to travel the relay.
 */
export async function versionBytes(id) {
  if (mock) {
    await tick()
    return []
  }
  const res = await fetch(`${getHost()}/version/${encodeURIComponent(id)}/syx`)
  if (!res.ok) throw new Error(`Version ${id} not readable (${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * What a preset file actually holds, without loading any of it.
 *
 * The host decodes offline — no transport touched — and dispatches on the
 * model byte, so an AM4 dump decodes even while an FM3 is the attached unit.
 * A file can hold a whole bank; the answer is per-preset: name, slot, scene
 * names where the format carries them, and whether the checksum still agrees
 * with the bytes.
 */
export const decodePresetFile = (bytes) =>
  mock
    ? tick().then(() => ({ model: 'demo', count: 1, presets: [{ name: 'Demo preset', location: 0 }] }))
    : request('/preset/decode', { method: 'POST', body: JSON.stringify({ bytes: Array.from(bytes) }) })

/** Modifier slots and the sources that can drive them. */
export const modifierModel = () => (mock ? tick().then(() => mock.modModel()) : request('/mod/model'))

/**
 * Attach a modifier source to a parameter.
 *
 * This is what makes a preset respond rather than sit still — an envelope
 * follower on drive so it cleans up when you back off, an LFO on a filter, an
 * expression pedal on delay mix. Static values are a preset; these are a
 * performance.
 */
export const bindModifier = (slot, targetEffectId, targetParam, source) =>
  mock
    ? tick().then(() => mock.bindModifier(slot, targetEffectId, targetParam, source))
    : request('/mod/bind', {
        method: 'POST',
        body: JSON.stringify({ slot, targetEffectId, targetParam, source })
      })

/** Which blocks are engaged in each scene, and on which channel. */
export const sceneState = () =>
  mock ? tick().then(() => mock.sceneStateNow()) : request('/preset/scene-state')

/** Preset tempo in BPM. Delays and modulation sync to it. */
export const getTempo = () => (mock ? tick().then(() => mock.tempo()) : request('/tempo'))

export const setTempo = (bpm) =>
  mock
    ? tick().then(() => mock.setTempo(bpm))
    : request('/tempo', { method: 'POST', body: JSON.stringify({ bpm }) })

export const tapTempo = () =>
  mock ? tick().then(() => mock.tapTempo()) : request('/tempo/tap', { method: 'POST' })

/** Turn the hardware tuner on or off. */
export const setTuner = (on) =>
  mock
    ? tick().then(() => ({ ok: true }))
    : request('/tuner', { method: 'POST', body: JSON.stringify({ on }) })


/**
 * ForgeFX's own preset version history.
 *
 * Distinct from the saved presets in this app. Those store a generated spec —
 * an intent, replayable against any preset. A version is a raw .syx snapshot of
 * one slot at one moment, which is what you want when the question is "put it
 * back how it was" rather than "do that again".
 */
export const listVersions = (location) =>
  mock
    ? tick().then(() => mock.versions(location))
    : request(`/versions${location === undefined ? '' : `?location=${location}`}`)

/** Play a snapshot without occupying a slot — it lands in the edit buffer. */
export const loadVersion = (id) =>
  mock ? tick().then(() => ({ ok: true })) : request(`/version/${id}/load`, { method: 'POST' })

/** Put a snapshot back in the slot it came from. Destructive. */
export const restoreVersion = (id) =>
  mock ? tick().then(() => ({ ok: true })) : request(`/version/${id}/restore`, { method: 'POST' })

/** Read a stored preset without loading it onto the unit. */
export const presetSummary = (n, full) =>
  mock
    ? tick().then(() => mock.presetSummary(n))
    : request(`/presets/${n}/summary${full ? '?full=1' : ''}`)

/** Every stored backup ForgeFX holds. */
export const listBackups = () =>
  mock ? tick().then(() => ({ backups: [] })) : request('/backups')

/**
 * Back up a range of slots in one pass.
 *
 * Per-preset .syx covers the preset you are working on. This covers the case
 * where something went wrong and you don't yet know which slot it touched.
 */
export const backupDevice = (label, from = 0, to = 511) =>
  mock
    ? tick().then(() => ({ ok: true, label }))
    : request('/backup/device', {
        method: 'POST',
        body: JSON.stringify({ label, from, to })
      })


/** Footswitch layout the unit reports. */
export const fcModel = () => (mock ? tick().then(() => null) : request('/fc/model'))


/* ------------------------------------------------------------------
   Grid editing

   Indexing is the trap. /preset/blocks reports col 0-indexed, while the
   grid write routes take row and col 1-indexed to match FM-Edit. Mixing
   them puts a block one column from where you meant.

   Everything below takes display coordinates — the ones /preset/blocks
   uses — and converts at the boundary, so the rest of the app only ever
   deals in one convention.
   ------------------------------------------------------------------ */

const toWireCell = (row, col) => ({ row, col: col + 1 })

/**
 * Put a block in a cell, or clear it with blockId 0.
 *
 * ForgeFX sends a cell-select before the insert — the FM3 drops the block at a
 * default cell otherwise — and watches for a 0x64 rejection on both frames, so
 * a refusal comes back as ok:false rather than silence. Known refusals: 0x0b for
 * an impossible grid position, 0x0c for DSP overload.
 */
export const placeBlock = (row, col, blockId) =>
  mock
    ? tick().then(() => mock.placeBlock(row, col, blockId))
    : request('/preset/grid/cell', {
        method: 'PUT',
        body: JSON.stringify({ ...toWireCell(row, col), blockId })
      })

export const clearCell = (row, col) => placeBlock(row, col, 0)

/** Connect or cut a cable from one cell to a row in the next column. */
export const setCable = (srcRow, srcCol, destRow, connect = true) =>
  mock
    ? tick().then(() => ({ ok: true }))
    : request('/preset/grid/cable', {
        method: 'POST',
        body: JSON.stringify({ ...toWireCell(srcRow, srcCol), srcRow, srcCol: srcCol + 1, destRow, connect })
      })

/** The routing grid as the device reports it, including cabling. */
export const readGrid = () =>
  mock ? tick().then(() => mock.grid()) : request('/preset/grid')


/**
 * Placeable blocks for whichever device is attached.
 *
 * GET /blocks is the palette: `page` is the block's own type code and goes
 * straight back to placeCell. It has to come from the device — the FM3 and AM4
 * use entirely different numbering, so a hardcoded list would place the wrong
 * blocks on the wrong unit while looking like it worked.
 */
export const blockCatalog = () =>
  mock ? tick().then(() => mock.blockCatalog()) : request('/blocks')


/**
 * Throw away unsaved edits and reload the preset from flash.
 *
 * Everything this app writes lands in the edit buffer; /preset/store is the only
 * thing that makes it permanent. Reselecting the same slot reloads it from
 * flash, so the edit buffer is discarded — which is the whole of revert.
 */
export const revertPreset = (number) => selectPreset(number)


/**
 * Subscribe to the device event stream.
 *
 * Tuner readings, meters, tempo and change notices are pushed here, not polled.
 * POST /tuner only starts the poll timer inside ForgeFX — the readings arrive
 * over this stream, so turning the tuner on without subscribing gives you a
 * running timer and nothing to look at.
 *
 * Returns an unsubscribe function.
 */
export function subscribeEvents(onEvent) {
  if (mock) {
    const tuner = mock.tunerStream()
    const id = setInterval(() => onEvent(tuner.next()), 400)
    return () => clearInterval(id)
  }

  // Over the relay the host bridges the same events onto the channel, so there
  // is no EventSource to open — localhost isn't reachable from the phone.
  if (remoteActive()) return subscribeRemoteEvents(onEvent)

  let source
  try {
    source = new EventSource(`${getHost()}/events`)
  } catch {
    return () => {}
  }

  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data))
    } catch {
      // Heartbeats and comments arrive as non-JSON; ignore them.
    }
  }
  source.onerror = () => {
    // EventSource reconnects on its own. Failing loudly here would mean an
    // error toast every time the server restarts.
  }

  return () => source.close()
}

/**
 * The name in a stored slot, whatever it takes to learn it.
 *
 * `/presets/{n}` is the short, obvious read, and on an AM4 it answers with the
 * name the unit has stored. Gen-3 units have no such query in their firmware,
 * so ForgeFX answers that same route with a `{number, name: ''}` stub: 200 OK,
 * and nothing in it. That is what an FM3's preset list was showing — 512 slots
 * read in a blink and every one of them "empty", including the one that was
 * loaded and named on screen at the time.
 *
 * On those units a name exists only inside the preset's own body, so the
 * fallback is to make the unit dump the preset and decode it. That costs a
 * SysEx transfer per slot instead of a short reply, which is why it isn't tried
 * first — and why, once the short route has been caught stubbing, it isn't
 * tried again for the rest of the session.
 */
let nameRouteStubbed = false
let deepNamesOff = false

/** Forget what was learned about the routes — a different unit answers differently. */
export function resetNameRoutes() {
  nameRouteStubbed = false
  deepNamesOff = false
}

/** Whether names on this unit cost a preset dump each. Known only after the first read. */
export const namesCostADump = () => nameRouteStubbed

/**
 * `known` says the unit has answered about this slot and won't say more —
 * including an answer of "nothing stored here". An unknown is a slot the unit
 * declined to talk about, and is worth asking again rather than remembering.
 */
export async function storedName(number) {
  let quick = null // null = the route didn't answer at all
  if (!nameRouteStubbed) {
    try {
      const res = await presetName(number)
      quick = cleanPresetName(res?.name)
    } catch {
      quick = null
    }
    if (quick) return { name: quick, known: true }
  }

  if (deepNamesOff) return { name: '', known: quick === '' }

  let decoded = null
  try {
    const res = await presetSummary(number)
    decoded = cleanPresetName(res?.name)
  } catch (err) {
    // 501 is ForgeFX saying this unit has no dump to decode, which is final.
    // Anything else is one slot going wrong, and the next slot deserves a try.
    if (err?.status === 501) deepNamesOff = true
    return { name: '', known: quick === '' && deepNamesOff }
  }

  // The short route said nothing about a slot that plainly has a name in it.
  // That route is the stub, and there is no point asking it about the other 511.
  if (decoded && quick === '') nameRouteStubbed = true
  return { name: decoded, known: true }
}

/**
 * The names, once learned, kept.
 *
 * They used to live for a session, which was fine when a name cost a short
 * reply. A gen-3 name costs a preset dump, so a full list is minutes of the
 * unit's attention — worth paying for once, not once per session. Kept per
 * unit, because slot 97 on an AM4 is not slot 97 on an FM3, and only ever
 * stale when something is stored, which is when the slot is forgotten.
 */
const NAME_STORE = 'fractal.presetNames'

let nameCache = new Map()
let namesFor = null

/** The unit these names belong to. A demo scan is never confused for a real one. */
const nameOwner = () => (mock ? `${currentDeviceSlug()}:demo` : currentDeviceSlug())

function restoreNames() {
  const owner = nameOwner()
  if (namesFor === owner) return
  namesFor = owner
  nameCache = new Map()
  resetNameRoutes()
  try {
    const all = JSON.parse(localStorage.getItem(NAME_STORE) || '{}')
    for (const [n, name] of Object.entries(all[owner] || {})) nameCache.set(Number(n), name)
  } catch {
    // A full or disabled localStorage costs a re-scan, nothing more.
  }
}

let saveTimer = null

/** Coalesced, because a scan learns names one at a time and this rewrites the lot. */
function persistNames() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const all = JSON.parse(localStorage.getItem(NAME_STORE) || '{}')
      all[namesFor] = Object.fromEntries(nameCache)
      localStorage.setItem(NAME_STORE, JSON.stringify(all))
    } catch {
      // As above: the list still holds them for this session.
    }
  }, 500)
}

export function cachedPresetNames() {
  restoreNames()
  return [...nameCache.entries()]
    .map(([number, name]) => ({ number, name }))
    .sort((a, b) => a.number - b.number)
}

export function forgetPresetName(number) {
  restoreNames()
  if (nameCache.delete(number)) {
    persistNames()
    // The host copy loses the slot too, so a phone reading it later asks
    // the unit rather than trusting a name that was just overwritten.
    publishNames()
  }
}

/** Whether this slot's name has been learned (a learned "empty" counts). */
export function knowsName(number) {
  restoreNames()
  return nameCache.has(number)
}

/** How many slots the unit has not been asked about yet. */
export function unreadSlots(total) {
  restoreNames()
  let n = 0
  for (let i = 0; i < total; i++) if (!nameCache.has(i)) n++
  return n
}

/**
 * One slot, learned and kept — for the scan that reads names on its own.
 *
 * Unlike rememberedName it throws when the unit would not say: a slot that
 * came back unknown is not an answer, and a run of them is a unit that has
 * gone quiet, which the scan should notice rather than ask 500 more times.
 */
export async function learnName(number) {
  restoreNames()
  if (nameCache.has(number)) return nameCache.get(number)
  const { name, known } = await storedName(number)
  if (!known) throw new ForgeError(`Slot ${number} did not answer`)
  nameCache.set(number, name)
  persistNames()
  return name
}

/**
 * The names, shared through the host.
 *
 * localStorage is one browser's memory. The Mac is the end with the cable,
 * so it is the end that learns the names — and the phone at the gig is the
 * end that needs them. Like the scene names, they go into ForgeFX's document
 * store, which every browser that talks to the host can read, over the relay
 * included. Only a direct connection writes: a phone publishing back over the
 * relay would be telling the Mac what the Mac told it.
 */
const namesDocId = () => `preset-names-${currentDeviceSlug()}`

let publishTimer = null

/**
 * Put what this browser knows on the host. At most once every few seconds: a
 * scan learns a name at a time, and a timer that restarted on each one never
 * fired while the scan was moving — which is exactly when there was news.
 */
export function publishNames() {
  if (mock || remoteActive() || publishTimer) return
  publishTimer = setTimeout(() => {
    publishTimer = null
    writeHostDoc(namesDocId(), Object.fromEntries(nameCache))
  }, 5000)
}

/** Take the host's copy for every slot this browser doesn't know. Returns how many it learned. */
export async function importHostNames() {
  restoreNames()
  const doc = await readHostDoc(namesDocId())
  if (!doc || typeof doc !== 'object') return 0
  let added = 0
  for (const [key, name] of Object.entries(doc)) {
    const number = Number(key)
    if (!Number.isInteger(number) || typeof name !== 'string' || nameCache.has(number)) continue
    nameCache.set(number, name)
    added++
  }
  if (added) persistNames()
  return added
}

/** One slot's name: from what's already known, and from the unit when it isn't. */
export async function rememberedName(number) {
  restoreNames()
  if (nameCache.has(number)) return nameCache.get(number)
  const { name, known } = await storedName(number)
  if (known) {
    nameCache.set(number, name)
    persistNames()
  }
  return name
}


/**
 * Scene names.
 *
 * Not available from GET /scene on either device — that returns the active
 * index and nothing else, which is why the list showed dashes. Names live in
 * the preset body and only appear once a dump is decoded, and the two families
 * expose that decode differently: gen-3 as `scenes` on the preset summary, the
 * AM4 as `sceneNames` on its backup.
 *
 * Both are heavier reads than a scene query, so this is called on preset change
 * rather than on every poll.
 */
const SCENE_NAME_CACHE = 'fractal.sceneNames'

/** Cache key for one preset on one unit. Slot 97 on an AM4 is not slot 97 on an FM3. */
export const sceneNameKey = (number) => `${currentDeviceSlug()}:${number}`

/** Names last read for a preset, so a session that can't read them still shows them. */
function rememberSceneNames(number, names) {
  if (typeof number !== 'number' || !names?.some((n) => n)) return
  try {
    const all = JSON.parse(localStorage.getItem(SCENE_NAME_CACHE) || '{}')
    all[sceneNameKey(number)] = names
    localStorage.setItem(SCENE_NAME_CACHE, JSON.stringify(all))
  } catch {
    // A full or disabled localStorage costs us a nicety, nothing more.
  }
  // And on the host, where the phone can reach them. Deliberately not awaited:
  // nothing on screen should wait on a write that only helps a later session.
  writeHostDoc(`scene-names-${sceneNameKey(number)}`, names)
}

function recallSceneNames(number) {
  if (typeof number !== 'number') return []
  try {
    const all = JSON.parse(localStorage.getItem(SCENE_NAME_CACHE) || '{}')
    const hit = all[sceneNameKey(number)]
    return Array.isArray(hit) ? hit : []
  } catch {
    return []
  }
}

/**
 * What each scene is called.
 *
 * Two routes, because the devices differ. An FM3 puts scene names in its preset
 * summary. An AM4 does not — its summary returns an empty scenes array, and the
 * names only exist inside a full preset dump, decoded from the raw bytes.
 *
 * That dump is a POST, and POSTs of preset backups are deliberately absent from
 * ForgeFX's remote allowlist. So on an AM4 driven from a phone the names are
 * genuinely unreachable — which is exactly the situation where they matter most,
 * standing on a stage looking for "Lead" rather than "3".
 *
 * So whenever they are readable they're kept — in this browser, and on the host
 * itself. The host copy is the one that matters on stage: the Mac learns the
 * names while the cable is in, and the phone reads them back over the relay,
 * which is the only reason an AM4 shows "Lead" rather than "3" from the floor.
 *
 * Renaming a scene clears both, so a stale name can't outlive the thing it named.
 */
/**
 * Where the last scene-name lookup got its answer, step by step.
 *
 * Names have four possible sources and three of them fail silently by design.
 * That is right for the gig screen — a missing nicety must not error — and
 * wrong for debugging it, which turned into guesswork twice. So the path
 * narrates itself here, and Technical details shows it.
 */
export let sceneNameTrace = []
const traceStep = (step) => sceneNameTrace.push(step)

export async function readSceneNames(number) {
  if (mock) {
    await tick()
    return mock.getScene().names
  }
  sceneNameTrace = []
  traceStep(`lookup for ${sceneNameKey(number)}`)

  if (typeof number === 'number') {
    try {
      const summary = await presetSummary(number)
      const names = summary?.scenes
      if (wrongSlot(number, summary?.number)) {
        traceStep(`summary: answered for ${summary?.number}, not ${number} — ignored`)
      } else if (Array.isArray(names) && names.some((n) => (n || '').trim())) {
        const clean = names.map((n) => (n || '').trim())
        rememberSceneNames(number, clean)
        traceStep('summary: found names')
        return clean
      } else {
        traceStep('summary: no names (normal on an AM4)')
      }
    } catch (err) {
      traceStep(`summary: failed — ${err.message}`)
    }
  }

  try {
    const dump = await backupPreset(number)
    const names = dump?.sceneNames
    /*
     * A dump that is not the slot we asked for names somebody else's scenes.
     *
     * "On the Cowboys From Hell rig it's still showing the Distortion Rigs
     * scenes." Slot 97 was showing 96's names, and kept showing them: the
     * answer was believed, cached under 97, and on a phone the cache is the
     * only source there is — the AM4 cannot be dumped over the relay — so the
     * wrong names outlived the read that produced them.
     *
     * A stored dump carries the location it came from, and an active-buffer
     * dump reports null. Either can arrive when the port is mid-preset-change,
     * which is exactly when this is asked. Checked rather than assumed.
     */
    if (wrongSlot(number, dump?.location)) {
      traceStep(`dump: came back as ${dump?.location ?? 'the active buffer'}, not ${number} — ignored`)
    } else if (Array.isArray(names) && names.some((n) => (n || '').trim())) {
      const clean = names.map((n) => (n || '').trim())
      rememberSceneNames(number, clean)
      traceStep('dump: found names')
      return clean
    }
    traceStep(
      dump?.sceneNames === undefined
        ? `dump: no sceneNames field at all — the decode on the Mac gave nothing (crcValid: ${dump?.crcValid ?? 'absent'})`
        : 'dump: sceneNames present but every name is blank — the scenes are unnamed on the unit'
    )
  } catch (err) {
    traceStep(`dump: refused or failed — ${err.message}`)
  }

  // Nothing readable from the unit. What did a session that could read them keep?
  const local = recallSceneNames(number)
  if (local.some((n) => (n || '').trim())) {
    traceStep('this browser remembered them')
    return local
  }
  traceStep('nothing remembered in this browser')

  if (typeof number === 'number') {
    const held = await readHostDoc(`scene-names-${sceneNameKey(number)}`)
    traceStep(held === null ? 'host store: nothing under this key' : 'host store: found an entry')
    if (Array.isArray(held) && held.some((n) => (n || '').trim())) {
      const clean = held.map((n) => (n || '').trim())
      // Keep it locally too, so the next preset change doesn't need the round trip.
      try {
        const all = JSON.parse(localStorage.getItem(SCENE_NAME_CACHE) || '{}')
        all[sceneNameKey(number)] = clean
        localStorage.setItem(SCENE_NAME_CACHE, JSON.stringify(all))
      } catch {
        // Nicety only.
      }
      return clean
    }
  }

  return local
}

/**
 * Drop cached names for a preset — call after renaming a scene.
 *
 * Both copies. Leaving the host copy behind would be worse than having no cache
 * at all: the phone would keep showing the old name for a scene that no longer
 * has it, and look authoritative doing it.
 */
export function forgetSceneNames(number) {
  if (typeof number !== 'number') return
  try {
    const all = JSON.parse(localStorage.getItem(SCENE_NAME_CACHE) || '{}')
    delete all[sceneNameKey(number)]
    delete all[number] // entries from before the cache was keyed by device
    localStorage.setItem(SCENE_NAME_CACHE, JSON.stringify(all))
  } catch {
    // Nothing to clean up if it was never written.
  }
  deleteHostDoc(`scene-names-${sceneNameKey(number)}`)
}


/**
 * Read what every scene does, by visiting each one.
 *
 * There's no query for "scene 3's state" — sceneState() reports the scene that
 * is currently active. So building a picture of all of them means switching to
 * each in turn and reading, then returning to where you started.
 *
 * That is audible. Every switch changes the sound coming out of the amp, which
 * is fine at a bench and not fine mid-song, so callers warn before doing it.
 */
export async function readAllScenes(count, onProgress) {
  const started = (await getScene())?.index ?? 0
  const scenes = []

  try {
    for (let i = 0; i < count; i++) {
      onProgress?.(i + 1, count)
      await setScene(i)
      // The unit needs a moment to settle before its state reads back true.
      await new Promise((r) => setTimeout(r, 90))
      let blocks = []
      try {
        blocks = (await sceneState()) || []
      } catch {
        // A device without per-scene state reporting yields an empty row rather
        // than aborting the whole walk.
      }
      scenes.push({ index: i, blocks })
    }
  } finally {
    // Always come back, even if a read threw. Leaving someone on scene 6
    // because a query failed would be its own bug.
    await setScene(started).catch(() => {})
  }

  return { scenes, returnedTo: started }
}

/**
 * Change what a block does in one particular scene.
 *
 * Bypass and channel are per-scene on this hardware — that IS what a scene is —
 * so setting them means being in that scene when the write lands.
 */
export async function setSceneBlock(sceneIndex, eid, { bypassed, channel } = {}) {
  const started = (await getScene())?.index ?? 0
  try {
    if (started !== sceneIndex) {
      await setScene(sceneIndex)
      await new Promise((r) => setTimeout(r, 90))
    }
    if (typeof bypassed === 'boolean') await setBypass(eid, bypassed)
    if (channel) await setChannel(eid, channel)
  } finally {
    if (started !== sceneIndex) await setScene(started).catch(() => {})
  }
  return { ok: true }
}


/**
 * Serial and MIDI connections ForgeFX can see, with Fractal units flagged.
 *
 * Worth having when more than one unit is around: switching between an FM3 and
 * an AM4 otherwise means stopping the server, swapping the cable and starting
 * again.
 */
export const listPorts = () =>
  mock ? tick().then(() => mock.ports()) : request('/ports')

/**
 * Choose which connection to talk to.
 *
 * `id` null clears back to auto-detect. `model` forces a device profile —
 * useful when detection guesses wrong, and something to leave alone otherwise,
 * since a forced profile that doesn't match the hardware writes frames the unit
 * will refuse.
 */
export const selectPort = ({ transport = 'serial', id = null, inId, outId, model } = {}) =>
  mock
    ? tick().then(() => ({ ok: true }))
    : request('/ports/select', {
        method: 'POST',
        body: JSON.stringify({ transport, id, inId, outId, model })
      })

/**
 * Whether this page is being served from ForgeFX itself.
 *
 * It matters for reaching the server from another device. A browser lets an
 * HTTPS page call http://localhost — that exemption is why the hosted app works
 * on the machine with the cable — but it does not extend to a LAN address. So a
 * phone loading the hosted app cannot reach http://10.0.0.x:5056 at all.
 *
 * Served from ForgeFX over plain HTTP, everything is same-origin and the phone
 * works. This is the check that lets the UI explain that rather than leaving
 * someone to discover it on stage.
 */
export function servedLocally() {
  if (typeof window === 'undefined') return false
  const here = window.location
  if (here.protocol !== 'http:') return false
  return getHost().includes(here.hostname)
}

export function pageIsSecure() {
  return typeof window !== 'undefined' && window.location.protocol === 'https:'
}


/**
 * Signing the host agent in, and turning it on.
 *
 * These are local-only by design — they aren't on ForgeFX's remote allowlist,
 * so they can only be driven from the machine holding the cable. They're POSTs,
 * which means a browser address bar can't reach them, and that was the last
 * thing in this setup that needed a terminal.
 */
export const cloudStatus = () => directRequest('/cloud/status')

export const cloudLogin = (email, password) =>
  directRequest('/cloud/login', { method: 'POST', body: JSON.stringify({ email, password }) })

export const cloudLogout = () => directRequest('/cloud/logout', { method: 'POST' })

export const remoteStatus = () => directRequest('/remote/status')

export const remoteEnable = (on) =>
  directRequest('/remote/enable', { method: 'POST', body: JSON.stringify({ on }) })
