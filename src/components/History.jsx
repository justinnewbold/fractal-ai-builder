import { useRef, useState } from 'react'
import {
  listPresets,
  deletePreset,
  renamePreset,
  clearHistory,
  exportHistory,
  importHistory,
  formatWhen
} from '../lib/history'
import { costOf, formatCost } from '../lib/cost'
import { savedFolder, writeDesignFile } from '../lib/localFolder'

/**
 * Saved presets.
 *
 * Reloading doesn't write anything. It runs the saved spec back through
 * validation against whatever is loaded on the unit right now, and drops you at
 * the preview — same as a fresh generation. A tone designed for one preset can
 * meet a different block layout or different parameter ranges, and the checks
 * that catch that are the ones already in the pipeline.
 */
export default function History({ onReload, busy, onError, onMoved }) {
  const [entries, setEntries] = useState(() => listPresets())
  const [expanded, setExpanded] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState(null)
  const fileInput = useRef(null)

  const refresh = () => setEntries(listPresets())

  const remove = (id) => {
    deletePreset(id)
    refresh()
  }

  const commitRename = (id) => {
    renamePreset(id, draft)
    setRenaming(null)
    refresh()
  }

  /**
   * Move everything here into the chosen folder, as design files.
   *
   * This storage is the older home, and it has the weaknesses files don't: it
   * belongs to one browser, backups never see it, and clearing site data takes
   * every tone with it. Moving is per-entry deliberate — each one is written to
   * disk first and removed from here only after that write succeeded, so a
   * failure part-way loses nothing, it just leaves some not yet moved.
   */
  const moveAll = async () => {
    const folder = await savedFolder().catch(() => null)
    if (!folder || folder.needsPermission) {
      onError?.('Choose a preset folder first, in the panel above.')
      return
    }
    let moved = 0
    try {
      for (const entry of listPresets()) {
        await writeDesignFile(folder, entry)
        deletePreset(entry.id)
        moved++
      }
      setNote(`Moved ${moved} design${moved === 1 ? '' : 's'} into the folder.`)
      refresh()
      onMoved?.(moved)
    } catch (err) {
      refresh()
      onError?.(`Moved ${moved}, then: ${err.message}`)
    }
  }

  const download = () => {
    const blob = new Blob([exportHistory()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fractal-presets-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const added = importHistory(await file.text())
      setNote(`Imported ${added} preset${added === 1 ? '' : 's'}.`)
      refresh()
    } catch (err) {
      setNote(err.message)
    } finally {
      event.target.value = ''
      setTimeout(() => setNote(null), 4000)
    }
  }

  if (!entries.length) {
    return (
      <section className="history">
        <p className="silk-label">Saved presets</p>
        <p className="hint">
          Presets you design are saved here automatically, and can be reloaded onto any preset
          later.
        </p>
        <div className="history-actions">
          <button className="chip" onClick={moveAll} disabled={busy || !entries.length}>
            Move all into the folder
          </button>
          <button className="chip" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            onChange={upload}
            style={{ display: 'none' }}
          />
        </div>
        {note ? <p className="hint">{note}</p> : null}
      </section>
    )
  }

  return (
    <section className="history">
      <div className="history-head">
        <p className="silk-label">Saved presets · {entries.length}</p>
        <div className="history-actions">
          <button className="chip" onClick={download}>
            Export
          </button>
          <button className="chip" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <button
            className="chip"
            onClick={() => {
              clearHistory()
              refresh()
            }}
          >
            Clear all
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            onChange={upload}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {note ? <p className="hint">{note}</p> : null}

      <div className="history-list">
        {entries.map((entry) => {
          const open = expanded === entry.id
          const spent = costOf(entry.usage, entry.usage?.model)

          return (
            <div className="history-entry" key={entry.id}>
              <div className="history-row">
                <button
                  className="history-title"
                  onClick={() => setExpanded(open ? null : entry.id)}
                  aria-expanded={open}
                >
                  <span className="history-name">{entry.name}</span>
                  <span className="history-when mono">{formatWhen(entry.at)}</span>
                </button>
                <button onClick={() => onReload(entry)} disabled={busy}>
                  Reload
                </button>
              </div>

              {entry.description ? <p className="history-desc">{entry.description}</p> : null}

              {open ? (
                <div className="history-detail">
                  {entry.summary ? <p className="summary">{entry.summary}</p> : null}

                  <div className="history-meta mono">
                    {entry.blockNames?.length ? entry.blockNames.join(' · ') : 'no blocks recorded'}
                    {spent !== null ? ` · cost ${formatCost(spent)}` : ''}
                    {entry.device ? ` · ${entry.device}` : ''}
                  </div>

                  {renaming === entry.id ? (
                    <div className="rename-row">
                      <input
                        type="text"
                        value={draft}
                        autoFocus
                        maxLength={31}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && commitRename(entry.id)}
                        aria-label="Preset name"
                      />
                      <button onClick={() => commitRename(entry.id)}>Save name</button>
                      <button onClick={() => setRenaming(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="history-actions">
                      <button
                        className="chip"
                        onClick={() => {
                          setDraft(entry.name)
                          setRenaming(entry.id)
                        }}
                      >
                        Rename
                      </button>
                      <button className="chip" onClick={() => remove(entry.id)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <p className="hint history-note">
        Reloading re-checks a saved preset against whatever is on the unit now and stops at the
        preview — nothing is written until you send it.
      </p>
    </section>
  )
}
