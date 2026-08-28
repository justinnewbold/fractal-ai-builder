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
import { Stages, LiveGeneration } from './components/LiveGeneration'
import { streamSpec } from './lib/stream'
import { Modifiers, SceneMatrix, TempoTuner } from './components/Modifiers'
import { Versions, DeviceBackup } from './components/Versions'
import Footswitches from './components/Footswitches'
import GridEditor from './components/GridEditor'
import Ports from './components/Ports'
import LocalLibrary from './components/LocalLibrary'
import Assistant from './components/Assistant'
import Theme from './components/Theme'
import { validatePlan, runPlan } from './lib/actions'
import { Chain, PresetList, BlockPanel, Tuner } from './components/Console'
import {
  getTempo,
  tapTempo,
  setTuner,
  subscribeEvents,
  scanAllPresets,
  cachedPresetNames,
  readSceneNames
} from './lib/forgefx'
import { savePreset } from './lib/history'
import { costOf } from './lib/cost'
import { VERSION, COMMIT, BUILT_AT } from './lib/version'
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
  getHost
} from './lib/forgefx'
import { validateSpec, countWrites } from './lib/validate'
import { newEntry, append } from './lib/log'

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
  const [log, setLog] = useState([])
  const [spend, setSpend] = useState({ total: 0, runs: 0 })
  const [lastPrompt, setLastPrompt] = useState('')
  const [historyKey, setHistoryKey] = useState(0)
  const [compare, setCompare] = useState(null)
  const [turns, setTurns] = useState([])
  const [runningPlan, setRunningPlan] = useState(false)
  const [catalog, setCatalog] = useState(null)
  const [partial, setPartial] = useState(null)
  const [liveOpen, setLiveOpen] = useState(false)
  const [thinking, setThinking] = useState(false)

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
  const [tunerOn, setTunerOn] = useState(false)
  const [tuning, setTuning] = useState(null)
  const [scanProgress, setScanProgress] = useState(null)
  const stopScan = useRef(false)
  const [editTab, setEditTab] = useState('ai')

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
    if (fromAssistant || !HAND_EDIT_KINDS.has(kind)) return
    setTurns((prev) => [...prev, { role: 'system', text: summary }])
  }, [])

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
    try {
      return await streamSpec(
        {
          description,
          device,
          blocks: schema,
          previous: previous || null,
          mode: previous ? 'refine' : 'design'
        },
        { onPartial: setPartial }
      )
    } finally {
      setThinking(false)
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

      setProgress(null)
      const spec = await requestSpec(schema, description)

      const validated = validateSpec(spec, schema)
      validated.spec = spec
      validated.description = description
      setResult(validated)
      setLastPrompt(description)

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
          await setPresetName(generatedName)
        } catch {
          // A device that refuses renames still gets the parameter changes.
        }
      }

      const count = countWrites(result.changes)
      setApplied({ failures, count, mismatches })
      setDirty(true)

      // Saved after writing rather than on generation: a spec that was never
      // sent isn't a preset, it's a draft.
      if (result.spec) {
        savePreset({
          name: result.presetName || preset?.name || 'Untitled',
          description: result.description || lastPrompt,
          summary: result.summary,
          spec: result.spec,
          usage: result.usage,
          device: device?.name,
          blockNames: result.changes.map((c) => c.name)
        })
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
      setError('Enter a preset slot number.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Name first: /preset/name writes the working buffer, and storePreset is
      // what makes it permanent. Doing it the other way round saves the old name.
      const name = saveName.trim()
      if (name && name !== preset?.name?.trim()) {
        await setPresetName(name)
      }
      await storePreset(number)
      setApplied((prev) => ({ ...prev, savedTo: number }))
      record('save', `Saved "${name || preset?.name}" to slot ${number}`)
      setDirty(false)
      await read()
    } catch (err) {
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
  const refine = async (instruction) => {
    const previous = result?.spec
    if (!previous) return

    setBusy(true)
    setError(null)
    try {
      setProgress('Reading what the unit has loaded...')
      const schema = await readSchema(
        blocks,
        (done, total, name) => setProgress(`Reading ${name} - ${done} of ${total}`),
        // Designing or rebuilding a whole preset starts from the unit, not from
        // what we last wrote to it.
        { force: true }
      )

      setProgress(null)
      const spec = await requestSpec(schema, instruction, previous)

      const validated = validateSpec(spec, schema)
      validated.spec = spec
      validated.description = instruction
      setResult(validated)
      setApplied(null)
      setSaveName(validated.presetName || preset?.name?.trim() || '')

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
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          device,
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
        setView('design')
        let builtBlocks = null

        /*
         * An empty slot used to be a dead end: design refused and told you to go
         * place blocks yourself, which meant leaving the conversation to get out
         * of it. Ask for a tone on an empty preset and the chain gets built
         * first, because that is plainly what you meant.
         */
        if (blocks.length === 0) {
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
          builtBlocks = await read()
          if (!builtBlocks?.length) {
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
        if (result?.spec) await refine(design.text || instruction)
        else await generate(design.text || instruction, builtBlocks)
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
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            Fractal <span>AI</span> Builder
          </h1>
          <p className="tagline">Describe a tone. Get a preset on the unit.</p>
        </div>
        <div className="build-badge">
          <Theme />
          <span className="version mono">v{VERSION}</span>
          <span className="silk-label">Phase 4 &middot; depth</span>
          <span className="build-meta mono" title={`built ${BUILT_AT} UTC`}>
            {COMMIT}
          </span>
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
          <h2>No connection</h2>
          <p>{error}</p>
          <p>
            This app runs in the cloud, but your Fractal unit is on your desk &mdash; so it talks
            to ForgeFX running locally at <code>{getHost()}</code>.
          </p>
          <p>
            Safari blocks a secure page from calling <code>localhost</code>. Use Chrome, or run
            this app locally with <code>npm run dev</code>.
          </p>
          <p>
            No unit to hand?{' '}
            <button
              className="chip"
              onClick={() => {
                setDemo(true)
                read()
              }}
            >
              Try demo mode
            </button>{' '}
            runs against a simulated FM3 built from real captured device data.
          </p>
        </div>
      ) : null}

      {/*
        The assistant sits above the tabs, not inside one. It is how the app is
        meant to be worked: the views below are for when you'd rather reach for
        the control yourself, not a separate mode with different powers.
      */}
      {status === 'live' ? (
        <Assistant
          turns={turns}
          onAsk={askFor}
          onConfirm={confirmTurn}
          onCancel={cancelTurn}
          busy={busy || runningPlan}
          progress={progress}
        />
      ) : null}

      {status === 'live' ? (
        <nav className="views" aria-label="Sections">
          {[
            ['console', 'Console'],
            ['design', 'Design'],
            ['edit', 'Edit'],
            ['library', 'Library'],
            ['gig', 'Gig']
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
        </nav>
      ) : null}

      {status === 'live' && view === 'console' ? (
        <>
          <div className="device-strip">
            <span className="lamp" data-state={isDemo() ? 'demo' : 'live'} />
            <span className="device-name">{device?.short || device?.name}</span>
            <span className="device-meta mono">
              gen {device?.gen} · {device?.capabilities?.slotModel === 'linear'
                ? `${device?.capabilities?.slotCount} slots`
                : `${device?.capabilities?.grid?.rows}×${device?.capabilities?.grid?.cols}`}
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
                onClick={async () => {
                  try {
                    const r = await tapTempo()
                    if (typeof r?.bpm === 'number') setBpm(r.bpm)
                  } catch (err) {
                    setError(err.message)
                  }
                }}
              >
                Tap
              </button>
              {bpm !== null ? <span className="bpm-box">{bpm} BPM</span> : null}
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
              scanning={scanning}
              progress={scanProgress}
              onStop={() => {
                stopScan.current = true
              }}
              onScan={async () => {
                setScanning(true)
                stopScan.current = false
                const total = device?.capabilities?.presets?.count ?? 512
                try {
                  const found = await scanAllPresets(
                    total,
                    (done, all, partial) => {
                      setScanProgress({ done, total: all, pct: Math.round((done / all) * 100) })
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

              <div className="edit-tabs">
                {[
                  ['ai', 'Design with AI'],
                  ['fx', 'FX Edit'],
                  ['build', 'Quick Build']
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={`edit-tab ${editTab === id ? 'current' : ''}`}
                    onClick={() => setEditTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {editTab === 'ai' ? (
                <>
                  <p className="hint">
                    Describe the tone in the chat above &mdash; the design lands here for you to
                    read before anything is written.
                  </p>
                  <Thinking message={progress} />
                  {thinking ? (
                    <div className="thinking" role="status" aria-live="polite">
                      <span className="thinking-bars" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                      <Stages active={thinking} />
                    </div>
                  ) : null}
                  <LiveGeneration
                    partial={partial}
                    open={liveOpen}
                    onToggle={() => setLiveOpen(!liveOpen)}
                  />
                  {result ? (
                    <p className="hint">
              Not quite it? Say what to change in the chat above.
            </p>
                  ) : null}
                  <Preview
                    result={result}
                    writeCount={writeCount}
                    busy={busy}
                    onApply={apply}
                    onDiscard={() => setResult(null)}
                  />
                </>
              ) : null}

              {editTab === 'build' ? (
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
              ) : null}
            </div>

            <Chain blocks={blocks} selected={selectedBlock} onSelect={setSelectedBlock} />

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

      {status === 'live' && dirty ? (
        <div className="dirty-bar">
          <span className="lamp" data-state="live" />
          <span className="dirty-text">
            Playing an unsaved version of <strong>{preset?.name}</strong>. Nothing is permanent
            until you save it to a slot.
          </span>

          {/*
            Save lives here rather than inside one view. This bar already appears
            on every page the moment anything is unsaved, which is exactly when
            the button is wanted — having to navigate to another tab to keep a
            change you just made is how edits get lost.

            The slot defaults to the preset currently loaded, so the common case
            is one click. Typing a different number saves a copy elsewhere.
          */}
          <div className="save-row dirty-save">
            <input
              type="text"
              className="name-field"
              value={saveName || preset?.name?.trim() || ''}
              maxLength={31}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Preset name"
              aria-label="Name to save the preset under"
            />
            <input
              type="text"
              value={slot === '' ? String(preset?.number ?? '') : slot}
              onChange={(e) => setSlot(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="Slot"
              aria-label="Preset slot to save into"
            />
            <button className="save-now" onClick={save} disabled={busy}>
              Save to slot {slot === '' ? (preset?.number ?? '--') : slot}
            </button>
          </div>

          <div className="history-actions">
            <button className="chip" onClick={revert} disabled={busy}>
              Revert to saved
            </button>
            {safety ? (
              <button className="chip" onClick={restoreSafety} disabled={busy}>
                Load pre-edit copy
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {status === 'live' && view === 'design' ? (
        <>
          {blocks.length === 0 ? (
            <div className="notice">
              <h2>This preset is empty</h2>
              <p>
                Slot {preset?.number} has no blocks on its grid &mdash; but that&rsquo;s no longer
                a dead end. Describe the tone you want in the chat above and a chain gets placed
                before anything is designed.
              </p>
              <p>
                To choose the blocks yourself, say which ones &mdash; &ldquo;build a drive, amp,
                cab and delay chain&rdquo; &mdash; or use the starter chain button in{' '}
                <strong>Edit</strong>.
              </p>
            </div>
          ) : (
            <p className="hint design-hint">
              Slot {preset?.number} is empty. Describe the tone you want in the chat above and a
              chain gets placed first &mdash; or say which blocks, like &ldquo;build a drive, amp,
              cab and delay chain&rdquo;.
            </p>
          )}

          <Thinking message={progress} />

          {thinking ? (
            <div className="thinking" role="status" aria-live="polite">
              <span className="thinking-bars" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <Stages active={thinking} />
            </div>
          ) : null}

          <LiveGeneration
            partial={partial}
            open={liveOpen}
            onToggle={() => setLiveOpen(!liveOpen)}
          />

          <PresetBar preset={preset} onSelect={jumpTo} onRename={rename} busy={busy} />

          {error ? (
            <div className="notice" data-kind="fault">
              <h2>Didn&rsquo;t work</h2>
              <p>{error}</p>
            </div>
          ) : null}

          {applied ? (
            <div className="notice">
              <h2>{applied.savedTo !== undefined ? 'Saved' : 'Written to the unit'}</h2>
              <p>
                {applied.count} changes sent.
                {applied.savedTo !== undefined
                  ? ` Stored to slot ${applied.savedTo}.`
                  : ' It\u2019s in the edit buffer \u2014 play it now. Nothing is permanent until you save it below, and Revert puts the saved version back.'}
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
                      {m.block} · {m.param} — wanted {m.wanted}, reads {m.got}
                    </p>
                  ))}
                </>
              ) : null}
              {applied.savedTo === undefined ? (
                <div className="save-row">
                  <input
                    type="text"
                    className="name-field"
                    value={saveName}
                    maxLength={31}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Preset name"
                    aria-label="Name to save the preset under"
                  />
                  <input
                    type="text"
                    value={slot}
                    onChange={(e) => setSlot(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Slot"
                    aria-label="Preset slot to save into"
                  />
                  <button onClick={save} disabled={busy || !slot}>
                    Save to slot {slot || '--'}
                  </button>
                  <span className="hint">Overwrites whatever is in that slot.</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {result?.usage ? (
            <Cost usage={result.usage} sessionTotal={spend.total} runs={spend.runs} />
          ) : null}

          {result ? (
            <p className="hint">
              Not quite it? Say what to change in the chat above.
            </p>
          ) : null}

          <Preview
            result={result}
            writeCount={writeCount}
            busy={busy}
            onApply={apply}
            onDiscard={() => setResult(null)}
          />

          {preset ? (
            <Grid preset={preset} blocks={blocks} capabilities={device?.capabilities} />
          ) : null}
        </>
      ) : null}

      {status === 'live' && view === 'edit' ? (
        <>
          {preset ? (
            <Grid preset={preset} blocks={blocks} capabilities={device?.capabilities} />
          ) : null}

          <Scenes
            blocks={blocks}
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

          <TempoTuner
            busy={busy}
            onError={setError}
            onChanged={(summary) => record('tempo', summary)}
          />

          <Modifiers
            blocks={blocks}
            busy={busy}
            onError={setError}
            onChanged={(summary) => record('modifier', `Modifier bound: ${summary}`)}
          />

          <Editor
            blocks={blocks}
            onWritten={(summary, detail) => {
              record('edit', summary, detail)
              read()
            }}
            onError={setError}
          />

          <Compare
            onCompare={buildComparison}
            state={compare}
            onClear={() => setCompare(null)}
            busy={busy}
            disabled={status !== 'live'}
          />

          {device?.capabilities?.cabIrs !== false ? (
            <CabPicker
              blocks={blocks}
            busy={busy}
            onError={setError}
              onChanged={(summary) => record('cab', summary)}
            />
          ) : null}

          <Backup
            preset={preset}
            busy={busy}
            onError={setError}
            onChanged={(summary) => {
              record('backup', summary)
              read()
            }}
          />

          {device?.capabilities?.meters?.outputLevels !== false &&
          device?.capabilities?.telemetry?.outputMeters !== false ? (
            <Meters active={status === 'live'} />
          ) : null}

          <LocalLibrary
            preset={preset}
            busy={busy}
            onError={setError}
            onChanged={(summary) => record('library', summary)}
          />

          <Ports
            busy={busy}
            onError={setError}
            onChanged={(summary) => {
              record('port', summary)
              read()
            }}
          />

          {device?.capabilities?.fc?.model !== false ? (
            <Footswitches onError={setError} />
          ) : null}
        </>
      ) : null}

      {status === 'live' && view === 'library' ? (
        <>
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

          <History key={historyKey} onReload={reload} busy={busy} />

          <ChangeLog log={log} onClear={() => setLog([])} />

          <Diagnostics />
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
