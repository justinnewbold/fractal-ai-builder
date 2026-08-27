import { useEffect, useState } from 'react'
import {
  localConfig,
  setLocalRoot,
  localPresets,
  localPresetFile,
  writeLocalPreset,
  localSync,
  localRestore,
  backupPreset,
  loadPresetBytes
} from '../lib/forgefx'

/**
 * Presets kept as files on the player's own machine.
 *
 * The history this app shipped with lives in localStorage: one browser profile,
 * one machine, gone if the profile is cleared. A .syx in a folder is a file the
 * player owns — it copies, it gets backed up by whatever backs up their Mac, and
 * Fractal's own tools can read it.
 *
 * The folder has to be named once. Until then ForgeFX answers every call with a
 * 409, which is a setup state rather than a failure, so it is presented that way.
 */
export default function LocalLibrary({ preset, busy, onError, onChanged }) {
  const [config, setConfig] = useState(null)
  const [root, setRoot] = useState('')
  const [entries, setEntries] = useState([])
  const [working, setWorking] = useState(null)
  const [note, setNote] = useState(null)

  const loadConfig = async () => {
    try {
      const c = await localConfig()
      setConfig(c)
      if (c?.root) setRoot(c.root)
      return c
    } catch {
      // A server too old to have the routes is a missing feature, not a fault.
      setConfig({ configured: false, unsupported: true })
      return null
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  const listAll = async (refresh = false) => {
    setWorking('listing')
    try {
      const res = await localPresets(refresh)
      setEntries(Array.isArray(res?.entries) ? res.entries : [])
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  const point = async () => {
    const path = root.trim()
    if (!path.startsWith('/')) {
      onError('Give the full path to a folder, starting with a slash.')
      return
    }
    setWorking('config')
    try {
      const c = await setLocalRoot(path)
      setConfig(c)
      onChanged(`Library folder set to ${path}`)
      await listAll()
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /** Put whatever is loaded on the unit into the library, under its own name. */
  const keep = async () => {
    setWorking('keeping')
    try {
      const dump = await backupPreset(preset?.number)
      const bytes = dump?.bytes
      if (!Array.isArray(bytes) || !bytes.length) throw new Error('The unit returned no data.')
      const name = (dump.name || preset?.name || 'preset').trim()
      await writeLocalPreset({ name, bytes, overwrite: true })
      setNote(`Saved "${name}" to the library.`)
      onChanged(`Kept "${name}" in the library`)
      await listAll(true)
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  /**
   * Send a library file to the unit's edit buffer.
   *
   * Deliberately not to a slot: it lands where you can hear it, and keeping it
   * is a separate decision made with the save bar at the top.
   */
  const audition = async (entry) => {
    setWorking(entry.path)
    try {
      const bytes = await localPresetFile(entry.path)
      const list = Array.isArray(bytes) ? bytes : [...new Uint8Array(bytes)]
      if (!list.length) throw new Error('That file is empty.')
      await loadPresetBytes(list)
      setNote(`Loaded "${entry.name}". Play it, then save it to a slot to keep it.`)
      onChanged(`Loaded "${entry.name}" from the library`)
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  const runSync = async (which) => {
    setWorking(which)
    try {
      if (which === 'sync') {
        await localSync()
        setNote('Version history written out to the folder.')
        onChanged('Synced version history to the library folder')
      } else {
        await localRestore()
        setNote('Version history read back in from the folder.')
        onChanged('Restored version history from the library folder')
      }
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(null)
    }
  }

  if (config?.unsupported) return null

  return (
    <section className="local-library">
      <p className="silk-label">Library on this Mac</p>

      {!config?.configured ? (
        <>
          <p className="hint">
            Name a folder and presets get kept there as .syx files &mdash; yours, on your own disk,
            rather than in this browser&rsquo;s storage. It will make a{' '}
            <span className="mono">Presets</span> folder inside whatever you point it at.
          </p>
          <div className="save-row">
            <input
              type="text"
              className="name-field"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              placeholder="/Users/justinnewbold/Documents/Fractal"
              aria-label="Full path to the library folder"
            />
            <button className="save-now" onClick={point} disabled={busy || working === 'config'}>
              {working === 'config' ? 'Setting up…' : 'Use this folder'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint mono">
            {config.root}
            {config.writable === false ? ' · not writable' : ''}
          </p>

          <div className="history-actions">
            <button className="chip" onClick={keep} disabled={busy || !!working}>
              {working === 'keeping' ? 'Saving…' : `Keep slot ${preset?.number ?? '--'} here`}
            </button>
            <button className="chip" onClick={() => listAll(true)} disabled={busy || !!working}>
              {working === 'listing' ? 'Reading…' : 'Refresh list'}
            </button>
            <button className="chip" onClick={() => runSync('sync')} disabled={busy || !!working}>
              {working === 'sync' ? 'Writing…' : 'Sync version history out'}
            </button>
            <button className="chip" onClick={() => runSync('restore')} disabled={busy || !!working}>
              {working === 'restore' ? 'Reading…' : 'Restore version history'}
            </button>
          </div>

          {entries.length ? (
            <div className="library-list">
              {entries.map((entry) => (
                <div className="library-row" key={entry.path}>
                  <span className="library-name">{entry.name}</span>
                  <span className="library-path mono">{entry.path}</span>
                  <button
                    className="chip"
                    onClick={() => audition(entry)}
                    disabled={busy || !!working}
                  >
                    {working === entry.path ? 'Loading…' : 'Load'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">
              {working === 'listing'
                ? 'Reading the folder…'
                : 'Nothing in the library yet — refresh the list, or keep the loaded preset here.'}
            </p>
          )}
        </>
      )}

      {note ? <p className="hint">{note}</p> : null}
    </section>
  )
}
