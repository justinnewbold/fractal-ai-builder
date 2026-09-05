import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopBar from './components/TopBar'
import { Preview } from './components/Generate'
import { ChangeLog } from './components/ChangeLog'
import Diagnostics from './components/Diagnostics'
import Cost from './components/Cost'
import Scenes from './components/Scenes'
import History from './components/History'
import { CabPicker, Backup } from './components/Hardware'
import Gig from './components/Gig'
import SaveBar from './components/SaveBar'
import SaveSheet from './components/SaveSheet'
import CloudPresets from './components/CloudPresets'
import { LiveGeneration, Thinking } from './components/LiveGeneration'
import { streamSpec } from './lib/stream'
import { Modifiers, SceneMatrix } from './components/Modifiers'
import Feedback from './components/Feedback'
import DevTrace, { TraceSwitch } from './components/DevTrace'
import { traceEnabled } from './lib/devtrace'
import { platform } from './lib/platform'
import { Versions, DeviceBackup } from './components/Versions'
import Footswitches from './components/Footswitches'
import GridEditor from './components/GridEditor'
import Ports from './components/Ports'
import LocalLibrary from './components/LocalLibrary'
import Section from './components/Section'
import Sheet from './components/Sheet'
import DeviceDetail from './components/DeviceDetail'
import {
  attachDriver,
  listen as listenToDevice,
  useDevice,
  put as putDevice,
  getSnapshot as deviceSnapshot,
  refreshBlocks,
  refreshScene,
  refreshSceneNames,
  refreshTempo,
  tapBeat,
  writeScene,
  writeTempo,
  confirmedDetect,
  writeBypass,
  writeTuner
} from './lib/deviceState'
import ParamSearch from './components/ParamSearch'
import Assistant from './components/Assistant'
import UpdateNotice from './components/UpdateNotice'
import Updates, { UpdateReadyNotice } from './components/Updates'
import { validatePlan, runPlan } from './lib/actions'
import { listPresets, newestFirst } from './lib/history'
import {
  profileFrom,
  describeProfile,
  suggestionsFrom,
  summariseProfile,
  tasteEnabled,
  setTasteEnabled
} from './lib/taste'
import {
  clearCorrections,
  describeCorrections,
  listCorrections,
  patternsFrom,
  rememberCorrection,
  rememberNote,
  summariseCorrections
} from './lib/corrections'
import { countFromRefusal, slotCount, slotOutside, timeLeft } from './lib/slots'
import { inDesktopApp } from './lib/desktop'
import { createNameScan } from './lib/nameScan'
import { Chain, PresetList, BlockPanel, Tuner } from './components/Console'
import Screens from './components/Screens'
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
  readSceneNames
} from './lib/forgefx'
import { savePreset, buildEntry } from './lib/history'
import { costOf } from './lib/cost'
import { isDemo, setDemo } from './lib/forgefx'
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
  getScene,
  setScene,
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
import { aiUrl } from './lib/ai'
import { saveCloudPreset, cloudReady, listCloudPresets } from './lib/cloudPresets'
import Tour, { tourSeen, markTourSeen } from './components/Tour'
import Recent from './components/Recent'
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
  setMacRemote,
  signOutHere,
  faultCopy
} from './lib/link'
import { pushEntry, replaceEntry } from './lib/nav'
import { useAsks } from './lib/asks'
import { useDismiss } from './lib/dismiss'
import { validateSpec, countWrites, countSceneWrites } from './lib/validate'
import { beatFlash, bringIntoView } from './lib/feedback'
import {
  remoteActive,
  remoteHostSeen,
  hostResponds,
  loadRemoteConfig,
  subscribeRemoteState
} from './lib/remote'
import { newEntry, append } from './lib/log'
import { EXCLUDED_BLOCKS } from './lib/guardrails'


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
const ofBpm = (s) => s.bpm
const ofTunerOn = (s) => s.tunerOn
const ofTuning = (s) => s.tuning

const PREVIEW_ABOVE = 4

/**
 * What a remote session cannot do.
 *
 * ForgeFX's allowlist stops at live performance edits — anything that
 * permanently overwrites is local-only. Mirroring the list here is what lets the
 * app explain itself instead of relaying a 403.
 */
const REMOTE_BLOCKED_KINDS = new Set(['savePreset', 'backupPreset', 'keepInLibrary'])

/**
 * Kinds that leave the preset holding unsaved changes.
 *
 * Narrower than HAND_EDIT_KINDS: loading a preset or writing to the library
 * tells the assistant something useful but doesn't make the edit buffer dirty.
 */
const UNSAVES_PRESET = new Set(['edit', 'grid', 'scene', 'cab', 'modifier', 'tempo'])

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

export default function App() {
  const [status, setStatus] = useState('idle')
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
  const [error, setError] = useState(null)
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

  const [result, setResult] = useState(null)
  /*
   * Whether to write the scene plan too. Off by default: it is the one part of
   * a generation that walks the unit through every scene, and someone who
   * asked for a sound has not asked for their scene layout to be rearranged.
   */
  const [withScenes, setWithScenes] = useState(false)
  /*
   * Whether to put the generated name on the preset itself.
   *
   * Naming the scenes and naming the preset are two different decisions, and
   * the app used to make them together: every generation renamed the slot,
   * whatever it was already called. Someone laying a set of scenes into a
   * preset they have already named does not want it renamed underneath them.
   */
  const [renamePreset, setRenamePreset] = useState(true)
  /*
   * A build waiting on one question. A preset where no scene has a name has
   * nothing to lose, so this is the moment to ask whether they want one sound
   * or a set of them — before the model runs, rather than after, when the
   * answer would cost a second generation.
   */
  const [sceneAsk, setSceneAsk] = useState(null)
  const [progress, setProgress] = useState(null)
  const [applied, setApplied] = useState(null)
  const [slot, setSlot] = useState('')
  const [saveName, setSaveName] = useState('')
  // A failed save is shown on the save bar as well as in the banner — the bar is
  // where the tap happened, and on a phone the banner is off-screen above it.
  const [saveError, setSaveError] = useState(null)
  const [log, setLog] = useState([])
  const [spend, setSpend] = useState({ total: 0, runs: 0 })
  const [lastPrompt, setLastPrompt] = useState('')
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
  const [cloudSaves, setCloudSaves] = useState([])
  const [tasteOn, setTasteOn] = useState(() => tasteEnabled())
  const [tour, setTour] = useState(false)

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
   * Everything generated on this account, from both stores, newest first.
   *
   * One list feeding two things: what Create shows under the box, and what
   * the taste profile is read from. Deliberately the same list — a profile
   * built from presets the player cannot see is a profile they cannot check,
   * and the dedupe matters to both for the same reason.
   */
  const library = useMemo(
    () => newestFirst(listPresets(), cloudSaves, folderSaves),
    [historyKey, cloudSaves, folderSaves]
  )

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

  const taste = useMemo(
    () => (tasteOn ? profileFrom(library) : null),
    [library, tasteOn]
  )
  /*
   * The habits behind the values this player fixes by hand.
   *
   * Re-read on a counter rather than on every render, because it comes out of
   * localStorage and the only things that change it are a correction being
   * recorded and the player forgetting them all — both of which bump the
   * counter. Same shape as taste: computed from the record, never stored, so
   * forgetting the record genuinely un-learns it.
   */
  const [correctionKey, setCorrectionKey] = useState(0)
  const corrections = useMemo(
    () => (tasteOn ? patternsFrom(listCorrections()) : null),
    [tasteOn, correctionKey]
  )
  const [turns, setTurns] = useState([])
  const [remote, setRemote] = useState(false)
  // A slot write asked for from the phone: what it's waiting on there, and
  // what has arrived here.
  const [queuedSave, setQueuedSave] = useState(null)
  const [askedSave, setAskedSave] = useState(null)
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
  const atTheMac = link.role === 'mac'
  const [signIn, setSignIn] = useState(false)
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
          secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
        })
      : null
  // Where "Leave gig" returns to. Gig takes the screen over, so coming back out
  // should land where you were rather than at a fixed default.
  const [runningPlan, setRunningPlan] = useState(false)
  const [partial, setPartial] = useState(null)
  const [liveOpen, setLiveOpen] = useState(false)
  const [thinking, setThinking] = useState(false)
  // The live request, and when it started — what Stop acts on and what the
  // elapsed clock counts from.
  const generationAbort = useRef(null)
  const [genStarted, setGenStarted] = useState(null)
  /*
   * Where the design sits in the conversation.
   *
   * How many turns had been said when this generation began, so the chat can
   * put the design there rather than always last. See Assistant.jsx.
   */
  const [genAt, setGenAt] = useState(null)

  // Anything written but not stored lives only in the edit buffer. Tracking it
  // is what lets the app say "this is not saved yet" instead of leaving someone
  // to wonder whether they just overwrote a preset.
  const [dirty, setDirty] = useState(false)
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
   */
  const [savedHere, setSavedHere] = useState(false)
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
  const sceneCount = device?.capabilities?.sceneCount || 8
  // Which channels a block can be put on. A scene remembers one per block, so
  // a generated scene plan can name them and this is what a name is checked
  // against.
  const channelNames = device?.capabilities?.channelNames || ['A', 'B', 'C', 'D']
  const bpm = useDevice(ofBpm)
  // One tempo read per burst of taps, not one per tap.
  const tapReadback = useRef(null)
  const tunerOn = useDevice(ofTunerOn)
  const tuning = useDevice(ofTuning)

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
      setError(err.message)
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
  useEffect(() => {
    liveRef.current = status === 'live'
  }, [status])

  const read = useCallback(async () => {
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
        setStatus('fault')
        return null
      }
      /*
       * A no from a unit that was answering a moment ago is confirmed before
       * it is believed. Next tells the unit to load a preset and reads back
       * immediately; on real hardware that read lands while the unit is still
       * busy, and the answer is "no unit". See confirmedDetect.
       */
      const info = await confirmedDetect({
        detect,
        wait: (ms) => new Promise((go) => setTimeout(go, ms)),
        wasLive: liveRef.current
      })
      setDevice(info)
      if (!info?.connected) {
        setStatus('fault')
        setError('Your Mac is connected, but no Fractal is plugged into it.')
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
      const list = Array.isArray(b) ? b : []
      setBlocks(list)
      setStatus('live')
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
      if (answered && liveRef.current) setError(err.message)
      else {
        setStatus('fault')
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
    return fresh
  }, [])

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
    try {
      // A phone asks its Mac again; the loop in link.js does the rest.
      if (linkState().role === 'remote') pokeLink()
    } catch {
      // Best-effort; the read is what decides the verdict.
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
  const linkAction = useCallback(
    async (kind) => {
      setError(null)
      try {
        if (kind === 'connect') {
          if (linkState().account) await reconnectPhone()
          else setSignIn(true)
        } else if (kind === 'retry') {
          pokeLink()
          await reconnectPhone()
        } else if (kind === 'disconnect') {
          await disconnectPhone()
          record('remote', 'Disconnected from the Mac')
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
      if (linkState().role === 'mac') {
        await setUpMac({ email, password })
        record('remote', `Phone remote set up for ${email}`)
      } else {
        await connectPhone({ email, password })
        record('remote', `Connected to the Mac as ${email}`)
      }
      setSignIn(false)
    },
    [record]
  )

  /** Do at the Mac what the phone asked for, and say so at both ends. */
  const carryOutSave = useCallback(
    async (req) => {
      /*
       * First, before anything is awaited and before the notice comes down.
       *
       * Clearing askedSave re-runs the effect that watches for parked saves,
       * which looks again immediately — while this is still part-way through
       * and the request is still parked on the host. Without this it finds it
       * and carries it out a second time.
       */
      markHandled(req?.id)
      setBusy(true)
      setAskedSave(null)
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
        forgetPresetName(req.slot)
        setSlots((prev) => prev.filter((s) => s.number !== req.slot))
        await clearParkedSave()
        // The phone is watching for this; without it, "asked" never becomes
        // "done" over there and the only honest thing it could say is nothing.
        await reportSave({ id: req.id, ok: true, slot: req.slot })
        setDirty(false)
        setSavedHere(true)
        record('save', `Saved "${name || preset?.name}" to slot ${req.slot}, asked for from the phone`)
        await read()
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
    [preset?.name, read, record, device?.capabilities, markHandled]
  )

  /*
   * At the Mac: anything the phone has asked for.
   *
   * Applied without ceremony when it is plainly the thing that is loaded — that
   * is someone saving the tone they have been editing, and a confirmation step
   * at a machine they are not standing at helps nobody. When the unit has moved
   * on since the request, it asks: storing the wrong buffer under someone's
   * name is not a mistake to make on their behalf.
   */
  useEffect(() => {
    if (status !== 'live' || remote || isDemo()) return
    let stop = false
    const look = async () => {
      const req = await takeParkedSave()
      if (stop || !req?.id || !Number.isInteger(req.slot)) return
      // Already on screen, or already answered — either way, not news.
      if (askedSave?.id === req.id || handledSaves.current.includes(req.id)) return
      const fresh = Date.now() - (req.at || 0) < 15 * 60 * 1000
      const sameBuffer = req.fromSlot == null || req.fromSlot === preset?.number
      if (fresh && sameBuffer) await carryOutSave(req)
      /*
       * Which of the two it is, decided here and carried with the request.
       *
       * The notice used to say "the unit has moved since it asked" whatever
       * the reason was, so a request held up purely by age announced itself
       * as "it was on 99 and is on 99 now" — a sentence that disproves itself
       * in front of the person reading it.
       */
      else setAskedSave({ ...req, why: sameBuffer ? 'stale' : 'moved' })
    }
    look()
    const timer = setInterval(look, 6000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [status, remote, preset?.number, carryOutSave, askedSave?.id])

  /* On the phone: what became of it. */
  useEffect(() => {
    if (!queuedSave) return
    let stop = false
    const timer = setInterval(async () => {
      const res = await readSaveResult()
      if (stop || res?.id !== queuedSave.id) return
      setQueuedSave(null)
      if (res.ok) {
        setDirty(false)
        setSavedHere(true)
        record('save', `The Mac saved it to slot ${res.slot}`)
        read()
      } else {
        setSaveError(res.error || 'The Mac could not save it.')
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
  useEffect(() => {
    replaceEntry({ view: viewRef.current })
    const onPop = (e) => {
      const st = e.state
      if (!st || st.sheet || typeof st.view !== 'string') return
      if (st.view === viewRef.current) return
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
    if (showConnect && status === 'live') setStatus('fault')
  }, [showConnect, status])

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

  /*
   * The account's presets, pulled in so the taste profile spans machines.
   *
   * The whole point of a profile is that it survives the move to a new Mac —
   * the loss that started this — so it cannot read only what this browser
   * happens to hold. Failure is silent on purpose: a profile is an
   * improvement to a generation, never a precondition for one, and someone
   * signed out or offline should notice nothing beyond slightly less
   * personal results.
   */
  useEffect(() => {
    if (!cloudReady()) {
      setCloudSaves([])
      return undefined
    }
    let live = true
    listCloudPresets()
      .then((rows) => {
        if (live) setCloudSaves(rows)
      })
      .catch(() => {})
    return () => {
      live = false
    }
    // The account is what there is to read presets from; historyKey covers a
    // preset saved here since the last read.
  }, [historyKey, link.account?.email])

  /*
   * The introduction, once, and only when there is something to introduce.
   *
   * Held until the app is live rather than shown on load. Before that the
   * screen is either scanning or explaining a connection that isn't working,
   * and a tour arriving over a real problem buries the one message that
   * mattered — and tours the player through screens they cannot reach.
   *
   * Marked seen on open rather than on finish. Someone who opens it, reads a
   * card and closes the tab has seen it; re-offering it next time treats
   * closing as an accident, and a tutorial that keeps coming back is the
   * thing everyone remembers hating.
   */
  useEffect(() => {
    if (status !== 'live' || tourSeen()) return
    markTourSeen()
    setTour(true)
  }, [status])

  /** One path to the model, so generate and refine can't drift apart. */
  const requestSpec = async (schema, description, previous, extra = {}) => {
    setPartial(null)
    // A new run replaces whatever the last failure was offering to repeat.
    setRetryAsk(null)
    setThinking(true)
    /*
     * A handle on the request while it runs, so Stop can actually stop it.
     * Without one the only way out of a stuck generation was reloading the
     * page, which also throws away the conversation.
     */
    const control = new AbortController()
    generationAbort.current = control
    setGenStarted(Date.now())
    setGenAt(turns.length)
    try {
      return await streamSpec(
        {
          description,
          device,
          blocks: schema,
          sceneNames,
          previous: previous || null,
          mode: previous ? 'refine' : 'design',
          // Only when someone has asked to see it — see lib/devtrace.js.
          trace: traceEnabled(),
          /*
           * Sent on a refine too. A refinement is a reaction to a tone the
           * player has just heard, so their habits are exactly the thing that
           * settles what "warmer" means to them in numbers.
           */
          taste: describeProfile(taste),
          /*
           * What this player fixes by hand after a generation.
           *
           * Kept apart from taste because it answers a different question.
           * Taste is what they choose; this is what the model keeps getting
           * wrong for them, which is the more useful of the two and was being
           * thrown away entirely.
           */
          corrections: tasteOn ? describeCorrections(corrections) : '',
          ...extra
        },
        {
          onPartial: setPartial,
          signal: control.signal,
          host: getHost(),
          /*
           * Say what is actually happening rather than what a timer guesses.
           * "Nearly there" was a scripted line that arrived 26 seconds in and
           * then stayed forever, saying the same thing whether the model was
           * one token from done or had died two minutes ago.
           */
          onEvent: (e) => {
            /*
             * Said to a guitarist waiting on their tone, not to whoever wrote
             * this. "Sent to the model — waiting for the first line" was every
             * word true and none of it anyone's business but mine: it names
             * machines a player has no reason to know about and describes a
             * milestone — the first line of the answer — that means nothing
             * from the outside.
             *
             * Each line still marks a real event, so none of it is a guess.
             * The exact names go to the generation log in Technical details,
             * which is where they belong and where they are still precise.
             */
            if (e.kind === 'request') setProgress('Sending your description…')
            // The far end answers before the AI is asked anything, so this
            // line changing at all means the round trip works — which is most
            // of what someone staring at a long wait wants to know, even if
            // they would never put it that way.
            /*
             * Which attempt this is, kept on screen.
             *
             * The retry announced itself and this line overwrote it a second
             * later, so two long waits read as one that never ended: "said
             * working on tone for over 3 minutes then just disappeared".
             */
            else if (e.kind === 'open')
              setProgress(e.attempt ? 'Second try — working on your tone…' : 'Working on your tone…')
            else if (e.kind === 'partial') {
              setProgress(
                e.blocks
                  ? `Building your chain — ${e.blocks} block${e.blocks === 1 ? '' : 's'} so far`
                  : 'Building your chain…'
              )
            } else if (e.kind === 'fallback') setProgress('Trying another way…')
            else if (e.kind === 'retrying') setProgress('No answer yet — asking again…')
          }
        }
      )
    } finally {
      generationAbort.current = null
      setGenStarted(null)
      setThinking(false)
      setProgress(null)
    }
  }

  /**
   * Nothing here is named yet, so nothing here can be overwritten.
   *
   * The signal is the scene names as the unit reports them. A preset somebody
   * has laid out has Rhythm and Lead on it; a blank slot has eight empty
   * strings. That is the difference between "build this over what is there"
   * and "there is nothing here yet — what do you want?"
   */
  const nothingLaidOut = () => !sceneNames.some((n) => (n || '').trim())

  const generate = async (description, against = null, opts = {}) => {
    /*
     * Ask once, before the model runs. Asking afterwards would mean paying for
     * a second generation to act on the answer.
     */
    if (opts.wantScenes === undefined && sceneCount > 1 && nothingLaidOut()) {
      setSceneAsk({ description, against })
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    setWithScenes(false)
    setRenamePreset(true)
    setApplied(null)
    try {
      setProgress('Reading what the unit has loaded...')
      const schema = await readSchema(
        against || blocks,
        (done, total, name) => setProgress(`Reading ${name} - ${done} of ${total}`),
        // Designing or rebuilding a whole preset starts from the unit, not from
        // what we last wrote to it.
        { force: true }
      )

      if (!schema.length) {
        throw new Error(
          'Nothing to design against — this preset has no editable blocks. Ask again and a chain will be built first.'
        )
      }

      setProgress(null)
      const spec = await requestSpec(schema, description, null, { wantScenes: opts.wantScenes })

      const validated = validateSpec(spec, schema, sceneCount, channelNames)
      validated.spec = spec
      validated.description = description
      /*
       * Carried up beside the result rather than left buried in the spec, so
       * the panel that explains a tone reads it from one place whether the
       * generation streamed or fell back. Absent unless someone asked for it.
       */
      if (spec?._trace) validated._trace = spec._trace
      setResult(validated)
      /*
       * Scenes are opt-in — unless they are the whole proposal. A plan that
       * changes no block and only lays out scenes would otherwise arrive with
       * its one useful half switched off and a button offering zero writes.
       */
      setWithScenes(
        validated.scenes.length > 0 && (opts.wantScenes === true || validated.changes.length === 0)
      )
      setLastPrompt(description)
      revealResult()

      setSaveName(validated.presetName || preset?.name?.trim() || '')

      const runCost = costOf(validated.usage, validated.usage?.model)
      if (runCost !== null) {
        setSpend((prev) => ({ total: prev.total + runCost, runs: prev.runs + 1 }))
      }
      record('generate', `Designed "${validated.presetName || 'untitled'}" from: ${description}`, [
        `${countWrites(validated.changes)} changes proposed`,
        ...validated.problems
      ])
    } catch (err) {
      // A run that failed leaves no half chain on screen beside its error.
      setPartial(null)
      setError(err.message)
      // Nothing reached the unit, so asking again is safe to offer.
      setRetryAsk({ description, against, opts })
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      // A verbatim copy of the slot as it stands, taken before the first write.
      // Revert covers unsaved edits; this covers changing your mind after
      // saving, which revert cannot reach.
      if (!safety && typeof preset?.number === 'number') {
        try {
          const dump = await backupPreset(preset.number)
          if (dump?.bytes?.length) {
            setSafety({ number: preset.number, name: preset.name, bytes: dump.bytes })
          }
        } catch {
          // Not every device exposes the dump path. Revert still works.
        }
      }

      const failures = await applyChanges(result.changes, (done, total, label) =>
        setProgress(`${done} of ${total} - ${label}`)
      )

      /*
       * Scenes go on after the rig, never with it.
       *
       * A scene records which blocks are on; it does not record what they sound
       * like, because parameters belong to the block (and to its channel). So
       * the models and values have to be in place before the states over them
       * mean anything — write them the other way round and every scene is a
       * pattern over a preset that has not been dialled yet.
       */
      const sceneFailures =
        withScenes && result.scenes?.length
          ? await applyScenes(result.scenes, (done, total, label) =>
              setProgress(`Scenes — ${done} of ${total} · ${label}`)
            )
          : []
      failures.push(...sceneFailures)

      // ForgeFX caches block parameters with no invalidation hook, so a read can
      // report a value the hardware doesn't hold. Check what actually stuck.
      setProgress('Checking what landed...')
      const mismatches = await verifyChanges(result.changes, (done, total, name) =>
        setProgress(`Verifying ${name} - ${done} of ${total}`)
      )

      // Name it now rather than at save. The name is part of the preset in the
      // edit buffer, so writing it here means the unit's screen shows what was
      // just built — which is also the quickest confirmation the write landed.
      const generatedName = (saveName || result.presetName || '').trim()
      // Renaming the preset is its own decision, made on the preview. Scene
      // names are written either way — they are part of the plan that was
      // agreed to, and they are what the footswitch shows.
      if (renamePreset && generatedName && generatedName !== preset?.name?.trim()) {
        try {
          const res = await setPresetName(generatedName)
          // The AM4 answers {ok:false} rather than erroring when it can't
          // resolve the stored location — a refusal wearing a success shape.
          if (res && res.ok === false) throw new Error('The unit refused the rename.')
        } catch (err) {
          /*
           * This used to be swallowed whole, and over a remote session it fails
           * EVERY time — ForgeFX's relay refuses renames by design — so every
           * generated preset silently kept its old name and the feature looked
           * broken. The name is part of what was generated: keep the intent in
           * the save options, where the save flow will write it, and say what
           * happened next to the button that will finish the job.
           */
          setSaveName(generatedName)
          /*
           * Park it on the host so it isn't lost. Renames are refused over the
           * relay by design, but writes to ForgeFX's document store are not —
           * the same crossing scene names already use. The app at the Mac picks
           * this up on its next read and writes it, so a preset designed from
           * the phone ends up named without anyone retyping it.
           */
          const parked =
            typeof preset?.number === 'number' &&
            (await parkPresetName(preset.number, generatedName).catch(() => false))
          setSaveError(
            err.remoteBlocked
              ? parked
                ? `Renaming happens at the Mac, so the unit still shows the old name. “${generatedName}” is waiting there — open this app on the Mac and it gets written automatically.`
                : `Renaming happens at the Mac, so the unit still shows the old name. “${generatedName}” is kept in the save options here — rename at the Mac to put it on the unit.`
              : `Couldn't write the name “${generatedName}” to the unit — it's kept in the save options and will be applied on save.`
          )
        }
      }

      const count = countWrites(result.changes)
      setApplied({ failures, count, mismatches })
      setDirty(true)

      // Saved after writing rather than on generation: a spec that was never
      // sent isn't a preset, it's a draft.
      if (result.spec) {
        const fields = {
          name: result.presetName || preset?.name || 'Untitled',
          description: result.description || lastPrompt,
          summary: result.summary,
          spec: result.spec,
          usage: result.usage,
          device: device?.name,
          blockNames: result.changes.map((c) => c.name)
        }
        /*
         * The folder is the home when one is chosen; this browser's storage is
         * the fallback, not a second copy. Writing both would show every design
         * twice on the Mac and leave the question "which one is real" — files
         * on disk are the answer, because backups reach them and browsers get
         * reinstalled.
         */
        const { savedFolder, writeDesignFile } = await import('./lib/localFolder')
        const folder = await savedFolder().catch(() => null)
        if (folder && !folder.needsPermission) {
          try {
            await writeDesignFile(folder, buildEntry(fields))
          } catch {
            savePreset(fields)
          }
        } else {
          savePreset(fields)
        }
        /*
         * And to the account, when signed in. Additive rather than instead:
         * the local copy is what makes this work with no account at all, and
         * the cloud copy is what makes a new machine not a fresh start. A
         * failure here must not lose the tone, so it is caught and reported
         * through the log rather than thrown into the middle of a write.
         */
        if (cloudReady()) {
          try {
            await saveCloudPreset(buildEntry(fields))
          } catch (err) {
            // The app talking about itself, not a hand on the unit.
            record('library', `Kept locally, but not to your account — ${err.message}`, [], true)
          }
        }
        setHistoryKey((k) => k + 1)
      }
      record(
        'write',
        `Wrote ${count} changes to ${preset?.name || 'the working preset'}`,
        [
          ...result.changes.flatMap((c) => [
            ...(c.typeName ? [`${c.name} model -> ${c.typeName}`] : []),
            ...c.params.map((p) => `${c.name} - ${p.name} ${p.from} -> ${p.to}${p.unit}`)
          ]),
          ...failures,
          ...mismatches.map((m) => `did not stick: ${m.block} ${m.param} wanted ${m.wanted}, reads ${m.got}`)
        ]
      )
      await read()
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

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
        setQueuedSave({ id, slot: number })
        record('save', `Asked the Mac to save "${saveName.trim() || preset?.name}" to slot ${number}`)
        return
      }

      // Name first: /preset/name writes the working buffer, and storePreset is
      // what makes it permanent. Doing it the other way round saves the old name.
      const name = saveName.trim()
      if (name && name !== preset?.name?.trim()) {
        await setPresetName(name)
      }
      await storePreset(number)
      // The list is holding that slot's old name, and it just stopped being true.
      forgetPresetName(number)
      setSlots((prev) => prev.filter((s) => s.number !== number))
      setApplied((prev) => ({ ...prev, savedTo: number }))
      record('save', `Saved "${name || preset?.name}" to slot ${number}`)
      setDirty(false)
      setSavedHere(true)
      await read()
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
      record('select', `Loaded slot ${number}`)
      setDirty(false)
      setSavedHere(false)
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
      await setPresetName(name)
      record('rename', `Renamed to "${name}"`, ['Not permanent until saved to a slot.'])
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
  const revealResult = () => {
    /*
     * Two scrolls, because the preview sits inside the assistant's own
     * scrollbox: moving the page to the panel doesn't help if the panel is
     * scrolled to an older turn, and scrolling the box doesn't help if the
     * panel is off screen. So the box goes to the top of the result — where
     * its name and the Send button are — and the page goes to the panel.
     *
     * Two frames, not one: recording the change adds a turn, and the log pins
     * itself to its newest turn on that commit. One frame lands before that
     * and gets overwritten, leaving the box showing the END of a long preview.
     */
    const run = () => {
      const preview = document.querySelector('.preview')
      const log = document.querySelector('.assistant-log')
      if (log && preview) {
        log.scrollTop = Math.max(0, preview.offsetTop - log.offsetTop - 8)
      }
      bringIntoView(document.querySelector('.assistant'), { block: 'start' })
    }
    requestAnimationFrame(() => requestAnimationFrame(run))
  }

  const reload = async (entry) => {
    setBusy(true)
    setError(null)
    setApplied(null)
    try {
      setProgress('Reading what the unit has loaded...')
      const schema = await readSchema(
        blocks,
        (done, total, name) => setProgress(`Reading ${name} - ${done} of ${total}`),
        // Designing or rebuilding a whole preset starts from the unit, not from
        // what we last wrote to it.
        { force: true }
      )

      const validated = validateSpec(entry.spec, schema, sceneCount, channelNames)
      validated.spec = entry.spec
      validated.description = entry.description
      if (!validated.presetName) validated.presetName = entry.name

      setResult(validated)
      setSaveName(validated.presetName || entry.name)
      revealResult()
      record('reload', `Loaded saved preset "${entry.name}"`, [
        `${countWrites(validated.changes)} changes proposed`,
        ...validated.problems
      ])
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  /**
   * Adjust the tone that's currently proposed or written.
   *
   * Sends the previous spec as the subject rather than a fresh brief, so the
   * model moves one thing instead of redesigning around a new sentence.
   */
  const refine = async (instruction, against = null) => {
    const previous = result?.spec
    if (!previous) return

    /*
     * What they say when a first attempt is wrong.
     *
     * Every refinement is the model being told, in the player's own words,
     * what it should have done in the first place. Said three times, "darker"
     * stops being a correction and becomes an instruction for the next first
     * attempt — which is the whole point of collecting it.
     */
    if (tasteOn && rememberNote(instruction)) setCorrectionKey((n) => n + 1)

    setBusy(true)
    setError(null)
    try {
      setProgress('Reading what the unit has loaded...')
      const schema = await readSchema(
        against || blocks,
        (done, total, name) => setProgress(`Reading ${name} - ${done} of ${total}`),
        // Designing or rebuilding a whole preset starts from the unit, not from
        // what we last wrote to it.
        { force: true }
      )

      if (!schema.length) {
        // The generic server refusal for an empty schema reads like a device
        // fault. This is not one: the preset simply has nothing editable to
        // adjust, and saying so keeps the person off a debugging goose chase.
        throw new Error(
          'Nothing here to refine — this preset has no editable blocks. Ask for a tone and a chain will be built first.'
        )
      }

      setProgress(null)
      const spec = await requestSpec(schema, instruction, previous)

      const validated = validateSpec(spec, schema, sceneCount, channelNames)
      validated.spec = spec
      validated.description = instruction
      setResult(validated)
      setApplied(null)
      setSaveName(validated.presetName || preset?.name?.trim() || '')
      revealResult()

      const runCost = costOf(validated.usage, validated.usage?.model)
      if (runCost !== null) setSpend((p) => ({ total: p.total + runCost, runs: p.runs + 1 }))

      record('refine', `Adjusted: ${instruction}`, [
        `${countWrites(validated.changes)} changes proposed`,
        ...validated.problems
      ])
    } catch (err) {
      // A run that failed leaves no half chain on screen beside its error.
      setPartial(null)
      setError(err.message)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

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
      setSavedHere(false)
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
  const askFor = async (instruction) => {
    setBusy(true)
    setError(null)
    setTurns((prev) => [...prev, { role: 'user', text: instruction }])

    // Parameters are cached between turns, which is what makes conversation
    // quick. The cache cannot see a knob turned on the unit itself, so asking
    // for a re-read is sayable rather than something only a hidden button does.
    const wantsFresh = /\b(re-?read|refresh|reload|check again|what changed)\b/i.test(instruction)

    try {
      setProgress('Reading the preset...')
      const schema = await readSchema(
        blocks,
        (done, total, name) => setProgress(`Reading ${name} - ${done} of ${total}`),
        { force: wantsFresh }
      )

      // Grid positions come from the placed-block list, not the schema, since
      // the schema drops blocks the generator must not touch.
      const withPositions = schema.map((entry) => {
        const placed = blocks.find((b) => b.effectId === entry.eid)
        return { ...entry, row: placed?.row, col: placed?.col }
      })

      setProgress('Working out what that means...')
      // The placeable palette rides along so "add a reverb" is sayable: the
      // model can only speak in names it has been shown, and type codes differ
      // per unit. Cached per device inside blockCatalog's own layer.
      let palette = []
      try {
        const cat = await blockCatalog()
        palette = (Array.isArray(cat) ? cat : cat?.blocks || []).map((b) => ({
          slug: b.slug,
          name: b.name
        }))
      } catch {
        // A unit that won't list its palette just can't be added to by name.
      }

      const res = await fetch(aiUrl('/api/command', getHost()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          device,
          grid: { ...(device?.capabilities?.grid || {}), palette },
          blocks: withPositions,
          scene,
          sceneNames,
          sceneCount: device?.capabilities?.sceneCount,
          presetName: preset?.name,
          presetNumber: preset?.number,
          history: turns.map((t) =>
            t.role === 'hand'
              ? { role: 'user', text: `(I did this by hand: ${t.text})` }
              : { role: t.role, text: t.text }
          )
        })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'That request failed.')

      /*
       * A tone description is not a list of changes. It gets designed and shown
       * before anything is written — describing a sound and having the unit
       * silently become something else is the opposite of useful.
       */
      const design = (body?.actions || []).find((a) => a.kind === 'designTone')
      if (design) {
        setTurns((prev) => [
          ...prev,
          {
            role: 'assistant',
            text:
              body.understood ||
              'Designing that — I\u2019ll show you the whole thing before anything is written.'
          }
        ])
        // No view to switch to — the design appears in this conversation.
        let builtBlocks = null

        /*
         * An empty slot used to be a dead end: design refused and told you to go
         * place blocks yourself, which meant leaving the conversation to get out
         * of it. Ask for a tone on an empty preset and the chain gets built
         * first, because that is plainly what you meant.
         */
        /*
         * Empty means nothing you can edit — not nothing at all.
         *
         * An empty AM4 slot still reports its input and output rows, so the
         * raw count said "two blocks", the chain build was skipped as
         * unnecessary, and the schema then filtered those two rows out and
         * sent the generator nothing. Both hardware failures so far were this
         * one gap wearing different errors.
         */
        const editableBlocks = blocks.filter((b) => !EXCLUDED_BLOCKS.includes(b.slug))
        if (editableBlocks.length === 0) {
          /*
           * A verbatim copy of the slot before the first structural write.
           *
           * "Empty" is this app's own read, and this is the one path that
           * changes what blocks exist. If that read were ever wrong — and AM4
           * placement is the least hardware-proven part of the stack — these
           * writes would land on someone's real preset. The apply path has
           * taken this exact precaution all along; the build path just never
           * did, and it's the riskier of the two.
           */
          if (!safety && typeof preset?.number === 'number') {
            try {
              const dump = await backupPreset(preset.number)
              if (dump?.bytes?.length) {
                setSafety({ number: preset.number, name: preset.name, bytes: dump.bytes })
              }
            } catch {
              // Not every device exposes the dump path; the unsaved buffer can
              // still be discarded by reloading the preset.
            }
          }

          setTurns((prev) => [
            ...prev,
            { role: 'system', text: 'Empty slot — putting a chain in first.' }
          ])
          const built = validatePlan(
            { actions: [{ kind: 'buildChain', text: null, why: 'empty preset' }] },
            [],
            device?.capabilities
          )
          const failures = await runPlan(built.actions, (done, total, label) =>
            setProgress(`${done} of ${total} - ${label}`)
          )
          if (failures.length) {
            setError(failures.join(' · '))
            setTurns((prev) => [
              ...prev,
              { role: 'assistant', text: `Couldn't build a chain: ${failures.join(' · ')}` }
            ])
            return
          }
          // Design computes against what is on the grid, so it has to see it.
          // Taken from read's return rather than state, which hasn't caught up.
          // The app's own step inside a design, not a hand edit.
          record('grid', 'Built a chain into the empty slot', [], true)
          builtBlocks = (await read()) || []
          // The same raw-count trap as above: input and output rows would pass
          // this guard even if placement wrote nothing. Count what's editable.
          const landed = (builtBlocks || []).filter((b) => !EXCLUDED_BLOCKS.includes(b.slug))
          // Say what landed, ids included. When the generation then references
          // ids the preset doesn't hold, this line is the other half of the
          // diagnosis, already on screen.
          if (landed.length) {
            setTurns((prev) => [
              ...prev,
              {
                role: 'system',
                text: `Chain in: ${landed.map((b) => `${b.name || b.slug} (${b.effectId})`).join(', ')}`
              }
            ])
          }
          if (!landed.length) {
            setTurns((prev) => [
              ...prev,
              { role: 'assistant', text: 'The chain went in but the unit reports nothing on the grid.' }
            ])
            return
          }
        }

        // With a design already on screen and not yet written, adjust that spec
        // rather than starting over: "warmer" means warmer than the thing you
        // are looking at, and redesigning from scratch would throw away
        // everything else about it.
        /*
         * A chain that was just built has no history to refine. The lingering
         * spec that sent us to refine here belonged to whatever was loaded
         * before — including a failed attempt, which stores its spec too — and
         * refine reads its schema from state that hasn't caught up with the
         * build. That exact combination turned a successful chain build into
         * "No blocks were read from the device": the chain landed, then a
         * stale spec was refined against a stale empty schema, and the error
         * buried the success.
         */
        if (builtBlocks) {
          setResult(null)
          await generate(design.text || instruction, builtBlocks)
        } else if (result?.changes?.length) {
          // Refining means adjusting a design that produced something. A spec
          // whose every change was rejected is not a thing to build on.
          await refine(design.text || instruction)
        } else {
          await generate(design.text || instruction, builtBlocks)
        }
        return
      }

      const checked = validatePlan(body, withPositions, { ...(device?.capabilities || {}), activeScene: scene, sceneNames })
      record(
        'ask',
        `Asked: ${instruction}`,
        [checked.understood, `${checked.actions.length} actions proposed`, ...checked.problems],
        true
      )

      const reply = {
        role: 'assistant',
        text: checked.understood || checked.refused || 'Nothing to change.',
        actions: checked.actions,
        problems: checked.problems
      }

      /*
       * What runs on arrival and what waits.
       *
       * Setting a named control is a thing you asked for by name, so it just
       * happens — a confirmation click there is the ceremony that sends people
       * back to the knobs. Anything that can lose work waits. So does anything
       * broad: past a handful of changes you are no longer nudging a control,
       * you are reshaping the sound, and you should see that first.
       */
      /*
       * Some things the host refuses from a distance, deliberately: saving to a
       * slot, backups, the library. Say so before running anything rather than
       * letting the player watch a plan half-succeed and then throw a 403.
       */
      if (remote) {
        const blocked = checked.actions.filter((a) => REMOTE_BLOCKED_KINDS.has(a.kind))
        if (blocked.length) {
          setTurns((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: `${blocked
                .map((a) => a.label)
                .join(', ')} — that has to happen at the Mac. A phone can't overwrite a preset, which is the right call mid-set.`
            }
          ])
          return
        }
      }

      const broad = checked.actions.length > PREVIEW_ABOVE
      if (checked.actions.some((a) => a.destructive) || broad) {
        setTurns((prev) => [
          ...prev,
          {
            ...reply,
            pending: true,
            reason: broad && !checked.actions.some((a) => a.destructive) ? 'broad' : null
          }
        ])
        return
      }

      setTurns((prev) => [...prev, reply])
      if (checked.actions.length) await perform(checked.actions)
    } catch (err) {
      setError(err.message)
      setTurns((prev) => [...prev, { role: 'assistant', text: `That didn't work: ${err.message}` }])
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  /**
   * Run a checked list and report back into the conversation.
   *
   * Failures are attached to the turn that proposed them rather than only
   * raised as an error, so the transcript stays an honest record of what
   * actually reached the unit.
   */
  const perform = async (actions) => {
    setRunningPlan(true)
    try {
      const failures = await runPlan(actions, (done, total, label) =>
        setProgress(`${done} of ${total} - ${label}`)
      )
      record(
        'edit',
        `Did ${actions.length} things`,
        [...actions.map((a) => a.label), ...failures],
        true
      )
      if (failures.length) {
        setError(failures.join(' · '))
        setTurns((prev) => {
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant' && next[i].actions?.length) {
              next[i] = { ...next[i], failed: failures }
              break
            }
          }
          return next
        })
      }
      /*
       * Say what happened, in the conversation.
       *
       * Otherwise a request ends in silence and you have to go and look at a
       * panel to find out whether it worked — which is the same "the answer is
       * somewhere else" problem the design preview had.
       */
      if (!failures.length) {
        const done = actions.map((a) => a.label)
        setTurns((prev) => [
          ...prev,
          {
            role: 'system',
            text: done.length === 1 ? `Done — ${done[0]}.` : `Done — ${done.length} changes.`
          }
        ])
      }

      // Saving is what makes things permanent, so a plan containing one leaves
      // the preset clean rather than still flagged as unsaved.
      setDirty(!actions.some((a) => a.kind === 'savePreset'))
      showWhatChanged(actions)
      await read()
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      setRunningPlan(false)
    }
  }

  /**
   * Put the thing that just changed on screen.
   *
   * A change you asked for in words and can't see is worse than no change: you
   * are left checking the unit to find out whether it worked. So the view
   * follows the work, and the relevant section is scrolled to rather than left
   * somewhere below the fold.
   */
  const showWhatChanged = (actions) => {
    const kinds = new Set(actions.map((a) => a.kind))
    /*
     * Where the thing that changed now lives. Two of these are sheets rather
     * than screens, so "show me" opens the sheet instead of switching a tab —
     * and the anchor is inside it, which is why the scroll waits a frame for
     * it to exist. The class names are checked by a test: an anchor nothing
     * renders scrolls to nothing, silently, which is what `.local-library`
     * did for three releases.
     */
    const target = kinds.has('keepInLibrary')
      ? { sheet: 'presets', anchor: '.local-library' }
      : kinds.has('placeBlock') || kinds.has('clearCell') || kinds.has('moveBlock')
        ? { view: 'shape', anchor: '.grid-editor' }
        : kinds.has('setSceneBlock') || kinds.has('setScene')
          ? { sheet: 'scenes', anchor: '.scenes' }
          : kinds.has('setParam') || kinds.has('setModel') || kinds.has('setChannel')
            ? { view: 'shape', anchor: '.chain-strip' }
            : null
    if (!target) return
    if (target.view) setView(target.view)
    if (target.sheet) setSheet(target.sheet)
    // After the surface exists, not before — two frames, because a sheet
    // mounts closed for one so it has somewhere to animate from.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        bringIntoView(document.querySelector(target.anchor), { block: 'start' })
      })
    )
  }

  const confirmTurn = async (index) => {
    const turn = turns[index]
    if (!turn?.actions?.length) return
    setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, pending: false } : t)))
    setBusy(true)
    try {
      await perform(turn.actions)
    } finally {
      setBusy(false)
    }
  }

  const cancelTurn = (index) => {
    setTurns((prev) =>
      prev.map((t, i) =>
        i === index ? { ...t, pending: false, actions: [], text: `${t.text} — left alone.` } : t
      )
    )
  }

  const writeCount = result ? countWrites(result.changes) : 0
  const sceneWriteCount = result ? countSceneWrites(result.scenes) : 0

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
    // The loaded preset's name is one the unit has already told us. Its slot
    // read "—" in a list of 512 of them, the one name on screen missing.
    if (typeof preset?.number === 'number' && typeof preset?.name === 'string' && !byNumber.has(preset.number)) {
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
  const hasBrowserSaves = useMemo(() => listPresets().length > 0, [historyKey])

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
   * The conversation, built once and shown in two places.
   *
   * Create is its home and gives it the whole screen. Everywhere else it
   * arrives in a sheet from a button, because a tone you want to change is
   * usually one you are listening to right now — and walking off the screen
   * you are playing on to go and ask was the wrong shape.
   *
   * One element, rendered into whichever place is open, rather than two
   * call sites. The props here are numerous, and the failure mode of a
   * second copy is a conversation that behaves subtly differently depending
   * on how it was opened — which nobody would think to check.
   *
   * A button, never a pinned input. A fixed bar carrying a text field is the
   * configuration iOS Safari handles worst, Assistant.submit already carries
   * 30 lines of hard-won keyboard scroll-holding, and this app removed a
   * pinned bottom bar once already.
   */
  const chat = status === 'live' ? (
    <Assistant
      turns={turns}
      onAsk={askFor}
      onConfirm={confirmTurn}
      onCancel={cancelTurn}
      busy={busy || runningPlan}
      /* Not drawn there — Thinking below draws it. Passed so the transcript
         scrolls with each tick, which is the one thing Assistant needs it for. */
      progress={progress}
      at={genAt}
      suggestions={suggestionsFrom(taste)}
      onStop={
        genStarted
          ? () => {
              generationAbort.current?.abort()
              setTurns((prev) => [
                ...prev,
                { role: 'system', text: 'Stopped. Nothing was written to the unit.' }
              ])
            }
          : null
      }
    >
      {/* A design shows up in the conversation that asked for it. */}
      <Thinking message={progress} active={thinking} startedAt={genStarted} />

      <LiveGeneration
        partial={partial}
        open={liveOpen}
        onToggle={() => setLiveOpen(!liveOpen)}
      />

      <Preview
        result={result}
        writeCount={writeCount}
        sceneWriteCount={sceneWriteCount}
        withScenes={withScenes}
        onWithScenes={setWithScenes}
        scene={scene}
        sceneNames={sceneNames}
        sceneCount={sceneCount}
        renamePreset={renamePreset}
        onRenamePreset={setRenamePreset}
        presetNow={preset?.name}
        /* Choosing a scene switches to it rather than remembering it for
           later. Bypass is written into whatever scene is live, so making
           the choice real immediately is both simpler and honest — and you
           hear it, which is the confirmation that it took. */
        onScene={async (index) => {
          try {
            await writeScene(index)
          } catch (err) {
            setError(err.message)
          }
        }}
        busy={busy}
        onApply={apply}
        onDiscard={() => setResult(null)}
      >
        {/*
          What it cost, and why it came out the way it did.
          Both belong with the tone rather than beside it — and both belong
          behind the same fold as the rest of the detail, because a chat that
          answers a request with four stacked panels is the thing being fixed.
        */}
        <Cost usage={result?.usage} sessionTotal={spend.total} runs={spend.runs} />

        {result?._trace || result?.spec ? (
          <DevTrace trace={result._trace} spec={result.spec} problems={result.problems} />
        ) : null}
      </Preview>

      {/*
        What applying actually did, including anything that read back
        different from what was sent. This lived in the Design view; without
        it here, applying a design would finish in silence.
      */}
      {applied ? (
        <div className="notice">
          <h2>{applied.savedTo !== undefined ? 'Saved' : 'Written to the unit'}</h2>
          <p>
            {applied.count} changes sent.
            {applied.savedTo !== undefined
              ? ` Stored to slot ${applied.savedTo}.`
              : ' It\u2019s in the edit buffer \u2014 play it now. Nothing is permanent until you save it, and Revert puts the saved version back.'}
          </p>
          {applied.failures?.length
            ? applied.failures.map((f, i) => (
                <p key={i} className="mono problem">
                  {f}
                </p>
              ))
            : null}
          {applied.mismatches?.length ? (
            <>
              <p className="mono problem">
                {applied.mismatches.length} value
                {applied.mismatches.length > 1 ? 's' : ''} read back different from what was
                sent:
              </p>
              {/* Field by field. A mismatch is an object — {block, param,
                  wanted, got} — and rendering it bare took the whole page
                  down with React #31 the first time a value actually
                  failed to stick. */}
              {applied.mismatches.map((m, i) => (
                <p key={i} className="mono problem">
                  {`${m.block} ${m.param} — wanted ${m.wanted}, reads ${m.got ?? '—'}`}
                </p>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </Assistant>
  ) : null

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
        current={preset?.number}
        deviceSlots={device?.capabilities?.presets?.count}
        addressing={device?.capabilities?.presets?.addressing}
        scanning={scanning}
        progress={scanProgress}
        onStop={stopNames}
        onScan={scanPresets}
        onSelect={(n) => {
          jumpTo(n)
          setPresetMenu(false)
        }}
      />
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

  return (
    <div className="shell">
      {/* Above everything, because a stale tab makes every other thing on this
          screen a possible lie about what the code does. */}
      <UpdateNotice />

      {/*
        The Mac app's update, when one is downloaded and waiting. Renders
        nothing anywhere else — a phone has no updater to talk to.
      */}
      <UpdateReadyNotice />

      {/*
        Saving rides in the bar, and stays off the gig screen: that screen
        exists to switch sounds with a thumb in the dark, and a slot overwrite
        is not something to put within reach of a mis-tap mid-song. The bar
        still says "Unsaved" there, so the state survives even where the button
        doesn't follow it.
      */}
      <TopBar
        status={status}
        device={device}
        preset={preset}
        dirty={dirty}
        presetsOpen={presetMenu}
        onOpenPresets={() => setPresetMenu((v) => !v)}
        onOpenSettings={() => setSheet('settings')}
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
            savedHere={savedHere}
            preset={preset}
            dirty={dirty}
            busy={busy}
            saving={saving}
            compact
            queued={queuedSave}
            onOpenSave={() => setSheet('save')}
          />
        ) : null}
      </TopBar>

      {isDemo() && status === 'live' ? (
        <p className="demo-banner">
          Simulated FM3 &mdash; nothing here reaches hardware. Real models and parameter ranges,
          real write behaviour including the silent clamp.
        </p>
      ) : null}

      {/*
        A phone that is not connected is not broken; it has one thing to do.
        The connect screen says what and offers the button. It is also the
        screen while the Mac stops answering mid-set — after a ten-second
        grace, so a phone in a pocket losing a socket for a moment keeps the
        Play screen and gets it back without anyone noticing.
      */}
      {showConnect ? (
        <ConnectScreen
          key={tick}
          link={link}
          busy={busy}
          onConnect={() => linkAction('connect')}
          onRetry={() => linkAction('retry')}
          onSwitchAccount={() => linkAction('switch')}
          onDemo={() => {
            setDemo(true)
            window.location.reload()
          }}
        />
      ) : status === 'fault' && fault ? (
        <div className="notice" data-kind="fault">
          <h2>{fault.title}</h2>
          <p>{fault.body}</p>
          <p>
            <button className="chip" onClick={reconnect} disabled={busy}>
              Try again
            </button>{' '}
            <button
              className="chip"
              onClick={() => {
                setDemo(true)
                window.location.reload()
              }}
            >
              Try the demo
            </button>
          </p>
        </div>
      ) : null}

      {/*
        Errors are raised from every view, so the one place they're shown has to
        be outside all of them. This banner lived inside Design, which meant a
        failure anywhere else — a rejected sign-in, a refused write — set the
        message and rendered nothing. Silence read as "the button does nothing".
      */}
      {askedSave ? (
        <div className="notice" data-kind="fault">
          <h2>The phone asked to save</h2>
          <p>
            &ldquo;{askedSave.name || askedSave.fromName || 'Untitled'}&rdquo; to slot{' '}
            {askedSave.slot}.{' '}
            {askedSave.why === 'moved' ? (
              <>
                The unit has moved since it asked &mdash; it was on {askedSave.fromSlot ?? '--'} and
                is on {preset?.number ?? '--'} now &mdash; so saving would store what is loaded
                here, under that name.
              </>
            ) : (
              <>
                That was asked a while ago, and what is loaded here may not be what they meant any
                more &mdash; saving would store whatever is on the unit now, under that name.
              </>
            )}
          </p>
          <div className="history-actions">
            <button
              className="chip"
              onClick={() => carryOutSave(askedSave)}
              disabled={busy}
            >
              Save it anyway
            </button>
            <button
              className="chip"
              onClick={async () => {
                markHandled(askedSave.id)
                setAskedSave(null)
                await clearParkedSave().catch(() => {})
                await reportSave({
                  id: askedSave.id,
                  ok: false,
                  slot: askedSave.slot,
                  error: 'Left alone at the Mac — the unit had moved on.'
                }).catch(() => {})
              }}
            >
              Leave it
            </button>
          </div>
        </div>
      ) : null}

      {status === 'live' && error ? (
        <div className="notice" data-kind="fault" role="alert">
          <h2>Didn&rsquo;t work</h2>
          <p>{error}</p>
          <div className="history-actions">
            {/*
              Asking again, without typing it again.

              Offered only where the app knows nothing was written — a design
              run that failed — because that is the one case where repeating
              the request cannot do any harm. Three minutes of waiting used to
              end at a Dismiss button and a blank chat box.
            */}
            {retryAsk ? (
              <button
                className="chip"
                disabled={busy}
                onClick={() => {
                  const again = retryAsk
                  setRetryAsk(null)
                  setError(null)
                  generate(again.description, again.against, again.opts)
                }}
              >
                Try again
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

      {status === 'live' ? (
        <nav className="views" aria-label="Screens">
          {/* The ids are the app's own vocabulary and stay put — showWhatChanged
              and revealResult anchor to them. Only the words a player reads
              change: "Shape" and "Ask" described what the screen was to the
              person building it, not what you go there to do. */}
          {/* Create before Edit: you make a tone, then you adjust it, and the
              tabs now run in that order. */}
          {[
            ['play', 'Play'],
            ['ask', 'Create'],
            ['shape', 'Edit']
          ].map(([id, label]) => (
            <button
              key={id}
              className={`view-tab ${view === id ? 'current' : ''}`}
              onClick={() => setView(id)}
              aria-current={view === id}
            >
              {label}
            </button>
          ))}
          {/*
            Ask, as a tab, on a phone. The floating button below sat over the
            bottom-right corner — scene tile 6, the pad's Change, Edit's
            Modifiers — because that corner is where the last control in every
            grid lands. Up here nothing is under it. On Create the
            conversation is the screen, so the tab has nothing to open.
          */}
          <button
            className="view-tab ask-tab"
            onClick={() => setSheet('chat')}
            disabled={view === 'ask'}
            aria-label="Ask for a change"
          >
            <span aria-hidden="true">✦</span> Ask
          </button>
        </nav>
      ) : null}

      {/*
        A button, not a bar, on the two screens where the conversation is not
        already the screen. Create has it full height and does not need a way
        to open what is open.
      */}
      {status === 'live' && view !== 'ask' ? (
        <button
          className="ask-anywhere"
          onClick={() => setSheet('chat')}
          aria-label="Ask for a change"
        >
          <span aria-hidden="true">✦</span>
          <span className="ask-anywhere-word">Ask</span>
        </button>
      ) : null}

      {/*
        The three screens, one shown, swiped between on a phone. The wrapper
        takes nothing on touchstart — every control on every screen is inside
        it — and only claims a drag that has plainly gone sideways.
      */}
      <Screens view={view} enabled={status === 'live'} onChange={setView}>
      {status === 'live' && view === 'play' ? (
        <Gig
          preset={preset}
          device={device}
          capabilities={device?.capabilities}
          onError={setError}
          onChanged={read}
          onPickPreset={() => setPresetMenu(true)}
        />
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
            onSelect={(id) => {
              setSelectedBlock(id)
              setSheet('block')
            }}
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
                  <span className="scene-now-tag mono">S{scene + 1}</span>
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
              setSelectedBlock(eid)
              setSheet('block')
              setEditorFocus({ eid, paramId, nonce: Date.now() })
            }}
          />

          <Section key="chain" title="Chain" note="Add, remove and move blocks">
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

      {view === 'ask' ? chat : null}

      {/*
        What you have made, under the box you make it in — and only there.
        `chat` is one element rendered in two places, so this sits outside it:
        in the Ask sheet, which is for a quick change to the tone playing now,
        a library would be the longest thing in a surface that exists to be
        short.
      */}
      {status === 'live' && view === 'ask' ? (
        <Recent
          entries={library}
          busy={busy}
          onRestore={reload}
          onSeeAll={() => setSheet('presets')}
        />
      ) : null}
      </Screens>

      {/* ---------------------------------------------------------------
          Sheets. Things you open, act on and dismiss — not places you go.
          --------------------------------------------------------------- */}

      <Sheet
        open={sheet === 'block' && !!openBlock}
        onClose={() => setSheet(null)}
        title={openBlock?.name || 'Block'}
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
          onChanged={(summary, change) => {
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
            if (applied && change && tasteOn) {
              if (rememberCorrection(change)) setCorrectionKey((n) => n + 1)
            }
            setDirty(true)
            read()
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
      {/*
        The introduction. Rendered beside the sheets rather than among them
        because it is not one of the app's places: it opens itself, once, and
        the only way back to it is the button in Settings.
      */}
      <Tour open={tour} onClose={() => setTour(false)} />

      {/* The one sign-in, as a sheet: it pops up, you do the thing, it goes. */}
      <SignInSheet
        open={signIn}
        role={link.role}
        email={link.account?.email || loadRemoteConfig()?.email || ''}
        busy={busy}
        onClose={() => setSignIn(false)}
        onSubmit={signInSubmit}
      />

      <Sheet
        open={sheet === 'chat'}
        onClose={() => setSheet(null)}
        title="Ask"
        note={preset?.name?.trim() || null}
      >
        {sheet === 'chat' ? chat : null}
      </Sheet>

      <Sheet
        open={sheet === 'save'}
        onClose={() => setSheet(null)}
        title="Save"
        note={preset?.name?.trim() || null}
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
          current={preset?.number}
          deviceSlots={device?.capabilities?.presets?.count}
          addressing={device?.capabilities?.presets?.addressing}
          scanning={scanning}
          progress={scanProgress}
          onStop={stopNames}
          onScan={scanPresets}
          onSelect={(n) => {
            jumpTo(n)
            setSheet(null)
          }}
        />

        {/* Three places a design can live, and they are different things: the
            account follows you between machines, the folder survives a browser
            being reinstalled, and browser storage is the fallback that needs
            neither. Listed in that order because that is the order of how
            much they survive. */}
        <Section key="account-presets" title="Kept with your account" note="On any machine you sign in from">
          <CloudPresets onLoad={reload} onError={setError} busy={busy} />
        </Section>

        <Section key="saved-presets" title="Saved presets" note="Captures and designs, as files in a folder you choose">
          <LocalLibrary
            preset={preset}
            busy={busy}
            remote={remote}
            onError={setError}
            onReload={reload}
            onChanged={(summary) => record('library', summary)}
          />
        </Section>

        {/* Only when there is something in there. It holds real work, so it is
            kept — but an empty panel explaining browser storage to someone who
            never used it is a panel for nobody. */}
        {hasBrowserSaves ? (
          <Section key="older-saves" title="Older saves in this browser" note="Move these into the folder — files survive, browser storage doesn't">
            <History
              key={historyKey}
              onReload={reload}
              busy={busy}
              onError={setError}
              onMoved={() => setHistoryKey((k) => k + 1)}
            />
          </Section>
        ) : null}

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
            onError={setError}
            onChanged={(summary) => {
              record('version', summary)
              read()
            }}
          />
          <DeviceBackup
            busy={busy}
            onError={setError}
            onChanged={(summary) => record('backup', summary)}
          />
        </Section>
      </Sheet>

      {/*
        One question, asked once, on a preset with nothing laid out in it.

        The player's own question was what happens to the other scenes on a new
        empty preset. The honest answer depends on what they wanted, and the
        app never asked — it built one sound into whichever scene was live and
        left seven blank. Asking here costs one tap and saves a second
        generation, because the answer goes into the request rather than being
        applied to a reply that already exists.
      */}
      <Sheet
        open={!!sceneAsk}
        onClose={() => setSceneAsk(null)}
        title="One sound, or a set?"
        note="Nothing in this preset is named yet"
      >
        <div className="scene-ask">
          <p className="hint">
            This preset has no scenes set up, so there is nothing here to write over. What are you
            building?
          </p>
          <button
            className="primary"
            onClick={() => {
              const ask = sceneAsk
              setSceneAsk(null)
              generate(ask.description, ask.against, { wantScenes: false })
            }}
          >
            One sound
            <span className="hint">Goes into the scene you are in. The rest stay empty.</span>
          </button>
          <button
            onClick={() => {
              const ask = sceneAsk
              setSceneAsk(null)
              generate(ask.description, ask.against, { wantScenes: true })
            }}
          >
            A set of scenes
            <span className="hint">
              Three or four named sounds off one rig, switched by footswitch.
            </span>
          </button>
        </div>
      </Sheet>

      <Sheet
        open={sheet === 'scenes'}
        onClose={() => setSheet(null)}
        title="Scenes"
      >
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

      <Sheet
        open={sheet === 'settings'}
        onClose={() => setSheet(null)}
        title="Setup"
        note={device?.short || device?.name || null}
      >
        {/* `reconnect`, not `read`: a plain re-read is what the old Reconnect
            button did, and it is why refreshing the page was the only thing
            that worked when a relay went quiet. This one drops a dead relay
            and rejoins the session before it reads. */}
        <DeviceDetail status={status} device={device} onRetry={reconnect} busy={busy} />

        <Section key="phone-remote" title="Phone remote" note={describeLink(link).note}>
          {/*
            One panel for both ends. It says which end this is, whether the
            other end answers, and offers the one thing that state calls for.
            The four panels it replaces — each written for the person who built
            the app — are gone, and the words they used with them.
          */}
          <PhoneRemote link={link} onAction={linkAction} onError={setError} busy={busy} />
        </Section>

        <Section key="developer" title="Developer" note="See what the AI was given">
          <TraceSwitch />
        </Section>

        <Section key="feedback" title="Tell us" note="Something broken, or something you want">
          {/*
            Where a person looks when the app has annoyed them: settings,
            before the technical panels rather than buried under them. It needs
            no account, because most people driving a unit from their own Mac
            never sign in and are exactly the ones who find the bugs.
          */}
          <Feedback device={device} link={link} platform={platform()} />
        </Section>

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

        {/*
          Only in the Mac app: Updates renders nothing without a bridge to the
          updater, and a section that is always empty everywhere else is worse
          than no section.
        */}
        {inDesktopApp() ? (
          <Section key="updates" title="Updates" note="This app, not your unit">
            <Updates />
          </Section>
        ) : null}

        {device?.capabilities?.fc?.model !== false ? (
          <Section key="footswitches" title="Footswitches">
            <Footswitches onError={setError} />
          </Section>
        ) : null}

        {/*
          The way back to the introduction.

          It shows itself once and then never again, which is right, but it
          leaves the four things it explains unreachable to anyone who skipped
          it on a day they were busy — or who has handed the app to a
          bandmate. This is the only route back, so it is a plain button
          rather than a link inside a paragraph.
        */}
        <Section key="how-this-works" title="How this works" note="A short introduction">
          <p className="hint">
            Four cards: what the three screens are for, how to ask for a sound, where a change
            actually goes, and what a scene is. It appears once the first time you connect.
          </p>
          <div className="history-actions">
            <button
              className="chip"
              onClick={() => {
                setSheet(null)
                setTour(true)
              }}
            >
              Show the introduction
            </button>
          </div>
        </Section>

        {/*
          What the app has worked out about you, and the switch to stop it.

          Anything inferred from someone's history has to be visible to them.
          Without this the first surprising generation has no explanation and
          no way to check one — and a profile you cannot see or refuse is the
          kind of thing that reads as the app knowing too much, however
          ordinary the arithmetic behind it turns out to be.
        */}
        <Section key="what-it-has-learned" title="What it has learned from you" note={taste ? `${taste.presets} presets` : 'Nothing yet'}>
          <p className="hint">{summariseProfile(taste)}</p>
          {/*
            Say what actually happens, including the part that is a
            disclosure. The summary above does travel — it goes to the model
            with every request, which is the whole mechanism — and writing
            "nothing leaves your device" here would have been a comfortable
            sentence that was not true. What is worth saying instead is that
            nothing is kept: no profile is stored, it is rebuilt from the
            presets each time, and deleting a preset genuinely un-learns it.
          */}
          <p className="hint">
            This summary &mdash; not your presets &mdash; is sent with each request, so a tone you
            ask for lands nearer what you usually choose. Nothing is trained and no profile is
            stored: it is worked out fresh from your own presets each time, so deleting one
            un-learns it and turning this off stops it being sent at all.
          </p>
          {taste ? (
            <ul className="cloud-list taste-list">
              {taste.models.length ? (
                <li className="hint">Models you pick: {taste.models.map((m) => m.name).join(', ')}</li>
              ) : null}
              {taste.controls.length ? (
                <li className="hint">
                  Where you land: {taste.controls.map((c) => `${c.name} ${c.typical}`).join(' · ')}
                </li>
              ) : null}
              {taste.words.length ? (
                <li className="hint">You ask for: {taste.words.map((w) => w.name).join(', ')}</li>
              ) : null}
            </ul>
          ) : null}
          {/*
            The other half, and the more useful one.

            What someone keeps says the whole tone was good enough. What they
            reach over and change says which part was wrong — and it comes with
            the number they actually wanted. That was being thrown away, so the
            same correction was needed again on the next generation and the one
            after. Shown separately from taste because it reads differently: it
            is a list of the app's own repeated misses, in this player's hands.
          */}
          <p className="silk-label">What you keep fixing afterwards</p>
          <p className="hint">{summariseCorrections(corrections)}</p>
          {corrections ? (
            <ul className="cloud-list taste-list">
              {corrections.controls.map((c) => (
                <li className="hint" key={c.name}>
                  {c.name}: you usually turn it {c.way} ({c.count} of {c.of} times, by about {c.by})
                </li>
              ))}
              {corrections.words.length ? (
                <li className="hint">
                  You often ask for: {corrections.words.map((w) => w.text).join(', ')}
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className="history-actions">
            <button
              className="chip"
              onClick={() => setTasteOn(setTasteEnabled(!tasteOn))}
              aria-pressed={tasteOn}
            >
              {tasteOn ? 'Stop using my history' : 'Use my history again'}
            </button>
            {corrections ? (
              <button
                className="chip"
                onClick={() => {
                  clearCorrections()
                  setCorrectionKey((n) => n + 1)
                }}
              >
                Forget what I keep fixing
              </button>
            ) : null}
          </div>
        </Section>

        <Section key="what-s-changed-this-session" title="What's changed this session">
          <ChangeLog log={log} onClear={() => setLog([])} />
        </Section>

        <Section key="technical-details" title="Technical details" note="For working out why something went wrong">
          <Diagnostics />
          <LinkDetails />

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
      </Sheet>

    </div>
  )
}

/**
 * The tempo readout you can type into.
 *
 * Tap gets you close; typing gets you exact. Shows "120 BPM" at rest; a tap
 * into it drops the unit and selects the number so typing replaces it. Enter
 * or tapping away commits, Escape abandons, and the device's own 20–400 range
 * is enforced here so an impossible tempo is refused with words rather than
 * silently clamped somewhere downstream.
 */
function BpmBox({ bpm, onSet, onError }) {
  const [text, setText] = useState(null)
  const abandon = useRef(false)

  const finish = () => {
    if (abandon.current) {
      abandon.current = false
      setText(null)
      return
    }
    if (text === null) return
    const n = Math.round(Number(text))
    setText(null)
    if (!Number.isFinite(n) || n === bpm || text.trim() === '') return
    if (n < 20 || n > 400) {
      onError(`${n} BPM is out of range — the unit takes 20 to 400.`)
      return
    }
    onSet(n)
  }

  return (
    <input
      className="bpm-box mono"
      type="text"
      inputMode="numeric"
      value={text !== null ? text : `${bpm} BPM`}
      onFocus={(e) => {
        setText(String(bpm))
        const el = e.target
        requestAnimationFrame(() => el.select())
      }}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          abandon.current = true
          e.currentTarget.blur()
        }
      }}
      aria-label="Tempo in BPM"
    />
  )
}
