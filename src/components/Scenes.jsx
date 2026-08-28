import { useEffect, useState } from 'react'
import { getScene, setScene, setSceneName, setChannel, forgetSceneNames } from '../lib/forgefx'

/**
 * Scenes and per-block channels.
 *
 * A scene is a snapshot of which blocks are on and which channel each is using
 * — eight of them per preset, switchable by footswitch. That's how one preset
 * covers a whole set, so it belongs next to the grid rather than buried.
 *
 * Channels are the other axis: each block holds four independent versions of
 * its settings, so an amp can carry a clean and a lead voicing without a second
 * block.
 */
export default function Scenes({
  blocks,
  preset,
  count = 8,
  channelNames,
  hasScenes = true,
  onChanged,
  onError,
  busy
}) {
  // Not every Fractal unit has both. Rendering eight scene buttons for a device
  // that reports none would be inventing hardware.
  const channels = channelNames?.length ? channelNames : ['A', 'B', 'C', 'D']
  const [current, setCurrent] = useState(null)
  const [names, setNames] = useState([])
  const [renaming, setRenaming] = useState(null)
  const [draft, setDraft] = useState('')

  const load = async () => {
    try {
      const res = await getScene()
      setCurrent(typeof res?.index === 'number' ? res.index : null)
      setNames(Array.isArray(res?.names) ? res.names : [])
    } catch (err) {
      onError(err.message)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const jump = async (index) => {
    try {
      await setScene(index)
      setCurrent(index)
      onChanged(`Switched to scene ${index + 1}`)
      await load()
    } catch (err) {
      onError(err.message)
    }
  }

  const rename = async (index) => {
    const name = draft.trim()
    setRenaming(null)
    if (!name) return
    try {
      await setSceneName(index, name)
      // Gig keeps a copy so a remote session can still show names. Drop it, or
      // the old name outlives the thing it named.
      forgetSceneNames(preset?.number)
      onChanged(`Named scene ${index + 1} "${name}"`)
      await load()
    } catch (err) {
      onError(err.message)
    }
  }

  const channel = async (block, ch) => {
    try {
      await setChannel(block.effectId, ch)
      onChanged(`${block.name} → channel ${ch}`)
    } catch (err) {
      onError(err.message)
    }
  }

  const channelled = blocks.filter((b) => b.channel)

  if (!hasScenes && !channelled.length) return null

  return (
    <section className="scenes">
      {hasScenes ? <p className="silk-label">Scenes</p> : null}
      <div className="scene-row" hidden={!hasScenes}>
        {Array.from({ length: hasScenes ? count : 0 }, (_, i) => (
          <div key={i} className="scene-cell">
            <button
              className={`scene ${i === current ? 'current' : ''}`}
              onClick={() => jump(i)}
              disabled={busy}
              onDoubleClick={() => {
                setDraft(names[i] || '')
                setRenaming(i)
              }}
              title="Double-click to rename"
            >
              <span className="scene-num mono">{i + 1}</span>
              <span className="scene-name">{names[i] || '—'}</span>
            </button>
          </div>
        ))}
      </div>

      {renaming !== null ? (
        <div className="rename-row">
          <input
            type="text"
            value={draft}
            maxLength={31}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && rename(renaming)}
            aria-label={`Name for scene ${renaming + 1}`}
          />
          <button onClick={() => rename(renaming)}>Name scene {renaming + 1}</button>
          <button onClick={() => setRenaming(null)}>Cancel</button>
        </div>
      ) : (
        <p className="hint">Double-click a scene to name it.</p>
      )}

      {channelled.length ? (
        <>
          <p className="silk-label channels-label">Channels</p>
          <div className="channel-list">
            {channelled.map((block) => (
              <div className="channel-row" key={block.effectId}>
                <span className="diff-label">{block.name}</span>
                <div className="channel-buttons">
                  {channels.map((ch) => (
                    <button
                      key={ch}
                      className={`chip ${block.channel === ch ? 'active' : ''}`}
                      onClick={() => channel(block, ch)}
                      disabled={busy}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
