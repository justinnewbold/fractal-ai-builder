import { useCallback, useEffect, useState } from 'react'
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
import { Modifiers, SceneMatrix, TempoTuner } from './components/Modifiers'
import { Versions, DeviceBackup } from './components/Versions'
import Footswitches from './components/Footswitches'
import GridEditor from './components/GridEditor'
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
  setPresetName,
  setChannel,
  setScene,
  getHost
} from './lib/forgefx'
import { validateSpec, countWrites } from './lib/validate'
import { newEntry, append } from './lib/log'

import ampTypes from './data/amp-types.json'
import driveTypes from './data/drive-types.json'
import cabTypes from './data/cab-types.json'
import blockCatalog from './data/blocks.json'

const totalParams = blockCatalog.reduce((sum, b) => sum + (b.paramCount || 0), 0)

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

  // Fifteen stacked sections was a long scroll with the important things buried.
  // Grouped by what you're doing rather than by which endpoint it calls.
  const [view, setView] = useState('design')

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
      setBlocks(Array.isArray(b) ? b : [])
      setStatus('live')
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

  /** One path to the model, so generate, refine and compare can't drift apart. */
  const requestSpec = async (schema, description, previous) => {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        device,
        blocks: schema,
        previous: previous || null,
        mode: previous ? 'refine' : 'design'
      })
    })
    const spec = await res.json()
    if (!res.ok) throw new Error(spec.error || 'Generation failed.')
    return spec
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

      setProgress('Designing the preset...')
      const spec = await requestSpec(schema, description)

      const validated = validateSpec(spec, schema)
      validated.spec = spec
      validated.description = description
      setResult(validated)
      setLastPrompt(description)

      if (validated.presetName) setSaveName(validated.presetName)

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
      const failures = await applyChanges(result.changes, (done, total, label) =>
        setProgress(`${done} of ${total} - ${label}`)
      )

      // ForgeFX caches block parameters with no invalidation hook, so a read can
      // report a value the hardware doesn't hold. Check what actually stuck.
      setProgress('Checking what landed...')
      const mismatches = await verifyChanges(result.changes, (done, total, name) =>
        setProgress(`Verifying ${name} - ${done} of ${total}`)
      )

      const count = countWrites(result.changes)
      setApplied({ failures, count, mismatches })

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

      setProgress(`Adjusting: ${instruction}`)
      const spec = await requestSpec(schema, instruction, previous)

      const validated = validateSpec(spec, schema)
      validated.spec = spec
      validated.description = instruction
      setResult(validated)
      setApplied(null)
      if (validated.presetName) setSaveName(validated.presetName)

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

      {status === 'live' && view === 'gig' ? (
        <Gig
          preset={preset}
          device={device}
          capabilities={device?.capabilities}
          onError={setError}
          onChanged={read}
        />
      ) : null}

      {status === 'live' && view === 'design' ? (
        <>
          <PresetBar preset={preset} onSelect={jumpTo} onRename={rename} busy={busy} />

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
                  : ' Play it. If you want to keep it, save it to a slot below.'}
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

          <SceneMatrix onError={setError} />

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
          Catalog loaded for generation
        </p>
        <div className="stats">
          <div className="stat">
            <div className="value">{ampTypes.length}</div>
            <div className="silk-label label">Amp models</div>
          </div>
          <div className="stat">
            <div className="value">{driveTypes.length}</div>
            <div className="silk-label label">Drive pedals</div>
          </div>
          <div className="stat">
            <div className="value">{cabTypes.length}</div>
            <div className="silk-label label">Cabinets</div>
          </div>
          <div className="stat">
            <div className="value">{blockCatalog.length}</div>
            <div className="silk-label label">Block slots</div>
          </div>
          <div className="stat">
            <div className="value">{totalParams.toLocaleString()}</div>
            <div className="silk-label label">Parameters</div>
          </div>
        </div>
      </section>

      <p className="footnote" hidden={status === 'live' && view === 'gig'}>
        Models and parameter ranges are read off your own hardware at generation time, so the
        designer can only pick models your unit has and only set values inside each control&rsquo;s
        real range. Anything outside it is rejected before a single write goes out. Device access
        via{' '}
        <a href="https://github.com/sKuhLight/ForgeFX" target="_blank" rel="noreferrer">
          ForgeFX
        </a>
        , an independent project not affiliated with Fractal Audio Systems.
      </p>
    </div>
  )
}
