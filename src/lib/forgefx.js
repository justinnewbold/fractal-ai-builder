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

const DEFAULT_HOST = 'http://localhost:5056'

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
  return localStorage.getItem('forgefx.host') || DEFAULT_HOST
}

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

  const url = `${getHost()}${path}`
  let res
  try {
    res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    })
  } catch (cause) {
    throw new ForgeError(
      'Could not reach ForgeFX. Check that the server is running and the Fractal unit is connected.',
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

/** Full capability report: grid size, scene count, preset count, what writes are allowed. */
export const detect = async () => {
  const res = mock ? (await tick(), mock.detect()) : await request('/device/detect')
  const label = res?.short || res?.name
  if (label) deviceSlug = String(label).toLowerCase().replace(/[^a-z0-9]/g, '') || 'device'
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

/** The preset currently loaded on the unit. */
export const currentPreset = async () => (mock ? (await tick(), mock.preset()) : request('/preset'))

/** Every block placed in the current preset, with grid position, bypass state and channel. */
export const presetBlocks = async () => (mock ? (await tick(), mock.presetBlocks()) : request('/preset/blocks'))

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
 * Model swaps go first, because changing a block's model resets its parameters
 * and would otherwise undo the values just written. But a swap can also change
 * the parameter *ranges* — different amp models have different low-cut spans —
 * and values were normalised against the ranges read before the swap. So after
 * a model change that block's parameters are re-read and the conversion redone
 * against what the new model actually reports. Without this, a frequency asked
 * for in the middle of the old range can land pinned at the floor of the new
 * one.
 */
export async function applyChanges(changes, onProgress) {
  const failures = []
  const swapped = changes.filter((c) => c.type !== undefined)
  let step = 0
  const total =
    changes.reduce(
      (n, c) => n + c.params.length + (c.type !== undefined ? 1 : 0) + (c.bypassed !== undefined ? 1 : 0),
      0
    ) + swapped.length

  const advance = (label) => onProgress?.(++step, total, label)

  // 1. models
  for (const change of swapped) {
    advance(`${change.name} → ${change.typeName}`)
    try {
      await setType(change.eid, change.type)
    } catch (err) {
      failures.push(`${change.name} model — ${err.message}`)
    }
  }

  // 2. re-read ranges for anything whose model moved
  const freshRanges = new Map()
  for (const change of swapped) {
    advance(`Re-reading ${change.name} after model change`)
    try {
      const res = await blockParams(change.eid)
      freshRanges.set(
        change.eid,
        new Map((res?.named || []).map((p) => [p.id, { min: p.min, max: p.max, log: !!p.log }]))
      )
    } catch {
      // Fall back to the pre-swap ranges rather than skipping the writes.
    }
  }

  // 3. parameters, then bypass
  for (const change of changes) {
    const fresh = freshRanges.get(change.eid)
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
 */
export async function presetRange(start, count, onProgress) {
  const out = []
  for (let i = 0; i < count; i++) {
    const number = start + i
    onProgress?.(i + 1, count)
    try {
      const res = await presetName(number)
      out.push({ number, name: (res?.name || '').trim() })
    } catch {
      out.push({ number, name: null })
    }
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
 * Move the device's edit cursor to a cell. Writes nothing.
 *
 * The safe way to confirm the app and the hardware agree about which cell is
 * which: point at one and watch the FM3's screen. Worth doing once before
 * trusting placement, given the two indexing conventions in play.
 */
export const pointAtCell = (row, col) =>
  mock
    ? tick().then(() => ({ ok: true }))
    : request('/preset/grid/select', { method: 'POST', body: JSON.stringify(toWireCell(row, col)) })

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
    const id = setInterval(() => {
      const cents = Math.round((Math.random() - 0.5) * 30)
      onEvent({ type: 'tuner', note: ['E', 'A', 'D', 'G', 'B'][Math.floor(Math.random() * 5)], octave: 2, cents })
    }, 400)
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
 * Read every preset name on the unit, in pages.
 *
 * 512 sequential reads down one serial port is slow, so this reports progress
 * and can be stopped. Names are cached for the session — they only change when
 * something is stored, and re-reading 512 slots to redraw a list would be
 * absurd.
 */
const nameCache = new Map()

export function cachedPresetNames() {
  return [...nameCache.entries()]
    .map(([number, name]) => ({ number, name }))
    .sort((a, b) => a.number - b.number)
}

export function forgetPresetName(number) {
  nameCache.delete(number)
}

export async function scanAllPresets(total, onProgress, shouldStop) {
  for (let number = 0; number < total; number++) {
    if (shouldStop?.()) break
    if (nameCache.has(number)) continue
    try {
      const res = await presetName(number)
      nameCache.set(number, (res?.name || '').trim())
    } catch {
      nameCache.set(number, null)
    }
    if (number % 4 === 0 || number === total - 1) onProgress?.(number + 1, total, cachedPresetNames())
  }
  return cachedPresetNames()
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
export async function readSceneNames(number) {
  if (mock) {
    await tick()
    return mock.getScene().names
  }

  if (typeof number === 'number') {
    try {
      const summary = await presetSummary(number)
      const names = summary?.scenes
      if (Array.isArray(names) && names.some((n) => (n || '').trim())) {
        const clean = names.map((n) => (n || '').trim())
        rememberSceneNames(number, clean)
        return clean
      }
    } catch {
      // Not every device serves a summary; fall through to the dump.
    }
  }

  try {
    const dump = await backupPreset(number)
    const names = dump?.sceneNames
    if (Array.isArray(names) && names.some((n) => (n || '').trim())) {
      const clean = names.map((n) => (n || '').trim())
      rememberSceneNames(number, clean)
      return clean
    }
  } catch {
    // Blocked remotely, or the device has no dump to give.
  }

  // Nothing readable from the unit. What did a session that could read them keep?
  const local = recallSceneNames(number)
  if (local.some((n) => (n || '').trim())) return local

  if (typeof number === 'number') {
    const held = await readHostDoc(`scene-names-${sceneNameKey(number)}`)
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
export const cloudStatus = () =>
  mock ? tick().then(() => ({ enabled: false, user: null })) : request('/cloud/status')

export const cloudLogin = (email, password) =>
  mock
    ? tick().then(() => ({ user: { email } }))
    : request('/cloud/login', { method: 'POST', body: JSON.stringify({ email, password }) })

export const cloudLogout = () =>
  mock ? tick().then(() => ({ user: null })) : request('/cloud/logout', { method: 'POST' })

export const remoteStatus = () =>
  mock ? tick().then(() => ({ enabled: false, connected: false })) : request('/remote/status')

export const remoteEnable = (on) =>
  mock
    ? tick().then(() => ({ enabled: on, connected: on }))
    : request('/remote/enable', { method: 'POST', body: JSON.stringify({ on }) })
