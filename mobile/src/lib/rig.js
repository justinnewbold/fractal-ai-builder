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
import { idOf, sameBlock } from './unit.mjs'
import { TAP_REREAD_MS } from './tempo'
import { DEFAULT_SLUG, deviceSlug } from './device-slug'
import { adopt as adoptNames, forget as forgetNames, learn as learnName, nameOf } from './presetNames'
import { forget as forgetControls } from './paramIndex'
import { forgetSceneNames, recallSceneNames, rememberSceneNames } from './sceneNameCache'
import { subscribeRemoteEvents } from './relay'

const initial = {
  /** null until the unit has said what it is. */
  capabilities: null,
  deviceName: '',
  /*
   * The same unit, as the key its setlists and stars are filed under.
   *
   * Kept beside the name rather than derived at each call site, because the
   * derivation has to match the Mac's exactly — see lib/device-slug, which both
   * apps are handed a copy of. A screen that rolled its own would build a
   * perfectly good setlist in a drawer the Mac never opens.
   *
   * The shared default until the unit has said what it is, and that default is
   * a real bucket rather than null: a unit that answered without naming itself
   * still has setlists worth keeping.
   */
  deviceSlug: DEFAULT_SLUG,
  preset: null,
  /**
   * Names renamed on this phone and not yet saved to a slot: which preset,
   * and what the names were before. See noteSceneName.
   */
  unsaved: null,
  /** What the stage screen draws: everything but the four you never kick. */
  blocks: [],
  /** What the edit screen draws: the chain as the unit reports it, ends and all. */
  allBlocks: [],
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
  /*
   * A preset change drops a rename that was never saved — on the unit, which
   * throws its edit buffer away, so here too. Caught at the one place every
   * change of preset passes through, whichever route it came by.
   */
  if (patch.preset && state.unsaved && patch.preset.number !== state.unsaved.number) {
    patch = { ...patch, unsaved: null }
    discardUnsaved(state.unsaved)
  }
  state = { ...state, ...patch }
  emit()
}

export const getState = () => state
export const reset = () => set(initial)

/**
 * Put the last failure away.
 *
 * Nothing else clears an error until the next thing goes wrong or the next
 * write succeeds, and on a rig that is working again neither may happen for a
 * song — so the red bar stays above the preset being played, about a read that
 * has since been answered. The ✕ on it comes here.
 */
export const clearError = () => set({ error: null })

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
  if (event.type === 'scene' || event.type === 'changed') {
    if (chainWrites) chainAsked = true
    else refreshBlocks({ quiet: true })
  }
}

/*
 * WHILE THIS PHONE IS WRITING THE CHAIN, ITS OWN WRITES ARE NOT NEWS.
 *
 * A move is six cell writes, and the unit announces every one; each
 * announcement asked for the chain, and each of those is a preset dump down
 * the same serial port the writes are waiting on. A log showed the read after
 * a move taking thirty seconds, the phone locking its screen while it waited,
 * and the pending write coming back as "your computer didn't answer" — so
 * the move was rolled back: "it just put it right back where it was."
 *
 * So the screen doing the writing says when it starts and when it is done,
 * announcements in between are noted rather than acted on, and the chain is
 * read once at the end — by the writer, which drops the computer's copy first.
 */
let chainWrites = 0
let chainAsked = false
export function beginChainWrite() {
  chainWrites += 1
}
export function endChainWrite({ refresh = true } = {}) {
  if (!chainWrites) return
  chainWrites -= 1
  if (chainWrites) return
  const asked = chainAsked
  chainAsked = false
  if (asked && refresh) refreshBlocks({ quiet: true })
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
  const slug = deviceSlug(caps)
  /*
   * A different unit means the names read off the last one are wrong, not
   * merely old. Slot 45 on an FM3 and slot 45 on an AM4 are different presets,
   * and a picker showing one unit's names over the other's slots would send
   * somebody to the wrong song by its right name.
   */
  if (slug !== state.deviceSlug) forgetNames()
  set({
    capabilities: caps?.capabilities ?? null,
    deviceName: caps?.short || caps?.name || '',
    deviceSlug: slug
  })
  /*
   * The preset names, from disk now and from the computer's list when it
   * answers — one small request that never touches the unit, so it is not
   * waited on and not in the port's queue. See presetNames.adopt.
   */
  adoptNames(device.nameOwner(slug)).catch(() => {})
  await refreshPreset()
  await refreshScene()
  /* The names this phone or the computer already has, before the chain: a
     small read, and the tiles are named while the chain is still coming. */
  const quick = await quickSceneNames()
  /* The chain first: it is most of what the stage screen draws, and the scene
     names are a slow read nobody is waiting on. */
  await refreshBlocks()
  if (!quick) await refreshSceneNames()
  await refreshTempo()
}

/**
 * A rename this phone just made, taken as true without asking.
 *
 * "Renaming a preset doesn't work, just goes right back to the original
 * name." It did not go back: the write landed, and the read that followed it
 * came back out of the computer's cache with the old name, which then
 * overwrote the new one on screen. The write is better evidence than any
 * read, so it is what the screen and the name list are told. And the name
 * the next Save carries is this one — the computer renames the preset to
 * whatever the save request says, so a stale name here would have undone
 * the rename on the way into the slot.
 */
export function notePresetName(name) {
  const preset = state.preset
  if (!preset || typeof name !== 'string') return
  const unsaved = pendingFor(preset.number)
  if (unsaved && unsaved.presetName === null) unsaved.presetName = preset.name || ''
  set({ preset: { ...preset, name }, unsaved })
  if (Number.isInteger(preset.number)) learnName(preset.number, name)
}

/**
 * The same for a scene: on the tiles now, and kept on this phone so the
 * tiles still say it after a trip to another screen.
 *
 * NOT KEPT FOR GOOD UNTIL IT IS SAVED. "I renamed two scenes, then switched
 * to a different preset without saving, and when I went back it still showed
 * those names." The unit had dropped them with its edit buffer; the phone
 * had written them to its disk and to the computer's store as if they were
 * the preset's. So a rename is pending: what the names were is remembered,
 * a preset change puts them back (see set), and only a save that succeeds
 * sends them to the computer's store, where every phone reads them from.
 */
export function noteSceneName(index, name) {
  if (!Number.isInteger(index) || index < 0 || typeof name !== 'string') return
  const names = [...(state.sceneNames || [])]
  while (names.length <= index) names.push('')
  names[index] = name
  const number = state.preset?.number
  const unsaved = pendingFor(number)
  set({ sceneNames: names, unsaved })
  const slug = state.deviceSlug
  if (!Number.isInteger(number) || !slug) return
  rememberSceneNames(device.nameOwner(slug), number, names)
}

/** The pending record for this preset, started from what the names are now. */
function pendingFor(number) {
  if (!Number.isInteger(number)) return state.unsaved
  if (state.unsaved && state.unsaved.number === number) return state.unsaved
  return { number, sceneNames: [...(state.sceneNames || [])], presetName: null }
}

/** The preset moved on without a save: the names go back to what they were. */
function discardUnsaved(unsaved) {
  const slug = state.deviceSlug
  if (!unsaved || !slug) return
  /* A slot that had no names before the rename gets none back — remembering
     eight blanks writes nothing, which would have left the renamed ones. */
  if (!rememberSceneNames(device.nameOwner(slug), unsaved.number, unsaved.sceneNames)) {
    forgetSceneNames(device.nameOwner(slug), unsaved.number)
  }
  if (typeof unsaved.presetName === 'string') learnName(unsaved.number, unsaved.presetName)
}

/** A save landed in `slot`: what was pending there is the preset's now. */
export function savedToSlot(slot) {
  const unsaved = state.unsaved
  if (!unsaved || unsaved.number !== slot) return
  const slug = state.deviceSlug
  if (slug) device.keepSceneNames(slug, slot, state.sceneNames)
  set({ unsaved: null })
}

export async function refreshPreset() {
  try {
    const fresh = await device.currentPreset()
    /* A name this phone renamed and has not saved outranks the read: the
       read can come out of the computer's copy from before the rename, and
       the next Save carries whatever name is here. */
    const pending = state.unsaved
    if (fresh && pending && pending.number === fresh.number && typeof pending.presetName === 'string') {
      fresh.name = state.preset?.name ?? fresh.name
    }
    set({ preset: fresh })
  } catch (err) {
    set({ error: err.message })
  }
}

export async function refreshScene() {
  try {
    const res = await device.getScene()
    const index = typeof res === 'number' ? res : res?.index
    if (Number.isInteger(index)) set({ sceneIndex: index })
    /*
     * Some units hand the names over with the scene. A gen-3 does not — see
     * device.sceneNames, which is why the tiles were numbered squares.
     */
    if (Array.isArray(res?.names) && res.names.some((n) => (n || '').trim())) {
      set({ sceneNames: res.names })
    }
  } catch {
    // A unit that won't report its scene still gets buttons; it just starts on
    // the one the app last saw rather than pretending to know.
  }
}

/**
 * How long a tempo this phone just set on the unit outranks a read of it.
 *
 * "After doing tap tempo, if I go to the edit screen and then go back to the
 * main screen, the tap tempo doesn't save." It had saved — on the unit. The
 * main screen re-reads everything when it appears, and the computer answers
 * a tempo read out of the preset copy it took for the chain, which is good
 * for fifteen seconds and was taken before the taps. So the old figure came
 * back onto the button over the one the unit was actually playing.
 *
 * A tempo the phone set — by tapping or by typing — is therefore held for a
 * while: a read that disagrees inside this window is the stale copy, not
 * news. Longer than the copy lives, and short enough that a tempo changed at
 * the front panel is followed within the minute.
 */
export const TEMPO_KEEP_MS = 20 * 1000
let tempoSetAt = 0
const tempoJustSet = () => Date.now() - tempoSetAt < TEMPO_KEEP_MS

export async function refreshTempo() {
  try {
    const res = await device.getTempo()
    const bpm = typeof res === 'number' ? res : res?.bpm
    if (!Number.isFinite(bpm)) return
    if (tempoJustSet() && Number.isFinite(state.bpm) && bpm !== state.bpm) return
    set({ bpm })
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
/**
 * What this preset's scenes are called, when the unit did not volunteer them.
 *
 * Its own read because it belongs to the PRESET rather than to the scene: it is
 * worth doing once when a preset loads and not again when somebody steps
 * between scenes with a footswitch. Never fails a screen — a unit with no scene
 * names gets numbered tiles, which is what it had before.
 */
export async function refreshSceneNames() {
  const number = state.preset?.number
  if (!Number.isInteger(number)) return
  const names = await device.sceneNames(number)
  /* Still the same preset: a slow read that lands after the next tap would
     otherwise put the last song's names on this song's tiles. */
  if (!names.length || state.preset?.number !== number) return
  set({ sceneNames: names })
  /* Read the slow way once; never again on this phone, and not on the next
     device either. */
  const slug = state.deviceSlug
  rememberSceneNames(device.nameOwner(slug), number, names)
  device.keepSceneNames(slug, number, names)
}

/**
 * The scene names without asking the unit: this phone's disk first, then the
 * computer's store. True when the computer had them, in which case the dump
 * is not needed at all.
 *
 * "When you switch preset, it takes about 5 to 10 seconds for the scene names
 * to load." That was the summary read, a preset dump, queued behind the chain
 * read, another dump. Names hardly ever change, so what was read last time
 * goes on the tiles at once and the slow read only runs when nobody has them.
 */
export async function quickSceneNames() {
  const number = state.preset?.number
  if (!Number.isInteger(number)) return false
  /* A unit that handed the names over with the scene has already answered,
     and fresher than any copy: nothing to fetch and no dump to run. */
  if ((state.sceneNames || []).some((n) => (n || '').trim())) return true
  const slug = state.deviceSlug
  const owner = device.nameOwner(slug)
  const kept = await recallSceneNames(owner, number)
  if (kept.length && state.preset?.number === number) set({ sceneNames: kept })
  let held = null
  try {
    held = await device.storedSceneNames(slug, number)
  } catch {
    held = null
  }
  if (!held || state.preset?.number !== number) return false
  set({ sceneNames: held })
  rememberSceneNames(owner, number, held)
  return true
}

export async function refreshBlocks({ quiet = false } = {}) {
  /*
   * ONE READ AT A TIME, HOWEVER MANY TIMES WE ARE ASKED — and this is the
   * reason the whole app felt slow.
   *
   * "App is very laggy especially on the set list screen." The log said why,
   * and it was nothing to do with setlists:
   *
   *   23:02:50.187 [wire] GET /preset/blocks — 2878ms
   *   23:02:50.748 [wire] GET /preset/blocks — 3123ms
   *   23:03:00.265 [wire] GET /preset/blocks — 3219ms
   *
   * Three of the same slow read, two of them half a second apart. The unit
   * emits an event per change, `handleEvent` asked for the chain on each one,
   * and every one of those asks is a preset dump down a serial port with a
   * relay in front of it — one at a time, in a queue. A preset change that
   * fires six events puts twenty seconds of reading in front of the next thing
   * anybody presses, on any screen. That is what "laggy" was.
   *
   * So: while one is in flight, another ask does not queue. It notes that the
   * answer now on its way is already out of date and asks ONE more time when
   * that lands — once, no matter how many asks arrived meanwhile. The last read
   * is still the true one, which is the only thing that has to stay true.
   */
  if (blocksInFlight) {
    blocksAgain = true
    return blocksInFlight
  }
  blocksInFlight = readBlocks(quiet)
  try {
    return await blocksInFlight
  } finally {
    blocksInFlight = null
    if (blocksAgain) {
      blocksAgain = false
      /* Quiet: the chain on screen is a moment old, not missing, and flipping
         it to 'reading' would blank a row of buttons somebody is aiming at. */
      refreshBlocks({ quiet: true })
    }
  }
}

/** Whether a chain read is on the wire, and whether one more is owed after it. */
let blocksInFlight = null
let blocksAgain = false

async function readBlocks(quiet) {
  if (!quiet) set({ chain: 'reading' })
  try {
    /*
     * One read, two lists. The unit is asked once — it is a slow read and the
     * relay is one channel — and each screen is handed the blocks it is for.
     * See device.presetBlocks for why the two differ.
     */
    const all = await device.presetBlocks()
    set({ allBlocks: all, blocks: device.stageBlocks(all), chain: 'ok' })
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

/*
 * Both lists move together, because they are one chain seen by two screens.
 * Toggling a drive on the stage screen and then opening it on the edit screen
 * must not show it still engaged.
 */
const patchBlock = (id, patch) => ({
  blocks: state.blocks.map((b) => (sameBlock(b, id) ? { ...b, ...patch } : b)),
  allBlocks: state.allBlocks.map((b) => (sameBlock(b, id) ? { ...b, ...patch } : b))
})

const asWas = () => ({ blocks: state.blocks, allBlocks: state.allBlocks })

export function writeBypass(id, bypassed) {
  const was = asWas()
  return optimistic(patchBlock(id, { bypassed }), was, () => device.setBypass(id, bypassed))
}

export function writeChannel(id, channel) {
  const was = asWas()
  return optimistic(patchBlock(id, { channel }), was, () => device.setChannel(id, channel))
}

/**
 * One tap of the tempo.
 *
 * Nothing optimistic here and nothing expected back: a tap is not a statement
 * about where the tempo should end up, it is one beat among several, and the
 * unit works out the BPM from the spacing. The number on screen follows what
 * the unit reports rather than anything this app computed.
 */
/**
 * One tap, and the number that follows it.
 *
 * THE TAP GOES NOW; THE READ-BACK WAITS FOR THE BURST TO END. The unit works
 * the tempo out from the SPACING between taps, so a tap held back by a debounce
 * is a different rhythm, not a late one. And the figure can only be read once
 * tapping has stopped — reading mid-burst answers with the tempo of the taps
 * before this one and puts a stale number on the button still under your thumb.
 *
 * WHY THE PHONE NEEDS THIS AND THE BROWSER GOT AWAY WITHOUT IT FOR LONGER.
 * There is a `tempo` event, and the phone was relying on it entirely: tap, and
 * wait to be told. Over the relay that event is not reliably carried — the same
 * filtering that keeps the tuner's readings at the Mac — so the unit's tempo
 * changed and the screen did not. "Tap tempo isn't changing on the phone screen,
 * but it does update the unit."
 *
 * The event still works where it arrives; this just stops the screen depending
 * on it. The delay is shared with the browser so the two cannot drift.
 */
let reread = null

/** The read after a burst of taps: the tempo the unit settled on, held from then. */
async function readTappedTempo() {
  tempoSetAt = 0
  await refreshTempo()
  tempoSetAt = Date.now()
}

export async function tapTempo() {
  clearTimeout(reread)
  try {
    await device.tapTempo()
  } catch (err) {
    set({ error: err.message })
    return false
  }
  /* The read after the burst is the tempo the unit settled on; from then it
     is this phone's figure, held against a stale copy. See TEMPO_KEEP_MS. */
  reread = setTimeout(() => readTappedTempo(), TAP_REREAD_MS)
  return true
}

export function writeTempo(bpm) {
  const was = state.bpm
  expect('bpm', bpm)
  tempoSetAt = Date.now()
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
/**
 * Load a stored slot, and show it before the unit has finished saying so.
 *
 * "When tapping a preset there is about a 2 second delay before it highlights
 * it and goes back to the main screen."
 *
 * It waited for the lot: the select, then the preset, the scene, the scene
 * names and the whole chain — six round trips, two of them among the SLOW reads
 * that make the unit dump a preset over serial. Only then did anything move. A
 * control that waits that long before acknowledging a press reads as a control
 * that did not register it, which is how a preset gets loaded twice.
 *
 * So it is optimistic, like every other write in this file. The new slot is on
 * screen on the press; the reads that confirm it happen behind that. If the
 * unit refuses the select, the old preset goes back — captured before the
 * change rather than rebuilt after the failure, for the reason `optimistic`
 * gives above.
 *
 * THE NAME COMES FROM WHAT HAS ALREADY BEEN READ. The picker has it — it is
 * drawn on the row somebody just tapped — and lib/presetNames is where it is
 * kept, so this looks there rather than taking it as an argument. When nothing
 * is known, `pending` says so and the screen shows the slot rather than
 * inventing "Untitled" for the one round trip it takes to find out.
 */
export async function loadPreset(number) {
  const was = state.preset
  /*
   * The control index is about the preset that was loaded, not this one. Slot
   * 45's Presence is not slot 46's, and a search box answering from the last
   * preset sends somebody to a control that is not there.
   */
  forgetControls()
  const known = nameOf(number)
  /*
   * The scene names go with it too. They belong to the preset being left, so
   * carrying them across would put the last song's names on this song's tiles —
   * which is worse than the numbers, because numbers are never wrong.
   */
  set({
    error: null,
    chain: 'reading',
    sceneNames: [],
    preset: {
      number,
      name: typeof known === 'string' ? known : '',
      empty: false,
      pending: typeof known !== 'string'
    }
  })
  try {
    await device.selectPreset(number)
  } catch (err) {
    set({ error: err.message, chain: 'ok', preset: was })
    return false
  }
  await refreshPreset()
  await refreshScene()
  /* What is already known about this slot's scenes, at once. See quickSceneNames. */
  const quick = await quickSceneNames()
  /*
   * The chain before the slow scene-name read, and the order is the point: the
   * chain is most of what the stage screen draws, and the names are the least
   * urgent thing on it. Reading the names first left the tiles saying
   * "reading" for a slow read nobody was waiting on. And only when neither the
   * phone nor the computer had them — most of the time, now, they do.
   */
  await refreshBlocks()
  if (!quick) await refreshSceneNames()
  return true
}
