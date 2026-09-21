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
import { firmwareOf } from './firmware'

import * as device from './device'
import { idOf, sameBlock } from './unit.mjs'
import { TAP_REREAD_MS, keepTaps, tappedBpm, tempoSender } from './tempo'
import { watchEvery, probeSays, countQuiet, unitGone } from './unit-watch'
import { DEFAULT_SLUG, deviceSlug } from './device-slug'
import { adopt as adoptNames, forget as forgetNames, learn as learnName, nameOf } from './presetNames'
import { forget as forgetControls } from './paramIndex'
import { forgetSceneNames, recallSceneNames, rememberSceneNames } from './sceneNameCache'
import { subscribeRemoteEvents } from './relay'
import { isDemo } from './demo'
import { logDebug } from './debugLog'

const initial = {
  /** null until the unit has said what it is. */
  capabilities: null,
  firmware: null,
  deviceName: '',
  /*
   * Whether the unit is there and answering, as distinct from whether the
   * computer is. 'unknown' until asked; 'missing' when the computer has no
   * unit; 'silent' when it has one that stopped answering (a frozen FM3
   * answers nothing: no preset number, no chain, every read times out);
   * 'present' when it answers. The bar and Setup say this before they say
   * "connected" -- see shared/link-word unitWord.
   */
  unit: 'unknown',
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
  error: null,
  /*
   * Whether what answered is the simulation rather than a rig.
   *
   * Held because the SLUG cannot tell them apart: the demo's FM3 and a real
   * FM3 both answer 'fm3', so leaving the demo with an FM3 plugged in looked
   * to this store like the same unit it already had — and the 512 preset
   * names read off the simulation stayed on screen over the real one's slots.
   */
  simulated: false
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
  /* Every add, move and remove comes through here, which is why the mark
     goes here rather than on each of them. */
  noteEdited()
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
  stopWatching()
}

/* ---------------------------------------------------------------- */
/* Is the unit still there?                                          */
/* ---------------------------------------------------------------- */

/*
 * "I purposefully unplugged the FM3 from the computer and it still said
 * connected. I waited a few minutes, went ahead and tried to click some
 * buttons, go to different presets, still said connected, so it's lying."
 *
 * Nothing asked. `unit` was set by refreshAll at the moment of connecting
 * and by whatever reads a screen happened to make after that — and the
 * screens that matter most on stage make none, because everything they draw
 * is already in this store.
 *
 * Pressing buttons could not settle it either. A preset change, a bypass, a
 * scene: those are writes, and a write into a port whose far end has been
 * pulled out does not have to come back as an error. Only an ANSWER proves
 * anybody is home, so this asks for one on a timer — which preset is loaded,
 * the first thing a unit that has gone stops being able to say.
 *
 * refreshPreset already knows that rule (-1 means the computer asked and the
 * unit said nothing) and already sets `unit: 'silent'`, which the top bar
 * already draws in red. Everything needed was here except somebody asking.
 */
let watchTimer = null
/*
 * Which run of the watch this is.
 *
 * A read is in the air for as long as the far end takes, and stopWatching can
 * land in the middle of one. Clearing the timer does not reach that read, so
 * without a generation the tick it belongs to would come back and arm the
 * next one — a watch that carries on after it was stopped, invisibly, and a
 * second watchUnit() would then leave two of them running.
 */
let watchRun = 0

/** Ask about the unit from now on. Safe to call repeatedly. */
export function watchUnit() {
  if (watchTimer) return stopWatching
  const run = ++watchRun
  let quiet = 0
  const tick = async () => {
    watchTimer = null
    let said = 'quiet'
    try {
      said = probeSays({ preset: await device.currentPreset() })
    } catch {
      said = probeSays({ failed: true })
    }
    if (run !== watchRun) return
    quiet = countQuiet(quiet, said)
    /*
     * One quiet answer is not evidence — the computer asks this same port
     * several times a second and a question that loses that race looks
     * exactly like a unit that has gone. Two in a row is not a race.
     */
    if (unitGone(quiet)) {
      quiet = 0
      if (state.unit !== 'silent' && state.unit !== 'missing') {
        logDebug('unit', 'the unit stopped answering the timed check')
      }
      /* refreshPreset is what decides the word, so it decides it here too
         rather than this reaching into the store with its own opinion. */
      await refreshPreset()
      if (run !== watchRun) return
    }
    watchTimer = setTimeout(tick, watchEvery(true))
  }
  watchTimer = setTimeout(tick, watchEvery(true))
  return stopWatching
}

export function stopWatching() {
  watchRun += 1
  if (!watchTimer) return
  clearTimeout(watchTimer)
  watchTimer = null
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
  /*
   * A different unit means the names read off the last one are wrong — and so
   * does the same unit arriving from the other side of the demo switch.
   *
   * "It's also still showing demo presets when I'm no longer in the demo."
   * The demo's FM3 and his FM3 share a slug, so this comparison said nothing
   * had changed and the simulation's names were served over the real rig's
   * slots. They are lazily filled and never re-read wholesale, so nothing
   * later corrected them; signing out was the only thing that cleared them,
   * which is exactly what he had to do.
   */
  const simulated = isDemo()
  if (slug !== state.deviceSlug || simulated !== state.simulated) forgetNames()
  const unit = caps?.connected === false ? 'missing' : 'present'
  if (unit !== state.unit) logDebug('unit', unit === 'missing' ? 'the computer has no unit' : 'the computer has a unit', caps?.short || caps?.name || undefined)
  set({
    capabilities: caps?.capabilities ?? null,
    deviceName: caps?.short || caps?.name || '',
    /* Kept rather than dropped on the floor, which is what happened to the
       computer's own version for eighty releases. A unit that does not report
       one leaves this null and the screen draws nothing. */
    firmware: firmwareOf(caps),
    deviceSlug: slug,
    simulated,
    unit,
    /*
     * The old failure is over, because this one worked.
     *
     * "Says I'm not connected but I'm clearly connected based on the green
     * FM3 and connected button." Both were true: the bar reads the live link
     * and was right, and the note reads this field, which no successful read
     * ever cleared. So a message from a minute ago sat over a working rig
     * until the app was signed out. A detect that answers IS the evidence
     * that whatever failed before is no longer failing; anything that fails
     * after this sets its own.
     */
    error: null
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

/**
 * Something changed on this preset that a save would keep.
 *
 * "The save button is visible and able to be clicked even though there's
 * nothing that I change and nothing to save. Can we set that to only show up
 * after a parameter has been changed?"
 *
 * There was already a flag for this and it only knew about NAMES — a renamed
 * preset or scene, because those are the two the phone has to remember for
 * itself in order to put them back. A moved knob needs no remembering: the
 * unit is holding it and drops it at the next preset change, all by itself.
 * So nothing marked the preset as touched when the thing that touched it was
 * a knob, and the Save button had no way to know whether there was anything
 * to save.
 *
 * This is that mark, and it deliberately shares the one record. A save writes
 * the unit's whole edit buffer, so knobs and names are not two kinds of
 * unsaved work with two kinds of button — they are one question, "is there
 * anything here that dies at the next preset change", and one answer.
 *
 * WHAT COUNTS is anything that ends up in the edit buffer: a parameter, a
 * bypass, a channel, a model, a chain move, a modifier, a tempo, a name.
 * What does NOT count is changing scene or preset, or turning the tuner on —
 * those move you around the rig rather than altering it.
 */
export function noteEdited() {
  const number = state.preset?.number
  if (!Number.isInteger(number)) return
  const unsaved = pendingFor(number)
  /* Already marked: the record is the same object, and setting it again
     would re-render every screen watching it on every knob of a drag. */
  if (unsaved === state.unsaved) return
  set({ unsaved })
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
    /*
     * A preset number of -1 is the computer saying the unit did not answer
     * its own name -- the first thing a frozen unit stops doing. Said on the
     * bar as "unit not answering" rather than a slot -1 under a green word.
     */
    const answered = Number.isInteger(fresh?.number) && fresh.number >= 0
    if (fresh?.number === -1 && state.unit !== 'silent') logDebug('unit', 'the unit did not answer the computer', 'no preset number')
    if (answered && state.unit === 'silent') logDebug('unit', 'the unit is answering again')
    set({ preset: fresh, ...(fresh?.number === -1 ? { unit: 'silent' } : answered && state.unit !== 'missing' ? { unit: 'present' } : {}) })
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
    /* Said in the log as well as on screen: "Chain — out of date" and the
       note under it used to be the only record that this read failed. */
    logDebug('chain', 'the chain could not be read — buttons kept from the last read', err.message)
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
    // one we just left until this comes back. A scene moves no block, so this
    // is the small status read, not a dump of the whole preset -- see
    // device.sceneState for what the dump did here.
    await refreshSceneState()
  })
}

/**
 * Re-read each block's bypass and channel and lay them over the chain on
 * screen. Falls back to the full read when the computer cannot answer the
 * small one, so an older Mac still gets the right picture, just slower.
 */
export async function refreshSceneState() {
  let states = []
  try {
    states = await device.sceneState()
  } catch (err) {
    logDebug('chain', 'scene state could not be read — reading the whole chain instead', err.message)
    return refreshBlocks({ quiet: true })
  }
  if (!states.length) return refreshBlocks({ quiet: true })
  const byId = new Map(states.map((s) => [s.effectId, s]))
  const lay = (b) => {
    const s = byId.get(idOf(b))
    return s ? { ...b, bypassed: s.bypassed ?? b.bypassed, channel: s.channel ?? b.channel } : b
  }
  set({ blocks: state.blocks.map(lay), allBlocks: state.allBlocks.map(lay) })
  return true
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
  noteEdited()
  return optimistic(patchBlock(id, { bypassed }), was, () => device.setBypass(id, bypassed))
}

export function writeChannel(id, channel) {
  const was = asWas()
  noteEdited()
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

/* When each tap happened, so the tempo they mean can be shown at once rather
   than waited for. Module-level beside `reread` because a burst of taps is one
   rhythm however many screens come and go during it. */
let taps = []

/*
 * What crosses the network is the NUMBER, not the taps.
 *
 * "Right now after I tap it a few times slowly, it'll send a number and then
 * I'm done tapping and it sends back a different one."
 *
 * Because every press was forwarded as a tap — POST /tempo/tap — and the unit
 * worked the tempo out from the spacing between them AS THEY ARRIVED. That is
 * the thumb's spacing plus whatever the wifi, the relay server and the
 * computer's own queue added to each press, differently each time, and the
 * further apart the taps the more of it accumulates. The unit then reported,
 * correctly, the tempo of what it had actually heard.
 *
 * Nothing at the far end can undo that; the timing is gone by the time it
 * arrives. The only clock that knows the rhythm is the one in the hand. So
 * the gaps are measured here and the answer is SET, with the same call a
 * typed tempo uses. See shared/tempo.mjs.
 *
 * One write in the air at a time, newest number wins — a burst of taps must
 * not queue five writes and have the last one land after the read-back.
 */
const sendTempo = tempoSender(
  (bpm) => device.setTempo(bpm),
  (err) => set({ error: err.message })
)

export async function tapTempo() {
  clearTimeout(reread)
  /*
   * WHAT THE TAPS MEAN, SHOWN NOW AND SENT NOW.
   *
   * "It should change the tempo based on the tap and change the number
   * immediately … you can't even tell the tempo you're tapping at."
   *
   * tempoSetAt is stamped so the ordinary stale-read guard protects this the
   * same way it protects a typed tempo. readTappedTempo clears it deliberately,
   * which is how the unit's own answer gets to win a moment later — and now
   * that answer is the number this sent, so it agrees.
   */
  taps = keepTaps(taps, Date.now())
  const guess = tappedBpm(taps)
  if (guess != null) {
    /* The tempo lives in the preset, so a tap is a change to it — and a save
       that dropped the tempo somebody just set would be a save that lied. */
    noteEdited()
    set({ bpm: guess })
    tempoSetAt = Date.now()
    expect('bpm', guess)
    sendTempo.push(guess)
  }
  /* The read after the burst confirms what the unit ended up on. It waits for
     the last write to land, or it answers about the one before it. */
  reread = setTimeout(function settle() {
    if (!sendTempo.idle) {
      reread = setTimeout(settle, TAP_REREAD_MS)
      return
    }
    readTappedTempo()
  }, TAP_REREAD_MS)
  return true
}

export function writeTempo(bpm) {
  const was = state.bpm
  noteEdited()
  expect('bpm', bpm)
  tempoSetAt = Date.now()
  return optimistic({ bpm }, { bpm: was }, () => device.setTempo(bpm))
}

/*
 * The demo's tuner, which on a phone was a needle that never moved.
 *
 * "Demo tuner animations." The simulation has had a proper tuner in it the
 * whole time — lib/tunerStream, which holds a note for the life of a ring and
 * only picks a new string coming out of a quiet gap, because a real detector
 * cannot hop mid-note. The browser subscribes to it and animates.
 *
 * The phone never did. Its readings arrive as events off the relay, and in
 * the demo there is no relay to carry them — so the tuner opened, the timer
 * ran, and nothing ever reached the needle. Which is the one screen in the
 * app where "nothing happens" and "it is broken" look identical.
 *
 * So in the demo the phone drives the same stream itself, at the same 400ms
 * the browser polls it, straight into the same handleEvent every real reading
 * goes through. Nothing downstream can tell the difference, which is the
 * point: the tuner screen is being demonstrated, not a second copy of it.
 */
let tunerTimer = null

function stopDemoTuner() {
  if (!tunerTimer) return
  clearInterval(tunerTimer)
  tunerTimer = null
}

function startDemoTuner() {
  stopDemoTuner()
  const source = device.demoTuner?.()
  if (!source) return
  tunerTimer = setInterval(() => handleEvent(source.next()), 400)
}

/**
 * Turn the tuner on or off.
 *
 * The flag goes down before the request, not after: a tuner the unit refuses to
 * start must not leave a screen waiting for readings that are never coming.
 */
export async function writeTuner(on) {
  set({ tunerOn: on, tuning: on ? state.tuning : null, error: null })
  if (!on) stopDemoTuner()
  try {
    await device.setTuner(on)
    /* Only once the unit has agreed, and only in the demo — on a real rig the
       readings come off the relay and a second source would fight them. */
    if (on) startDemoTuner()
    return true
  } catch (err) {
    stopDemoTuner()
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
  /*
   * THE COMPUTER'S COPY IS OLDER THAN THE PRESET NOW LOADED, so it is dropped
   * before anything is read back.
   *
   * "I clicked a preset name, in this case it was Drop D Chug, then it went to
   * the preset screen, shows Drop D Chug for a split second, and then goes to
   * Metallica." On two phones, and Refresh put it right on each of them
   * separately.
   *
   * Both halves of that are this. The split second is the name this app
   * already knew, shown at once so the screen is not blank; what replaces it
   * is the answer to "what preset is loaded", and the computer holds that
   * answer for fifteen seconds. A read inside the window describes the preset
   * you just LEFT — so the stage settled on the old name, the old scene names,
   * and the old chain, all of them consistent with each other and with nothing
   * on the unit. Two phones asking the same computer got the same stale
   * answer, which is why one of them refreshing did nothing for the other.
   *
   * The preset list was right throughout, because it is drawn from names this
   * app read off the unit rather than from that copy. The one on screen was
   * the one that came from the computer.
   *
   * The chain editor has dropped this copy after a write since the day it was
   * written, for the same reason in the other direction — see `after()` in
   * screens/Edit.js. Changing which preset is loaded is the larger change of
   * the two and was not doing it.
   */
  await device.dropReadCache()
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
