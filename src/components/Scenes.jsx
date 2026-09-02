import { useState } from 'react'
import { setSceneName, setChannel, forgetSceneNames } from '../lib/forgefx'
import { useDevice, refreshScene, writeScene } from '../lib/deviceState'

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
/* Hoisted: one function for the life of the module, so the store isn't re-read
   on every notify. */
const ofScene = (s) => s.sceneIndex
const ofSceneNames = (s) => s.sceneNames

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
  /*
   * From the store, so this panel keeps up.
   *
   * It read the scene once at mount and never again. Change scene from the gig
   * screen, the home list or a footswitch, and this panel went on highlighting
   * whatever was live when it rendered — confidently, and wrong, until
   * something remounted it.
   */
  const current = useDevice(ofScene)
  const names = useDevice(ofSceneNames)
  const [renaming, setRenaming] = useState(null)
  const [draft, setDraft] = useState('')

  const startRename = (i) => {
    setDraft(names[i] || '')
    setRenaming(i)
  }

  const jump = async (index) => {
    try {
      await writeScene(index)
      onChanged(`Switched to scene ${index + 1}`)
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
      await refreshScene()
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
            {/*
              Tap to go there; tap the one you are in to name it. This was a
              double-click, which never fired: the first click jumped, the jump
              re-read the unit, the re-read disabled the button, and a disabled
              button dispatches no second click. A phone had no path at all.
            */}
            <button
              className={`scene ${i === current ? 'current' : ''}`}
              onClick={() => (i === current ? startRename(i) : jump(i))}
              disabled={busy}
              title={i === current ? 'Tap again to name this scene' : `Switch to scene ${i + 1}`}
            >
              <span className="scene-num mono">{i + 1}</span>
              <span className="scene-name">{names[i] || '—'}</span>
            </button>
            {/* And a pencil, for naming a scene without switching to it. */}
            <button
              className="scene-pencil"
              onClick={() => startRename(i)}
              disabled={busy}
              aria-label={`Name scene ${i + 1}`}
              title="Name this scene"
            >
              ✎
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
        <p className="hint">Tap the scene you&rsquo;re in again to name it, or ✎ on any scene.</p>
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
