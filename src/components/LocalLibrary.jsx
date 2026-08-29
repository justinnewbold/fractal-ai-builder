import { useEffect, useState } from 'react'
import { backupPreset, loadPresetBytes, listVersions, versionBytes } from '../lib/forgefx'
import {
  canPickFolder,
  pickFolder,
  savedFolder,
  forgetFolder,
  listPresetFiles,
  writePresetFile,
  readPresetFile,
  readDesignFile,
  deletePresetFile,
  versionsFolder,
  syncedVersionIds,
  writeVersionFile
} from '../lib/localFolder'

/**
 * Presets kept as files in a folder on this Mac.
 *
 * The folder is chosen through the operating system's own picker rather than by
 * typing a path. A typed path is a thing you can get wrong in silence, and
 * nobody knows how their home directory is spelled.
 *
 * Files are read and written by the browser directly, not through the helper
 * app. That is not a workaround: the picker deliberately never reveals where a
 * folder lives, so there is no path to hand anyone, and going direct means
 * there is nothing for two sides to disagree about.
 */
export default function LocalLibrary({ preset, busy, onError, onChanged, onReload, remote }) {
  const [folder, setFolder] = useState(null)
  const [needsPermission, setNeedsPermission] = useState(false)
  const [entries, setEntries] = useState([])
  const [working, setWorking] = useState(null)
  const [note, setNote] = useState(null)

  useEffect(() => {
    let stop = false
    savedFolder()
      .then((res) => {
        if (stop || !res) return
        if (res.needsPermission) {
          setNeedsPermission(true)
          setFolder(res.handle)
        } else {
          setFolder(res)
        }
      })
      .catch(() => {})
    return () => {
      stop = true
    }
  }, [])

  useEffect(() => {
    if (!folder || needsPermission) return
    let stop = false
    listPresetFiles(folder)
      .then((list) => !stop && setEntries(list))
      .catch(() => !stop && setEntries([]))
    return () => {
      stop = true
    }
  }, [folder, needsPermission])

  const choose = async () => {
    setWorking('choose')
    try {
      const handle = await pickFolder()
      if (!handle) return
      setFolder(handle)
      setNeedsPermission(false)
      setNote(`Using "${handle.name}".`)
      onChanged(`Preset folder set to "${handle.name}"`)
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  const regrant = async () => {
    const res = await savedFolder({ prompt: true })
    if (res && !res.needsPermission) {
      setFolder(res)
      setNeedsPermission(false)
    } else {
      onError('That folder is no longer available — choose it again.')
    }
  }

  const refresh = async () => {
    setWorking('list')
    try {
      setEntries(await listPresetFiles(folder))
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /** Put whatever is loaded on the unit into the folder, under its own name. */
  const keep = async () => {
    setWorking('keep')
    try {
      const dump = await backupPreset(preset?.number)
      const bytes = dump?.bytes
      if (!Array.isArray(bytes) || !bytes.length) throw new Error('The unit returned no data.')
      const name = (dump.name || preset?.name || 'preset').trim()
      const file = await writePresetFile(folder, name, bytes)
      setNote(`Saved as ${file}.`)
      onChanged(`Kept "${name}" in the preset folder`)
      await refresh()
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /**
   * Send a file to the unit's edit buffer.
   *
   * Not to a slot: it lands where you can hear it, and keeping it is a separate
   * decision made with the save bar at the top.
   */
  const load = async (entry) => {
    setWorking(entry.file)
    try {
      if (entry.kind === 'design') {
        /*
         * A design is a recipe, not a photograph. It goes back through the
         * same validation as a fresh generation — against whatever is on the
         * unit right now — and lands as a preview, because a tone designed for
         * one preset can meet a different layout or different ranges.
         */
        const saved = await readDesignFile(folder, entry.file)
        onReload?.(saved)
        setNote(`"${entry.name}" is being re-checked against the unit — the preview appears above.`)
      } else {
        const bytes = await readPresetFile(folder, entry.file)
        if (!bytes.length) throw new Error('That file is empty.')
        await loadPresetBytes(bytes)
        setNote(`Loaded "${entry.name}". Play it, then save it to a slot to keep it.`)
        onChanged(`Loaded "${entry.name}" from the preset folder`)
      }
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /**
   * Copy every whole-unit version into the folder, once each.
   *
   * The old sync ran inside ForgeFX and needed the typed path the picker
   * replaced. This one runs here, on the folder handle, and is idempotent: the
   * version id rides in each filename, so re-syncing writes only what's new.
   * Local-only — the bytes route serves this Mac, and the folder is this Mac's.
   */
  const syncVersions = async () => {
    setWorking('versions')
    try {
      const res = await listVersions()
      const versions = Array.isArray(res) ? res : res?.versions || []
      if (!versions.length) {
        setNote('No stored versions to copy yet.')
        return
      }
      const dir = await versionsFolder(folder)
      const have = await syncedVersionIds(dir)
      let wrote = 0
      for (const v of versions) {
        if (have.has(v.id)) continue
        const bytes = await versionBytes(v.id)
        if (!bytes.length) continue
        await writeVersionFile(dir, v, bytes)
        wrote++
      }
      setNote(
        wrote
          ? `Copied ${wrote} version${wrote === 1 ? '' : 's'} into "versions".`
          : 'Every version is already in the folder.'
      )
      if (wrote) onChanged(`Copied ${wrote} versions into the preset folder`)
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  const remove = async (entry) => {
    setWorking(entry.file)
    try {
      await deletePresetFile(folder, entry.file)
      setNote(`Deleted ${entry.file}.`)
      await refresh()
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  if (!canPickFolder()) {
    return (
      <p className="hint">
        Choosing a folder needs Chrome. In other browsers you can still back up one preset at a
        time from Edit.
      </p>
    )
  }

  if (!folder) {
    return (
      <>
        <p className="hint">
          Pick a folder and your presets get kept there as ordinary files &mdash; yours, on your own
          Mac, where your backups will pick them up.
        </p>
        <button className="save-now" onClick={choose} disabled={busy || working === 'choose'}>
          {working === 'choose' ? 'Choosing…' : 'Choose a folder'}
        </button>
      </>
    )
  }

  if (needsPermission) {
    return (
      <>
        <p className="hint">
          Chrome needs you to allow access to &ldquo;{folder.name}&rdquo; again for this session.
        </p>
        <button className="save-now" onClick={regrant}>
          Allow access
        </button>
      </>
    )
  }

  return (
    <>
      <p className="hint">
        Using <strong>{folder.name}</strong>
      </p>

      <div className="history-actions">
        <button className="chip" onClick={keep} disabled={busy || !!working}>
          {working === 'keep' ? 'Saving…' : `Keep slot ${preset?.number ?? '--'} here`}
        </button>
        <button className="chip" onClick={refresh} disabled={busy || !!working}>
          {working === 'list' ? 'Reading…' : 'Refresh'}
        </button>
        {!remote ? (
          <button className="chip" onClick={syncVersions} disabled={busy || !!working}>
            {working === 'versions' ? 'Copying…' : 'Copy unit versions here'}
          </button>
        ) : null}
        <button
          className="chip"
          onClick={async () => {
            await forgetFolder()
            setFolder(null)
            setEntries([])
          }}
        >
          Use a different folder
        </button>
      </div>

      {entries.length ? (
        <div className="library-list">
          {entries.map((entry) => (
            <div className="library-row" key={entry.file}>
              <span className="library-name">{entry.name}</span>
              <span className="library-path mono">
                {entry.kind === 'design' ? 'design · ' : ''}
                {new Date(entry.at).toLocaleDateString()}
              </span>
              <button className="chip" onClick={() => load(entry)} disabled={busy || !!working}>
                {working === entry.file ? 'Working…' : 'Load'}
              </button>
              <button className="chip" onClick={() => remove(entry)} disabled={busy || !!working}>
                Delete
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">Nothing saved here yet.</p>
      )}

      {note ? <p className="hint">{note}</p> : null}
    </>
  )
}
