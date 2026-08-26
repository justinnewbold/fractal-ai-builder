import { useCallback, useEffect, useRef, useState } from 'react'
import DeviceBar from './components/DeviceBar'
import Grid from './components/Grid'
import { ToneForm, Preview } from './components/Generate'
import { PresetBar, ChangeLog, Thinking } from './components/PresetBar'
import Editor from './components/Editor'
import Diagnostics from './components/Diagnostics'
import Cost from './components/Cost'
import Scenes from './components/Scenes'
import History from './components/History'
import { CabPicker, Backup, Meters } from './components/Hardware'
import { Refine, Compare } from './components/Refine'
import Gig from './components/Gig'
import { Stages, LiveGeneration } from './components/LiveGeneration'
import { streamSpec } from './lib/stream'
import { Modifiers, SceneMatrix, TempoTuner } from './components/Modifiers'
import { Versions, DeviceBackup } from './components/Versions'
import Footswitches from './components/Footswitches'
import GridEditor from './components/GridEditor'
import Ports from './components/Ports'
import Command from './components/Command'
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
  const [plan, setPlan] = useState(null)
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

  const record = useCallback((kind, summary, detail = []) => {
    setLog((prev) => append(prev, newEntry(kind, summary, detail)))
  }, [])

  const read = useCallback(async () => {
    setBusy(true)
    setError(null)
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

  const generate = async (description) => {
    setBusy(true)
    setError(null)
    setResult(null)
    setApplied(null)
    try {
      setProgress('Reading what the unit has loaded...')
      const schema = await readSchema(blocks, (done, total, name) =>
        setProgress(`Reading ${name} - ${done} of ${total}`)
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
    const number = Number(slot)
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
      const schema = await readSchema(blocks, (done, total, name) =>
        setProgress(`Reading ${name} - ${done} of ${total}`)
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
      const schema = await readSchema(blocks, (done, total, name) =>
        setProgress(`Reading ${name} - ${done} of ${total}`)
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
      const schema = await readSchema(blocks, (done, total, name) =>
        setProgress(`Reading ${name} - ${done} of ${total}`)
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
    setPlan(null)
    try {
      setProgress('Reading the preset...')
      const schema = await readSchema(blocks, (done, total, name) =>
        setProgress(`Reading ${name} - ${done} of ${total}`)
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
          presetName: preset?.name
        })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'That request failed.')

      const checked = validatePlan(body, withPositions, device?.capabilities)
      setPlan(checked)
      record('ask', `Asked: ${instruction}`, [
        checked.understood,
        `${checked.actions.length} actions proposed`,
        ...checked.problems
      ])
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  const doPlan = async () => {
    if (!plan?.actions.length) return
    setRunningPlan(true)
    setError(null)
    try {
      const failures = await runPlan(plan.actions, (done, total, label) =>
        setProgress(`${done} of ${total} - ${label}`)
      )
      record(
        'edit',
        `Did ${plan.actions.length} things`,
        [...plan.actions.map((a) => a.label), ...failures]
      )
      if (failures.length) setError(failures.join(' · '))
      setDirty(true)
      setPlan(null)
      await read()
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      setRunningPlan(false)
    }
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

      {status === 'live' ? (
        <nav className="views" aria-label="Sections">
          {[
            ['console', 'Console'],
            ['design', 'Design'],
            ['bench', 'Bench'],
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
                  <ToneForm onGenerate={generate} busy={busy} disabled={status !== 'live'} />
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
                    <Refine onRefine={refine} busy={busy} disabled={status !== 'live'} />
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
                Slot {preset?.number} has no blocks on its grid, and this app can only adjust
                blocks that are already placed &mdash; it can&rsquo;t build a chain from nothing
                yet.
              </p>
              <p>
                Load a preset that already has an amp and cab, or go to <strong>Bench</strong> and
                build a chain first &mdash; there&rsquo;s a starter chain button that places
                drive, amp, cab, delay and reverb in one go.
              </p>
            </div>
          ) : (
            <ToneForm onGenerate={generate} busy={busy} disabled={status !== 'live'} />
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

          <Command
            onPlan={askFor}
            onRun={doPlan}
            plan={plan}
            running={runningPlan}
            busy={busy}
            progress={progress}
            onDismiss={() => setPlan(null)}
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
            <Refine onRefine={refine} busy={busy} disabled={status !== 'live'} />
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

      {status === 'live' && view === 'bench' ? (
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
