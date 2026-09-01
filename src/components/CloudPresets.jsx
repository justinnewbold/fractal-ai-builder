import { useCallback, useEffect, useState } from 'react'
import { listCloudPresets, deleteCloudPreset, pushLocalPresets, cloudReady } from '../lib/cloudPresets'
import { listPresets } from '../lib/history'

/**
 * Presets kept with the account, so a new machine is not a fresh start.
 *
 * This panel exists because of a specific loss. Generated tones lived only in
 * `localStorage`, which is per browser and per device and synced by nothing —
 * so moving to a new Mac left every one of them behind, reachable only by
 * going back to the old machine. That is the failure this fixes, and the
 * "copy this browser's presets up" button is the way out of it for anyone
 * already in that position.
 *
 * A copy, never a move. The local entries stay where they are: the two stores
 * are different things, and a partial failure must not have eaten the
 * originals.
 */
export default function CloudPresets({ onLoad, onError, busy }) {
  const [entries, setEntries] = useState(null)
  const [working, setWorking] = useState(null)
  const [note, setNote] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setEntries(await listCloudPresets())
    } catch (err) {
      onError?.(err.message)
      setEntries([])
    }
  }, [onError])

  useEffect(() => {
    if (cloudReady()) refresh()
    else setEntries([])
  }, [refresh])

  if (!cloudReady()) {
    return (
      <p className="hint">
        Sign in and your generated presets are kept with your account &mdash; they come back on any
        machine you sign in from.
      </p>
    )
  }

  const local = listPresets()

  return (
    <div className="cloud-presets">
      {entries === null ? (
        <p className="hint">Reading…</p>
      ) : entries.length === 0 ? (
        <p className="hint">Nothing kept with your account yet.</p>
      ) : (
        <ul className="cloud-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                className="preset-row"
                disabled={busy}
                onClick={() => onLoad?.(entry)}
                title={entry.summary || entry.description}
              >
                <span className="preset-row-name">{entry.name}</span>
                <span className="preset-row-when mono">
                  {new Date(entry.at).toLocaleDateString()}
                </span>
              </button>
              <button
                className="chip"
                disabled={busy || working === entry.id}
                onClick={async () => {
                  setWorking(entry.id)
                  try {
                    await deleteCloudPreset(entry.id)
                    await refresh()
                  } catch (err) {
                    onError?.(err.message)
                  } finally {
                    setWorking(null)
                  }
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Only offered when there is something to copy. An empty migration
          button is a question nobody asked. */}
      {local.length ? (
        <div className="history-actions">
          <button
            className="chip"
            disabled={busy || working === 'push'}
            onClick={async () => {
              setWorking('push')
              setNote(null)
              try {
                const { saved, failed } = await pushLocalPresets(local, (done, total, name) =>
                  setNote(`Copying ${done} of ${total} — ${name || 'untitled'}`)
                )
                await refresh()
                setNote(
                  failed.length
                    ? `Copied ${saved}. ${failed.length} did not go: ${failed[0]}`
                    : `Copied ${saved} preset${saved === 1 ? '' : 's'} to your account. The browser copies are still here.`
                )
              } catch (err) {
                onError?.(err.message)
              } finally {
                setWorking(null)
              }
            }}
          >
            {working === 'push'
              ? 'Copying…'
              : `Copy this browser's ${local.length} preset${local.length === 1 ? '' : 's'} up`}
          </button>
        </div>
      ) : null}

      {note ? <p className="hint">{note}</p> : null}
    </div>
  )
}
