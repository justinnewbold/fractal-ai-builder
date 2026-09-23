import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopBar from './components/TopBar'
import { ChangeLog } from './components/ChangeLog'
import Diagnostics from './components/Diagnostics'
import Volume from './components/Volume'
import DebugLog from './components/DebugLog'
import PresetReport from './components/PresetReport'
import { installCrashCapture, logDebug, getDebugLog } from './lib/debugLog'
import Scenes from './components/Scenes'
import { CabPicker, Backup } from './components/Hardware'
import Gig from './components/Gig'
import SaveBar from './components/SaveBar'
import SaveSheet, { SaveFooter } from './components/SaveSheet'
import { getMode } from './lib/theme'
import { Modifiers, SceneMatrix } from './components/Modifiers'
import Feedback from './components/Feedback'
import { platform } from './lib/platform'
import { Versions, DeviceBackup } from './components/Versions'
import GridEditor from './components/GridEditor'
import Ports from './components/Ports'
import LocalLibrary from './components/LocalLibrary'
import GearNames from './components/GearNames'
import PhoneApp from './components/PhoneApp'
import SetupRow from './components/SetupRow'
import Onboarding, { onboarded, markOnboarded } from './components/Onboarding'
import { REPLAY } from '../shared/onboarding.mjs'
import { FULL, BUILT_AT, VERSION } from './lib/version'
import Theme from './components/Theme'
import Section from './components/Section'
import Sheet from './components/Sheet'
import DeviceDetail from './components/DeviceDetail'
import {
  attachDriver,
  listen as listenToDevice,
  useDevice,
  put as putDevice,
  getSnapshot as deviceSnapshot,
  macSilent,
  refreshBlocks,
  refreshScene,
  refreshSceneNames,
  refreshTempo,
  tapBeat,
  writeScene,
  writeTempo,
  confirmedDetect,
  SETTLING_TRIES,
  SETTLING_MS,
  writeBypass,
  writeTuner
} from './lib/deviceState'
import ParamSearch from './components/ParamSearch'
import UpdateNotice from './components/UpdateNotice'
import Updates, { UpdateReadyNotice } from './components/Updates'
import RenamePreset from './components/RenamePreset'
import { countFromRefusal, slotCount, slotOutside, slotsForChat, timeLeft } from './lib/slots'
import { inDesktopApp } from './lib/desktop'
import { createNameScan } from './lib/nameScan'
import { Chain, PresetList, BlockPanel, Tuner } from './components/Console'
import Screens, { viewsFor } from './components/Screens'
import { useAsks } from './lib/asks'
import { SIZES, loadSize, saveSize, clampSize, loadFit, saveFit } from './lib/gigSize'
import { editButtonShows } from './lib/playMode'
import { FIXES, FIRMWARE_NOTE, fixById, fixFor, versionsInSync } from '../shared/troubleshooting.mjs'
import { osGuess, waysFor, waysWord } from '../shared/ways-in.mjs'
import { AFFILIATION } from '../shared/affiliation.mjs'
import { remember as rememberPreset, CHANGED as MARKS_CHANGED } from './lib/presetMarks'
import { CHANGED as SETLISTS_CHANGED } from './lib/setlists'
import { syncSetlists, setlistCloudReady } from './lib/cloudSetlists'
import {
  getTempo,
  setTempo,
  tapTempo,
  setBypass,
  setTuner,
  subscribeEvents,
  cachedPresetNames,
  knowsName,
  unreadSlots,
  learnName,
  importHostNames,
  publishNames,
  namesCostADump,
  parkSave,
  takeParkedSave,
  clearParkedSave,
  reportSave,
  readSaveResult,
  forgetPresetName,
  forgetAllPresetNames,
  notePresetName,
  noteSceneNames,
  readSceneNames,
  currentDeviceSlug,
  setTelemetryMode,
  placeableBlocks
} from './lib/forgefx'
import { isDemo, setDemo, resetCacheClear, demoUnit, setDemoUnit } from './lib/forgefx'
import { UNITS as DEMO_UNITS, demoSentence, unitByKey } from './lib/demoUnits'
import { buyOnWeb, checkUnlocked, webPrice } from './lib/webPurchase'
import {
  detect,
  currentPreset,
  presetBlocks,
  readSchema,
  resetSchemaCache,
  applyChanges,
  applyScenes,
  verifyChanges,
  storePreset,
  selectPreset,
  clearDeviceCache,
  getScene,
  setScene,
  sceneChannels,
  setPresetName,
  setChannel,
  revertPreset,
  backupPreset,
  parkPresetName,
  takeParkedPresetName,
  clearParkedPresetName,
  getHost,
  servedLocally
} from './lib/forgefx'
import ConnectScreen from './components/ConnectScreen'
import PhoneRemote from './components/PhoneRemote'
import LinkDetails from './components/LinkDetails'
import SignInSheet from './components/SignInSheet'
import {
  bootLink,
  linkState,
  subscribeLink,
  describeLink,
  pokeLink,
  connectPhone,
  reconnectPhone,
  disconnectPhone,
  setUpMac,
  signInAccount,
  createAccount,
  isPairAccount,
  setMacRemote,
  signOutHere,
  recheckHosts,
  chooseHost,
  faultCopy,
  nextDelay
} from './lib/link'
import { loadSession, saveSession, interrupted } from './lib/session'
import { pushEntry, replaceEntry } from './lib/nav'
import { useDismiss } from './lib/dismiss'
import {
  remoteActive,
  remoteHostSeen,
  hostResponds,
  loadRemoteConfig,
  subscribeRemoteState
} from './lib/remote'
import { newEntry, append } from './lib/log'
import { watchEvery, probeSays, countQuiet, unitGone } from '../shared/unit-watch.mjs'


/**
 * Which log entries are worth telling the assistant about.
 *
 * Changes to the sound and to what is loaded, so "put that back" and "what did
 * I just do" work after a hand edit. Not asks — those are already turns — and
 * not housekeeping like port choice or backups, which say nothing about the
 * tone.
 */
/**
 * Past this many changes in one request, show them before doing them.
 *
 * Four is roughly the line between "turn the gain up and cut the bass" and
 * reshaping the sound. Below it you know what you asked for; above it you want
 * to read the list first.
 */
/*
 * What the device store is allowed to do to the unit.
 *
 * Handed over rather than imported by the store, so the store stays a pure
 * module that node can load and the whole optimistic-write path is testable
 * without a browser. Done once, at module scope: there is one unit.
 */
attachDriver({
  subscribeEvents,
  presetBlocks,
  getScene,
  setScene,
  getTempo,
  setTempo,
  tapTempo,
  setBypass,
  setTuner,
  readSceneNames
})

/* Hoisted so each is one function for the life of the module: a selector
   rebuilt every render makes useSyncExternalStore re-read on every notify. */
const ofPreset = (s) => s.preset
const ofBlocks = (s) => s.blocks
const ofScene = (s) => s.sceneIndex
const ofSceneNames = (s) => s.sceneNames


/** How long the "Done" card stays on a screen before it takes itself off. */
const DID_STAYS_MS = 20000

/**
 * The one-time note on Play about holding a block for its channels.
 *
 * "On the play screen the first time it's opened, have another pop up that
 * also tells them to hold down those buttons to switch channels... I actually
 * believe we had this previously set up, but I'm not seeing it working."
 *
 * It was not. Nothing on Play has ever said this, which is why it reads as
 * something that used to work: the gesture is real and has been since the
 * channel sheet was built, and a gesture with nothing on screen pointing at it
 * is indistinguishable from one that is broken.
 *
 * Its own key rather than the tour's. Somebody who skipped the introduction,
 * or who met this app before the card existed, still gets told once — and put
 * away, it stays away.
 */
const HOLD_NOTE_KEY = 'fab.play.hold'
const holdNoteWasSeen = () => {
  try {
    return localStorage.getItem(HOLD_NOTE_KEY) === 'seen'
  } catch {
    return false
  }
}
const rememberHoldNote = () => {
  try {
    localStorage.setItem(HOLD_NOTE_KEY, 'seen')
  } catch {
    // Private windows throw; it comes back next time, which is fine.
  }
}

/** The one-time note about the demo, once put away. */
const DEMO_NOTE_KEY = 'fab.demo.note'
const demoNoteWasSeen = () => {
  try {
    return localStorage.getItem(DEMO_NOTE_KEY) === 'seen'
  } catch {
    return false
  }
}
const rememberDemoNote = () => {
  try {
    localStorage.setItem(DEMO_NOTE_KEY, 'seen')
  } catch {
    // Private windows throw; the note comes back next time, which is fine.
  }
}

/**
 * Write down what a slot is called, the moment a save puts a name in it.
 *
 * Three routes end in a preset landing in a slot — a save at the Mac, the Mac
 * carrying out a save the phone asked for, and the phone hearing back that it
 * landed — and all three used to do the same thing to the list: forget that
 * slot's name and wait for somebody to read it again. On a phone nobody can:
 * an AM4 will not dump a preset over the relay, so the old name simply stayed,
 * through a restart and for good. "It says TIGHT MODERN on 98 when it's Three
 * Days Grace."
 *
 * A buffer with no name of its own is the one case with nothing to state, and
 * that one is still forgotten rather than asserted as empty.
 */
function keepSavedName(number, name) {
  const kept = (name || '').trim()
  if (kept) notePresetName(number, kept)
  else forgetPresetName(number)
}

/**
 * The slot the unit says it is on, under the name it says it has. A buffer
 * with no name is not evidence of anything and leaves the row alone.
 */
function noteLoadedName(p) {
  if (typeof p?.number !== 'number') return
  const kept = (p.name || '').trim()
  if (kept) notePresetName(p.number, kept)
}

/**
 * And the scenes that went with it, from the buffer that became that slot.
 *
 * Every index, including the blank ones: the buffer is the truth for this slot
 * now, so a scene left unnamed here really is unnamed there.
 */
function keepSavedScenes(number, names) {
  if (!Array.isArray(names) || !names.some((n) => (n || '').trim())) return
  noteSceneNames(number, new Map(names.map((n, i) => [i, (n || '').trim()])))
}

/**
 * What a remote session cannot do.
 *
 * ForgeFX's allowlist stops at live performance edits — anything that
 * permanently overwrites is local-only. Mirroring the list here is what lets the
 * app explain itself instead of relaying a 403.
 */

/**
 * Kinds that leave the preset holding unsaved changes.
 *
 * Narrower than HAND_EDIT_KINDS: loading a preset or writing to the library
 * tells the assistant something useful but doesn't make the edit buffer dirty.
 */
const UNSAVES_PRESET = new Set(['edit', 'grid', 'scene', 'cab', 'modifier', 'tempo'])

/**
 * What the chat is told about a design: enough to explain it, not the spec.
 *
 * The result panel holds the whole validated plan. The chat needs the name,
 * what was asked for, the designer's summary and notes — that summary is the
 * reasoning, "matched the 2204 Angus and Malcolm actually ran" — and, per
 * block, the model chosen and the settings moved. `applied` flips when the
 * plan is written, so "did you change my amp" has a true answer.
 */
function designMemory(validated) {
  if (!validated || !Array.isArray(validated.changes)) return null
  return {
    name: validated.presetName || '',
    description: validated.description || '',
    summary: validated.summary || '',
    notes: validated.notes || '',
    applied: false,
    changes: validated.changes.map((c) => ({
      name: c.name,
      typeName: c.typeName || null,
      bypassed: c.bypassed === true,
      params: (c.params || []).map((p) => ({ name: p.name, to: p.to, unit: p.unit || '' }))
    }))
  }
}

const HAND_EDIT_KINDS = new Set([
  'edit',
  'scene',
  'grid',
  'cab',
  'modifier',
  'tempo',
  'save',
  'select',
  'library'
])

/** The pages behind Setup's rows, by key, in the words on the rows. */
/*
 * The doors, in the order somebody meets them.
 *
 * "Unit" was the top row and it held two unrelated things: whether the unit
 * is answering, and the way in to renaming presets and scenes. The first of
 * those is what "Phone & computer" is ABOUT — the cable, the computer, the
 * unit on the end of it, one chain — and splitting the chain over two rows
 * meant neither row could say whether it was working. So the state went
 * there, the row kept the errand, and the row is named after the errand:
 * "Rename presets and scenes" is a thing you came here to DO, where "Unit"
 * was a thing you had to open to find out what was inside.
 *
 * "Help & fixes" is "Troubleshooting" for the same reason the log and the
 * feedback form now live behind it: they are three stages of one errand —
 * read what to try, read what happened, tell somebody — and they were three
 * rows that each looked like a different errand.
 */
const SETUP_PAGES = {
  link: 'Phone & computer',
  phone: 'Get it on your phone',
  demo: 'Demo Unit',
  rename: 'Rename presets and scenes',
  help: 'Troubleshooting',
  updates: 'Updates',
  about: 'About',
  /* The phone's sheet is titled Unlock; so is this page. */
  unlock: 'Unlock'
}

/**
 * WHICH PAGE A PAGE CAME FROM, for the two that are no longer on the front list.
 *
 * "It looks like some of the menus aren't matching up, some of the changes we
 * made recently, like nesting some of the menus."
 *
 * Troubleshooting moved inside About and the demo picker inside Phone &
 * computer, matching the phone — and the moment a page sits one level down, a
 * Back button that always says "‹ Settings" and always goes to the front list
 * walks straight past the page you were standing on. The phone hit this same
 * wall when About swallowed three rows and grew the same map; this is the
 * browser's copy of it.
 *
 * A map rather than an `if`, so the next nested page is a line rather than a
 * branch.
 */
const SETUP_PARENT = { help: 'about', updates: 'about', demo: 'link' }
const upFrom = (page) => SETUP_PARENT[page] || null
const upLabel = (page) => `\u2039 ${SETUP_PAGES[upFrom(page)] || 'Settings'}`
/** What the chat says when a request needed the model and the model is off. */

export default function App() {
  const [status, setStatus] = useState('idle')
  /*
   * Which of the ways a read can fail this one was.
   *
   * 'no-unit' — the Mac answered and nothing is plugged into it.
   * 'no-answer' — the question never came back.
   * 'unreadable' — the Mac answered and the read failed anyway.
   *
   * The screen used to work this out from `device`, which cannot tell the
   * first from the other two: a question that never came back leaves `device`
   * exactly as it was, and before the first answer of the session that is
   * null — the same null a fresh phone starts with. So a Mac that had gone
   * quiet was described as a Mac that had answered. See faultCopy.
   */
  const [faultReason, setFaultReason] = useState(null)
  /*
   * The walkthrough, and whether it has been through.
   *
   * Opened from `onboarded()` rather than a fresh false, so a reload does not
   * start it again — and marked the moment it opens rather than when it
   * finishes. Somebody who opens it, reads a screen and closes the tab has
   * seen it; offering it again treats closing as an accident, and a tutorial
   * that keeps coming back is the thing everybody remembers hating.
   */
  const [walkthrough, setWalkthrough] = useState(() => !onboarded())
  useEffect(() => {
    if (walkthrough) markOnboarded()
  }, [walkthrough])
  const [device, setDevice] = useState(null)
  /*
   * The unit's own state comes from the store, not from here.
   *
   * These used to be App's useStates, and Gig kept a second copy of four of
   * them with its own event subscription — two clients contending for one
   * serial port, and two answers to "which scene is live". The setters below
   * keep their old names so every call site reads the same; what changed is
   * where the value lives.
   */
  const preset = useDevice(ofPreset)
  const blocks = useDevice(ofBlocks)
  /*
   * The block the volume moves, which is also the reason there is a speaker in
   * the bar at all. The output block's Level is the whole preset's volume —
   * lib/volume.js says why that one is the player's to move — and a preset
   * that has no output block has no volume, so it gets no speaker rather than
   * a speaker that opens an empty sheet.
   */
  const outputEid = useMemo(
    () => blocks.find((b) => b.slug === 'output')?.effectId ?? null,
    [blocks]
  )
  /*
   * An effect id turned back into the name on the unit.
   *
   * The model answers in ids, because that is what it was given. "eid 58" is
   * the unit's word for Amp 1 and nobody else's, and it was being printed
   * straight onto the screen while a tone was building.
   */
    const [error, setErrorText] = useState(null)
  /*
   * WHEN the message on screen was raised, as well as what it says.
   *
   * "I tap one of the buttons and nothing happens." The second tap of a button
   * that has already failed once set the same string into the same state, React
   * saw no change, and nothing re-rendered and nothing was logged — so a
   * failure that is happening over and over looks exactly like a button that
   * is doing nothing at all. This is what makes a repeat count as news: the
   * notice is keyed on it and remounts, which is also what makes a screen
   * reader say it again.
   */
  const [errorAt, setErrorAt] = useState(0)
  /* The far end's own words for the last failure, where it had any. See setError. */
  const [errorDetail, setErrorDetail] = useState(null)
  /*
   * Whether the unit itself has gone, as opposed to one write being refused.
   *
   * Set when a call comes back saying the Mac has no port to the unit any
   * more. It decides which fault notice is shown, and it is cleared by the
   * next read that works.
   */
  const [lostUnit, setLostUnit] = useState(false)
  /*
   * How many times the unit was actually asked before this was called a fault.
   *
   * The notice said "five times" whatever happened. Five is what a phone that
   * was not already live does; a unit that WAS answering a moment ago is asked
   * three times and a screen at the Mac once, so the same sentence was being
   * shown over two asks that never happened. See faultCopy.
   */
  const [asks, setAsks] = useState(0)
  /*
   * Which sheet was over the screen when the message was raised, so the sheet
   * can show its own failures and none of anybody else's. A ref, updated in
   * render, because the one way in below is built once and would otherwise
   * close over whichever sheet was open at mount — which is none of them.
   */
  const sheetNow = useRef(null)
  const [errorSheet, setErrorSheet] = useState(null)
  /*
   * One way in for everything that failed, taking the error itself or a
   * sentence. The error is worth having whole: only the object carries
   * `unitGone`, and that is the difference between "that write was refused"
   * and "nothing on this screen is true any more".
   */
  const setError = useCallback((value) => {
    const text =
      value == null ? null : typeof value === 'string' ? value : value.message || String(value)
    setErrorText(text)
    /*
     * What the far end actually said, kept beside the sentence a player reads.
     *
     * Only the errors that carry one — today that is the port being shut, where
     * the sentence on screen is this app's translation and "port not open" is
     * the server's own four words. Nobody can act on those four words, which is
     * why they are not the notice; they are the difference between a screenshot
     * that raises a question and one that answers it.
     */
    setErrorDetail(value && typeof value !== 'string' ? value.detail || null : null)
    setErrorAt(text ? Date.now() : 0)
    setErrorSheet(text ? sheetNow.current : null)
    if (value && typeof value !== 'string' && value.unitGone) setLostUnit(true)
  }, [])
  /*
   * Every error the screen shows is a line in the debug log too, and so is a
   * crash the screen never got to show. One place, so a report has both.
   */
  useEffect(() => {
    if (error) logDebug('error', error)
  }, [error, errorAt])
  useEffect(() => installCrashCapture(), [])
  const [busy, setBusy] = useState(false)
  /*
   * Saving needs its own flag, because `busy` is not about saving.
   *
   * One boolean guards ten different operations here — generating, applying,
   * jumping slots, reading the chain — and the save button was rendering
   * `busy ? 'Saving…'`. So designing a tone lit up a button claiming to be
   * writing to a slot, which is the one thing in this app you most want to be
   * sure isn't happening by surprise. `busy` still does the disabling; only
   * the word belongs to the save.
   */
  const [saving, setSaving] = useState(false)

  /*
   * What was on screen when this page last existed.
   *
   * Read once, synchronously, before the first render — a phone coming back
   * from the background must not flash an empty conversation on its way to the
   * real one. See lib/session.js for why this state has to leave memory at all.
   */
  const restored = useRef(loadSession()).current
  const [result, setResult] = useState(restored?.result ?? null)
  /*
   * The most recent design, kept after the panel that showed it has gone.
   *
   * "Why did you choose the tones that you did?" was asked of a chat that
   * could see fifty-two changes had been written and nothing about why: the
   * designer's summary lived in the result panel, and the result panel is
   * cleared by the next design, a reload, or a Leave it. This survives all
   * three so the conversation can answer from the record. See designMemory.
   */
    /*
   * The tones asked for earlier in this conversation.
   *
   * There was one slot for a design, so a second tone destroyed the first —
   * ask for "something darker" and the thing you were comparing it against was
   * gone from the screen, with nothing anywhere that remembered it. History
   * only keeps what was saved, so a tone that was generated and turned down
   * left no trace at all.
   *
   * "Like most chat bots" is the whole specification: what was said stays
   * said. Each entry keeps the tone exactly as it was, where it was asked for,
   * the two choices that were on it, and what became of it.
   */
      /*
   * Whether to write the scene plan too. Off by default: it is the one part of
   * a generation that walks the unit through every scene, and someone who
   * asked for a sound has not asked for their scene layout to be rearranged.
   */
  const [withScenes, setWithScenes] = useState(!!restored?.withScenes)
  /*
   * Whether to put the generated name on the preset itself.
   *
   * Naming the scenes and naming the preset are two different decisions, and
   * the app used to make them together: every generation renamed the slot,
   * whatever it was already called. Someone laying a set of scenes into a
   * preset they have already named does not want it renamed underneath them.
   */
  const [renamePreset, setRenamePreset] = useState(restored?.renamePreset !== false)
  /*
   * Whether this tone, exactly as it now stands, has already been written.
   *
   * "After sending changes, it still says send changes." It did: the button
   * counted the writes in the plan and went on offering them for ever, so the
   * one question it answered — have I sent this? — it answered wrongly from
   * the moment you pressed it, and pressing it again wrote all sixty-four a
   * second time.
   *
   * "Exactly as it now stands" is the whole of it. Scenes and the rename are
   * tick boxes on the card, and turning one on after sending genuinely does
   * leave something unsent, so the offer has to come back.
   *
   * Held as the plan that was sent rather than a flag, and compared, so no
   * setter has to remember to clear it — there are eight places that replace
   * the result and three that change a tick box, and a flag would have to be
   * cleared correctly in all eleven for ever. Identity on `result` is exact:
   * every generation, refine and restore builds a new object. Turning a tick
   * box back to where it was makes this true again, which is right — that plan
   * really was sent.
   */
    /*
   * A build waiting on one question. A preset where no scene has a name has
   * nothing to lose, so this is the moment to ask whether they want one sound
   * or a set of them — before the model runs, rather than after, when the
   * answer would cost a second generation.
   */
    /*
   * A saved tone waiting on the same kind of question, asked the other way
   * round. A tone made on an eight-scene unit holds scenes the unit in front
   * of you may not have, and which of them come across is the player's call —
   * see lib/sceneFit.js. Null whenever the tone fits, which is most of them.
   */
    const [progress, setProgress] = useState(null)
  const [applied, setApplied] = useState(null)
  /*
   * What a request in words just did, for the screen it takes you to.
   *
   * The chat already said it — "Done — 3 changes." goes into the conversation
   * — and then the app immediately walks away from the conversation to put the
   * thing that changed on screen. So the answer was written to the one screen
   * the person was no longer looking at, and what they got was a jump to Edit
   * with nothing said: "it pulled up the screen automatically, but didn't tell
   * me that anything got changed, so I'm confused."
   *
   * The report travels with them now. Only where the conversation isn't —
   * saying it twice on the Ask screen would be noise, not reassurance.
   */
  const [justDid, setJustDid] = useState(null)
  const [slot, setSlot] = useState('')
  const [saveName, setSaveName] = useState(restored?.saveName || '')
  /*
   * The save name follows the unit's name, unless somebody typed another.
   *
   * "Rename preset to Tool" — done, said the chat. Six seconds later the
   * save sheet asked the Mac to save it as "Tool - Adam Jones", the name the
   * design had proposed, and the Mac renames before it stores, so the old
   * name went straight back on. The field is seeded when the SLOT changes
   * and left alone after that, on purpose (see the seeding effect): a
   * generation's suggested name must survive the re-reads its writes cause.
   * So this only moves it when the unit's name changes AND the field still
   * says what the unit used to — the one case where it was plainly not a
   * name anybody typed.
   */
  const unitName = useRef(null)
  const followUnitName = (p) => {
    const now = typeof p?.name === 'string' ? p.name.trim() : null
    const was = unitName.current
    unitName.current = now
    if (now === null || was === null || now === was) return
    setSaveName((field) => (field.trim() === was ? now : field))
  }
  // A failed save is shown on the save bar as well as in the banner — the bar is
  // where the tap happened, and on a phone the banner is off-screen above it.
  const [saveError, setSaveError] = useState(null)
  const [log, setLog] = useState([])
      /*
   * The last call, so a failure can still say what it spent.
   *
   * "When there's errors and it doesn't write, it doesn't show me any tokens
   * that were used." The tone card is where that number lives and a failed run
   * has no card — so the error says it instead, including when the honest
   * answer is that nothing was reported.
   */
    const [lastPrompt, setLastPrompt] = useState(restored?.lastPrompt || '')
  /*
   * A failed generation, kept so it can be asked again with one tap.
   *
   * "Said working on tone for over 3 minutes then just disappeared and nothing
   * was generated." At the end of that the only thing on offer was Dismiss, so
   * the cost of the failure was the wait plus typing it all again. Every one of
   * these failures ends with nothing written to the unit, which is exactly the
   * condition that makes asking again safe to offer.
   */
  const [retryAsk, setRetryAsk] = useState(null)
  /*
   * The ask currently in flight, or null.
   *
   * Not state: nothing renders from it, and it has to be readable by the save
   * below without adding a render to every generation. Its whole job is to be
   * on disk when the page dies, so the next load can say the answer is not
   * coming rather than waiting for it forever.
   */
  const pending = useRef(restored?.pending || null)
  const [historyKey, setHistoryKey] = useState(0)
  /*
   * Designs kept in a chosen folder.
   *
   * When a folder is picked it becomes the home for designs, and browser
   * storage is skipped rather than written to as well — which is right, and
   * left them invisible: the list only ever read browser storage, so on a Mac
   * with a folder chosen every tone was saved somewhere the app could never
   * show. "I generated a new papa roach tone and it didn't save it to
   * history." It did. Nothing could list it.
   */
  const [folderSaves, setFolderSaves] = useState([])
  /*
   * The account's presets, held so the taste profile can see them.
   *
   * Read once when signed in rather than before every generation: this is
   * background for a request, not a value the request depends on, and a round
   * trip to Supabase in front of every "make it brighter" would be felt.
   */

  /*
   * What this player tends to like, read off what they have kept.
   *
   * Recomputed rather than stored. There is no taste table: the presets are
   * the profile, so deriving it here means it can never disagree with the
   * library it describes — deleting a preset un-learns it, which a cached
   * profile would not.
   *
   * Both stores feed it. Someone who has copied this browser's presets to
   * their account holds every one of them twice, and profileFrom dedupes for
   * exactly that reason.
   */
  

  /*
   * Read the folder's designs whenever the history moves.
   *
   * Names and times only: listing is cheap, and opening forty files to show a
   * list nobody has clicked yet is not. The full entry is read on demand when
   * one is opened, the same way a preset in a slot is.
   *
   * Silent on failure by design — a folder the browser has forgotten
   * permission for, or one that has been moved, must leave the rest of the
   * history working rather than emptying the screen.
   */
  useEffect(() => {
    let stop = false
    ;(async () => {
      try {
        const { savedFolder, listPresetFiles } = await import('./lib/localFolder')
        const folder = await savedFolder().catch(() => null)
        if (!folder || folder.needsPermission) {
          if (!stop) setFolderSaves([])
          return
        }
        const files = await listPresetFiles(folder.handle || folder)
        if (stop) return
        setFolderSaves(
          files
            .filter((f) => f.kind === 'design')
            .map((f) => ({ id: f.file, name: f.name, at: f.at, where: 'folder', file: f.file }))
        )
      } catch {
        if (!stop) setFolderSaves([])
      }
    })()
    return () => {
      stop = true
    }
  }, [historyKey])

  
  
    /*
   * The habits behind the values this player fixes by hand.
   *
   * Re-read on a counter rather than on every render, because it comes out of
   * localStorage and the only things that change it are a correction being
   * recorded and the player forgetting them all — both of which bump the
   * counter. Same shape as taste: computed from the record, never stored, so
   * forgetting the record genuinely un-learns it.
   */
      const [turns, setTurns] = useState(() => {
    const back = restored?.turns || []
    // A generation that was in flight died with the page. Say so where the
    // question was asked, rather than coming back looking as if nothing had
    // been happening.
    const cut = interrupted(restored?.pending)
    return cut ? [...back, cut] : back
  })
  /*
   * Which conversation the one on screen IS.
   *
   * Null until it has been put on the shelf once. It exists so that archiving
   * the same chat twice — start a new one, open an old one, start another —
   * updates the row it already has instead of leaving a second copy of one
   * conversation down the list. Kept with the session, so a phone that was put
   * in a pocket comes back still knowing which chat it is in.
   */
  const [chatId, setChatId] = useState(restored?.chatId || null)
  /*
   * When a chat was last put down on this device.
   *
   * "When I hit new chat, it just shows the same chat." New chat empties the
   * box here and the account a couple of seconds later, and a phone loses the
   * page inside those seconds all the time — so the account was still holding
   * the conversation that had just been discarded, and the empty box filled
   * back up with it on the next load. This is the moment that says which of
   * the two is the stale one. See cloudChat.pickChat.
   */
  const [chatClearedAt, setChatClearedAt] = useState(restored?.clearedAt || 0)
  const [remote, setRemote] = useState(false)
  // A slot write asked for from the phone: what it's waiting on there, and
  // what has arrived here.
  const [queuedSave, setQueuedSave] = useState(null)
  /*
   * Requests already dealt with, by id.
   *
   * "This notification doesn't disappear after clicking one of the options."
   *
   * Both buttons cleared the state and then cleared the parked request on the
   * host — in that order, with awaits in between. Clearing the state re-runs
   * the effect below, which looks again immediately, finds the request still
   * parked, and raises it a second time. The same happens whenever the clear
   * fails at all: the notice returns six seconds later, for ever.
   *
   * So the decision is remembered here the moment it is made, before anything
   * is awaited. A ref rather than state because it must be true instantly, in
   * the same tick, for the look() that is about to run.
   */
  const handledSaves = useRef([])
  const markHandled = useCallback((id) => {
    if (!id || handledSaves.current.includes(id)) return
    // Bounded: this only has to outlive the request that is on screen.
    handledSaves.current = [...handledSaves.current.slice(-19), id]
  }, [])
  /*
   * Whether this is the machine with the cable in it.
   *
   * Asked of localhost rather than guessed from the user agent, and asked
   * independently of the relay: a browser AT the Mac can perfectly well be in a
   * remote session — the page had been relaying to a host that wasn't on — and
   * it is still the machine where the host switch lives.
   */
  /*
   * Which end of the phone remote this is, and whether the other end answers.
   * One object from one place; every indicator draws from it, and "connected"
   * in it means the Mac answered, never merely that a channel was joined.
   */
  const [link, setLink] = useState(() => linkState())
    /* false, true for the sign-in this end's role calls for, or 'account'
       for a sign-in with no errand attached — see signInAccount. */
    const [signIn, setSignIn] = useState(false)
    /* Which side the form opens on: 'up' when a Create Account button opened it. */
    const [signInStart, setSignInStart] = useState('in')
    useEffect(() => {
      if (!signIn) setSignInStart('in')
    }, [signIn])
  /*
   * Whether the phone has ever had the Mac answer this session. A blip after
   * that keeps the screen (the chip goes red; the loop retries); before it,
   * the connect screen is the screen.
   */
  const [everLinked, setEverLinked] = useState(false)
  const [tick, setTick] = useState(0)
  /*
   * Whether the phone's screen is the connect screen. Signed out or
   * deliberately disconnected: at once. Not answering: after a ten-second
   * grace if the Mac has answered before this session — a socket lost for a
   * moment in a pocket keeps Play and gets it back unnoticed. `tick` is
   * bumped when that grace runs out so this is re-read.
   */
  const showConnect =
    link.role === 'remote' &&
    (link.link === 'signed-out' ||
      link.link === 'off' ||
      (link.link !== 'connected' && (!everLinked || Date.now() - link.since > 10000 || tick < 0)))
  // What the notice says when the unit cannot be read — by role, in one tested
  // place, and nothing at all until the role is known.
  const fault =
    status === 'fault'
      ? faultCopy({
          role: link.role,
          device,
          reason: faultReason,
          asks,
          secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
        })
      : null
  /*
   * What came back, when the notice above has nothing specific to say.
   *
   * The three named cases — the unit gone, the Mac gone quiet, a Mac with
   * nothing plugged into it — explain themselves, and repeating the message
   * underneath them is noise. Everything else lands on the generic copy, and
   * that is exactly where the one useful fact was being dropped: a screenshot
   * of "your Mac answered, but the unit didn't" with no way to tell whether it
   * was a timeout, a refusal, or something the Mac said.
   */
  const faultWhy =
    status !== 'fault'
      ? null
      : errorDetail || (faultReason === null || faultReason === 'unreadable' ? error : null)
  // Where "Leave gig" returns to. Gig takes the screen over, so coming back out
  // should land where you were rather than at a fixed default.
      /*
   * Whether the step list under Thinking is open. Open to begin with: the
   * list was asked for so the scenes could be watched being written, and a
   * chevron that starts closed hides the thing that was asked for behind a
   * tap nobody knows to make. Closing it is one tap and sticks for the
   * session.
   */
    /* The full feed of every control and value, offered by its own chip once
     the run has finished. Its own state, so opening the steps mid-run does
     not pop this panel open the moment the run ends. */
    const [thinking, setThinking] = useState(false)
  // The live request, and when it started — what Stop acts on and what the
  // elapsed clock counts from.
      /*
   * Where the design sits in the conversation.
   *
   * How many turns had been said when this generation began, so the chat can
   * put the design there rather than always last. See Assistant.jsx.
   */
    /*
   * How long the conversation is right now, as opposed to when this function
   * was made.
   *
   * A generation is started from inside an async chain — something typed, a
   * turn recorded, a round trip to the model, then the design request. By the
   * time that last step runs, `turns` in its closure is several turns out of
   * date, so a design read its position from the conversation as it stood
   * before the request that asked for it. Every tone landed one exchange too
   * high: above the sentence that produced it.
   */
  const turnsNow = useRef(0)
  turnsNow.current = turns.length

  // Anything written but not stored lives only in the edit buffer. Tracking it
  // is what lets the app say "this is not saved yet" instead of leaving someone
  // to wonder whether they just overwrote a preset.
  const [dirty, setDirty] = useState(false)
  /* A request in words just wrote to the unit and nothing has kept it. Shown
     beside Save until a save lands or the preset is clean again. */
  const [askedUnsaved, setAskedUnsaved] = useState(false)
  /* The count the profile was last updated at, so ten more messages mean one
     more update and not one per render. */
      /* Whether the line explaining the demo has been put away. */
  const [holdNoteSeen, setHoldNoteSeen] = useState(() => holdNoteWasSeen())
  const dismissHoldNote = () => {
    rememberHoldNote()
    setHoldNoteSeen(true)
  }
  const [demoNoteSeen, setDemoNoteSeen] = useState(() => demoNoteWasSeen())
  const dismissDemoNote = () => {
    setDemoNoteSeen(true)
    rememberDemoNote()
  }
  /* The blocks the last plan was checked against, kept so a plan re-made
     from a question in the chat (see scopeTurn) is checked against the same
     chain without another read. */
    useEffect(() => {
    if (!dirty) setAskedUnsaved(false)
  }, [dirty])
  // Read inside read(), which is built once and never sees state change.
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  /*
   * Whether this preset has actually been saved from here.
   *
   * "This says 'Saved' when there is nothing saved yet. It should say SAVE if
   * it hasn't been saved yet."
   *
   * The button said "Saved" whenever nothing was unsaved — which is a claim
   * about pending changes, not about having saved anything, and on a preset
   * freshly loaded or just generated it reads as a lie. Kept separate from
   * `dirty` because they answer different questions, and cleared whenever a
   * different preset arrives: saving slot 93 says nothing about slot 2.
   *
   * A time rather than a flag, because the button now goes away when there is
   * nothing to do and "Saved" has to stop being said at some point. A flag has
   * no way to expire, and a remounted component would start its own timer and
   * say it again for an old save.
   */
  const [savedAt, setSavedAt] = useState(null)
  const [safety, setSafety] = useState(null)

  // Fifteen stacked sections was a long scroll with the important things buried.
  // Grouped by what you're doing rather than by which endpoint it calls.
  /*
   * Three screens, not four plus a mode.
   *
   * Play is the stage screen and the one you land on: it is what this app is
   * for when a guitar is plugged in. Shape is everything that changes the
   * sound. Ask is the conversation, which used to sit above every screen at
   * once and is a surface in its own right — it renders progress, streaming,
   * cost, a preview and the applied report.
   */
  const [view, setView] = useState('play')
  const [selectedBlock, setSelectedBlock] = useState(null)
  /*
   * Whether the block editor is *showing*, which is not the same question as
   * which block is selected. A refresh picks the amp so the chain has something
   * highlighted; if that alone opened the sheet, every connect and every read
   * would drop the editor over the screen unasked. Opening is a tap.
   */
  /*
   * Which sheet is over the screen: 'block' | 'presets' | 'scenes' | 'settings'.
   *
   * One at a time, deliberately. Each sheet pushes a history entry so the back
   * gesture closes it; two open at once would push two, and closing the outer
   * one would take the inner one's entry with it.
   */
  const [sheet, setSheet] = useState(null)
  /*
   * Which sheet the block editor was opened FROM.
   *
   * Only one sheet is open at a time — `sheet` is a single name — so tapping a
   * block inside the chain sheet replaces it with the block editor. Closing
   * that editor with nothing remembered would drop you on the Play screen,
   * two taps from the chain you were working through. This is the way back.
   */
  const [sheetBack, setSheetBack] = useState(null)
  /*
   * The failure this sheet is responsible for showing.
   *
   * The message belongs to the tap that caused it: one raised on the Play
   * screen ten minutes ago is not something to greet somebody with when they
   * open the chain. Matched on the sheet that was open when it was raised
   * rather than on a clock, so there is no frame in which an old message is
   * still on the way out of a sheet that has just arrived.
   */
  sheetNow.current = sheet
  const sheetAlert = sheet && error && errorSheet === sheet ? error : null
  /* Open a block's knobs, and remember what to return to. */
  const openBlockFrom = useCallback((id, from = null) => {
    setSelectedBlock(id)
    setSheetBack(from)
    setSheet('block')
  }, [])

  /*
   * The preset menu is a menu, not a sheet.
   *
   * Changing preset is the single most frequent thing anyone does here, and it
   * was two taps and a full-screen surface away. This drops the list under the
   * bar the way the caret beside the name has always implied it would.
   */
  const [presetMenu, setPresetMenu] = useState(false)
  const presetMenuRef = useRef(null)
  /*
   * On a phone the picker is a sheet, not a popover. The popover filled the
   * screen with a list and left no room outside it to tap, no X, and no swipe
   * — a sheet has all three, and Back closes it. A desktop keeps the popover
   * under the bar, where there is a page around it to tap.
   */
  const narrow = useAsks('(max-width: 620px)')

  /*
   * Which screens this viewport reaches.
   *
   * Edit is bench work and a phone is not a bench: rebuilding a chain is a
   * drag around a 4x12 grid, and it sat one sideways swipe from the stage
   * screen, which put a grid editor within reach of a thumb mid-song.
   *
   * Hidden on a phone rather than deleted, because a desktop browser is
   * exactly where it belongs.
   */
  const views = useMemo(() => viewsFor(narrow), [narrow])

  /*
   * How big the buttons on Play are.
   *
   * It lives up here rather than in Gig because it is drawn in the tab row,
   * which Gig does not own — and the tab row is where it belongs on a phone:
   * that row carries one word now that Ask and Edit are gone, and the control
   * had been costing a whole line of its own directly above the scenes.
   *
   * Read synchronously for the first paint rather than in an effect: a stage
   * screen that paints at one size and jumps to another is worse than either,
   * and the jump lands exactly when someone is reaching for it.
   */
  /*
   * Whether the Ask button is drawn, decided once and named.
   *
   * It used to end in `views.includes('ask')`, which is false on a phone — the
   * line that took tone generation off a handset altogether. It does not
   * belong to the viewport any more: Ask is a SHEET, not one of the screens
   * the tab row and the swipe move between, so a phone can open it without Ask
   * becoming somewhere a stray drag can land. That distinction is the whole
   * change, and the bench screens are still bench screens.
   *
   * The rule itself lives in lib/playMode.js — testable without a browser, and
   * out of reach of a comment in this file impersonating it.
   */
  /* The chain editor is there whenever there is a unit, play mode or not.
     A ✦ Ask button stood beside it until the chat came out. */
  const chainShows = editButtonShows({ status, view })

  const [size, setSize] = useState(loadSize)
  /* Whether Play sizes its tiles from the screen instead of the step. */
  const [fit, setFit] = useState(loadFit)
  /* Which page of Setup is open; null is the list of rows. */
  /* Which computer this browser is on, read once. The guide's routes are
     sorted by it; see shared/ways-in.mjs for why only this end sorts them. */
  const thisComputer = useMemo(
    () => osGuess(typeof navigator === 'undefined' ? '' : navigator.userAgent),
    []
  )
  const [setupPage, setSetupPage] = useState(null)
  /*
   * WHETHER THIS ACCOUNT HAS PAID, asked of the server rather than decided here.
   *
   * "We already decided that we ARE gonna offer the purchases on the desktop
   * apps and the web app." A browser has no App Store and no Play Store, so it
   * asks the `entitlement` function — the same one the phone calls — which
   * reads who is asking out of the session and asks RevenueCat. A purchase
   * made on a phone shows as paid here without this page knowing anything
   * about Apple or Google, and the answer is written where the relay reads it.
   *
   * `checked` so the unlock row does not flash up for somebody who has paid
   * during the second it takes to find out that they have.
   */
  const [paid, setPaid] = useState({ checked: false, unlocked: false })
  const [webPriceText, setWebPriceText] = useState(null)
  const [buying, setBuying] = useState(false)
  const [buySaid, setBuySaid] = useState(null)
  /* Which fix the guide opens on, when an error notice sent you there. Null is
     the guide with everything folded shut, which is what Setup opens on. */
  const [fix, setFix] = useState(null)
  /*
   * Named rather than written inline in the tab row.
   *
   * test/structure.mjs locates the Play screen by searching the source for the
   * literal conditional that opens it, and takes the first hit. A second one
   * written above, in the tab row, hands that test the tab row instead — so
   * the condition is given a name here and the row asks for the name.
   *
   * Which is also why this comment describes that string rather than quoting
   * it: quoting it put a third hit above both of them, and the test then
   * measured the chrome from a comment.
   */
    /* A row of tabs is worth a row of the screen only when it can take you
     somewhere. On a phone it cannot: Play is the only screen there is. */
  const tabsWorthShowing = status === 'live' && views.length > 1
  const resize = (by) => {
    const next = clampSize(size + by)
    if (next === size) return
    setSize(next)
    saveSize(next)
  }

  /*
   * A window narrowed while Ask was open leaves `view` naming a screen that no
   * longer has a tab, a swipe or a rendered body — an app showing nothing, with
   * no way back. Turning a phone sideways does the same thing in reverse.
   */
  useEffect(() => {
    if (!views.includes(view)) setView('play')
  }, [views, view])

  /* A tap outside and Escape are the two ways anyone expects to dismiss a
     menu; without them the only way out is finding the button again. The
     sheet on a phone brings its own, so the listener stands down under it. */
  useDismiss(presetMenuRef, () => setPresetMenu(false), { open: presetMenu && !narrow, ignore: '.topbar-preset' })
  const [slots, setSlots] = useState([])
  const [scanning, setScanning] = useState(false)
  const scene = useDevice(ofScene)
  const sceneNames = useDevice(ofSceneNames)
  // How many scenes this unit actually has. Eight is the gen-3 answer and the
  // safe fallback, but it is a capability, not a constant.
    // Which channels a block can be put on. A scene remembers one per block, so
  // a generated scene plan can name them and this is what a name is checked
  // against.
      // One tempo read per burst of taps, not one per tap.
      
  /*
   * Setter-shaped writers over the store, for the two facts App still reads
   * and writes directly. Scene, tempo and the tuner have proper writers on the
   * store — optimistic, confirmed, rolled back on refusal — and no longer need
   * one of these; when the preset and the chain get theirs, these go too.
   */
  const into = useCallback((field) => (next) => {
    putDevice({
      [field]: typeof next === 'function' ? next(deviceSnapshot()[field]) : next
    })
  }, [])
  const setPreset = useMemo(() => into('preset'), [into])
  const setBlocks = useMemo(() => into('blocks'), [into])
  const [editorFocus, setEditorFocus] = useState(null)
  const [scanProgress, setScanProgress] = useState(null)
  // The scan that reads names on its own, and what it waits for. See readNames.
  const nameScan = useRef(null)
  const namesHeld = useRef(false)
  const unitInUse = useRef({ busy: false, working: false, touched: 0 })

  /**
   * Everything that changed, in one place.
   *
   * Hand edits also land in the conversation. Without that the assistant is
   * blind to half of what happens: turn a knob yourself, say "put that back",
   * and it has no idea what "that" was. Since every manual control already
   * reports here, this is the one place that has to know.
   *
   * `fromAssistant` marks the changes it made itself, which are already in the
   * transcript and must not appear twice.
   */
  const record = useCallback((kind, summary, detail = [], fromAssistant = false) => {
    setLog((prev) => append(prev, newEntry(kind, summary, detail)))
    // The same line in the debug log, where it sits in order with the wire.
    logDebug('app', `${kind}: ${summary}`, detail?.length ? detail : undefined)

    /*
     * Anything that alters the sound leaves the preset unsaved.
     *
     * This was set by two components out of nine. The grid editor and the hand
     * editor — the two that change the most — never set it, so placing blocks or
     * turning a knob left the save bar hidden and there was no way to keep the
     * work. On an empty slot that reads as "it won't let me save", because
     * building a chain is the only change there is.
     *
     * Every one of those components already reports here, so here is the place
     * that has to know. The assistant's own writes are excluded: perform()
     * decides that case, since a plan containing a save leaves things clean.
     */
    if (!fromAssistant && UNSAVES_PRESET.has(kind)) setDirty(true)

    if (fromAssistant || !HAND_EDIT_KINDS.has(kind)) return
    setTurns((prev) => [...prev, { role: 'hand', text: summary }])
  }, [])

  /**
   * Flip one block on or off, straight from its chain tile.
   *
   * Optimistic, like the gig screen's toggles: the tile flips now, the write
   * follows, and a refusal flips it back with the reason. Deliberately NOT a
   * full read() — reloading the whole device state to change one bypass bit is
   * what makes the screen lurch.
   */
  const toggleBlock = async (block) => {
    const wanted = !block.bypassed
    try {
      // Optimistic-then-roll-back, in the store, where every write does it the
      // same way — rather than hand-rolled once per call site.
      await writeBypass(block.effectId, wanted)
      record('edit', `${block.name || block.slug} ${wanted ? 'bypassed' : 'engaged'}`)
    } catch (err) {
      /*
       * Whole, not flattened to its sentence.
       *
       * "When I tap one of the buttons it will turn it off on the unit, but
       * there's no way to turn it back on, and the buttons always say on."
       * Every write was failing with the Mac's port shut, the store put the
       * block back the way it found it, and the message went to a notice
       * behind the sheet. So the strip sat there claiming everything was on,
       * tap after tap, with nothing anywhere saying otherwise.
       */
      setError(err)
      /*
       * And ask the unit what it actually has, rather than trusting the way
       * the store put it back.
       *
       * A write that came back as a failure may still have landed — the frame
       * goes out and the answer is what got lost — and then the strip is
       * showing the opposite of the truth, so the next tap sends the same
       * thing again and the block can never come back on. The gig screen has
       * always re-read after a refused toggle; this one never did. Skipped
       * when the unit is gone, because there is nobody to ask.
       */
      if (!err?.unitGone) refreshBlocks()
    }
  }

  /*
   * Whether the unit was answering before this read started.
   *
   * A ref because read() is built once and would otherwise close over the
   * status as it stood at mount — which is 'idle', i.e. exactly the value that
   * turns the confirmation off.
   */
  const liveRef = useRef(false)
  /*
   * Whether a read is already in flight, for the timed check below to stand
   * clear of. In a ref rather than the dependency list: the check is a loop
   * that schedules itself, and restarting that loop every time a button goes
   * busy would reset its own timer and mean it never reached the end of one.
   */
  const busyRef = useRef(false)
  useEffect(() => {
    liveRef.current = status === 'live'
  }, [status])
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  /*
   * `settling` is for a read that follows an order this app gave the unit —
   * a save, which takes it away for seconds while the preset goes to flash.
   * It keeps asking rather than believing the first "no unit" from a port
   * that is busy doing what it was just told to do. See SETTLING_TRIES.
   *
   * An options object, because `read` is also handed straight to children as
   * an onChanged callback and is called with whatever they pass; anything
   * that is not this flag reads as absent.
   */
  const read = useCallback(async (opts) => {
    const settling = opts?.settling === true
    setBusy(true)
    setError(null)
    let fresh = null
    // Whether the unit answered this pass, which decides what a later failure
    // means: a read that lost a race, or a unit that has gone.
    let answered = false
    try {
      /*
       * A channel with nothing answering on it is the worst case: every call
       * below waits out its own timeout — 20 s, 45 s for the block list —
       * before this admits the fault. One short question first bounds that
       * at six seconds.
       */
      if (remoteActive() && !remoteHostSeen() && !(await hostResponds())) {
        setFaultReason('no-answer')
        setStatus('fault')
        // Nothing has asked the unit anything, so the notice must not say how
        // many times it did.
        setAsks(0)
        return null
      }
      /*
       * A no from a unit that was answering a moment ago is confirmed before
       * it is believed. Next tells the unit to load a preset and reads back
       * immediately; on real hardware that read lands while the unit is still
       * busy, and the answer is "no unit". See confirmedDetect.
       */
      let asked = 0
      const info = await confirmedDetect({
        detect,
        wait: (ms) => new Promise((go) => setTimeout(go, ms)),
        wasLive: liveRef.current,
        /* A phone's first no is the least trustworthy answer in the app —
           the handshake races the Mac's own polling. See RELAY_TRIES. */
        remote: remoteActive(),
        // Counted rather than assumed, because the notice says the number out
        // loud and how many asks this makes depends on every reason to be
        // patient that applies to this read.
        onAsk: (n) => {
          asked = n
        },
        ...(settling ? { least: SETTLING_TRIES, gap: SETTLING_MS } : {})
      })
      setAsks(asked)
      setDevice(info)
      if (!info?.connected) {
        setFaultReason('no-unit')
        setStatus('fault')
        setError('Your computer is connected, but no Fractal is plugged into it.')
        return
      }
      /*
       * Past here the unit has answered. Anything that fails now is one read
       * that lost a race for the port, not a unit that has gone — so it is
       * reported without tearing down a working screen. See the catch.
       */
      answered = true
      const [p, b] = await Promise.all([currentPreset(), presetBlocks()])
      setPreset(p)
      followUnitName(p)
      /*
       * The unit has just said which slot it is on and what that slot is
       * called, in one answer. That is the one name in the list this app can
       * be sure of, so it is written down — unless the buffer has been edited
       * here, when the name on it may not be the name in the slot. Nothing
       * else corrects a row for a preset stored from AM4-Edit or renamed at
       * the front panel: "98 · 3DG Verse-Rhythm-Lead is loaded" over a list
       * still reading 098 TIGHT MODERN, for days.
       */
      if (!dirtyRef.current) noteLoadedName(p)
      const list = Array.isArray(b) ? b : []
      setBlocks(list)
      setFaultReason(null)
      setStatus('live')
      // The unit answered, so whatever was lost is back.
      setLostUnit(false)
      // Returned as well as stored: a caller that reads and then acts in the
      // same tick still has the old array in its closure, and state won't have
      // caught up yet.
      fresh = list

      // Keep a sensible selection: the amp if nothing is chosen, and drop a
      // selection that no longer exists rather than showing a stale panel.
      setSelectedBlock((current) => {
        if (current && list.some((x) => x.effectId === current)) return current
        return list.find((x) => x.slug === 'amp')?.effectId ?? list[0]?.effectId ?? null
      })

      // The active index is a cheap query; the names require decoding the
      // preset body, so they're fetched separately and only when the preset
      // changes rather than on every refresh. Both land in the store, so the
      // gig screen and the scene panel get them without asking again.
      refreshScene()

      if (typeof p?.number === 'number') {
        refreshSceneNames(p.number)

        /*
         * A name a phone couldn't write, written now.
         *
         * Generating from a remote session leaves the name parked on the host,
         * because ForgeFX refuses renames over the relay. This is the other end
         * of that: at the Mac, where a rename IS allowed, the parked name is
         * applied to the preset it was designed for and then cleared. Guarded
         * on the slot matching and on the name actually differing, so a stale
         * doc can't rename a preset someone has since moved on from.
         */
        if (!remoteActive()) {
          takeParkedPresetName(p.number)
            .then(async (parked) => {
              if (!parked || parked === p.name?.trim()) return
              await setPresetName(parked)
              await clearParkedPresetName(p.number)
              setPreset((prev) => (prev ? { ...prev, name: parked } : prev))
              setDirty(true)
              record('rename', `Applied the name “${parked}” designed on the phone`, [
                'Not permanent until saved to a slot.'
              ])
            })
            .catch(() => {
              // Nothing parked, or the unit refused: the preset keeps its name.
            })
        }
      }

      refreshTempo()

    } catch (err) {
      /*
       * Losing one read is not losing the unit.
       *
       * This used to answer every failure with a fault, which on a stage means
       * the whole app replaced by a "no unit" screen because one call lost the
       * port to a preset that was still loading. If the unit answered at the
       * top of this pass and was live before it, the chain on screen is still
       * the truth: say what failed and leave it up.
       */
      // The error itself, not its sentence: `unitGone` is the part that decides
      // which notice this becomes, and a string cannot carry it.
      if (answered && liveRef.current) setError(err)
      else {
        /*
         * A relay that dropped is not a unit that went. `linkDown` is set by
         * remote.js on every failure that never left the phone, and that is
         * the whole difference between "your Mac stopped answering" and "the
         * unit wouldn't read" — two sentences that send someone to two
         * different rooms.
         */
        setFaultReason(
          // A Mac with no port to the unit says so outright, and that is more
          // specific than either of the two below: not "the read failed" but
          // "there is nothing at the other end of the cable to read".
          err?.unitGone ? 'unit-gone' : macSilent(err) ? 'no-answer' : 'unreadable'
        )
        /*
         * And nothing may be said about the unit on the strength of an answer
         * that came before the Mac went quiet. "This is lying saying that a Mac
         * is connected. My Mac is turned off completely" — over a notice about
         * a unit, written from a `device` the last good read left behind. The
         * reason above decides the words, and this makes sure the old answer
         * cannot decide them instead.
         */
        if (macSilent(err)) setDevice(null)
        setStatus('fault')
        setError(err)
      }
    } finally {
      setBusy(false)
    }
    return fresh
  }, [])

  /*
   * Below read(), and that is not a matter of taste.
   *
   * A dependency array is evaluated DURING RENDER, so an effect that names
   * `read` while `read` is a const declared further down the component throws
   * on its temporal dead zone — before anything is drawn. Minified, that read
   * as "Cannot access 'we' before initialization" over a blank page.
   * Console.jsx carries the same warning about the same trap.
   */
  /*
   * A unit that has gone takes the sheet with it — once a READ says so too.
   *
   * A sheet is a surface over an inert page, so the notice explaining the
   * failure was being drawn underneath a chain sheet that could not be
   * reached, behind blocks still reading On. There is nothing to edit in a
   * preset the app cannot reach: close it, and let the fault notice — the one
   * screen in the app with a way back on it — actually be on screen.
   *
   * But one write is not evidence. "My Mac is connected just fine. The phone
   * app says it has lost the unit." A single call can come back with the port
   * shut while the next one is answered perfectly — the Mac's own screen is
   * asking that same port several times a second — and tearing the whole app
   * down to a red screen over one of those is how a working rig ends up
   * looking like a broken one. So the claim is checked before it is acted on:
   * a read, which sets the screen live again on its own if the unit answers,
   * and only a read that fails too closes what is open. The re-reading loop
   * below keeps asking after that, so a unit that comes back comes back.
   */
  useEffect(() => {
    if (!lostUnit) return undefined
    let live = true
    read().then((fresh) => {
      // read() has already set the screen: live if the unit answered, the
      // fault notice if it did not. What is left is the sheet over it.
      if (live && !fresh) setSheet(null)
    })
    return () => {
      live = false
    }
  }, [lostUnit, read])

  /*
   * Ask, on a timer, whether the unit is still there.
   *
   * "I purposefully unplugged the FM3 from the computer and it still said
   * connected. I waited a few minutes, went ahead and tried to click some
   * buttons, go to different presets, still said connected, so it's lying."
   *
   * It was, and nothing here ever asked. `status` was set by the last read
   * that ran, and after startup a read only runs when something on screen
   * wants a fresh answer — so "connected" was a fact about the past, drawn
   * as a fact about now, ageing quietly.
   *
   * Pressing buttons did not settle it, and that is the part worth knowing:
   * a preset change is a WRITE, and a write to a port whose far end has gone
   * away does not have to fail. The bytes leave. Only an ANSWER proves the
   * unit is there, so this asks for one — which preset is loaded, the first
   * thing a unit that has gone stops being able to say.
   *
   * It does not touch the screen when the answer is good. A poll that also
   * applied what it read would fight whoever is working at the Mac, and the
   * question here is only whether anybody is home. When the answer is bad
   * twice running it hands over to read(), which confirms it properly and
   * puts up the notice that says what to check.
   *
   * See shared/unit-watch.mjs for the two numbers and why they are those.
   */
  useEffect(() => {
    if (status !== 'live') return undefined
    let live = true
    let timer = null
    let quiet = 0
    const every = watchEvery(remoteActive())
    const ask = async () => {
      if (!live) return
      /* A tab nobody is looking at is a tab that can be wrong for free, and a
         phone in a pocket should not be holding a relay open to ask. */
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      if (hidden || busyRef.current) {
        timer = setTimeout(ask, every)
        return
      }
      let said = 'quiet'
      try {
        said = probeSays({ preset: await currentPreset() })
      } catch {
        said = probeSays({ failed: true })
      }
      if (!live) return
      quiet = countQuiet(quiet, said)
      if (unitGone(quiet)) {
        logDebug('unit', 'the unit stopped answering the timed check', `${quiet} quiet answers`)
        quiet = 0
        await read()
        if (!live) return
      }
      timer = setTimeout(ask, every)
    }
    timer = setTimeout(ask, every)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [status, read])

  /**
   * What a reload does, without the reload.
   *
   * Reconnect only re-read the unit, and a reload does two things: it re-reads,
   * and it rejoins the relay from the session this browser already holds. So
   * when the link had dropped, pressing the button read over nothing and
   * refreshing the page "fixed" it — which is the wrong lesson to teach anyone
   * about a button called Reconnect.
   *
   * A relay that has stopped answering is worse than no relay at all: every
   * request goes into it and waits out its own timeout. So a dead one is
   * dropped before anything else is tried.
   */
  const reconnect = useCallback(async () => {
    setBusy(true)
    setError(null)
    /*
     * Ask this Mac again whether it takes a cache clear.
     *
     * Whether a write can be verified from a phone depends on the device
     * server at the OTHER end, which is the one thing a reconnect can change —
     * a Mac that refused it an hour ago may have taken the update since. The
     * answer is remembered per session precisely so it is not asked before
     * every write, and this is the moment it is worth asking again.
     */
    resetCacheClear()
    try {
      /*
       * The rejoin is AWAITED, which is the whole difference between this
       * button working and this button appearing to do nothing.
       *
       * It used to call pokeLink and move straight on to the read. pokeLink
       * schedules a timer; it does not connect. So the read ran first, over
       * whatever the link was a moment ago — over a dead socket it failed
       * instantly and put the same fault screen back up, and the rejoin it had
       * asked for landed seconds later with nothing looking at it. "Hitting
       * try again did nothing. Refreshing browser reconnect." A reload worked
       * because a reload rebuilds the channel BEFORE reading.
       */
      /*
       * On a NEW socket, not the one that is already there.
       *
       * "I have to force close the app completely and then reopen it for it to
       * connect again." A force-quit's only power is that it rebuilds every
       * piece, and the channel was the piece a reconnect kept: realtime-js
       * still called it joined, so it was handed back unchanged and this read
       * went down the same dead line as the last one. A socket the phone
       * believes in and the server has let go of cannot be told from a working
       * one from in here — so the button stops trying to tell and just asks
       * for a new one.
       */
      if (linkState().role === 'remote') await reconnectPhone({ fresh: true })
    } catch {
      // A rejoin that failed still leaves the read below to say so plainly.
    }
    await read()
  }, [read])

  /**
   * What the chip, the connect screen and the Setup section ask for.
   *
   * One handler, because the same five things are asked from three places
   * and the failure of three copies is a Disconnect that behaves differently
   * depending on which surface it was tapped on.
   */
  /*
   * Written down on every change, so the phone can be put in a pocket.
   *
   * Cheap enough to do on each render that matters: a transcript is text and a
   * spec is a few kilobytes, and the alternative — a timer — loses whatever
   * happened in the last tick, which on iOS is exactly the moment the page is
   * taken away. See lib/session.js.
   */
  useEffect(() => {
    saveSession({
      turns,
      chatId,
      clearedAt: chatClearedAt,
      result,
      withScenes,
      renamePreset,
      saveName,
      lastPrompt,
      pending: pending.current
    })
  }, [turns, chatId, chatClearedAt, result, withScenes, renamePreset, saveName, lastPrompt, thinking])

  /*
   * And up to the account, so the conversation is the same on the next device.
   *
   * Debounced rather than written per turn: a reply arrives as several state
   * changes in a row — the turn, then the tone, then what landed — and each one
   * would otherwise be its own round trip. Two seconds after the last of them
   * is still well inside the time it takes to pick up another device.
   *
   * Skipped until this device has had a conversation of its own, so opening
   * the app signed in does not immediately push an empty chat over the one on
   * the Mac. See saidSomething — an empty box after a conversation is a
   * different thing entirely, and it does go up.
   */


  
  /*
   * The setlists and the stars, with the account.
   *
   * "This says that setlists stay in this browser. Can we set that up to save
   * to the database across the cloud if user is signed in?" They were browser
   * storage because they started as a convenience; a night's running order
   * built at the bench and then absent from the phone on the stand is not one.
   *
   * One round on sign-in — read the account, merge it with what is here, write
   * both back — and another two seconds after any change made here, which is
   * long enough for a drag through a running order to settle into one write.
   *
   * lib/cloudSetlists does the merging, per setlist and per star rather than
   * per device, so a list built on the Mac and one built on the phone both
   * survive meeting each other.
   */
  const syncedLists = useRef(false)
  useEffect(() => {
    if (!link.account || !setlistCloudReady()) return undefined
    let live = true

    const pull = async () => {
      const res = await syncSetlists().catch(() => null)
      if (!live || !res?.changedHere) return
      const { lists, stars } = res.gained || {}
      const parts = [
        lists ? `${lists} setlist${lists === 1 ? '' : 's'}` : null,
        stars ? `${stars} star${stars === 1 ? '' : 's'}` : null
      ].filter(Boolean)
      if (parts.length) {
        record('setlists', `Picked up ${parts.join(' and ')} from ${res.from || 'your other device'}`)
      }
    }

    if (!syncedLists.current) {
      syncedLists.current = true
      pull()
    }

    /* And after anything changes here. Both stores announce their own writes,
       which is what the stage screen and the picker already listen to. */
    let timer = null
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(pull, 2000)
    }
    window.addEventListener(SETLISTS_CHANGED, later)
    window.addEventListener(MARKS_CHANGED, later)
    return () => {
      live = false
      clearTimeout(timer)
      window.removeEventListener(SETLISTS_CHANGED, later)
      window.removeEventListener(MARKS_CHANGED, later)
    }
  }, [link.account, record])

  /*
   * Ask again whenever the account changes: signing in, signing out, or a
   * different person signing in on the same browser. Signed out is simply
   * unpaid — there is nobody for a purchase to belong to.
   */
  const accountId = link.account?.id || null
  /*
   * `for` says whose answer this is. Signing in changes the account a render
   * before the question has been put again, and without it the answer that
   * belonged to nobody — not paid — reads for a moment as the new account's.
   */
  useEffect(() => {
    let live = true
    if (!accountId) {
      setPaid({ checked: true, unlocked: false, for: null })
      /* The demo shows the price to somebody not signed in: see TopBar. */
      if (isDemo()) webPrice(null).then((price) => live && setWebPriceText(price))
      else setWebPriceText(null)
      return () => {
        live = false
      }
    }
    setPaid((p) => ({ ...p, checked: false }))
    /* `unknown` kept: a question that could not be put is not a no, and the
       one place that shuts a door on "not paid" — mustPay — leaves it open. */
    checkUnlocked().then(
      (out) => live && setPaid({ checked: true, unlocked: out.unlocked, unknown: out.unknown, for: accountId })
    )
    webPrice(accountId).then((price) => live && setWebPriceText(price))
    return () => {
      live = false
    }
  }, [accountId])

  /*
   * UNLOCK in the demo's top bar, and the price beside it.
   *
   * "When someone's on the demo, it should always say unlock, and then the
   * price at the top? Otherwise, how's a user supposed to know how to go to
   * settings to sign in?"
   *
   * A purchase here has to belong to an account, so somebody not signed in
   * is asked to sign in first and lands on the unlock page the moment they
   * have — one press from the bar to the checkout, with the sign-in on the
   * way rather than a hunt through Settings for it. Somebody who turns out
   * to have paid already, on a phone, is not shown the unlock page at all.
   */
  /*
   * The price on Settings' Unlock row for somebody not signed in, fetched
   * when Settings opens rather than on every page load — the payment library
   * is a download nobody who never looks at the row should pay for.
   */
  useEffect(() => {
    if (sheet !== 'settings' || accountId || webPriceText) return undefined
    let live = true
    webPrice(null).then((price) => live && setWebPriceText(price))
    return () => {
      live = false
    }
  }, [sheet, accountId, webPriceText])

  /*
   * THE PHONE'S RULES, NAMED ONCE, so the browser on a phone plays by them.
   *
   * "We need to make sure we're on the same page as far as what the app does
   * and what the web app does." Two of the phone's rules had never reached
   * this end:
   *
   * OWNED — somebody signed in who has paid. The phone offers them "Demo",
   * never "Try the Demo".
   *
   * MUST PAY — a phone signed in, not paid, and not in the demo. The phone
   * puts the unlock in front of everything before it will drive a rig
   * (shouldAskToPay, mobile/src/lib/unlock-rule.js); this end connected
   * anyway. Only the browser acting as a phone: the computer driving its
   * own unit over USB is free, and always has been. And only on a definite
   * no — a question the server could not answer lets them through, as the
   * phone does, so a bad minute on a venue's wifi does not lock out somebody
   * who paid.
   */
  const answeredFor = accountId && paid.checked && paid.for === accountId
  const owned = Boolean(answeredFor && paid.unlocked)
  const mustPay = Boolean(link.role === 'remote' && !isDemo() && answeredFor && !paid.unlocked && !paid.unknown)

  const [unlockAfterSignIn, setUnlockAfterSignIn] = useState(false)
  const openUnlock = () => {
    if (accountId) {
      setSheet('settings')
      setSetupPage('unlock')
      return
    }
    setUnlockAfterSignIn(true)
    setSignIn('account')
  }
  useEffect(() => {
    if (!unlockAfterSignIn || !accountId || paid.for !== accountId || !paid.checked) return
    setUnlockAfterSignIn(false)
    if (paid.unlocked) return
    setSheet('settings')
    setSetupPage('unlock')
  }, [unlockAfterSignIn, accountId, paid])

  const buyHere = async () => {
    setBuying(true)
    setBuySaid(null)
    const out = await buyOnWeb({ accountId, email: link.account?.email })
    setBuying(false)
    if (out.ok) {
      setPaid({ checked: true, unlocked: true, for: accountId })
      setSetupPage(null)
      /*
       * Buying ends the demo, as it does on the phone. A reload, because
       * which end this is was decided when the page loaded — see leave-demo.
       */
      if (isDemo()) {
        setDemo(false)
        window.location.reload()
      }
      return
    }
    if (!out.cancelled) setBuySaid(out.message)
  }

  const linkAction = useCallback(
    async (kind) => {
      setError(null)
      try {
        if (kind === 'connect') {
          if (linkState().account) await reconnectPhone()
          else setSignIn(true)
        } else if (kind === 'retry') {
          /*
           * The connect screen's Try again, and the same new socket the fault
           * screen's asks for. This is the screen someone reaches when the Mac
           * has stopped answering, which is exactly when the channel is most
           * likely to be one realtime-js still calls joined and the server has
           * long since dropped — the state that used to need a force-quit.
           */
          pokeLink()
          await reconnectPhone({ fresh: true })
        } else if (kind === 'disconnect') {
          await disconnectPhone()
          record('remote', 'Disconnected from the computer')
          resetSchemaCache()
          read()
        } else if (kind === 'switch') {
          await disconnectPhone()
          setSignIn(true)
        } else if (kind === 'mac-setup') {
          setSignIn(true)
        } else if (kind === 'leave-demo') {
          /*
           * The whole of "connect this phone" for someone stuck in the demo.
           *
           * A reload, because which end this is was decided when the page
           * loaded. After it there is nothing left to do by hand: the phone
           * reads as a phone, and bootLink connects a saved sign-in on its own
           * or shows the connect screen to someone who has none.
           */
          const { setDemo } = await import('./lib/forgefx')
          setDemo(false)
          window.location.reload()
        } else if (kind === 'mac-on') {
          await setMacRemote(true)
          record('remote', 'Phone remote turned on')
        } else if (kind === 'mac-off') {
          await setMacRemote(false)
          record('remote', 'Phone remote turned off')
        } else if (kind === 'signout') {
          await signOutHere()
          record('remote', 'Signed out on this device')
          resetSchemaCache()
          read()
        }
      } catch (err) {
        setError(err.message)
      }
    },
    [read, record]
  )

  /** The sign-in sheet's submit: the same form does a different job per role. */
  const signInSubmit = useCallback(
    async ({ email, password }) => {
      if (signIn === 'account') {
        await signInAccount({ email, password })
        record('remote', `Signed in as ${email}`)
        /* A phone signed in has one thing to do next, and it did not do it:
           it stopped on "Connect as …" and waited for another tap. */
        if (linkState().role === 'remote' && !isDemo()) await reconnectPhone()
      } else if (linkState().role === 'mac') {
        await setUpMac({ email, password })
        record('remote', `Phone remote set up for ${email}`)
      } else {
        await connectPhone({ email, password })
        record('remote', `Connected to the computer as ${email}`)
      }
      setSignIn(false)
    },
    [record, signIn]
  )

  /** Do at the Mac what the phone asked for, and say so at both ends. */
  const carryOutSave = useCallback(
    async (req) => {
      /*
       * First, before anything is awaited.
       *
       * The watcher looks again every six seconds, and it looks while this is
       * still part-way through with the request still parked on the host.
       * Without marking it first it finds it and carries it out a second time.
       */
      markHandled(req?.id)
      setBusy(true)
      try {
        /*
         * A slot this unit does not have is refused here, not by the unit.
         *
         * A save is parked on one machine and carried out on another, and the
         * two need not be looking at the same hardware — a phone in the demo
         * offers 512 slots, and the unit with the cable in it may hold 104.
         * Sent on, that becomes "Preset location index must be integer 0..103,
         * got 500" in front of a guitarist, once every six seconds, because the
         * parked request keeps being retried.
         */
        if (slotOutside(req.slot, device?.capabilities)) {
          const has = slotCount(device?.capabilities)
          throw new Error(
            `Slot ${req.slot} isn't on this unit — it holds ${has}, numbered 0 to ${has - 1}. Nothing was saved.`
          )
        }
        const name = (req.name || '').trim()
        if (name && name !== preset?.name?.trim()) await setPresetName(name)
        await storePreset(req.slot)
        // What that slot is called is now known exactly, and the phone that
        // asked for this reads it back off the host. See notePresetName.
        keepSavedName(req.slot, name || preset?.name)
        keepSavedScenes(req.slot, sceneNames)
        setSlots(cachedPresetNames())
        await clearParkedSave()
        // The phone is watching for this; without it, "asked" never becomes
        // "done" over there and the only honest thing it could say is nothing.
        await reportSave({ id: req.id, ok: true, slot: req.slot })
        setDirty(false)
        setSavedAt(Date.now())
        record('save', `Saved "${name || preset?.name}" to slot ${req.slot}, asked for from the phone`)
        // And here, where the Mac carries out the phone's save.
        await read({ settling: true })
      } catch (err) {
        /*
         * The unit's own complaint often states its size — "must be integer
         * 0..103" — and that sentence is the only place some units ever say it.
         * So it is read rather than shown: the count is corrected here, which
         * stops the picker offering slots that do not exist and stops this
         * happening again.
         */
        /*
         * Only where the unit has said nothing itself.
         *
         * A refusal is weaker evidence than a stated count, and taking it as
         * stronger is how this fix could become a worse bug than the one it
         * fixes: a unit that reports 512 slots, refused once by something that
         * quotes an AM4's range, would have four hundred real slots hidden
         * from its owner. What the unit says about itself wins.
         */
        const learned = slotCount(device?.capabilities) ? null : countFromRefusal(err.message)
        if (learned) {
          setDevice((prev) =>
            prev
              ? {
                  ...prev,
                  capabilities: {
                    ...prev.capabilities,
                    presets: { ...prev.capabilities?.presets, count: learned }
                  }
                }
              : prev
          )
        }
        await clearParkedSave().catch(() => {})
        await reportSave({ id: req.id, ok: false, slot: req.slot, error: err.message }).catch(() => {})
        setError(
          learned
            ? `Slot ${req.slot} isn't on this unit — it holds ${learned}, numbered 0 to ${learned - 1}. Nothing was saved.`
            : err.message
        )
      } finally {
        setBusy(false)
      }
    },
    [preset?.name, sceneNames, read, record, device?.capabilities, markHandled]
  )

  /*
   * At the Mac: anything the phone has asked for.
   *
   * Applied without ceremony when it is plainly the thing that is loaded — that
   * is someone saving the tone they have been editing, and a confirmation step
   * at a machine they are not standing at helps nobody.
   *
   * And when it is NOT: the answer goes to the phone, not to the Mac.
   *
   * "Every time I open the Mac app it shows me 'the phone asked to save'. I
   * have dismissed this notification multiple times and it shows up every
   * time." It did, and it would have for ever: dismissing recorded the id in a
   * ref, which a restart empties, so the only durable record was the delete —
   * and `deleteHostDoc` swallows its own failure and returns false, which the
   * caller then dropped on the floor. One failed DELETE and the question came
   * back at every launch until the end of time.
   *
   * The deeper problem is that it was the wrong question to ask. Once the unit
   * has moved on, the edited buffer the phone was working on is gone — there is
   * nothing correct left to save, and "Save it anyway" would store whatever is
   * loaded now under somebody's name. The only sound answer is no, so asking a
   * person at a machine they walked away from to give it is a notice that can
   * only ever be dismissed. The phone is told instead, where the person who
   * asked actually is.
   *
   * So there are two outcomes now and neither one interrupts the Mac: it is
   * saved, or it is dropped and reported.
   */
  useEffect(() => {
    if (status !== 'live' || remote || isDemo()) return
    let stop = false
    const look = async () => {
      const req = await takeParkedSave()
      if (stop || !req?.id || !Number.isInteger(req.slot)) return
      if (handledSaves.current.includes(req.id)) return
      const fresh = Date.now() - (req.at || 0) < 15 * 60 * 1000

      /*
       * Ask the unit what is loaded. Do not ask the screen.
       *
       * "I keep seeing the 'Mac has moved to slot 7' but it had never moved."
       * It hadn't. What had moved was this page's idea of it, in the opposite
       * direction: the unit was on 501 and the Mac was still remembering 7.
       *
       * `preset.number` is React state, filled by `read()` and by nothing else.
       * The device event stream carries scene, tempo and tuner — see
       * deviceState.handleEvent — and has never carried a preset change. So
       * selecting a preset from the phone, or turning the knob on the unit
       * itself, moves the hardware and leaves this page's number exactly where
       * it was, indefinitely. The guard then compared a phone that knew the
       * truth against a Mac that did not, found them different, and refused a
       * save that was perfectly good — naming the stale number as the one the
       * Mac had "moved to", which is precisely backwards.
       *
       * One read settles it. It costs a round trip and happens only when there
       * is actually a request parked, which is rare.
       */
      let loaded = preset?.number ?? null
      try {
        const now = await currentPreset()
        if (Number.isInteger(now?.number)) {
          loaded = now.number
          /*
           * And the screen was wrong too, so it is corrected here rather than
           * left to say one thing while the decision was made on another. The
           * preset alone: a full re-read from a six-second poll would fight
           * whoever is working at the Mac, and the number is what was lying.
           */
          if (now.number !== preset?.number) setPreset(now)
        }
      } catch {
        // The unit would not answer. What the screen has is all there is, and
        // it is what this used to use for everything.
      }
      if (stop) return

      const sameBuffer = req.fromSlot == null || req.fromSlot === loaded
      if (fresh && sameBuffer) {
        await carryOutSave(req)
        return
      }
      /*
       * Dropped, and said so — in that order, so a failed delete cannot leave
       * the phone waiting on an answer that has already been decided.
       */
      handledSaves.current = [...handledSaves.current.slice(-19), req.id]
      await clearParkedSave()
      await reportSave({
        id: req.id,
        ok: false,
        slot: req.slot,
        error: sameBuffer
          ? 'The computer did not pick this up within fifteen minutes, so it was dropped rather than written to a preset that has moved on. Nothing was saved — ask again with the computer awake.'
          : `The computer had moved to slot ${loaded ?? 'another preset'} by the time it saw this, so the sound you edited was no longer loaded. Nothing was saved.`
      }).catch(() => {})
    }
    look()
    const timer = setInterval(look, 6000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [status, remote, preset?.number, carryOutSave])

  /* On the phone: what became of it. */
  useEffect(() => {
    if (!queuedSave) return
    let stop = false
    const timer = setInterval(async () => {
      const res = await readSaveResult()
      if (stop || res?.id !== queuedSave.id) return
      /*
       * Taken once. Two ticks can be in flight over a slow relay, and both
       * came back with the same answer before the state change below had
       * torn this interval down — so "The Mac saved it to slot 499" landed
       * in the conversation twice.
       */
      stop = true
      setQueuedSave(null)
      if (res.ok) {
        setDirty(false)
        setSavedAt(Date.now())
        /*
         * The list on this phone still has that slot under its old name, and
         * nothing here can re-read it. See keepSavedName.
         */
        keepSavedName(res.slot, queuedSave.name)
        keepSavedScenes(res.slot, queuedSave.scenes)
        setSlots(cachedPresetNames())
        record('save', `The computer saved it to slot ${res.slot}`)
        // The unit is still writing that preset to flash. See SETTLING_TRIES.
        read({ settling: true })
      } else {
        setSaveError(res.error || 'The computer could not save it.')
      }
    }, 3000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [queuedSave, read, record])

  /*
   * The unit, once it is known which end this is.
   *
   * At the Mac and in the demo the role is decided without asking anyone, so
   * the read starts at once. Anywhere else it waits for the role: the first
   * read used to go straight to localhost from a phone, fail, and put the
   * Mac's error on the screen for the second it took to learn this was a
   * phone. A phone reads once the Mac answers, from the effect below.
   */
  useEffect(() => {
    if (isDemo() || servedLocally()) {
      read()
      return undefined
    }
    let done = false
    const onRole = (s) => {
      if (done || s.role === 'unknown') return
      done = true
      if (s.role !== 'remote') read()
    }
    onRole(linkState())
    return subscribeLink(onRole)
  }, [read])

  /*
   * Which end this is, and the saved sign-in, before anything else is judged.
   *
   * Once, at mount. This is what used to happen inside a panel that only
   * mounted after the app had already failed — so a phone always saw an
   * error screen first, and "not signed in" was shown over a good session.
   */
  useEffect(() => {
    const stop = subscribeLink(setLink)
    bootLink().then(setLink)
    return stop
  }, [])

  /*
   * A sheet belongs to the screen it was opened from. A block sheet left open
   * across a tab press sat over Create with its scrim taking the first tap.
   * On `view` alone: a handler that opens a sheet never changes the screen in
   * the same breath, so this cannot close what it just opened.
   */
  useEffect(() => setSheet(null), [view])

  /*
   * Back moves between screens.
   *
   * There is no router, so without an entry per screen Back left the app from
   * any of them. The entries go through the same ledger the sheets use
   * (lib/nav.js); this listener reads the entry's state and never swallows a
   * pop, so it does not count as a sheet in the sheets' books.
   */
  const fromPop = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view
  /* Read through a ref so the listener still subscribes once: the reachable
     set changes when a window is resized, and this must not resubscribe. */
  const viewsRef = useRef(views)
  viewsRef.current = views
  useEffect(() => {
    replaceEntry({ view: viewRef.current })
    const onPop = (e) => {
      const st = e.state
      if (!st || st.sheet || typeof st.view !== 'string') return
      if (st.view === viewRef.current) return
      /* Entries pushed while the window was wide outlive the width that made
         them. Back should not restore a screen this viewport has no tab for. */
      if (!viewsRef.current.includes(st.view)) return
      fromPop.current = true
      setView(st.view)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (fromPop.current) {
      fromPop.current = false
      return
    }
    if (window.history.state?.view === view) return
    pushEntry({ view })
  }, [view])

  /*
   * The Mac answering is the moment the phone's view of the unit is worth
   * reading. Everything about the device is re-read down the new path.
   */
  useEffect(() => {
    if (link.role !== 'remote') return
    if (link.link === 'connected') {
      setEverLinked(true)
      setError(null)
      resetSchemaCache()
      read()
    }
    // Wait out a blip before swapping the screen: a second look at the same
    // state ten seconds on is what decides between "reconnecting" and "gone".
    if (link.link === 'no-answer') {
      const id = setTimeout(() => setTick((t) => t + 1), 10500)
      return () => clearTimeout(id)
    }
    return undefined
  }, [link.role, link.link, read])

  /*
   * While the connect screen is up, the unit is not: the views are gated on
   * a live status, and a Play screen under a "Connect to your Mac" heading
   * would be two answers to one question. Coming back, the read that follows
   * the Mac answering sets it live again.
   */
  useEffect(() => {
    if (showConnect && status === 'live') {
      // The connect screen is only up while the Mac is not answering, so that
      // is what this fault is — not a unit that went missing.
      setFaultReason('no-answer')
      setStatus('fault')
    }
  }, [showConnect, status])

  /*
   * A fault keeps looking, instead of waiting to be tapped.
   *
   * "This keeps saying I'm not connected, but yet the Mac app says I am
   * connected to the remote." It kept saying it because nothing ever asked
   * again. One read runs when the Mac first answers, and if that read loses a
   * race — the port busy with the Mac's own polling, a preset still loading,
   * one relay message that went astray — the red notice is where the phone
   * stays. The link is up, so the effect above never fires again; the only way
   * out is the Try again button, and the reason that button "works on the
   * fifth or sixth tap" is that tapping is the only thing still asking.
   *
   * So the asking carries on by itself, backing off the way the Mac probe
   * does: three seconds, then six, then twelve, up to every thirty. A rig that
   * comes good comes back on its own, with nothing in anyone's hand.
   *
   * Not while the connect screen is up (that screen does its own asking and
   * says so), and not in the demo, which has nothing to ask.
   */
  useEffect(() => {
    if (isDemo() || status !== 'fault' || showConnect) return undefined
    let live = true
    let timer = null
    let delay = 0
    const again = () => {
      delay = nextDelay(delay)
      timer = setTimeout(async () => {
        if (!live) return
        try {
          await read()
        } catch {
          // read() reports through status and error; a throw here is nothing
          // extra to say, and must not stop the next attempt.
        }
        // A read that worked left status 'live' and this effect is already
        // torn down; getting here means it did not.
        if (live) again()
      }, delay)
    }
    again()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [status, showConnect, read])

  /*
   * A relay that comes and goes, followed rather than assumed.
   *
   * A phone put in a pocket drops its socket, and realtime-js rejoins on its
   * own when the network returns — but nothing here noticed either event. The
   * screen went on saying "remote session" over a dead channel, and the way
   * back was to reload the page, which is not a thing to be doing between
   * songs. Coming back re-reads the unit, because whatever happened while the
   * link was down happened without us.
   */
  useEffect(
    () =>
      subscribeRemoteState((up) => {
        setRemote(up)
        // Coming back is handled where the Mac is known to have answered, not
        // merely where the socket came up; going down is said by the chip.
      }),
    [read]
  )

  /*
   * Seed the name field from whatever is loaded.
   *
   * It used to fall back to the preset name while displaying, which meant
   * clearing the box put the old name straight back and there was no way to
   * type a different one from empty. Seeding on load instead leaves the field
   * genuinely editable — including blank, which is what an empty slot starts as
   * and what naming a new preset needs.
   */
  useEffect(() => {
    setSaveName(preset?.name?.trim() || '')
    // Keyed on the slot alone, not the name. A generation suggests a name and
    // the writes that follow re-read the preset; including the name here would
    // let that read overwrite the suggestion before it could be saved.
  }, [preset?.number])

  /*
   * The one subscription to the unit's event stream.
   *
   * There used to be two — this one, opened only while the tuner was on, and
   * Gig's, opened always. A footswitch scene change therefore arrived twice and
   * each listener answered it by re-reading the block list down a port that
   * serialises every request. The store owns it now, and every surface reads
   * the result, so a scene changed on the floor moves all of them.
   */
  useEffect(() => {
    if (status !== 'live') return undefined
    return listenToDevice()
  }, [status])


  
  /**
   * Nothing here is named yet, so nothing here can be overwritten.
   *
   * The signal is the scene names as the unit reports them. A preset somebody
   * has laid out has Rhythm and Lead on it; a blank slot has eight empty
   * strings. That is the difference between "build this over what is there"
   * and "there is nothing here yet — what do you want?"
   */
  
  /**
   * The tone on screen, as it will be kept in the conversation.
   *
   * Read from this render, so it is the design the person is actually looking
   * at, with the two choices as they left them. The outcome is the plain fact
   * of what happened to it — sent or not — rather than anything about what
   * came next: a line saying "replaced" would be a lie if the generation that
   * was supposed to replace it then failed.
   */
  
  /** Put a tone into the conversation for good. */
  
  /**
   * Has this exact plan already been written?
   *
   * Every part of what a send would do: the tone itself, and the three choices
   * on the card that change what goes with it. Change any of them and this goes
   * false and the button offers again, which is the whole point.
   *
   * Down here rather than beside the state it reads, because `scene` is a
   * `useDevice` subscription declared much further down the component and a
   * `const` cannot be read above its own declaration. Written up there first,
   * this threw "Cannot access 'scene' before initialization" — but only on the
   * render after a write, which is the one render no unit test performs. The
   * error boundary caught it and replaced the whole app with "The app couldn't
   * draw"; every test still passed.
   */
  
  
  
  const save = async () => {
    // An empty slot field means "the one that's loaded" — the save bar shows
    // that number, so the button does what it says without anything typed.
    const number = slot === '' ? preset?.number : Number(slot)
    if (!Number.isInteger(number) || number < 0) {
      setSaveError('Enter a preset slot number.')
      return
    }
    /*
     * Caught here rather than by the unit, and caught before it is parked: a
     * save asked for from the phone is carried out later, on the Mac, and a
     * slot that does not exist becomes a driver message in front of a
     * guitarist minutes after they typed it.
     */
    if (slotOutside(number, device?.capabilities)) {
      const has = slotCount(device?.capabilities)
      setSaveError(`This unit holds ${has} presets, numbered 0 to ${has - 1}.`)
      return
    }
    setBusy(true)
    setSaving(true)
    setError(null)
    setSaveError(null)
    try {
      /*
       * From the phone, the Mac does the writing.
       *
       * ForgeFX refuses a slot write over the relay by design, and that refusal
       * is worth keeping — but it was being handed to the player as "you can't
       * save from here", which is the wrong answer to ten minutes of work on a
       * tone with the amp across the room. The request goes into the host's
       * document store, which the relay does allow, and the page at the Mac
       * carries it out where writing was always permitted.
       */
      if (remoteActive()) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        await parkSave({
          id,
          slot: number,
          name: saveName.trim(),
          fromSlot: preset?.number ?? null,
          fromName: preset?.name ?? null
        })
        /*
         * What the slot will be called, and what its scenes are, carried with
         * the request rather than read back later: an AM4 will not dump a
         * preset over the relay, so when the Mac says this landed, THIS is the
         * only description of slot ${number} the phone will ever have.
         */
        setQueuedSave({
          id,
          slot: number,
          name: saveName.trim() || preset?.name || '',
          scenes: Array.isArray(sceneNames) ? [...sceneNames] : []
        })
        record('save', `Asked the computer to save "${saveName.trim() || preset?.name}" to slot ${number}`)
        return
      }

      // Name first: /preset/name writes the working buffer, and storePreset is
      // what makes it permanent. Doing it the other way round saves the old name.
      const name = saveName.trim()
      if (name && name !== preset?.name?.trim()) {
        await setPresetName(name)
      }
      await storePreset(number)
      // The list is holding that slot's old name, and this is the name that
      // just replaced it — better evidence than any read. See notePresetName.
      keepSavedName(number, name || preset?.name)
      /*
       * And the slot now holds this buffer's scenes, so its names are these.
       *
       * "Saving a scene and the unit confirmed it was saved — when I go back on
       * the phone and then forward again it's not there anymore." Navigating to
       * a slot asks what its scenes are called, and on a phone the answer can
       * only come from what somebody wrote down: dumps do not travel the relay.
       * Nothing wrote anything down at the one moment the answer was certain —
       * the moment the buffer became that slot.
       */
      keepSavedScenes(number, sceneNames)
      setSlots(cachedPresetNames())
      setApplied((prev) => ({ ...prev, savedTo: number }))
      record('save', `Saved "${name || preset?.name}" to slot ${number}`)
      setDirty(false)
      setSavedAt(Date.now())
      // Same here: the write has been taken, and the unit is still doing it.
      await read({ settling: true })
    } catch (err) {
      // Shown on the save bar itself as well as the banner. A refusal that
      // appears only at the top of a page you aren't looking at reads as a
      // button that did nothing.
      setSaveError(err.message)
      setError(err.message)
    } finally {
      setBusy(false)
      setSaving(false)
    }
  }

  const jumpTo = async (number) => {
    setBusy(true)
    setError(null)
    // A different preset means different blocks, values and ranges.
    resetSchemaCache()
    try {
      await selectPreset(number)
      /* Before anything is read back: the computer answers "what is loaded"
         from a fifteen-second copy, and inside that window it names the preset
         you just left. */
      await clearDeviceCache().catch(() => {})
      record('select', `Loaded slot ${number}`)
      /*
       * Recorded after the unit took it, not when it was asked for: a slot the
       * device refuses is not one you were recently on. Every route counts —
       * the list, Previous and Next, a footswitch — because "recent" is about
       * where you have been, not how you got there.
       */
      rememberPreset(currentDeviceSlug(), number)
      setDirty(false)
      setSavedAt(null)
      setSafety(null)
      setResult(null)
      setApplied(null)
      await read()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const rename = async (name) => {
    setBusy(true)
    setError(null)
    try {
      const res = await setPresetName(name)
      if (res && res.ok === false) throw new Error('The unit refused the rename.')
      record('rename', `Renamed to "${name}"`, ['Not permanent until saved to a slot.'])
      // The save sheet proposes this name from now on, and the buffer no
      // longer matches the slot it came from.
      setSaveName(name)
      setDirty(true)
      await read()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Replay a saved preset.
   *
   * Re-reads the schema and re-validates rather than writing the stored values
   * directly — the preset loaded now may have a different block layout, and a
   * model swap since then may have moved the ranges those values were computed
   * against. Stops at the preview like any other generation.
   */
  /**
   * Put a freshly proposed design where it can be seen.
   *
   * The preview renders inside the assistant, which sits at the top of the
   * page on every view. Ask for something from the bottom of Presets — Reload
   * on a saved preset is the clearest case — and the result lands a screen and
   * a half above you, with nothing near the button you pressed. It looked
   * exactly like a button that does nothing.
   *
   * One scroll, on an explicit request, after the commit that renders it. This
   * is deliberately not the assistant's old auto-scroll, which ran on every
   * turn and every progress tick and fought the player for the scroll position
   * all through a generation. Wanting to be shown the thing you just asked for
   * is not the same as being dragged there ten times a minute.
   */
  /**
   * Say in the conversation that the tone is ready, and offer to send it.
   *
   * "This is what shows after generation is complete. No user notification.
   * No idea what happened. User has to scroll down to bottom to see Send
   * changes." The Thinking line vanished, the card appeared below the
   * conversation, and its Send button was a screen further down. Nothing in
   * the chat — the place the player was looking — said the run had finished,
   * let alone what it made. So the run ends the way a write does: a line in
   * the conversation, with the count, and a Send button on the line itself.
   * Marked `tone` so the transcript can draw those buttons on the newest one
   * while the design is still unsent, and drop them once it has gone.
   */
  
  
  
  /**
   * Adjust the tone that's currently proposed or written.
   *
   * Sends the previous spec as the subject rather than a fresh brief, so the
   * model moves one thing instead of redesigning around a new sentence.
   */
  
  /** Reload the current slot from flash, discarding anything unsaved. */
  const revert = async () => {
    resetSchemaCache()
    if (typeof preset?.number !== 'number') return
    setBusy(true)
    setError(null)
    try {
      await revertPreset(preset.number)
      record('revert', `Reverted slot ${preset.number} to its saved version`)
      setDirty(false)
      setSavedAt(null)
      setResult(null)
      setApplied(null)
      await read()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /** Push the pre-edit copy back, for when revert is no longer enough. */
  const restoreSafety = async () => {
    resetSchemaCache()
    if (!safety) return
    setBusy(true)
    setError(null)
    try {
      const { loadPresetBytes } = await import('./lib/forgefx')
      await loadPresetBytes(safety.bytes)
      record('restore', `Loaded the pre-edit copy of "${safety.name}" into the edit buffer`)
      setDirty(true)
      await read()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Work out what an instruction means, without doing any of it.
   *
   * The schema read is the same one generation uses — the model can only act on
   * ids and ranges the device actually reported.
   */
  /* How often the local matcher could have answered, this session. Refs, not
     state: nothing renders from them and a re-render per chat turn would be a
     re-render for a number only the debug log reads. */
    
  
  /**
   * Run a checked list and report back into the conversation.
   *
   * Failures are attached to the turn that proposed them rather than only
   * raised as an error, so the transcript stays an honest record of what
   * actually reached the unit.
   */
  /**
   * A screen the person went to themselves.
   *
   * Which clears the report of what the last request did: they have either
   * read it or gone somewhere it does not answer, and both mean it has stopped
   * being the thing on screen.
   */
  const changeView = (next) => {
    // A swipe cannot reach an unreachable screen, but a caller might.
    if (!views.includes(next)) return
    setJustDid(null)
    setView(next)
  }

  /*
   * And it goes on its own, after long enough to be read.
   *
   * The card sat on Play until Got it was pressed — through closing the chat,
   * through a song. It is a report, not a dialog: twenty seconds is long
   * enough to read six lines, and the chat still holds the same answer.
   */
  useEffect(() => {
    if (!justDid) return undefined
    const t = setTimeout(() => setJustDid(null), DID_STAYS_MS)
    return () => clearTimeout(t)
  }, [justDid])

  
  /**
   * Put the thing that just changed on screen.
   *
   * A change you asked for in words and can't see is worse than no change: you
   * are left checking the unit to find out whether it worked. So the view
   * follows the work, and the relevant section is scrolled to rather than left
   * somewhere below the fold.
   */
  
  
  /**
   * Do it, but with the scene on its own channel first.
   *
   * The plan is re-made from the turn's own actions with a setChannel ahead of
   * each shared value, checked again against the same chain the first plan
   * was, and run. The re-check is what turns "shared with scenes 1, 3 and 4"
   * into "this scene only" on the labels, so the Done card tells the truth.
   */
  
  
    
  const hasScenes = device?.capabilities?.hasScenes !== false

  /*
   * Every slot the unit has, whether or not its name has been read.
   *
   * The preset menu was empty until someone ran a scan — and on a gen-3 unit a
   * full scan is minutes of one-dump-per-slot down a serial port, because the
   * firmware has no query for a stored name. So a dropdown you opened to
   * change preset offered nothing to change to.
   *
   * The slots exist regardless; only the names are unknown. Listing them by
   * number means "go to 46" works on the first tap, and the names fill in
   * behind as they are learned.
   */
  const knownSlots = slots.length ? slots : cachedPresetNames()
  const allSlots = useMemo(() => {
    const count = device?.capabilities?.presets?.count
    if (!count) return knownSlots
    const byNumber = new Map(knownSlots.map((s) => [s.number, s]))
    // The loaded preset's name is one the unit has already told us, and it
    // wins over a cached name for its slot: a slot read as EMPTY and then saved
    // into kept its blank, the blank hid the row, and the list opened at 000.
    if (
      typeof preset?.number === 'number' &&
      typeof preset?.name === 'string' &&
      (!byNumber.has(preset.number) || preset.name.trim())
    ) {
      byNumber.set(preset.number, { number: preset.number, name: preset.name })
    }
    return Array.from({ length: count }, (_, i) => byNumber.get(i) || { number: i })
    // knownSlots is rebuilt each render; its length and the count are what move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownSlots.length, device?.capabilities?.presets?.count, preset?.number, preset?.name])

  /*
   * Whether browser storage still holds anything.
   *
   * The panel that lists it is kept — it holds real work someone saved — but
   * it is a migration route, not a feature. An empty one explains browser
   * storage to a person who has never used it, which is a panel for nobody.
   * Re-read on the key that changes when something moves out of it.
   */
  
  /*
   * The names read themselves.
   *
   * On a gen-3 unit a stored name costs a preset dump, so the list opened
   * empty until someone pressed ⟳ and waited minutes. Now, once the unit is
   * live: the host's copy first (the Mac learned them, the phone reads them
   * back), then a scan of whatever is left. At the Mac the scan runs quietly
   * — it leaves the port alone between slots and waits while the unit is in
   * use — so the names are there before the picker is opened. When the picker
   * opens with names still missing, the scan turns eager and the list fills in
   * front of you; ■ holds it for the session and ⟳ resumes it. Over the relay
   * there is no quiet pace: a phone reads only while its picker is open, so
   * the relay carries nothing nobody is looking at. The demo has no port to
   * protect and reads eagerly from the start.
   */
  /*
   * How many slots to read, and nothing invented.
   *
   * This was `?? 512`, which is the gen-3 count and a guess about hardware the
   * app may not be attached to. On a unit whose driver reports no count, the
   * guess became a fact: the scan walked toward slot 512 on a unit that holds
   * 104, and the picker offered every one of them to be saved into. Zero means
   * there is nothing to scan, which is the right amount of a unit's attention
   * to spend on slots nobody has said exist.
   */
  const namesTotal = slotCount(device?.capabilities) ?? 0

  useEffect(() => {
    unitInUse.current.busy = busy
  }, [busy])
  useEffect(() => {
    unitInUse.current.working = !!progress
  }, [progress])
  useEffect(() => {
    const touch = () => {
      unitInUse.current.touched = Date.now()
    }
    document.addEventListener('pointerdown', touch, { passive: true })
    document.addEventListener('keydown', touch, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', touch)
      document.removeEventListener('keydown', touch)
    }
  }, [])

  /*
   * Ask the Mac to poll the unit gently while a phone is the one watching.
   *
   * ForgeFX starts its telemetry supervisor as soon as anything subscribes to
   * its event stream, and the relay bridge subscribing on this phone's behalf
   * is enough. At the balanced default that is a 100ms tick of FOUR output
   * meter round trips — about forty SysEx transactions a second at the unit's
   * control processor, for as long as this screen is open. Reported as the
   * sound cutting in and out whenever the app was open and stopping the moment
   * it was closed.
   *
   * A phone cannot use that rate for anything. Its own meter read is on a
   * 2000ms tick over the relay, so twenty of every twenty-one of those polls
   * are thrown away before they reach a screen — and the one thing they draw
   * is a peak bar. 'reduced' quarters the tick, which is still five times
   * faster than the phone reads.
   *
   * Only over the relay. At the Mac the cable is short, the meters are drawn
   * at full rate, and nothing here has been shown to cost that end anything.
   */
  useEffect(() => {
    if (status !== 'live' || !remote || isDemo()) return
    setTelemetryMode('reduced').catch(() => {
      /* An older host without the route is not a problem worth a banner. */
    })
  }, [status, remote])

  /** Start the scan, or change its pace. Nothing to do once every slot is known. */
  const readNames = useCallback(
    (eager) => {
      const scan = nameScan.current
      if (!scan || namesHeld.current) return
      scan.setEager(eager)
      if (scan.running || !unreadSlots(namesTotal)) return
      setScanning(true)
      scan.run()
    },
    [namesTotal]
  )

  /** ■ — and it stays stopped until ⟳, however many times the picker opens. */
  const stopNames = () => {
    namesHeld.current = true
    nameScan.current?.stop()
  }

  /** ⟳ — read the rest now, back to back. */
  const scanPresets = () => {
    namesHeld.current = false
    readNames(true)
  }

  /**
   * Every name off the unit again, from nothing.
   *
   * ⟳ reads what has not been read; it cannot fix a name that was read and
   * has since changed under it — a preset stored from AM4-Edit, a rename at
   * the front panel. A running scan is stopped first and restarted from its
   * end, because a run that has already walked past slot 98 would not come
   * back for it.
   */
  const namesAgain = useRef(false)
  const rereadNames = () => {
    forgetAllPresetNames()
    setSlots(cachedPresetNames())
    namesHeld.current = false
    const scan = nameScan.current
    if (scan?.running) {
      namesAgain.current = true
      scan.stop()
      return
    }
    readNames(true)
  }

  useEffect(() => {
    if (status !== 'live') return undefined
    let gone = false
    /*
     * The pace is measured over the last stretch and smoothed, never taken
     * from the start of the run: a resumed scan skips hundreds of known slots
     * in a blink, and an average carrying that would promise four hundred
     * dumps in ten seconds. Shown only while eager: a quiet scan's pace is
     * mostly waiting, which is not a promise about anything.
     */
    const pace = { at: Date.now(), done: 0, each: null }
    const scan = createNameScan({
      total: namesTotal,
      isKnown: knowsName,
      read: learnName,
      onProgress: (done, all) => {
        if (gone) return
        const since = done - pace.done
        if (since >= 8) {
          const each = (Date.now() - pace.at) / since
          pace.each = pace.each ? (pace.each + each) / 2 : each
          pace.at = Date.now()
          pace.done = done
        }
        setScanProgress({
          done,
          total: all,
          pct: Math.round((done / all) * 100),
          left: scan.eager ? timeLeft(all - done, pace.each) : null
        })
        setSlots(cachedPresetNames())
        publishNames()
      },
      onDone: () => {
        if (gone) return
        setScanning(false)
        setScanProgress(null)
        setSlots(cachedPresetNames())
        publishNames()
        // Stopped only to start over — see rereadNames.
        if (namesAgain.current) {
          namesAgain.current = false
          readNames(true)
        }
      }
    })
    scan.setHold(() => {
      const use = unitInUse.current
      return use.busy || use.working || Date.now() - use.touched < 2000
    })
    nameScan.current = scan
    importHostNames().then((added) => {
      if (gone) return
      if (added) setSlots(cachedPresetNames())
      if (isDemo()) readNames(true)
      else if (!remote) setTimeout(() => !gone && readNames(false), 4000)
    })
    return () => {
      gone = true
      scan.stop()
      nameScan.current = null
    }
  }, [status, namesTotal, remote, readNames])

  // The picker: eager while it is open; quiet — or, over the relay, stopped — when it closes.
  const pickerOpen = presetMenu || sheet === 'presets'
  useEffect(() => {
    if (pickerOpen) readNames(true)
    else if (remote) nameScan.current?.stop()
    else nameScan.current?.setEager(false)
  }, [pickerOpen, remote, readNames])

  // The block the sheet is showing. Resolved once: a selection can outlive the
  // chain it pointed into (a preset change lands before the refresh does), and
  // an id with no block behind it must not open an empty sheet.
  const openBlock = selectedBlock ? blocks.find((b) => b.effectId === selectedBlock) : null



  /*
   * The picker, written once and shown in one of two places: a popover under
   * the bar on a desktop, a sheet on a phone. Changing preset is the bar's
   * job; keeping, backing up and restoring them is a different job with its
   * own surface, which the last line hands over to.
   */
  const presetPicker = (
    <>
      <PresetList
        slots={allSlots}
        slowNames={namesCostADump()}
        device={currentDeviceSlug()}
        current={preset?.number}
        deviceSlots={device?.capabilities?.presets?.count}
        addressing={device?.capabilities?.presets?.addressing}
        scanning={scanning}
        progress={scanProgress}
        onStop={stopNames}
        onScan={scanPresets}
        onReread={rereadNames}
        onSelect={(n) => {
          jumpTo(n)
          setPresetMenu(false)
        }}
      />
      {/*
        The way to the save sheet when nothing has been edited.

        Save is gone from the bar unless there is something to save, which is
        what was asked for and is right — a button that does nothing is worse
        than no button. But it was also the only door to that sheet, and the
        sheet is how you put a preset in a DIFFERENT slot: load 45, change
        nothing, keep it as 46. Losing that quietly would have been a feature
        removed under cover of a tidy-up.
      */}
      <button
        className="chip preset-menu-more"
        onClick={() => {
          setPresetMenu(false)
          setSheet('save')
        }}
      >
        Save to a slot…
      </button>
      <button
        className="chip preset-menu-more"
        onClick={() => {
          setPresetMenu(false)
          setSheet('presets')
        }}
      >
        Saved presets and backups…
      </button>
    </>
  )

  /*
   * THE UNLOCK, IN THE PHONE PAYWALL'S OWN WORDS — drawn in two places, so
   * written once: the Unlock page in Settings, and the screen a phone that
   * has not paid sees in place of connecting (mustPay, above).
   *
   * Every sentence here is copied from mobile/src/screens/Paywall.js, and
   * test/both-ends.mjs holds them to it.
   */
  const unlockBody = (
    <>
      <p className="device-meta">One payment, once</p>
      <h3 className="unlock-head">Phone Remote</h3>
      <p className="hint">
        {`One-time payment unlocks the full version of this app, forever, including all future updates, on all supported Fractal devices: ${
          DEMO_UNITS.slice(0, -1).map((u) => u.name).join(', ') + ' and ' + DEMO_UNITS[DEMO_UNITS.length - 1].name
        }. Sign in with the same account on another phone or tablet and it is unlocked there too.`}
      </p>
      <p className="unlock-features">
        You&rsquo;ll be able to control and switch presets, scenes, amp &amp; effects blocks,
        tuner, tap tempo, setlists, and so much more.
      </p>
      {buySaid ? <p className="hint tone-bad">{buySaid}</p> : null}
      <button type="button" className="primary unlock-buy" disabled={buying || !accountId} onClick={buyHere}>
        {webPriceText ? `Unlock Full Version — ${webPriceText}` : 'Unlock Full Version'}
      </button>
    </>
  )

  return (
    <div className="shell">
      {/*
        NOTHING RENDERS ABOVE THE BAR, which is what lets the bar be pinned.

        "Can you pin the header to the top of the screen — right now when you
        scroll a little bit it comes down slightly and moves with the scroll."
        It was sticky already; what moved it was the page reserving a strip
        above it for whatever might be up there. The update notices were up
        there, and on a notched phone that strip also had to clear the clock —
        so the bar sat some seventy pixels down at rest and travelled up to
        nothing every time the screen was touched.

        The notices are below it now. They are still the first thing on the
        page and still say that a stale tab is lying to you; they say it under
        a bar that does not move, and the bar's own inset covers the notch.
      */}
      {/*
        Saving rides in the bar, and stays off the gig screen: that screen
        exists to switch sounds with a thumb in the dark, and a slot overwrite
        is not something to put within reach of a mis-tap mid-song. The bar
        still says "Unsaved" there, so the state survives even where the button
        doesn't follow it.
      */}
      <TopBar
        onGetPhoneApp={() => {
              /* Setup is a sheet here, so open the sheet AND land on the page
                 — opening one without the other shows the wrong screen. */
              setSheet('settings')
              setSetupPage('phone')
            }}
            status={status}
        /* In the demo: UNLOCK and the price for somebody who has not paid,
           Exit demo for somebody who has. As on the phone. */
        onUnlock={isDemo() && paid.checked && !paid.unlocked ? openUnlock : null}
        unlockPrice={webPriceText}
        onExitDemo={isDemo() && paid.unlocked ? () => linkAction('leave-demo') : null}
        device={device}
        faultReason={faultReason}
        preset={preset}
        dirty={dirty}
        presetsOpen={presetMenu}
        /* Not on Play: the preset tile under the bar is the same button. */
        showPreset={view !== 'play'}
        onOpenPresets={() => setPresetMenu((v) => !v)}
        onOpenSettings={() => setSheet('settings')}
        onOpenUnit={() => {
          /* Two destinations behind one press — see TopBar's onOpenUnit. The
             demo's name is a choice and opens the five; a real unit's name is
             a fact and opens the page that holds the facts about it. */
          setSheet('settings')
          setSetupPage(isDemo() ? 'demo' : 'link')
        }}
        onOpenVolume={status === 'live' && outputEid !== null ? () => setSheet('volume') : null}
        menu={
          presetMenu && !narrow ? (
            <div className="preset-menu" ref={presetMenuRef}>
              {presetPicker}
            </div>
          ) : null
        }
        link={link}
        onLinkAction={linkAction}
      >
        {status === 'live' && view !== 'gig' ? (
          <SaveBar
            savedAt={savedAt}
            preset={preset}
            dirty={dirty}
            busy={busy}
            saving={saving}
            compact
            hint={askedUnsaved ? (narrow ? 'dot' : 'words') : false}
            queued={queuedSave}
            onOpenSave={() => setSheet('save')}
          />
        ) : null}
      </TopBar>

      {/* First on the page, under the bar: a stale tab makes every other thing
          on this screen a possible lie about what the code does. */}
      <UpdateNotice />

      {/*
        The Mac app's update, when one is downloaded and waiting. Renders
        nothing anywhere else — a phone has no updater to talk to.
      */}
      <UpdateReadyNotice />

      {/*
        Said once. The sentence took a full line at the top of every screen for
        as long as the demo ran, and the word DEMO is already in the bar with
        the same sentence behind it. Got it puts it away for good.
      */}
      {isDemo() && status === 'live' && !demoNoteSeen ? (
        <p className="demo-banner">
          <span>{demoSentence(demoUnit())}</span>
          <button className="chip" onClick={dismissDemoNote}>
            Got it
          </button>
        </p>
      ) : null}

      {/*
        A phone that is not connected is not broken; it has one thing to do.
        The connect screen says what and offers the button. It is also the
        screen while the Mac stops answering mid-set — after a ten-second
        grace, so a phone in a pocket losing a socket for a moment keeps the
        Play screen and gets it back without anyone noticing.
      */}
      {mustPay ? (
        /*
         * The phone's imposed paywall, on the phone's terms: the unlock, then
         * its three ways out in its own words — a different account, the
         * demo, or back to the start signed out.
         */
        <section className="connect connect-unlock">
          {unlockBody}
          <div className="connect-actions">
            <button className="chip" onClick={() => linkAction('switch')} disabled={busy}>
              Sign in with an email and password
            </button>
          </div>
          <button
            type="button"
            className="connect-demo"
            onClick={() => {
              setDemo(true)
              window.location.reload()
            }}
            disabled={busy}
          >
            Keep using the demo
          </button>
          <button type="button" className="signin-link" onClick={() => linkAction('signout')} disabled={busy}>
            Back
          </button>
        </section>
      ) : showConnect ? (
        <ConnectScreen
          key={tick}
          link={link}
          busy={busy}
          onConnect={() => linkAction('connect')}
          onRetry={() => linkAction('retry')}
          onSwitchAccount={() => linkAction('switch')}
          onCreateAccount={() => {
            setSignInStart('up')
            linkAction('switch')
          }}
          owned={owned}
          onUnpair={() => linkAction('signout')}
          onDemo={() => {
            setDemo(true)
            window.location.reload()
          }}
        />
      ) : status === 'fault' && fault ? (
        <div className="notice" data-kind="fault">
          <h2>{fault.title}</h2>
          <p>{fault.body}</p>
          {faultWhy ? <p className="hint">What came back: {faultWhy}</p> : null}
          <p>
            {/*
              The label moves, because this button takes several seconds and
              said nothing while it worked: a rejoin, then the five reads it
              takes to be sure a unit really is missing. "Hitting try again did
              nothing" was partly that it did not work and partly that there
              was no way to tell.
            */}
            <button className="chip" onClick={reconnect} disabled={busy}>
              {busy ? 'Trying…' : 'Try again'}
            </button>{' '}
            <button
              className="chip"
              onClick={() => {
                setDemo(true)
                window.location.reload()
              }}
            >
              {/* "Demo" to somebody who owns it, as on the phone. */}
              {owned ? 'Demo' : 'Try the demo'}
            </button>
          </p>
          {/*
            Said, because it is now true and nobody could tell. The screen goes
            on asking every few seconds and comes back by itself; without this
            line it looks like the same dead red notice it was when the only
            thing still asking was a thumb.
          */}
          <p className="notice-note">Still checking every few seconds — this comes back on its own.</p>
        </div>
      ) : null}

      {/*
        Errors are raised from every view, so the one place they're shown has to
        be outside all of them. This banner lived inside Design, which meant a
        failure anywhere else — a rejected sign-in, a refused write — set the
        message and rendered nothing. Silence read as "the button does nothing".
      */}

      {/*
        Two Macs on one account share one line, and a change made here would be
        made on every unit on it — so this is said before anybody tries, not
        after. The refusal in remoteRequest is the guarantee; this is the part
        that explains it while there is still time to do something about it.
      */}
      {link.clash ? (
        <div className="notice" data-kind="fault" role="alert">
          <h2>Two Macs are answering</h2>
          <p>{link.clash}</p>
          <p className="host-pick">
            {/*
              The choice itself, where the problem is explained rather than a
              screen away. Naming the Macs is the whole of the fix: they are
              told apart by the name each one calls itself, so the button says
              exactly what will be driven.

              Only offered when there is something to choose between. Two Macs
              with one name between them cannot be addressed separately, and a
              picker there would promise something it cannot do.
            */}
            {new Set(link.hosts).size === link.hosts.length
              ? link.hosts.map((name) => (
                  <button
                    key={name}
                    className={`chip ${link.chosenHost === name ? 'current' : ''}`}
                    onClick={() => chooseHost(name)}
                    disabled={busy}
                  >
                    Drive {name}
                  </button>
                ))
              : null}
            {/* The fix may also be at the other Mac — turning its phone remote
                off, or updating it — and neither drops this connection, so
                nothing here would ever notice on its own. */}
            <button className="chip" onClick={() => recheckHosts()} disabled={busy}>
              Check again
            </button>
          </p>
        </div>
      ) : null}

      {status === 'live' && error ? (
        /* Keyed on when it was raised, so the same failure happening again
           remounts the notice rather than looking like nothing happened. */
        <div className="notice" data-kind="fault" role="alert" key={errorAt}>
          <h2>Didn&rsquo;t work</h2>
          <p>{error}</p>
          {/*
            And what to do about it, when this app can tell.

            A message that says what went wrong and offers nothing to do next
            is where the troubleshooting guide came from. fixFor reads the
            message for a handful of plain signals and names one of four
            fixes; anything it cannot place gets no button, which is the
            honest answer — a wrong fix offered confidently costs more than no
            fix offered at all.
          */}
          <div className="history-actions">
            {fixFor(error) ? (
              <button
                className="chip"
                onClick={() => {
                  setFix(fixFor(error))
                  setError(null)
                  setSheet('settings')
                  setSetupPage('help')
                }}
              >
                {fixById(fixFor(error)).title}
              </button>
            ) : null}
            <button
              className="chip"
              onClick={() => {
                setError(null)
                setRetryAsk(null)
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/*
        No tab row when there is one screen.

        A phone reaches Play and nothing else — Ask and Edit are bench work and
        were taken off it deliberately. What was left was a row containing the
        word "Play", underlined, which cannot be pressed to any effect and
        cannot be left. "An entire row with no buttons that can even be
        changed."

        It earned its keep while it also held the size control; that moved to
        the preset row, and this had nothing.

        The condition is named rather than written inline: test/structure.mjs
        reads this file as text and takes the first hit, so a second
        `views.length > 1` higher up — a comment included — hands it the wrong
        block. See CLAUDE.md.
      */}
      {tabsWorthShowing ? (
        <nav className="views" aria-label="Screens">
          {/* The ids are the app's own vocabulary and stay put. Only the
              words a player reads change: "Shape" described what the screen
              was to the person building it, not what you go there to do.

              There were three tabs. The middle one was the conversation, and
              it went with the AI. */}
          {[
            ['play', 'Play'],
            ['shape', 'Edit']
          ].filter(([id]) => views.includes(id)).map(([id, label]) => (
            <button
              key={id}
              className={`view-tab ${view === id ? 'current' : ''}`}
              /* changeView, not setView: a tab is the person going somewhere
                 themselves, and the report of what the last request did stops
                 being the thing on screen when they do. Through setView it
                 stayed pinned on Play until Got it. */
              onClick={() => changeView(id)}
              aria-current={view === id}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}

      {/*
        What the last request in words did, on the screen it moved you to.

        Outside the screens rather than inside one, because the whole problem
        is that the answer was tied to a screen: the conversation says "Done —
        3 changes" and then the app switches tabs, so the report and the person
        end up in different places. Not shown on Ask, where the conversation is
        already saying it — an answer repeated beside itself reads as two
        different answers.
      */}
      {justDid ? (
        <div className="notice" data-kind="did" role="status">
          <h2>
            {justDid.labels.length === 1
              ? 'Done — one change'
              : `Done — ${justDid.labels.length} changes`}
          </h2>
          {/* Named, not counted. "3 changes" and a jump to a screen full of
              blocks still leaves you looking for which three. */}
          <ul className="did-list">
            {justDid.labels.map((label, i) => (
              <li key={i}>{label}</li>
            ))}
          </ul>
          {/* Where those values landed: one scene, or the whole preset, and
              which other scenes share the channel. Without it "Done — 2
              changes" on Play could not be told from a preset-wide edit. */}
          {justDid.where ? <p className="did-where">{justDid.where}</p> : null}
          <div className="history-actions">
            <button className="chip" onClick={() => setJustDid(null)}>
              Got it
            </button>
          </div>
        </div>
      ) : null}

      {/*
        The three screens, one shown, swiped between on a phone. The wrapper
        takes nothing on touchstart — every control on every screen is inside
        it — and only claims a drag that has plainly gone sideways.
      */}
      <Screens view={view} enabled={status === 'live'} order={views} onChange={changeView}>
      {status === 'live' && view === 'play' ? (
        <>
        {/*
          Said once, on the screen it is about, and cleared for good.

          Inside the Play view rather than above it on purpose: the strip
          between the bar and the first screen is held to the bar, the states
          that mean the app cannot work yet, and the assistant — see the chrome
          check in test/structure.mjs. A hint belongs with the thing it hints
          at anyway.
        */}
        {!holdNoteSeen ? (
          <p className="play-hint">
            <span>
              Hold a block &mdash; the amp, the drive, any of them &mdash; to bring up its channels
              and pick the one this scene plays. A tap just switches it on and off.
            </span>
            <button className="chip" onClick={dismissHoldNote}>
              Got it
            </button>
          </p>
        ) : null}
        <Gig
          preset={preset}
          device={device}
          /* The stars and setlists are kept per unit; the slot list gives
             the setlist sheet its names. Both are what the picker gets. */
          deviceKey={currentDeviceSlug()}
          slots={allSlots}
          capabilities={device?.capabilities}
          size={size}
          fit={fit}
          onError={setError}
          onChanged={read}
          onPickPreset={() => setPresetMenu(true)}
          /*
           * On a phone this opens the chain in a sheet, because the Edit
           * screen is not reachable there on purpose. On a screen wide enough
           * to have that screen it simply goes there, rather than opening a
           * second copy of the same editor in the rail beside it.
           */
          onChain={
            chainShows
              ? () => (views.includes('shape') ? changeView('shape') : setSheet('chain'))
              : null
          }
        />
        </>
      ) : null}

      {status === 'live' && view === 'shape' ? (
        <>
          {/*
            Everything that changes the sound, on one screen, with the chain as
            the object you work through.

            This is Home and Controls merged. Home drew the chain and then a
            preset name, a scene list and a device strip that said what the bar
            above already said; Controls drew a second chain, a third scene
            list, a second tempo and a second tuner, behind twelve folds. The
            chain is rendered once now, and tapping a block opens it.
          */}
          <Chain
            blocks={blocks}
            selected={selectedBlock}
            onSelect={(id) => openBlockFrom(id)}
            onToggle={toggleBlock}
          />

          <div className="shape-row">
            {/*
              Which scene an edit lands in.

              Every knob turned and every block switched on this screen writes
              into the scene that is live — and nothing on this screen said
              which one that was. A chip reading "Scenes" is a door; a chip
              reading "Scene 2 · Lead" is the answer to the question you have
              while you are turning the knob.
            */}
            <button
              className={`chip ${hasScenes ? 'scene-now' : ''}`}
              onClick={() => setSheet('scenes')}
              disabled={!hasScenes}
            >
              {hasScenes ? (
                <>
                  <span className="scene-now-tag mono">Scene {scene + 1}</span>
                  <span className="scene-now-name">{sceneNames[scene] || `Scene ${scene + 1}`}</span>
                </>
              ) : (
                'Scenes'
              )}
            </button>
            <button className="chip" onClick={() => setSheet('presets')}>
              Presets and backups
            </button>
            {dirty ? (
              <button className="chip armed" onClick={revert} disabled={busy}>
                Revert
              </button>
            ) : null}
          </div>

          {/*
            Search opens the block that holds the control and lands on it. It
            used to feed a separate staged editor, which is why the same knob
            existed twice with two different write contracts.
          */}
          <ParamSearch
            blocks={blocks}
            onError={setError}
            onPick={(eid, paramId) => {
              openBlockFrom(eid)
              setEditorFocus({ eid, paramId, nonce: Date.now() })
            }}
          />

          <Section key="chain" title="Chain" note="Add, remove and move blocks" defaultOpen>
            <GridEditor
              blocks={blocks}
              capabilities={device?.capabilities}
              busy={busy}
              onError={setError}
              onChanged={(summary) => {
                record('grid', summary)
                read()
              }}
            />
          </Section>

          <Section key="modifiers" title="Modifiers" note="Let a pedal or the volume knob move a control">
            <Modifiers
              blocks={blocks}
              busy={busy}
              onError={setError}
              onChanged={(summary) => record('modifier', `Modifier bound: ${summary}`)}
            />
          </Section>

        </>
      ) : null}

      </Screens>

      {/* ---------------------------------------------------------------
          Sheets. Things you open, act on and dismiss — not places you go.
          --------------------------------------------------------------- */}


      {/*
        The chain, and everything that changes it, on a phone.

        "On the PWA we need to be able to see what chain was written or what
        chain is currently on a setting."

        The Edit screen where this lives is deliberately unreachable on a phone
        — see BENCH in components/Screens.jsx, and the same rule the phone apps
        in mobile/ have always had: a generate button within reach of a stage
        tap is a hazard. That rule is about what a SWIPE lands on in the dark,
        not about what the app is capable of showing. Nothing here is one
        gesture from the stage screen; it is behind the gear, which is where
        somebody goes when they have stopped playing and want to look at
        something.

        The same contents as the Edit screen, in a sheet, so there is one chain
        editor in this app rather than a second one written for a small screen.
      */}
      <Sheet
        open={sheet === 'chain'}
        onClose={() => setSheet(null)}
        title="Chain"
        alert={sheetAlert}
        note={
          hasScenes
            ? `Scene ${scene + 1}${sceneNames[scene] ? ` · ${sceneNames[scene]}` : ''}`
            : preset?.name || null
        }
      >
        {sheet === 'chain' ? (
          <>
            {/* What is in the preset, in signal order. Tapping one opens its
                knobs and closing them comes back here. */}
            <Chain
              blocks={blocks}
              selected={selectedBlock}
              onSelect={(id) => openBlockFrom(id, 'chain')}
              onToggle={toggleBlock}
            />

            <ParamSearch
              blocks={blocks}
              onError={setError}
              onPick={(eid, paramId) => {
                openBlockFrom(eid, 'chain')
                setEditorFocus({ eid, paramId, nonce: Date.now() })
              }}
            />

            <Section key="chain-blocks" title="Add, remove and move blocks" defaultOpen>
              <GridEditor
                blocks={blocks}
                capabilities={device?.capabilities}
                busy={busy}
                onError={setError}
                onChanged={(summary) => {
                  record('grid', summary)
                  read()
                }}
              />
            </Section>

            <Section key="chain-modifiers" title="Modifiers" note="Let a pedal or the volume knob move a control">
              <Modifiers
                blocks={blocks}
                busy={busy}
                onError={setError}
                onChanged={(summary) => record('modifier', `Modifier bound: ${summary}`)}
              />
            </Section>
          </>
        ) : null}
      </Sheet>

      <Sheet
        open={sheet === 'block' && !!openBlock}
        onClose={() => {
          setSheet(sheetBack)
          setSheetBack(null)
        }}
        title={openBlock?.name || 'Block'}
        alert={sheetAlert}
        /* Where these knobs land. A block's settings are per-scene, so an
           editor that doesn't name the scene is an editor you have to
           remember the context for. */
        note={
          [
            openBlock?.bypassed ? 'Bypassed' : null,
            hasScenes ? `Scene ${scene + 1}${sceneNames[scene] ? ` · ${sceneNames[scene]}` : ''}` : null
          ]
            .filter(Boolean)
            .join(' · ') || null
        }
      >
        <BlockPanel
          block={openBlock}
          channels={device?.capabilities?.channelNames}
          busy={busy}
          focus={editorFocus}
          onError={setError}
          onChanged={(summary, change, { chain = true } = {}) => {
            record('edit', summary)
            /*
             * A knob turned after a generation was written is a correction of
             * it: the model chose one value and the player wanted another.
             * That is the strongest signal this app can collect, and until now
             * it fixed one tone and was forgotten.
             *
             * Only while a generation is on the unit. A knob turned on a
             * preset someone built themselves corrects nobody, and counting it
             * would teach the model about their rig rather than about its own
             * misses.
             */
            setDirty(true)
            // A knob is not a change to the chain: the panel has already read
            // the new value back, and a full re-read of the unit per knob is
            // what made the sheet jump every time one was turned.
            if (chain) read()
          }}
        />

        {/*
          Which impulse responses this cab is actually loaded with.
          It had its own section, which is one panel for one read-only fact
          about one block. Here it is where you would look for it — inside the
          cab — and only when the cab is what you opened.
        */}
        {openBlock?.slug === 'cab' && device?.capabilities?.cabIrs !== false ? (
          <CabPicker
            blocks={blocks}
            busy={busy}
            onError={setError}
            onChanged={(summary) => record('cab', summary)}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={presetMenu && narrow}
        onClose={() => setPresetMenu(false)}
        title="Choose a preset"
        note={preset ? `${preset.number} · ${preset.name?.trim() || 'Untitled'} is loaded` : null}
      >
        {presetPicker}
      </Sheet>

      {/*
        Saving is a sheet now, not a button that writes.

        The bar's Save opens this; the write happens on the button inside,
        which names the slot and sits under the list of what is in it. Two taps
        for the common case, and an overwrite you can see before you commit it.
      */}
      {/*
        The same conversation, over whatever you were looking at.

        Only mounted while open: the Assistant holds a live turn list and a
        running generation, and a second copy of it existing quietly behind
        Create would be a second place for those to diverge.
      */}
      {/* The one sign-in, as a sheet: it pops up, you do the thing, it goes. */}
      {/*
        Not a sheet over the app: a page instead of it. There is nothing
        useful behind this until the unit is plugged in, and showing the app
        greyed out behind a dialog shows somebody a thing they cannot use yet.
      */}
      <Onboarding
        open={walkthrough}
        onClose={() => setWalkthrough(false)}
        device={device}
        status={status}
        faultReason={faultReason}
        link={link}
        onLookAgain={() => read()}
        onSignIn={() => linkAction('mac-setup')}
      />

      <SignInSheet
        open={Boolean(signIn)}
        account={signIn === 'account'}
        startIn={signInStart}
        onCreate={async (details) => {
          const out = await createAccount(details)
          if (out.needsConfirmation) return out
          record('remote', `Account made for ${details.email}`)
          /* Then the errand the sheet was opened for — connect this phone, or
             turn the computer's phone remote on — as the sign-in would have. */
          if (signIn === 'account') {
            setSignIn(false)
            if (linkState().role === 'remote' && !isDemo()) await reconnectPhone()
          } else await signInSubmit(details)
          return out
        }}
        role={link.role}
        email={[link.account?.email, loadRemoteConfig()?.email].find((e) => e && !isPairAccount(e)) || ''}
        busy={busy}
        onClose={() => {
          setSignIn(false)
          /* Closed without signing in: nobody is waiting for the unlock page. */
          setUnlockAfterSignIn(false)
        }}
        onSubmit={signInSubmit}
      />

      <Sheet
        open={sheet === 'save'}
        onClose={() => setSheet(null)}
        title="Save"
        note={preset?.name?.trim() || null}
        footer={
          <SaveFooter
            preset={preset}
            slot={slot}
            onSave={async () => {
              await save()
              setSheet(null)
            }}
            busy={busy}
            saving={saving}
            remote={remote}
            queued={queuedSave}
            slots={allSlots}
          />
        }
      >
        <SaveSheet
          preset={preset}
          saveName={saveName}
          onName={setSaveName}
          slot={slot}
          onSlot={setSlot}
          onSave={async () => {
            await save()
            setSheet(null)
          }}
          onRevert={revert}
          safety={safety}
          onRestoreSafety={restoreSafety}
          busy={busy}
          saving={saving}
          dirty={dirty}
          remote={remote}
          queued={queuedSave}
          error={saveError}
          onDismissError={() => setSaveError(null)}
          slots={allSlots}
          deviceSlots={device?.capabilities?.presets?.count}
          addressing={device?.capabilities?.presets?.addressing}
          scanning={scanning}
          progress={scanProgress}
          onScan={scanPresets}
          onStopScan={stopNames}
        />
      </Sheet>

      <Sheet
        open={sheet === 'presets'}
        onClose={() => setSheet(null)}
        title="Presets"
        note={device?.capabilities?.presets?.count ? `${device.capabilities.presets.count} slots` : null}
      >
        <PresetList
          slots={allSlots}
          slowNames={namesCostADump()}
          device={currentDeviceSlug()}
          current={preset?.number}
          deviceSlots={device?.capabilities?.presets?.count}
          addressing={device?.capabilities?.presets?.addressing}
          scanning={scanning}
          progress={scanProgress}
          onStop={stopNames}
          onScan={scanPresets}
          onReread={rereadNames}
          onSelect={(n) => {
            jumpTo(n)
            setSheet(null)
          }}
        />

        {/* The folder, which survives a browser being reinstalled.

            There were three panels here: the account, the folder and browser
            storage. The other two held DESIGNS — tones the AI had made — and
            went with it. What is left is the one that was always about the
            unit: preset files you captured, in a folder you chose. */}
        <Section key="saved-presets" title="Saved presets" note="Captures, as files in a folder you choose">
          <LocalLibrary
            preset={preset}
            busy={busy}
            remote={remote}
            onError={setError}
            onChanged={(summary) => record('library', summary)}
          />
        </Section>

        <Section key="backups" title="Backups" note="This preset, and every slot at once">
          <Backup
            preset={preset}
            busy={busy}
            onError={setError}
            onChanged={(summary) => {
              record('backup', summary)
              read()
            }}
          />
          <Versions
            preset={preset}
            busy={busy}
            deviceSlots={device?.capabilities?.presets?.count}
            onError={setError}
            onChanged={(summary) => {
              record('version', summary)
              read()
            }}
          />
          <DeviceBackup
            busy={busy}
            deviceSlots={device?.capabilities?.presets?.count}
            onError={setError}
            onChanged={(summary) => record('backup', summary)}
          />
        </Section>
      </Sheet>



      <Sheet
        open={sheet === 'scenes'}
        /*
         * Back to whatever opened it. The scene chip on the Edit screen wants
         * the Edit screen; Setup's rename page wants Setup — "when you go
         * deeper into the settings menu have swiping down or clicking the X
         * take you back to the settings menu instead of the home screen".
         */
        onClose={() => {
          setSheet(sheetBack)
          setSheetBack(null)
        }}
        title="Scenes"
        alert={sheetAlert}
      >
        {/* The preset's own name first: the pencil on the Play screen opens
            here, and a name is the one thing about a preset with no other
            place to be typed. */}
        <RenamePreset preset={preset} busy={busy} onRename={rename} />
        <Scenes
          blocks={blocks}
          preset={preset}
          count={device?.capabilities?.sceneCount || 8}
          channelNames={device?.capabilities?.channelNames}
          hasScenes={hasScenes}
          busy={busy}
          onChanged={(summary) => {
            record('scene', summary)
            read()
          }}
          onError={setError}
        />

        <SceneMatrix
          blocks={blocks}
          count={device?.capabilities?.sceneCount || 8}
          names={sceneNames}
          busy={busy}
          onError={setError}
          onChanged={(summary) => {
            record('scene', summary)
            setDirty(true)
          }}
        />
      </Sheet>

      {/*
        The volume, on a sheet the speaker in the bar opens.

        "Put a sound button that looks like a speaker in the header, and when
        it's tapped you can slide the volume left or right or do the plus minus
        thing that's already set up, but it's not there on the main screen."

        The same control, unchanged — the slider, the two steps and the figure —
        just no longer holding a strip of the stage screen open all night for
        the two moments it is wanted.
      */}
      <Sheet
        open={sheet === 'volume'}
        onClose={() => setSheet(null)}
        title="Volume"
        note={preset?.name?.trim() || null}
      >
        {sheet === 'volume' && outputEid !== null ? (
          <Volume eid={outputEid} preset={preset} onError={setError} />
        ) : null}
      </Sheet>

      {/*
        Tall, and mounted only while it is open. Four hundred rows is a real
        amount of DOM to keep alive behind a sheet nobody has open, and the
        search box inside starts empty every time it is opened, which is what
        somebody coming back to look up a second amp wants anyway.
      */}
      <Sheet
        open={sheet === 'gear'}
        /* Only Setup's row opens it, so closing it is going back there. */
        onClose={() => setSheet('settings')}
        title="Amp and pedal names"
        note={device?.short || device?.name || null}
        tall
      >
        {sheet === 'gear' ? <GearNames /> : null}
      </Sheet>

      <Sheet
        open={sheet === 'settings'}
        /*
          "When you go deeper into the settings menu have swiping down or
          clicking the X take you back to the settings menu instead of the
          home screen." A page's way out is the list; only the list's way out
          is the app. 'stay' tells the sheet it is still open — see Sheet's
          Back handling.
        */
        onClose={() => {
          if (setupPage) {
            setSetupPage(null)
            return 'stay'
          }
          setSheet(null)
          return undefined
        }}
        title="Settings"
        note={device?.short || device?.name || null}
      >
        {/*
          Setup, as a list.

          "I wanna overhaul this whole settings set-up screen." It was four
          doors with five unrelated buttons over them — History, Demo mode,
          Read the unit again, Rename, a theme switch — and two panels that had
          fallen off the end. Nothing on it said what state anything was in
          until a door was opened.

          Now: the version line he likes at the top, then seven rows, each
          carrying the one fact you would have opened it for, each opening its
          own page. Rename stays on the Unit page beside Read the unit again —
          "move the rename presets and scenes button to the settings menu" —
          History moved in with the AI's work, the theme switch in with the
          Play screen, and the real amp names got a row of their own.
        */}
        {setupPage === null ? (
          <>
            <div className="device-meta mono setup-version">{FULL}</div>
            <div className="setup-rows">
              {/*
                First, because it is the only row here anybody opens for the
                fun of it.

                "Move the amp and pedals button to the top of the list." Every
                other row in this list is plumbing — what is connected, what
                the screen looks like, what went wrong — and they are all rows
                you go to when something needs sorting out. This one answers
                "what IS a Das Metall, really", which is the question a player
                has while playing, and it was last but two, under
                Troubleshooting's neighbours.
              */}
              <SetupRow key="gear-names" title="Amp & pedal names" status="What each model on your unit really is" onClick={() => setSheet('gear')} />
              {/* The whole chain on one line: the computer, and the unit on
                  the end of it. Two rows could each only say half of it, and
                  half of a chain is never the answer to "why is nothing
                  happening". */}
              <SetupRow key="link" title="Phone & computer" status={[describeLink(link).note || 'Phone remote off', status === 'live' ? `${device?.short || device?.name || 'Unit'} · connected` : 'No unit'].join(' · ')} onClick={() => setSetupPage('link')} />
              {/*
                WHICH FRACTAL THE DEMO IS has gone back inside Phone & computer,
                which is where the phone keeps it — a "Which unit" section on
                that page, not a row on this list.

                It was lifted to this level on the strength of "Only shows FM3
                is the only model available", and the note written at the time
                claimed the phone had it here too. It never did. So the row was
                not the browser catching up with the phone, it was the browser
                walking away from it, and this list is the one Justin has since
                dictated: the things Setup is opened FOR, and one door.

                The complaint it answered is answered anyway — the picker is a
                row on the page named for the unit, and the DEMO badge still
                opens it in one press.
              */}
              <SetupRow key="rename" title="Rename presets and scenes" status={status === 'live' ? 'Give them names you will know on a dark stage' : 'Connect a unit first'} onClick={() => setSetupPage('rename')} />
              {/*
                THE SAME ROW THE PHONE HAS, in the same place: after renaming,
                before About. "Unlock the full version" over the price, the
                phone's words for the phone's errand.

                For anybody who has not paid, signed in or not, as on the
                phone. Signed out it asks for the sign-in first — where an
                account can be made now: "somebody should be able to create an
                account on the web and desktops, and make purchases as well" —
                and lands on the unlock page after it. Once it is bought there
                is nothing left to offer, and the row goes.

                The phone's other wording, "Drive a real rig, or restore a
                purchase", is for a store that has not answered with a price.
                A browser has no store to restore from, so until the price
                arrives it says the first half and nothing it cannot back up.
              */}
              {paid.checked && !paid.unlocked ? (
                <SetupRow
                  key="unlock"
                  title="Unlock the full version"
                  status={webPriceText ? `Drive a real rig · ${webPriceText}` : 'Drive a real rig'}
                  onClick={openUnlock}
                />
              ) : null}
              {/*
                THE ONE ROW HERE THE PHONE HAS NOT GOT, and it stays on the
                front page rather than moving into About with the other
                once-ever errands.

                "Not only behind the DEMO badge. Somebody who has a rig
                connected and wants the remote in their pocket is the likeliest
                buyer there is, and the badge they would have clicked is not on
                screen for them." Burying it one door down would undo exactly
                that. A phone has no use for it at all, which is why matching
                the two lists row for row was never going to be the test.
              */}
              <SetupRow
                key="phone-app"
                title="Get it on your phone"
                status="The remote, for a stage"
                onClick={() => setSetupPage('phone')}
              />
              <SetupRow key="about" title="About" status={FULL} onClick={() => setSetupPage('about')} />
            </div>
            {/*
              THE TWO THAT ARE NOT DOORS, and they are here rather than behind one.

              "Move this to the settings screen at the bottom below all the
              other drop-down menus — we want it quickly available just by
              clicking settings. Don't have it via a drop-down, have it always
              visible."

              Every row above opens something and then you come back. These
              two are not errands: they are how the screen you play off LOOKS,
              and the only way to judge either is to change it and look. Behind
              a row called Play screen that was four moves a go — open
              Settings, open the row, change it, come back out to see — and the
              thing being judged was not on screen while you judged it.

              Below the rows, because the rows are what somebody opens Settings
              FOR. These want to be one click away, not first.
            */}
            <div className="setup-loose">
              {/*
                Not <Section>. That is a <details> that starts CLOSED, which is
                the drop-down this was asked out of — moving a fold from one
                page to another would have changed nothing. These are headings
                over controls that are simply there.
              */}
              <div className="setup-open">
                <p className="silk-label setup-open-title">Stage tiles</p>
                <div className="size-steps" role="group" aria-label="Stage tiles">
                  <button
                    className="size-step"
                    onClick={() => resize(-1)}
                    disabled={fit || size <= 0}
                    aria-label="Smaller buttons"
                  >
                    &minus;
                  </button>
                  <span className="size-name">{fit ? 'Fit to screen' : SIZES[size].name}</span>
                  <button
                    className="size-step"
                    onClick={() => resize(1)}
                    disabled={fit || size >= SIZES.length - 1}
                    aria-label="Bigger buttons"
                  >
                    +
                  </button>
                </div>
                <p className="hint">
                  Bigger tiles are easier to hit without looking; smaller ones fit more of the rig
                  on screen. This device remembers it.
                </p>
                {/*
                  "It would be nice just to have everything static on the screen
                  without being able to scroll." A step is a fixed height, so
                  whether the rig fits depends on the preset. This hands the
                  height to the screen instead: Play measures what is left and
                  sizes the tiles so the last row of effects sits above the footer.
                */}
                <label className="rename-choice">
                  <input
                    type="checkbox"
                    checked={fit}
                    onChange={(e) => {
                      const on = e.target.checked
                      setFit(on)
                      saveFit(on)
                    }}
                  />
                  <span>
                    Fit everything on one screen
                    <span className="hint">
                      Sizes the scenes and effects so the whole rig is on screen at once, with no
                      scrolling. Bigger presets get smaller buttons, never under a thumb&rsquo;s
                      width. Overrides the size above while it is on.
                    </span>
                  </span>
                </label>
              </div>
              <div className="setup-open">
                <p className="silk-label setup-open-title">Appearance</p>
                <Theme />
              </div>
            </div>
          </>
        ) : null}

        {setupPage === 'phone' ? <PhoneApp /> : null}

        {setupPage === 'demo' ? (
          <div className="setup-page">
            <button type="button" className="setup-back" onClick={() => setSetupPage(upFrom('demo'))}>
              {upLabel('demo')}
            </button>
            <p className="setup-page-title">{SETUP_PAGES.demo}</p>
            {/*
              Each of these carries its own real factory bank — the preset and
              scene names the unit ships with — so picking one is not a label
              change. It is a different simulated rig, which is why it reloads.
            */}
            <p className="hint">
              Each one holds the factory presets and scenes that unit really ships with, and the
              right number of scenes and slots. Picking one starts the demo again as that unit.
            </p>
            <div className="demo-units" role="group" aria-label="Demo Unit">
              {DEMO_UNITS.map((u) => (
                <button
                  key={u.key}
                  className={`chip${u.key === demoUnit() ? ' active' : ''}`}
                  aria-pressed={u.key === demoUnit()}
                  onClick={() => {
                    setDemoUnit(u.key)
                    window.location.reload()
                  }}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {setupPage === 'rename' ? (
          <div className="setup-page">
            <button type="button" className="setup-back" onClick={() => setSetupPage(null)}>
              ‹ Settings
            </button>
            <p className="setup-page-title">{SETUP_PAGES.rename}</p>
            {/*
              One errand, said in the words of the errand.

              The button used to sit in the row of connection buttons on the
              Unit page, between "Reconnect" and the address box, where it was
              the only one of them that changed anything on the unit. Here it
              is the page.
            */}
            <p className="hint">
              The names your unit came with are numbers and abbreviations. These are the words you
              read off a phone on a dark stage, so they are worth the minute it takes.
            </p>
            {status === 'live' ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setSheetBack('settings')
                  setSheet('scenes')
                }}
              >
                Rename preset or scenes
              </button>
            ) : (
              <p className="hint">
                Nothing to rename until a unit is answering. Phone &amp; computer, one row up, says
                what the chain is doing.
              </p>
            )}
          </div>
        ) : null}

        {setupPage === 'link' ? (
          <div className="setup-page">
            <button type="button" className="setup-back" onClick={() => setSetupPage(null)}>
              ‹ Settings
            </button>
            <p className="setup-page-title">{SETUP_PAGES.link}</p>
            {/*
              The unit's own state leads, because it is the far end of the
              chain this page is about and the thing that was hardest to find:
              it used to be behind a row called "Unit", one door along.
            */}
            <DeviceDetail status={status} device={device} onRetry={reconnect} busy={busy} />
            {/*
              WHICH UNIT THE DEMO IS, on the page about the unit — where the
              phone keeps it, as a "Which unit" section on its own link page.
              Only while the demo is on: there is nothing to choose when a real
              rig is answering.
            */}
            {isDemo() ? (
              <div className="setup-rows">
                <SetupRow
                  key="demo-unit"
                  title="Demo Unit"
                  status={`${unitByKey(demoUnit()).name} · five to choose from`}
                  onClick={() => setSetupPage('demo')}
                />
              </div>
            ) : null}
<Section key="connection" title="Connection" note="Which unit this app is talking to">
            <Ports
              busy={busy}
              onError={setError}
              onChanged={(summary) => {
                record('port', summary)
                read()
              }}
            />
          </Section>
<Section key="phone-remote" title="Phone remote" note={describeLink(link).note}>
            {/*
              One panel for both ends. It says which end this is, whether the
              other end answers, and offers the one thing that state calls for.
              The four panels it replaces — each written for the person who built
              the app — are gone, and the words they used with them.
            */}
            <PhoneRemote link={link} onAction={linkAction} onError={setError} error={error} busy={busy} />
          </Section>
          {/*
            THE WAY IN, FROM THE DEMO. "There's actually no place to even sign
            in anywhere on the web app." In the demo the panel above says the
            phone remote is not part of it, and that was the whole page. The
            phone's Setup has had this since "there is no way to login with
            user name and password after you are in the app on the demo", and
            these are its words.
          */}
          {isDemo() && !link.account ? (
            <Section key="account" title="Account" note="Not signed in on this device." defaultOpen>
              <div className="history-actions">
                <button type="button" className="primary" onClick={() => setSignIn('account')} disabled={busy}>
                  Sign in with an email and password
                </button>
              </div>
            </Section>
          ) : null}
          {/*
            How to get a computer on the other end at all, which is the
            question somebody has when there is nothing on the other end.

            The routes are shared with the phone — see shared/ways-in.mjs —
            and THIS end is the one where sorting them means something. A
            browser is running on the computer in question, so waysFor can put
            the routes for it first; a handset cannot know whether there is a
            Mac or a PC on the desk and leaves the order alone.
          */}
          <Section
            key="ways-in"
            title="Connect a computer"
            note={
              thisComputer === 'mac'
                ? `${waysWord()} ways, with the Mac one first`
                : thisComputer === 'windows'
                  ? `${waysWord()} ways, with the Windows one first`
                  : `${waysWord()} ways, and what each one costs you`
            }
          >
            <p className="hint">
              Your unit plugs into a computer with a USB cable. That computer talks to the unit, and
              your phone tells the computer what to do — over wifi at the venue, or over the
              internet from anywhere. The phone never talks to the unit directly.
            </p>
            <div className="ways">
              {waysFor(thisComputer).map((way, i) => (
                /*
                  All four shut. "When opening the connect a computer menu the
                  Mac app is expanded by default. Have it collapsed like the
                  windows and Linux apps."

                  The first one used to open itself, on the reasoning that
                  waysFor puts the route for YOUR computer first so the open
                  one is the one you want. What that actually produced was a
                  page where one route is a wall of steps and the other three
                  are one line each — which reads as one real answer with
                  three footnotes, rather than a set of ways to choose between.
                  Four summaries, each saying what it costs you, is the list
                  somebody came here to read; the steps are for after choosing.
                */
                <details key={way.id} className="way" data-status={way.status}>
                  <summary>
                    <span className="way-n">{i + 1}</span>
                    <span className="way-title">{way.title}</span>
                    <span className="hint">{way.note}</span>
                  </summary>
                  <ol className="way-steps">
                    {way.steps.map((step, n) => (
                      /* The one step that is a command gets drawn as one. See ways-in.mjs. */
                      <li key={n}>{step === way.command ? <code className="way-command">{step}</code> : step}</li>
                    ))}
                  </ol>
                  {way.links.length ? (
                    <div className="history-actions">
                      {way.links.map((to) => (
                        <a key={to.url} className="chip" href={to.url} target="_blank" rel="noreferrer">
                          {to.label}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </details>
              ))}
            </div>
            <p className="footnote">
              Whichever way you go: only one program at a time can hold the unit&rsquo;s USB port. If
              the computer says it cannot find your unit, something else has it — the Fractal editor,
              or a second copy of this app.
            </p>
          </Section>

          <Section key="link-details" title="Link details" note="What the phone and the computer say about the line between them">
            <LinkDetails />
          </Section>
          </div>
        ) : null}

        {/*
          WHAT IS RUNNING, AND HOW TO GET THE NEWEST — a page of its own now,
          because it is a row inside About rather than a panel on it. The phone
          reached the same shape from the same instruction.

          Desktop only: a browser tab updates by being reloaded, and there is
          nothing here for it to offer.
        */}
        {setupPage === 'updates' ? (
          <div className="setup-page">
            <button type="button" className="setup-back" onClick={() => setSetupPage(upFrom('updates'))}>
              {upLabel('updates')}
            </button>
            <p className="setup-page-title">{SETUP_PAGES.updates}</p>
            <Updates />
          </div>
        ) : null}

        {setupPage === 'help' ? (
          <div className="setup-page">
            <button type="button" className="setup-back" onClick={() => setSetupPage(upFrom('help'))}>
              {upLabel('help')}
            </button>
            <p className="setup-page-title">{SETUP_PAGES.help}</p>
<Section
            key="fixes"
            title="Fixes"
            note="What to try, in the order worth trying it"
            defaultOpen={!!fix}
          >
            {/*
              The guide is shared with the phone — see shared/troubleshooting.mjs
              — so a fix reads the same wherever somebody standing in front of a
              dead rig happens to look it up.
            */}
            <div className="fixes">
              {FIXES.map((entry) => (
                <details key={entry.id} className="fix" open={fix === entry.id}>
                  <summary>
                    {entry.title}
                    <span className="hint">{entry.when}</span>
                  </summary>
                  <ol className="fix-steps">
                    {entry.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  {entry.id === 'versions' ? (
                    <div className="fix-versions">
                      {/*
                        The check itself, rather than a step telling somebody to
                        go and compare two numbers by hand. Two of the three:
                        the unit's firmware is not something either end can
                        read, and this says so rather than leaving a row that
                        looks like a check nobody ran.
                      */}
                      <p className="mono" data-sync={versionsInSync({ app: VERSION, host: link.macVersion }).state}>
                        {versionsInSync({ app: VERSION, host: link.macVersion }).says}
                      </p>
                      <p className="hint">{FIRMWARE_NOTE}</p>
                    </div>
                  ) : null}
                </details>
              ))}
            </div>
          </Section>
<Section
            key="preset-check"
            title="This preset"
            note="Read every value in this scene, and what would stop it making a sound"
          >
            <PresetReport device={device} link={link} />
          </Section>
<Section key="debug-log" title="Debug log" note="Share it as a file to the chat when something goes wrong">
            {/*
              One log, one Copy button. "Make a unified debug log with a copy
              log button to send back to you for debugging in the settings menu.
              Any debugging info already in menus move to debug log." The AI's
              timeline, the wire, the app's own changes, every error: one list,
              in order. The two detailed views under it are the same facts as
              tables, for reading rather than sending.
            */}
            <DebugLog device={device} link={link} />
            <Diagnostics />

            {/*
              This used to sit under every screen, permanently, including the one
              you look at on a stage. It is worth saying once and worth being
              findable — which is here, not there.
            */}
            <p className="footnote">
              Models and parameter ranges are read off the attached unit at generation time, so the
              designer can only pick models that unit actually has and only set values inside each
              control&rsquo;s real range. Anything outside it is rejected before a single write goes
              out. Device access via{' '}
              <a href="https://github.com/sKuhLight/ForgeFX" target="_blank" rel="noreferrer">
                ForgeFX
              </a>
              , an independent project not affiliated with Fractal Audio Systems.
            </p>
          </Section>
<Section key="feedback" title="Feedback" note="Something broken, or something you want">
            {/*
              Where a person looks when the app has annoyed them: behind the
              same door as the checks and the log, because "it's broken" and
              "here is what broke" are one errand. It needs no account, because
              most people driving a unit from their own Mac never sign in and
              are exactly the ones who find the bugs.
            */}
            {/* macVersion too: "the phone is on 7.344 and the Mac is on 7.191"
                is the answer to a surprising number of reports, and it is the
                one fact nobody would think to type. */}
            <Feedback device={device} link={link} platform={platform()} macVersion={link.macVersion} />
          </Section>
<Section key="what-s-changed-this-session" title="What's changed this session">
            <ChangeLog log={log} onClear={() => setLog([])} />
          </Section>
          </div>
        ) : null}

        {/*
          THE UNLOCK PAGE, in the phone paywall's own words.

          Every sentence here is copied from mobile/src/screens/Paywall.js, and
          test/both-ends.mjs holds them to it: the same offer, worded the same
          way at both ends, and none of it written fresh for the browser. What
          is left out is what a browser cannot do — Restore asks Apple or
          Google, and there is neither here; a purchase made on a phone already
          shows as paid on this page, through the account.

          The checkout itself is RevenueCat's, drawn over this page by the
          library. It takes real cards: webPurchase.js is on the live key since
          the sandbox checkout was walked through end to end.
        */}
        {setupPage === 'unlock' ? (
          <div className="setup-page">
            <button type="button" className="setup-back" onClick={() => setSetupPage(upFrom('unlock'))}>
              {upLabel('unlock')}
            </button>
            <p className="setup-page-title">{SETUP_PAGES.unlock}</p>
            {unlockBody}
          </div>
        ) : null}

        {setupPage === 'about' ? (
          <div className="setup-page">
            <button type="button" className="setup-back" onClick={() => setSetupPage(null)}>
              ‹ Settings
            </button>
            <p className="setup-page-title">{SETUP_PAGES.about}</p>
            <p className="device-meta mono">{FULL} · built {BUILT_AT} UTC</p>
            {/*
              UPDATES, TROUBLESHOOTING AND THE WALKTHROUGH, in that order,
              because that is the order the phone has them in.

              "Move walkthrough, updates and troubleshooting INSIDE of the
              'About' menu." That instruction was carried out on the phone and
              not here, and Troubleshooting and the walkthrough went on sitting
              on the browser's front list for it — which is the drift he spotted.
              They are three rows now rather than two Sections and a chip, for
              the same reason the phone's are: everything else at this level is
              a row, and the one thing that is not is the one thing nobody finds.
            */}
            <div className="setup-rows">
              {inDesktopApp() ? (
                <SetupRow key="updates" title="Updates" status="This app, not your unit" onClick={() => setSetupPage('updates')} />
              ) : null}
              <SetupRow
                key="help"
                title="Troubleshooting"
                status={`${getDebugLog().length} line${getDebugLog().length === 1 ? '' : 's'} in the log`}
                onClick={() => setSetupPage('help')}
              />
              {/*
                The way back in, named the way the last screen of it promises:
                "Need this again? Settings → Show the walkthrough."
              */}
              <SetupRow
                key="walkthrough"
                title={REPLAY}
                status="The three-step setup, again"
                onClick={() => {
                  setSheet(null)
                  setWalkthrough(true)
                }}
              />
            </div>
            {/* Reachable from inside the app, which is the point of writing
                them. Same two links as the phone's About page. */}
            <Section key="small-print" title="The small print" note="Worth knowing, once">
              {/* Said in the app rather than only in a file somebody would have
                  to go looking for. One string, shared with the phone — see
                  shared/affiliation.mjs for why it is not typed twice. */}
              <p className="hint">{AFFILIATION}</p>
              <div className="history-actions">
                <a className="chip" href="/privacy.html" target="_blank" rel="noreferrer">
                  Privacy
                </a>
                <a className="chip" href="/notices.txt" target="_blank" rel="noreferrer">
                  Licences
                </a>
              </div>
            </Section>
          </div>
        ) : null}
      </Sheet>

    </div>
  )
}

