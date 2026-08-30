import { useCallback, useEffect, useRef, useState } from 'react'
import DeviceBar from './components/DeviceBar'
import Grid from './components/Grid'
import { Preview } from './components/Generate'
import { PresetBar, ChangeLog, Thinking } from './components/PresetBar'
import Editor from './components/Editor'
import Diagnostics from './components/Diagnostics'
import Cost from './components/Cost'
import Scenes from './components/Scenes'
import History from './components/History'
import { CabPicker, Backup, Meters } from './components/Hardware'
import { Compare } from './components/Refine'
import Gig from './components/Gig'
import SaveBar from './components/SaveBar'
import { Stages, LiveGeneration } from './components/LiveGeneration'
import { streamSpec } from './lib/stream'
import { Modifiers, SceneMatrix, TempoTuner } from './components/Modifiers'
import { Versions, DeviceBackup } from './components/Versions'
import Footswitches from './components/Footswitches'
import GridEditor from './components/GridEditor'
import Ports from './components/Ports'
import LocalLibrary from './components/LocalLibrary'
import Remote from './components/Remote'
import Section from './components/Section'
import SectionStack from './components/SectionStack'
import StatusLine from './components/StatusLine'
import ParamSearch from './components/ParamSearch'
import Host from './components/Host'
import Assistant from './components/Assistant'
import Theme from './components/Theme'
import UpdateNotice from './components/UpdateNotice'
import { validatePlan, runPlan } from './lib/actions'
import { timeLeft } from './lib/slots'
import { Chain, PresetList, BlockPanel, Tuner } from './components/Console'
import {
  getTempo,
  setTempo,
  tapTempo,
  setBypass,
  setTuner,
  subscribeEvents,
  scanAllPresets,
  cachedPresetNames,
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
  clearParkedPresetName
} from './lib/forgefx'
import { validateSpec, countWrites } from './lib/validate'
import { beatFlash } from './lib/feedback'
import { remoteActive } from './lib/remote'
import { newEntry, append } from './lib/log'
import { VERSION } from './lib/version'
import { EXCLUDED_BLOCKS } from './lib/guardrails'

import { blockCatalog } from './lib/forgefx'

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
const PREVIEW_ABOVE = 4

/**
 * Whether this is plainly not the machine with the cable in it.
 *
 * Only used to choose which advice to give on the no-connection screen, so a
 * rough answer is the right kind: coarse enough not to matter when it's wrong,
 * and it spares someone on a phone a paragraph about npm.
 */
const onAnotherDevice =
  typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent)))

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
  const [preset, setPreset] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const [result, setResult] = useState(null)
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
  const [historyKey, setHistoryKey] = useState(0)
  const [compare, setCompare] = useState(null)
  const [turns, setTurns] = useState([])
  const [remote, setRemote] = useState(false)
  // Where "Leave gig" returns to. Gig takes the screen over, so coming back out
  // should land where you were rather than at a fixed default.
  const [lastView, setLastView] = useState('console')
  const [runningPlan, setRunningPlan] = useState(false)
  const [catalog, setCatalog] = useState(null)
  const [partial, setPartial] = useState(null)
  const [liveOpen, setLiveOpen] = useState(false)
  const [thinking, setThinking] = useState(false)
  // The live request, and when it started — what Stop acts on and what the
  // elapsed clock counts from.
  const generationAbort = useRef(null)
  const [genStarted, setGenStarted] = useState(null)

  // Anything written but not stored lives only in the edit buffer. Tracking it
  // is what lets the app say "this is not saved yet" instead of leaving someone
  // to wonder whether they just overwrote a preset.
  const [dirty, setDirty] = useState(false)
  const [safety, setSafety] = useState(null)

  // Fifteen stacked sections was a long scroll with the important things buried.
  // Grouped by what you're doing rather than by which endpoint it calls.
  const [view, setView] = useState('console')
  const [selectedBlock, setSelectedBlock] = useState(null)
  const [slots, setSlots] = useState([])
  const [scanning, setScanning] = useState(false)
  const [scene, setSceneIdx] = useState(0)
  const [sceneNames, setSceneNames] = useState([])
  const [bpm, setBpm] = useState(null)
  // One tempo read per burst of taps, not one per tap.
  const tapReadback = useRef(null)
  const [tunerOn, setTunerOn] = useState(false)
  const [tuning, setTuning] = useState(null)
  const [editorFocus, setEditorFocus] = useState(null)
  const [scanProgress, setScanProgress] = useState(null)
  const stopScan = useRef(false)

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
    setTurns((prev) => [...prev, { role: 'system', text: summary }])
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
    const flip = (to) =>
      setBlocks((prev) =>
        prev.map((b) => (b.effectId === block.effectId ? { ...b, bypassed: to } : b))
      )
    flip(wanted)
    try {
      await setBypass(block.effectId, wanted)
      record('edit', `${block.name || block.slug} ${wanted ? 'bypassed' : 'engaged'}`)
    } catch (err) {
      flip(!wanted)
      setError(err.message)
    }
  }

  const read = useCallback(async () => {
    setBusy(true)
    setError(null)
    let fresh = null
    try {
      const info = await detect()
      setDevice(info)
      if (!info?.connected) {
        setStatus('fault')
        setError('ForgeFX answered, but no Fractal unit is attached to it.')
        return
      }
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
      // changes rather than on every refresh.
      getScene()
        .then((sc) => typeof sc?.index === 'number' && sc.index >= 0 && setSceneIdx(sc.index))
        .catch(() => {})

      if (typeof p?.number === 'number') {
        readSceneNames(p.number)
          .then((names) => setSceneNames(names))
          .catch(() => setSceneNames([]))

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

      getTempo()
        .then((t) => typeof t?.bpm === 'number' && setBpm(t.bpm))
        .catch(() => {})

      // Read off the attached unit rather than from committed data. An AM4
      // offers a different roster from an FM3 — 250 amp models against 331, one
      // instance per family — and showing the FM3's numbers while an AM4 is
      // plugged in would be stating something false about the thing in the room.
      blockCatalog()
        .then((res) => setCatalog(Array.isArray(res) ? res : null))
        .catch(() => setCatalog(null))
    } catch (err) {
      setStatus('fault')
      setError(err.message)
    } finally {
      setBusy(false)
    }
    return fresh
  }, [])

  useEffect(() => {
    read()
  }, [read])

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

  // The tuner pushes readings over SSE rather than answering requests, so the
  // subscription is what makes the button do anything visible.
  useEffect(() => {
    if (!tunerOn || status !== 'live') return
    const unsubscribe = subscribeEvents((event) => {
      if (event?.type === 'tuner' || event?.note !== undefined) setTuning(event)
      if (event?.type === 'tempo' && typeof event.bpm === 'number') setBpm(event.bpm)
    })
    return () => {
      unsubscribe()
      setTuning(null)
    }
  }, [tunerOn, status])

  /** One path to the model, so generate, refine and compare can't drift apart. */
  const requestSpec = async (schema, description, previous) => {
    setPartial(null)
    setThinking(true)
    /*
     * A handle on the request while it runs, so Stop can actually stop it.
     * Without one the only way out of a stuck generation was reloading the
     * page, which also throws away the conversation.
     */
    const control = new AbortController()
    generationAbort.current = control
    setGenStarted(Date.now())
    try {
      return await streamSpec(
        {
          description,
          device,
          blocks: schema,
          previous: previous || null,
          mode: previous ? 'refine' : 'design'
        },
        {
          onPartial: setPartial,
          signal: control.signal,
          /*
           * Say what is actually happening rather than what a timer guesses.
           * "Nearly there" was a scripted line that arrived 26 seconds in and
           * then stayed forever, saying the same thing whether the model was
           * one token from done or had died two minutes ago.
           */
          onEvent: (e) => {
            if (e.kind === 'request') setProgress('Sent to the model — waiting for the first line…')
            else if (e.kind === 'first-output') setProgress('The model is answering…')
            else if (e.kind === 'partial') {
              setProgress(
                e.blocks
                  ? `Building the preset — ${e.blocks} block${e.blocks === 1 ? '' : 's'} so far`
                  : 'Building the preset…'
              )
            } else if (e.kind === 'fallback') setProgress('Streaming refused — asking again in one piece…')
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

  const generate = async (description, against = null) => {
    setBusy(true)
    setError(null)
    setResult(null)
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
      const spec = await requestSpec(schema, description)

      const validated = validateSpec(spec, schema)
      validated.spec = spec
      validated.description = description
      setResult(validated)
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
      setError(err.message)
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
      if (generatedName && generatedName !== preset?.name?.trim()) {
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
                ? `ForgeFX won't rename over a remote session, so the unit still shows the old name. “${generatedName}” is waiting on the host — open this app at the Mac and it gets written automatically.`
                : `ForgeFX won't rename over a remote session, so the unit still shows the old name. “${generatedName}” is kept in the save options here — rename at the Mac to put it on the unit.`
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
    setBusy(true)
    setError(null)
    setSaveError(null)
    try {
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
      await read()
    } catch (err) {
      // Shown on the save bar itself as well as the banner. A refusal that
      // appears only at the top of a page you aren't looking at reads as a
      // button that did nothing.
      setSaveError(err.message)
      setError(err.message)
    } finally {
      setBusy(false)
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
      document.querySelector('.assistant')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

      const validated = validateSpec(entry.spec, schema)
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

      const validated = validateSpec(spec, schema)
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
      setError(err.message)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  /**
   * Build two takes and put them on channels A and B.
   *
   * Channel first, then the writes — parameter values belong to whichever
   * channel is active when they land, so switching after would write both
   * variants onto the same one.
   */
  const buildComparison = async (description) => {
    setBusy(true)
    setError(null)
    setCompare(null)
    try {
      setProgress('Reading what the unit has loaded...')
      const schema = await readSchema(
        blocks,
        (done, total, name) => setProgress(`Reading ${name} - ${done} of ${total}`),
        // Designing or rebuilding a whole preset starts from the unit, not from
        // what we last wrote to it.
        { force: true }
      )

      const withChannels = blocks.filter((b) => b.channel)
      const takes = []

      for (const [index, channel] of ['A', 'B'].entries()) {
        setProgress(`Take ${index + 1} of 2 — designing...`)
        const spec = await requestSpec(schema, description)
        const validated = validateSpec(spec, schema)

        setProgress(`Take ${index + 1} of 2 — switching to channel ${channel}...`)
        for (const block of withChannels) await setChannel(block.effectId, channel)

        setProgress(`Take ${index + 1} of 2 — writing to channel ${channel}...`)
        await applyChanges(validated.changes, (done, total, label) =>
          setProgress(`Take ${index + 1} · ${done} of ${total} - ${label}`)
        )

        takes.push(validated.summary || validated.presetName || `Take ${index + 1}`)

        const runCost = costOf(validated.usage, validated.usage?.model)
        if (runCost !== null) setSpend((p) => ({ total: p.total + runCost, runs: p.runs + 1 }))
      }

      await setScene(0)
      setCompare({ done: true, a: takes[0], b: takes[1] })
      record('compare', `Built two takes of "${description}" on channels A and B`, takes)
      await read()
    } catch (err) {
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

      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          device,
          grid: { ...(device?.capabilities?.grid || {}), palette },
          blocks: withPositions,
          scene,
          presetName: preset?.name,
          presetNumber: preset?.number,
          history: turns.map((t) =>
            t.role === 'system'
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
          record('grid', 'Built a chain into the empty slot')
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

      const checked = validatePlan(body, withPositions, device?.capabilities)
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
                .join(', ')} — that has to happen at the Mac. ForgeFX won't let a remote session overwrite a preset, which is the right call mid-set.`
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
    const target = kinds.has('keepInLibrary')
      ? { view: 'library', anchor: '.local-library' }
      : kinds.has('placeBlock') || kinds.has('clearCell') || kinds.has('moveBlock')
        ? { view: 'edit', anchor: '.grid-editor' }
        : kinds.has('setSceneBlock') || kinds.has('setScene')
          ? { view: 'edit', anchor: '.scenes' }
          : kinds.has('setParam') || kinds.has('setModel') || kinds.has('setChannel')
            ? { view: 'edit', anchor: '.editor' }
            : null
    if (!target) return
    setView(target.view)
    // After the view swaps, not before — the element doesn't exist until then.
    requestAnimationFrame(() => {
      document.querySelector(target.anchor)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    })
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

  return (
    <div className="shell">
      {/* Above everything, because a stale tab makes every other thing on this
          screen a possible lie about what the code does. */}
      <UpdateNotice />

      <header className="masthead">
        <div>
          <h1 className="wordmark">
            Fractal <span>AI</span> Builder
          </h1>
          <p className="tagline">Describe a tone. Get a preset on the unit.</p>
        </div>
        <div className="mast-right">
          {/*
            Saving, top right — moved up from a bar pinned over the bottom of
            every screen. Absent in gig: that screen exists to switch sounds
            with a thumb in the dark, and a slot overwrite is not something to
            put within reach of a mis-tap mid-song. The StatusLine still says
            "Unsaved" on every screen, so the state survives the scroll even
            though the button doesn't follow it.
          */}
          {status === 'live' && view !== 'gig' ? (
            <SaveBar
              preset={preset}
              dirty={dirty}
              busy={busy}
              saveName={saveName}
              onName={setSaveName}
              slot={slot}
              onSlot={setSlot}
              onSave={save}
              onRevert={revert}
              safety={safety}
              onRestoreSafety={restoreSafety}
              error={saveError}
              onDismissError={() => setSaveError(null)}
            />
          ) : null}

          {/*
            Version, build stamp and commit used to sit here, above everything.
            They are the first thing a guitarist saw and told them nothing; they
            matter only when something has gone wrong, which is where they now
            live — Library, Technical details. The theme toggle stays, because
            that is a thing you actually want to change.
          */}
          <div className="build-badge">
            <Theme />
            {/* The one piece of "chrome" that earned its place back: the version
                is how a deploy is confirmed after every change, and burying it
                three taps deep in Technical details broke that habit. Just the
                number — the phase, hash and build stamp stay buried. */}
            <span className="version mono">v{VERSION}</span>
          </div>
        </div>
      </header>

      <DeviceBar status={status} device={device} onRetry={read} busy={busy} />

      {isDemo() && status === 'live' ? (
        <p className="demo-banner">
          Simulated FM3 &mdash; nothing here reaches hardware. Real models and parameter ranges,
          real write behaviour including the silent clamp.
        </p>
      ) : null}

      {status === 'fault' ? (
        <div className="notice" data-kind="fault">
          <h2>Can&rsquo;t reach your unit</h2>
          <p>
            This app runs on the web, but your Fractal unit is on your desk &mdash; so it needs the
            helper app running on your Mac to reach it.
          </p>
          {/* On a phone the local advice is not just unhelpful, it's wrong:
              localhost is the phone itself, and no browser choice changes that. */}
          {onAnotherDevice ? (
            <p>
              Nothing is broken &mdash; a phone can&rsquo;t reach your unit directly, because the
              unit is plugged into your Mac. Connect to the Mac below and you can play through it
              from here.
            </p>
          ) : (
            <p>
              Check the helper app is running on your Mac. If you&rsquo;re using Safari, try Chrome
              instead &mdash; Safari won&rsquo;t let a website talk to your own computer.
            </p>
          )}
          <p>
            No unit plugged in?{' '}
            <button
              className="chip"
              onClick={() => {
                setDemo(true)
                read()
              }}
            >
              Try demo mode
            </button>{' '}
            lets you try everything against a simulated FM3.
          </p>
        </div>
      ) : null}

      {/*
        On a phone this is the only screen that ever renders.
        `localhost` is the machine you're holding, so a phone can never reach
        ForgeFX directly and the status never becomes live — which meant the one
        panel that could rescue it was behind a check for being live already.
        A remote session is precisely the answer to having no local connection,
        so it belongs on the screen that says there isn't one.
      */}
      {status === 'fault' ? (
        <Remote
          onConnected={(on) => {
            setRemote(on)
            record('remote', on ? 'Connected to the host remotely' : 'Back to the local connection')
            resetSchemaCache()
            read()
          }}
          onError={setError}
        />
      ) : null}

      {/*
        Errors are raised from every view, so the one place they're shown has to
        be outside all of them. This banner lived inside Design, which meant a
        failure anywhere else — a rejected sign-in, a refused write — set the
        message and rendered nothing. Silence read as "the button does nothing".
      */}
      {status === 'live' && error ? (
        <div className="notice" data-kind="fault" role="alert">
          <h2>Didn&rsquo;t work</h2>
          <p>{error}</p>
          <div className="history-actions">
            <button className="chip" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/*
        The assistant sits above the tabs, not inside one. It is how the app is
        meant to be worked: the views below are for when you'd rather reach for
        the control yourself, not a separate mode with different powers.
      */}
      {/* Always on screen, above everything, on every view. */}
      {status === 'live' ? (
        <StatusLine
          device={device}
          preset={preset}
          dirty={dirty}
          remote={remote}
          onError={setError}
          /* Same consequences as the panel's own buttons: which unit answers
             changes, so the cached schema and the whole read go with it. */
          onRemoteChanged={(on) => {
            setRemote(on)
            record('remote', on ? 'Connected to the host remotely' : 'Back to the local connection')
            resetSchemaCache()
            read()
          }}
        />
      ) : null}

      {status === 'live' ? (
        <Assistant
          turns={turns}
          onAsk={askFor}
          onConfirm={confirmTurn}
          onCancel={cancelTurn}
          busy={busy || runningPlan}
          progress={progress}
          startedAt={genStarted}
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
          <Thinking message={progress} />

          {thinking ? (
            <div className="thinking" role="status" aria-live="polite">
              <span className="thinking-bars" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <Stages active={thinking} startedAt={genStarted} />
            </div>
          ) : null}

          <LiveGeneration
            partial={partial}
            open={liveOpen}
            onToggle={() => setLiveOpen(!liveOpen)}
          />

          <Cost usage={result?.usage} sessionTotal={spend.total} runs={spend.runs} />

          <Preview
            result={result}
            writeCount={writeCount}
            busy={busy}
            onApply={apply}
            onDiscard={() => setResult(null)}
          />

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
                  {applied.mismatches.map((m, i) => (
                    <p key={i} className="mono problem">
                      {m}
                    </p>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </Assistant>
      ) : null}

      {status === 'live' ? (
        <nav className="views" aria-label="Sections">
          {/*
            Gig is not a section like the others — it takes the screen over, and
            it's the one you reach for on a stage, one-handed, in the dark. As
            the last tab in a strip that scrolls sideways on a phone it was
            simply off the edge. Sticky keeps it in view however far the rest
            scrolls, and it leads rather than trails.
          */}
          <button
            className={`view-tab gig-tab ${view === 'gig' ? 'current' : ''}`}
            onClick={() => setView(view === 'gig' ? lastView : 'gig')}
            aria-current={view === 'gig'}
          >
            {view === 'gig' ? 'Leave gig' : 'Gig'}
          </button>

          {[
            ['console', 'Home'],
            ['edit', 'Controls'],
            ['library', 'Presets']
          ].map(([id, label]) => (
            <button
              key={id}
              className={`view-tab ${view === id ? 'current' : ''}`}
              onClick={() => {
                setLastView(id)
                setView(id)
              }}
              aria-current={view === id}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}

      {status === 'live' && view === 'console' ? (
        <>
          <div className="device-strip">
            <span className="lamp" data-state={isDemo() ? 'demo' : 'live'} />
            <span className="device-name">{device?.short || device?.name}</span>
            <span className="device-meta mono">
              {/* "Slots" already means presets one panel up — the same word for
                  chain positions read as a contradiction (104 slots vs 4). */}
              gen {device?.gen} · {device?.capabilities?.slotModel === 'linear'
                ? `${device?.capabilities?.slotCount}-block chain`
                : `${device?.capabilities?.grid?.rows}×${device?.capabilities?.grid?.cols} grid`}
            </span>

            <div className="strip-right">
              <button
                className={`strip-btn ${tunerOn ? 'armed' : ''}`}
                onClick={async () => {
                  try {
                    await setTuner(!tunerOn)
                    setTunerOn(!tunerOn)
                  } catch (err) {
                    setError(err.message)
                  }
                }}
              >
                Tuner
              </button>
              <button
                className="strip-btn"
                onClick={async (e) => {
                  // Feedback before the round trip: the flash confirms the tap
                  // registered, at tap time, not at network time.
                  beatFlash(e.currentTarget)
                  try {
                    await tapTempo()
                    /*
                     * The device computes the tempo from the spacing of the
                     * taps, and /tempo/tap answers only {ok} — the new value
                     * has to be read back. Debounced past the last tap so a
                     * burst of taps costs one read, and the box doesn't
                     * flicker through half-computed tempos mid-burst.
                     */
                    clearTimeout(tapReadback.current)
                    tapReadback.current = setTimeout(async () => {
                      try {
                        const t = await getTempo()
                        if (typeof t?.bpm === 'number') setBpm(t.bpm)
                      } catch {
                        /* the box keeps its last known value */
                      }
                    }, 700)
                  } catch (err) {
                    setError(err.message)
                  }
                }}
              >
                Tap
              </button>
              {bpm !== null ? (
                <BpmBox
                  bpm={bpm}
                  onSet={async (n) => {
                    try {
                      await setTempo(n)
                      setBpm(n)
                      record('tempo', `Tempo → ${n} BPM`)
                    } catch (err) {
                      setError(err.message)
                    }
                  }}
                  onError={setError}
                />
              ) : null}
              {dirty ? (
                <button className="strip-btn armed" onClick={revert} disabled={busy}>
                  Revert
                </button>
              ) : null}
            </div>
          </div>

          <Tuner reading={tuning} on={tunerOn} />

          <div className="console">
            <PresetList
              slots={slots.length ? slots : cachedPresetNames()}
              current={preset?.number}
              deviceSlots={device?.capabilities?.presets?.count}
              addressing={device?.capabilities?.presets?.addressing}
              scanning={scanning}
              progress={scanProgress}
              onStop={() => {
                stopScan.current = true
              }}
              onScan={async () => {
                setScanning(true)
                stopScan.current = false
                const total = device?.capabilities?.presets?.count ?? 512
                /*
                 * The pace is measured over the last stretch and smoothed,
                 * never taken from the start of the run: a resumed scan skips
                 * hundreds of known slots in a blink, and an average carrying
                 * that would promise four hundred dumps in ten seconds.
                 */
                const pace = { at: Date.now(), done: 0, each: null }
                try {
                  const found = await scanAllPresets(
                    total,
                    (done, all, partial) => {
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
                        left: timeLeft(all - done, pace.each)
                      })
                      setSlots(partial)
                    },
                    () => stopScan.current
                  )
                  setSlots(found)
                } catch (err) {
                  setError(err.message)
                } finally {
                  setScanning(false)
                  setScanProgress(null)
                }
              }}
              onSelect={jumpTo}
            />

            <div className="center-panel">
              <p className="panel-title" style={{ padding: 0 }}>
                Preset name
              </p>
              <div className="preset-name-field">
                <span className="num">{preset?.number}</span>
                <span className="name">{preset?.name?.trim() || 'Untitled'}</span>
                <span className="step-btns">
                  <button
                    className="icon-btn"
                    onClick={() => jumpTo(Math.max(0, (preset?.number ?? 0) - 1))}
                    disabled={busy}
                  >
                    ◁
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => jumpTo((preset?.number ?? 0) + 1)}
                    disabled={busy}
                  >
                    ▷
                  </button>
                </span>
              </div>

              {device?.capabilities?.hasScenes !== false ? (
                <>
                  <p className="panel-title" style={{ padding: '14px 0 0' }}>
                    Scenes
                  </p>
                  <div className="scene-list">
                    {Array.from({ length: device?.capabilities?.sceneCount || 8 }, (_, i) => (
                      <button
                        key={i}
                        className={`scene-line ${i === scene ? 'current' : ''}`}
                        onClick={async () => {
                          setSceneIdx(i)
                          try {
                            await setScene(i)
                          } catch (err) {
                            setError(err.message)
                          }
                        }}
                      >
                        <span className="scene-tag">S{i + 1}</span>
                        <span className={`scene-title ${sceneNames[i] ? '' : 'unnamed'}`}>
                          {sceneNames[i] || `Scene ${i + 1}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {/* The design preview and the grid builder live in Design and
                  Edit. Duplicating them here made Home a third copy of two
                  other screens, which is most of why this felt cluttered. */}
            </div>

            <Chain
              blocks={blocks}
              selected={selectedBlock}
              onSelect={setSelectedBlock}
              onToggle={toggleBlock}
            />

            <BlockPanel
              block={blocks.find((b) => b.effectId === selectedBlock)}
              channels={device?.capabilities?.channelNames}
              busy={busy}
              onError={setError}
              onChanged={(summary) => {
                record('edit', summary)
                setDirty(true)
                read()
              }}
            />
          </div>
        </>
      ) : null}

      {status === 'live' && view === 'gig' ? (
        <Gig
          preset={preset}
          device={device}
          capabilities={device?.capabilities}
          onError={setError}
          onChanged={read}
        />
      ) : null}

      {status === 'live' && view === 'edit' ? (
        <>
          {/*
            Twelve panels used to stand open in one column. Everything visible
            at once means nothing stands out, and most of these are touched once
            a month. The chain and the controls stay open because they're what
            you came for; the rest fold away until wanted.
          */}
          {preset ? (
            <Grid preset={preset} blocks={blocks} capabilities={device?.capabilities} />
          ) : null}

          <SectionStack id="edit">
          <Section key="controls" title="Controls" note="Every knob on every block" defaultOpen>
            <ParamSearch
              blocks={blocks}
              onError={setError}
              onPick={(eid, paramId) => setEditorFocus({ eid, paramId, nonce: Date.now() })}
            />
            <Editor
              focus={editorFocus}
              blocks={blocks}
              onWritten={(summary, detail) => {
                record('edit', summary, detail)
                read()
              }}
              onError={setError}
            />
          </Section>

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

          {device?.capabilities?.hasScenes !== false ? (
            <Section key="scenes" title="Scenes" note="Name them and set what each one does">
              <Scenes
                blocks={blocks}
                preset={preset}
                count={device?.capabilities?.sceneCount || 8}
                channelNames={device?.capabilities?.channelNames}
                hasScenes={device?.capabilities?.hasScenes !== false}
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
            </Section>
          ) : null}

          {device?.capabilities?.cabIrs !== false ? (
            <Section key="speaker-cabinets" title="Speaker cabinets" note="Choose the cab this amp plays through">
              <CabPicker
                blocks={blocks}
                busy={busy}
                onError={setError}
                onChanged={(summary) => record('cab', summary)}
              />
            </Section>
          ) : null}

          <Section key="tempo-and-tuner" title="Tempo and tuner">
            <TempoTuner
              busy={busy}
              onError={setError}
              onChanged={(summary) => record('tempo', summary)}
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

          {device?.capabilities?.fc?.model !== false ? (
            <Section key="footswitches" title="Footswitches">
              <Footswitches onError={setError} />
            </Section>
          ) : null}

          {device?.capabilities?.meters?.outputLevels !== false &&
          device?.capabilities?.telemetry?.outputMeters !== false ? (
            <Section key="output-levels" title="Output levels">
              <Meters active={status === 'live'} />
            </Section>
          ) : null}

          <Section key="try-two-versions" title="Try two versions" note="Build a pair and switch between them">
            <Compare
              onCompare={buildComparison}
              state={compare}
              onClear={() => setCompare(null)}
              busy={busy}
              disabled={status !== 'live'}
            />
          </Section>

          <Section key="back-up-this-preset" title="Back up this preset">
            <Backup
              preset={preset}
              busy={busy}
              onError={setError}
              onChanged={(summary) => {
                record('backup', summary)
                read()
              }}
            />
          </Section>
          </SectionStack>
        </>
      ) : null}

      {status === 'live' && view === 'library' ? (
        <>
          {/*
            Two different things shared one screen: presets you reach for, and
            setup you touch once. Saved work comes first and open; anything you
            configure and forget is folded away below it.
          */}
          <SectionStack id="library">
          <Section key="presets-on-this-mac" title="Saved presets" note="Captures and designs, as files in a folder you choose" defaultOpen>
            <LocalLibrary
              preset={preset}
              busy={busy}
              remote={remote}
              onError={setError}
              onReload={reload}
              onChanged={(summary) => record('library', summary)}
            />
          </Section>

          <Section key="tones-you-ve-made-here" title="Older saves in this browser" note="Move these into the folder — files survive, browser storage doesn't">
            <History
              key={historyKey}
              onReload={reload}
              busy={busy}
              onError={setError}
              onMoved={() => setHistoryKey((k) => k + 1)}
            />
          </Section>

          <Section key="whole-unit-backups" title="Whole-unit backups" note="Every slot at once, before something goes wrong">
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

          <Section key="play-from-your-phone" title="Play from your phone" note={remote ? 'Connected' : 'Leave the Mac by the amp'}>
            {/* Host controls only work on the machine holding the cable — from a
                phone these calls are refused, and a button that cannot work is
                worse than no button. */}
            {!remote ? <Host onError={setError} /> : null}

            <Remote
              onConnected={(on) => {
                setRemote(on)
                record(
                  'remote',
                  on ? 'Connected to the host remotely' : 'Back to the local connection'
                )
                // Everything about the device has to be re-read down the new path.
                resetSchemaCache()
                read()
              }}
              onError={setError}
            />
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

          <Section key="what-s-changed-this-session" title="What's changed this session">
            <ChangeLog log={log} onClear={() => setLog([])} />
          </Section>

          <Section key="technical-details" title="Technical details" note="For working out why something went wrong">
            <Diagnostics />
          </Section>
          </SectionStack>
        </>
      ) : null}

      <section hidden={status === 'live' && view !== 'library'}>
        <p className="silk-label" style={{ marginTop: 34 }}>
          {catalog ? `Read from your ${device?.short || device?.name}` : 'Catalog'}
        </p>
        {catalog ? (
          <>
            <div className="stats">
              <div className="stat">
                <div className="value">{catalog.length}</div>
                <div className="silk-label label">Block families</div>
              </div>
              <div className="stat">
                <div className="value">
                  {catalog.reduce((n, b) => n + (b.typeCount || 0), 0).toLocaleString()}
                </div>
                <div className="silk-label label">Models</div>
              </div>
              <div className="stat">
                <div className="value">
                  {catalog.reduce((n, b) => n + (b.paramCount || 0), 0).toLocaleString()}
                </div>
                <div className="silk-label label">Parameters</div>
              </div>
              <div className="stat">
                <div className="value">
                  {catalog.find((b) => b.slug === 'amp')?.typeCount ?? '—'}
                </div>
                <div className="silk-label label">Amp models</div>
              </div>
              <div className="stat">
                <div className="value">{device?.capabilities?.presets?.count ?? '—'}</div>
                <div className="silk-label label">Preset slots</div>
              </div>
            </div>
          </>
        ) : (
          <p className="hint">Connect a device to read its catalog.</p>
        )}
      </section>

      <p className="footnote" hidden={status === 'live' && view === 'gig'}>
        Models and parameter ranges are read off the attached unit at generation time, so the
        designer can only pick models that unit actually has and only set values inside each
        control&rsquo;s real range. Anything outside it is rejected before a single write goes out. Device access
        via{' '}
        <a href="https://github.com/sKuhLight/ForgeFX" target="_blank" rel="noreferrer">
          ForgeFX
        </a>
        , an independent project not affiliated with Fractal Audio Systems.
      </p>

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
