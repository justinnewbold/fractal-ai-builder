/**
 * What the phone believes about the unit, and the one place it changes.
 *
 * A screen per fact would mean a subscription per screen, and every one of them
 * asking the Mac the same questions — down a serial port that answers one at a
 * time. The gig screen in the web app was built that way once and a single
 * footswitch press produced two full preset dumps.
 *
 * So: one store, one event subscription, and every screen a view over it.
 *
 * Writes here are optimistic and roll back. On stage the difference between a
 * button that responds now and one that responds after a round trip to a Mac in
 * the wings is the difference between usable and not — but a change that the
 * unit then refuses must not be left on screen, because the whole point of this
 * app is that what it shows is what the unit holds.
 */
import { useSyncExternalStore } from 'react'

import * as device from './device'
import { subscribeRemoteEvents } from './relay'

const initial = {
  /** null until the unit has said what it is. */
  capabilities: null,
  deviceName: '',
  preset: null,
  blocks: [],
  sceneIndex: 0,
  sceneNames: [],
  bpm: null,
  tunerOn: false,
  tuning: null,
  /** 'idle' | 'reading' | 'ok' | 'failed' — a failed read and an empty preset are not the same. */
  chain: 'idle',
  error: null
}

let state = initial
const subscribers = new Set()

const emit = () => {
  for (const fn of subscribers) fn()
}

export function set(patch) {
  state = { ...state, ...patch }
  emit()
}

export const getState = () => state
export const reset = () => set(initial)

function subscribe(fn) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

/**
 * A view over one fact.
 *
 * The selector must be defined outside a component or the store is re-read on
 * every notify — useSyncExternalStore compares the selected value by identity,
 * and a selector rebuilt each render defeats that.
 */
export function useRig(select) {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(state)
  )
}

/* ---------------------------------------------------------------- */
/* Events                                                            */
/* ---------------------------------------------------------------- */

/**
 * Our own writes come back as events. Ignore the echo, follow everything else.
 *
 * Without this a write is applied twice — once optimistically, once when the
 * unit reports it — which is invisible for a scene index and very visible for
 * anything that toggles: the button flickers back and forth as the echo lands.
 */
const ECHO_MS = 1200
const recent = new Map()

export const expect = (field, value) => recent.set(field, { value, at: Date.now() })

function isEcho(field, value) {
  const seen = recent.get(field)
  if (!seen) return false
  if (Date.now() - seen.at > ECHO_MS) {
    recent.delete(field)
    return false
  }
  if (!Object.is(seen.value, value)) return false
  // One echo per write. A second event carrying the same value is the unit
  // saying it again, and the screen should follow it.
  recent.delete(field)
  return true
}

/**
 * Everything the unit says while nobody asked.
 *
 * A footswitch press, the front panel, another app — all of it arrives here,
 * and all of it is worth following. This is what makes the phone a view of the
 * unit rather than a record of what the phone last did to it.
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
   * Gated on the tuner actually being open. ForgeFX starts its poll for any
   * client, so an ungated store would re-render every screen holding a reading
   * several times a second with no tuner in sight.
   */
  if ((event.type === 'tuner' || event.note !== undefined) && state.tunerOn) {
    set({ tuning: event })
  }

  // A scene change or an edit made anywhere else changes which blocks are
  // engaged. One refresh, from one place, rather than one per listening screen.
  if (event.type === 'scene' || event.type === 'changed') refreshBlocks({ quiet: true })
}

let stopEvents = null

/** Start the one subscription. Safe to call repeatedly; only the first binds. */
export function listen() {
  if (stopEvents) return stopListening
  stopEvents = subscribeRemoteEvents(handleEvent)
  return stopListening
}

export function stopListening() {
  if (!stopEvents) return
  const off = stopEvents
  stopEvents = null
  off()
}

/* ---------------------------------------------------------------- */
/* Reads                                                             */
/* ---------------------------------------------------------------- */

/**
 * Ask the unit everything, in the order a screen needs it.
 *
 * Sequential because every one of these travels down the same serial port at
 * the far end; firing them together only queues them somewhere less visible.
 * Capabilities first, because the shape of every other answer depends on what
 * the unit turns out to be.
 */
export async function refreshAll() {
  const caps = await device.detect()
  set({
    capabilities: caps?.capabilities ?? null,
    deviceName: caps?.short || caps?.name || ''
  })
  await refreshPreset()
  await refreshScene()
  await refreshBlocks()
  await refreshTempo()
}

export async function refreshPreset() {
  try {
    set({ preset: await device.currentPreset() })
  } catch (err) {
    set({ error: err.message })
  }
}

export async function refreshScene() {
  try {
    const res = await device.getScene()
    const index = typeof res === 'number' ? res : res?.index
    if (Number.isInteger(index)) set({ sceneIndex: index })
    if (Array.isArray(res?.names)) set({ sceneNames: res.names })
  } catch {
    // A unit that won't report its scene still gets buttons; it just starts on
    // the one the app last saw rather than pretending to know.
  }
}

export async function refreshTempo() {
  try {
    const res = await device.getTempo()
    const bpm = typeof res === 'number' ? res : res?.bpm
    if (Number.isFinite(bpm)) set({ bpm })
  } catch {
    // Tempo is a nice-to-have on this screen; its absence is not a fault worth
    // a banner over a preset someone is about to play.
  }
}

/**
 * Re-read the chain.
 *
 * A read that fell over and a preset with nothing in it used to look the same:
 * no buttons, no explanation. They are not the same, and the difference matters
 * most where you can't see the unit.
 */
export async function refreshBlocks({ quiet = false } = {}) {
  if (!quiet) set({ chain: 'reading' })
  try {
    set({ blocks: await device.presetBlocks(), chain: 'ok' })
    return true
  } catch (err) {
    // The last chain stays on screen. It is the best thing anyone knows, and a
    // row of buttons vanishing mid-song is worse than a row that is a moment
    // out of date and says so.
    set({ chain: 'failed', error: err.message })
    return false
  }
}

/* ---------------------------------------------------------------- */
/* Writes                                                            */
/* ---------------------------------------------------------------- */

/**
 * Show it, send it, and put it back if the unit says no.
 *
 * `revert` is captured before the optimistic change rather than rebuilt after
 * the failure: rebuilding it re-derives from a state that has already moved,
 * which is how a refused bypass once restored a chain that never existed.
 */
async function optimistic(patch, revert, send) {
  set({ ...patch, error: null })
  try {
    await send()
    return true
  } catch (err) {
    set({ ...revert, error: err.message })
    return false
  }
}

export function writeScene(index) {
  const was = state.sceneIndex
  expect('sceneIndex', index)
  return optimistic({ sceneIndex: index }, { sceneIndex: was }, async () => {
    await device.setScene(index)
    // Bypass states belong to the scene, so the chain on screen is about the
    // one we just left until this comes back.
    await refreshBlocks({ quiet: true })
  })
}

export function writeBypass(eid, bypassed) {
  const was = state.blocks
  const now = was.map((b) => (b.eid === eid ? { ...b, bypassed } : b))
  return optimistic({ blocks: now }, { blocks: was }, () => device.setBypass(eid, bypassed))
}

export function writeChannel(eid, channel) {
  const was = state.blocks
  const now = was.map((b) => (b.eid === eid ? { ...b, channel } : b))
  return optimistic({ blocks: now }, { blocks: was }, () => device.setChannel(eid, channel))
}

/**
 * One tap of the tempo.
 *
 * Nothing optimistic here and nothing expected back: a tap is not a statement
 * about where the tempo should end up, it is one beat among several, and the
 * unit works out the BPM from the spacing. The number on screen follows what
 * the unit reports rather than anything this app computed.
 */
export async function tapTempo() {
  try {
    await device.tapTempo()
    return true
  } catch (err) {
    set({ error: err.message })
    return false
  }
}

export function writeTempo(bpm) {
  const was = state.bpm
  expect('bpm', bpm)
  return optimistic({ bpm }, { bpm: was }, () => device.setTempo(bpm))
}

/**
 * Turn the tuner on or off.
 *
 * The flag goes down before the request, not after: a tuner the unit refuses to
 * start must not leave a screen waiting for readings that are never coming.
 */
export async function writeTuner(on) {
  set({ tunerOn: on, tuning: on ? state.tuning : null, error: null })
  try {
    await device.setTuner(on)
    return true
  } catch (err) {
    set({ tunerOn: false, tuning: null, error: err.message })
    return false
  }
}

/**
 * Load another slot.
 *
 * Everything about the preset changes, so everything is re-read rather than
 * patched — including the name, which is the one thing on this screen read from
 * arm's length.
 */
export async function loadPreset(number) {
  set({ error: null, chain: 'reading' })
  try {
    await device.selectPreset(number)
  } catch (err) {
    set({ error: err.message, chain: 'ok' })
    return false
  }
  await refreshPreset()
  await refreshScene()
  await refreshBlocks()
  return true
}
