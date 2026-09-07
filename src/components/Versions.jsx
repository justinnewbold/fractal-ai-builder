import { useEffect, useState } from 'react'
import { listVersions, loadVersion, restoreVersion, backupDevice } from '../lib/forgefx'
import { formatWhen } from '../lib/history'

/**
 * Undo, for the hardware.
 *
 * Distinct from the saved presets in this app, and the distinction matters.
 * Those store a generated spec — an intent, replayable against any preset. A
 * version is a raw .syx snapshot of one slot at one moment. You want the first
 * when the question is "do that again", and the second when it's "put it back
 * how it was". Only the second can answer that, because only the second knows
 * what "it was" actually contained.
 */
export function Versions({ preset, onError, onChanged, busy, deviceSlots }) {
  const [versions, setVersions] = useState(null)
  const [scope, setScope] = useState('slot')
  const [confirming, setConfirming] = useState(null)

  const load = async () => {
    try {
      const res = await listVersions(scope === 'slot' ? preset?.number : undefined)
      setVersions(res?.versions || [])
    } catch (err) {
      setVersions([])
      onError(err.message)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, preset?.number])

  const play = async (version) => {
    try {
      await loadVersion(version.id)
      onChanged(`Loaded snapshot into the edit buffer — not saved to a slot yet`)
    } catch (err) {
      onError(err.message)
    }
  }

  const put = async (version) => {
    setConfirming(null)
    try {
      await restoreVersion(version.id)
      onChanged(`Restored slot ${version.location} from a snapshot`)
    } catch (err) {
      onError(err.message)
    }
  }

  if (!versions) return null

  return (
    <section className="versions">
      <div className="history-head">
        <p className="silk-label">Snapshots {versions.length ? `· ${versions.length}` : ''}</p>
        <div className="history-actions">
          <button
            className={`chip ${scope === 'slot' ? 'active' : ''}`}
            onClick={() => setScope('slot')}
          >
            This slot
          </button>
          <button
            className={`chip ${scope === 'all' ? 'active' : ''}`}
            onClick={() => setScope('all')}
          >
            All
          </button>
        </div>
      </div>

      {versions.length === 0 ? (
        <p className="hint">
          No snapshots yet. One is taken before a slot is overwritten, so they appear as you
          work.
        </p>
      ) : (
        <div className="history-list">
          {versions.map((version) => (
            <div className="history-entry" key={version.id}>
              <div className="history-row">
                <div className="version-info">
                  <span className="history-name">{version.name || `Slot ${version.location}`}</span>
                  <span className="history-when mono">
                    slot {version.location} · {formatWhen(version.at)}
                    {version.label ? ` · ${version.label}` : ''}
                  </span>
                </div>
                <div className="history-actions">
                  <button className="chip" onClick={() => play(version)} disabled={busy}>
                    Play it
                  </button>
                  <button
                    className="chip"
                    onClick={() => setConfirming(version.id)}
                    disabled={busy}
                  >
                    Put back
                  </button>
                </div>
              </div>

              {confirming === version.id ? (
                <div className="notice" data-kind="fault">
                  <p>
                    This overwrites slot {version.location} with the snapshot. Whatever is there now
                    is gone.
                  </p>
                  <div className="history-actions">
                    <button className="primary" onClick={() => put(version)}>
                      Overwrite slot {version.location}
                    </button>
                    <button onClick={() => setConfirming(null)}>Cancel</button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <p className="hint history-note">
        <strong>Play it</strong> loads a snapshot into the edit buffer so you can hear it without
        occupying a slot. <strong>Put back</strong> writes it to the slot it came from.
      </p>
    </section>
  )
}

/**
 * Back up every slot at once.
 *
 * The per-preset .syx covers the preset you're working on. This covers the case
 * where something went wrong and you don't yet know which slot it touched —
 * which, on a project that has silently written wrong values more than once, is
 * not a hypothetical.
 */
export function DeviceBackup({ onError, onChanged, busy }) {
  const [running, setRunning] = useState(false)
  const [label, setLabel] = useState('')

  const run = async () => {
    setRunning(true)
    try {
      const name = label.trim() || `Backup ${new Date().toLocaleDateString()}`
      await backupDevice(name)
      onChanged(`Backed up all slots as "${name}"`)
      setLabel('')
    } catch (err) {
      onError(err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="device-backup">
      <p className="silk-label">Back up everything</p>
      <div className="refine-row">
        <input
          type="text"
          className="refine-input"
          value={label}
          placeholder="Label this backup"
          onChange={(e) => setLabel(e.target.value)}
          aria-label="Backup label"
        />
        <button onClick={run} disabled={busy || running}>
          {running ? 'Reading all slots…' : 'Back up all slots'}
        </button>
      </div>
      {/*
        The unit's own count, not 512. That number is the gen-3 one — an AM4
        holds 104 and an Axe-Fx II 384 — and a sentence that states it as a
        fact is the app telling a player something about their hardware that
        is not true. A unit that has never said falls back to "every slot",
        which is accurate whatever the number turns out to be.
      */}
      <p className="hint">
        Reads {deviceSlots ? `all ${deviceSlots} slots` : 'every slot'} down one serial port, so it
        takes a while. Worth doing once before you let anything write in bulk.
      </p>
    </section>
  )
}
