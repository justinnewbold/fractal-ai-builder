import { useSyncExternalStore } from 'react'

/**
 * One device, one copy of what it is doing.
 *
 * Before this, the unit's state lived in as many places as there were panels
 * that cared. App held the blocks, the preset, the scene, the tempo and the
 * tuner. Gig held its own blocks, its own scene, its own tuner and its own
 * event subscription — it was not a view over App's state, it was a second
 * client to the same serial port. Scenes read the scene once at mount and never
 * again, so changing scenes anywhere else left that panel confidently wrong
 * until it remounted.
 *
 * Two subscriptions to one event stream is the part that actually bites: a
 * scene change on a footswitch arrived twice, and each listener answered it by
 * re-reading the block list down a port that serialises every request. So the
 * store owns the subscription, and everything else reads.
 *
 * The visible win: today only the gig screen follows a scene changed on the
 * floor. Afterwards every surface does.
 *
 * ## Why the device functions are injected
 *
 * This module deliberately does not import the device client. That client
 * imports the mock, and the mock imports JSON, which node cannot load — so
 * anything that reaches it becomes untestable outside a browser, which is
 * exactly what happened to App.jsx. With the driver injected, the whole write
 * path — optimistic set, confirm, roll back on refusal, and the echo guard —
 * runs against a fake in `test/run.mjs` with no hardware and no browser.
 */

/* Shared empties, so an unchanged snapshot is referentially unchanged and
   useSyncExternalStore doesn't re-render the app forever. */
const NO_BLOCKS = Object.freeze([])
const NO_NAMES = Object.freeze([])

const BLANK = {
  preset: null,
  blocks: NO_BLOCKS,
  sceneIndex: 0,
  sceneNames: NO_NAMES,
  bpm: null,
  tunerOn: false,
  tuning: null
}

let state = BLANK
const listeners = new Set()
let driver = null
let stopEvents = null

/** The current snapshot. Frozen in practice: never mutate it, replace it. */
export const getSnapshot = () => state

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Apply a patch, and say whether anything actually moved.
 *
 * The equality check is not an optimisation. useSyncExternalStore compares
 * snapshots by identity and re-reads on every notify, so a set() that always
 * built a new object would loop the app on every inbound event — and the tuner
 * pushes several a second.
 */
export function set(patch) {
  let next = null
  for (const key of Object.keys(patch)) {
    if (Object.is(state[key], patch[key])) continue
    if (!next) next = { ...state }
    next[key] = patch[key]
  }
  if (!next) return false
  state = next
  for (const listener of [...listeners]) listener()
  return true
}

/**
 * The echo guard.
 *
 * A local write and the device's own event for that write are the same fact
 * arriving twice. Without this the optimistic set lands, the SSE echo lands a
 * beat later, and a scene button flickers through the old value on its way back
 * to the one you pressed — or worse, a second write races the first.
 *
 * Time-boxed rather than counted: a dropped echo must not leave the guard armed
 * against a genuine footswitch press a minute later.
 */
export const ECHO_MS = 600
const recent = new Map()

export function markLocal(field, value, now = Date.now()) {
  recent.set(field, { value, at: now })
}

export function isEcho(field, value, now = Date.now()) {
  const seen = recent.get(field)
  if (!seen) return false
  if (now - seen.at > ECHO_MS) {
    recent.delete(field)
    return false
  }
  if (!Object.is(seen.value, value)) return false
  // One echo per write. A second event carrying the same value is the device
  // saying it again, and the screen should follow it.
  recent.delete(field)
  return true
}

/** Everything the store needs from the device, so tests can hand it a fake. */
export function attachDriver(next) {
  driver = next
}

export const attachedDriver = () => driver

/**
 * Inbound device events, from the one subscription.
 *
 * Exported rather than closed over so the event handling is testable on its
 * own — this is where a footswitch, a tap tempo and a tuner reading all land.
 */
export function handleEvent(event) {
  if (!event) return

  if (event.type === 'scene' && typeof event.index === 'number') {
    if (!isEcho('sceneIndex', event.index)) set({ sceneIndex: event.index })
  }

  if (event.type === 'tempo' && typeof event.bpm === 'number') {
    if (!isEcho('bpm', event.bpm)) set({ bpm: event.bpm })
  }

  /*
   * The tuner pushes readings rather than answering requests, so the stream is
   * the only thing that makes the display move — but only while the tuner is
   * actually on. ForgeFX starts its poll for any client and the demo device
   * pushes a reading every 400ms unconditionally, so an ungated store would
   * re-render every surface holding a reading two and a half times a second,
   * forever, with no tuner open anywhere.
   */
  if ((event.type === 'tuner' || event.note !== undefined) && state.tunerOn) {
    set({ tuning: event })
  }

  // A scene change or an edit made anywhere else changes which blocks are
  // engaged. One refresh, from one place, rather than one per listening panel.
  if (event.type === 'scene' || event.type === 'changed') refreshBlocks()
}

/** Start the one subscription. Safe to call repeatedly; only the first binds. */
export function listen() {
  if (stopEvents || !driver?.subscribeEvents) return stopListening
  stopEvents = driver.subscribeEvents(handleEvent)
  return stopListening
}

export function stopListening() {
  if (!stopEvents) return
  const off = stopEvents
  stopEvents = null
  off()
}

export const isListening = () => !!stopEvents

/* ---------------------------------------------------------------- reads --- */

/**
 * Re-read the chain.
 *
 * Returns the list, or null if the unit wouldn't answer. The event path ignores
 * the result — it runs behind every scene change and a lost race for the port
 * is not worth a message — but the gig screen shows "couldn't read the chain"
 * rather than an empty row, because an empty row reads as an empty preset.
 */
export async function refreshBlocks() {
  if (!driver?.presetBlocks) return null
  try {
    const list = await driver.presetBlocks()
    if (!Array.isArray(list)) return null
    set({ blocks: list })
    return list
  } catch {
    // The last known chain stays on screen: better than emptying it because
    // one poll lost a race for the port.
    return null
  }
}

export async function refreshScene() {
  if (!driver?.getScene) return
  try {
    const res = await driver.getScene()
    const patch = {}
    if (typeof res?.index === 'number' && res.index >= 0) patch.sceneIndex = res.index
    if (Array.isArray(res?.names)) patch.sceneNames = res.names
    set(patch)
  } catch {
    /* a unit without scenes just shows none */
  }
}

export async function refreshTempo() {
  if (!driver?.getTempo) return
  try {
    const res = await driver.getTempo()
    if (typeof res?.bpm === 'number') set({ bpm: res.bpm })
  } catch {
    /* keep the last known value */
  }
}

/**
 * One tap.
 *
 * Deliberately not "tap and read": the device computes the tempo from the
 * spacing between taps, so the tap must go the moment the button is pressed
 * while the read-back is debounced past the last one. Fold the two together and
 * a debounce swallows the whole burst into a single tap, which is not a tempo.
 */
export function tapBeat() {
  return driver.tapTempo()
}

export async function refreshSceneNames(number) {
  if (!driver?.readSceneNames) return
  try {
    const found = await driver.readSceneNames(number)
    set({ sceneNames: Array.isArray(found) ? found : NO_NAMES })
  } catch {
    set({ sceneNames: NO_NAMES })
  }
}

/* --------------------------------------------------------------- writes --- */

/**
 * Every write follows the same three steps: show it immediately, send it, and
 * put it back if the device refuses.
 *
 * Optimistic because these are stage controls — a scene button that waits for a
 * serial round trip before it looks pressed reads as a button that didn't work,
 * and gets pressed again.
 */
async function write(field, value, send) {
  const before = state[field]
  set({ [field]: value })
  markLocal(field, value)
  try {
    return await send()
  } catch (err) {
    set({ [field]: before })
    recent.delete(field)
    throw err
  }
}

export function writeScene(index) {
  return write('sceneIndex', index, () => driver.setScene(index))
}

export function writeTempo(bpm) {
  return write('bpm', bpm, () => driver.setTempo(bpm))
}

/**
 * Bypass, which is a write into an array rather than to a field.
 *
 * Rolls back to the exact array it started from, not to a recomputed one: a
 * refresh that landed while the write was in flight must not be undone by a
 * failure that has nothing to do with it.
 */
export async function writeBypass(effectId, bypassed) {
  const before = state.blocks
  set({
    blocks: before.map((b) => (b.effectId === effectId ? { ...b, bypassed } : b))
  })
  try {
    return await driver.setBypass(effectId, bypassed)
  } catch (err) {
    if (state.blocks !== before) set({ blocks: before })
    throw err
  }
}

/**
 * The tuner is a mode, not a value: the device answers {ok:false} rather than
 * failing when the attached unit has no tuner path, and a silent refusal looked
 * exactly like a tuner warming up, forever.
 */
export async function writeTuner(on) {
  const before = state.tunerOn
  set({ tunerOn: on, tuning: on ? state.tuning : null })
  try {
    const res = await driver.setTuner(on)
    if (on && res && res.ok === false) {
      set({ tunerOn: false, tuning: null })
      return res
    }
    return res
  } catch (err) {
    set({ tunerOn: before, tuning: null })
    throw err
  }
}

/* --------------------------------------------------------------- plumbing -- */

/** Fields the app owns outright — a read it performed, not a write it made. */
export function put(patch) {
  return set(patch)
}

/** Back to blank. Tests use it; so does losing the device. */
export function reset() {
  recent.clear()
  stopListening()
  state = BLANK
  for (const listener of [...listeners]) listener()
}

/* ------------------------------------------------------------------ react -- */

const identity = (s) => s

/**
 * Read the store from a component.
 *
 * The selector must return something stable — a field, or a value derived with
 * Object.is-stable parts. Returning a fresh object each call re-renders on
 * every notify, which with a running tuner is several times a second.
 */
export function useDevice(selector = identity) {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(BLANK)
  )
}
