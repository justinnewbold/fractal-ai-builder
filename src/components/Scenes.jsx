import { useState } from 'react'
import { setSceneName, setChannel, noteSceneName } from '../lib/forgefx'
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
      /*
       * Kept, not dropped.
       *
       * This forgot the cached names, so that an old name could not outlive the
       * thing it named. Sound where a name changed elsewhere; wrong here, where
       * we are the one who changed it and know what to. On a phone the cache is
       * not a convenience but the only copy there is — dumps do not travel the
       * relay — so forgetting left the name on the hardware and unreadable from
       * the handset that had just written it. See noteSceneName.
       */
      noteSceneName(preset?.number, index, name, names)
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
      {/*
        One tile per scene, and the tile is the whole target.

        There was a pencil beside every one of them — eight extra 44px buttons
        for something you do once a preset — and the tile itself was two
        different actions depending on which one you tapped, with the
        difference explained in a hint. "Let's make the bigger buttons where
        you tap them to switch, and then if you wanna edit the scene just have
        a single button that says edit name."

        So: tapping a tile goes there, always. Naming is one button, below,
        about the scene you are in.
      */}
      <div className="scene-row" hidden={!hasScenes}>
        {Array.from({ length: hasScenes ? count : 0 }, (_, i) => (
          <button
            key={i}
            className={`scene ${i === current ? 'current' : ''}`}
            onClick={() => jump(i)}
            disabled={busy}
            title={`Switch to scene ${i + 1}`}
            aria-current={i === current}
          >
            <span className="scene-num mono">{i + 1}</span>
            <span className="scene-name">{names[i] || '\u2014'}</span>
          </button>
        ))}
      </div>

      {hasScenes && renaming === null ? (
        <button
          className="chip scene-edit-name"
          onClick={() => startRename(current)}
          disabled={busy}
        >
          Edit name
        </button>
      ) : null}

      {renaming !== null ? (
        <div className="rename-row">
          <input
            type="text"
            value={draft}
            maxLength={31}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') rename(renaming)
              // Escape leaves the row the way Cancel does — a half-typed name is not a
              // name. Stopped here, or the sheet takes the same key and closes too.
              else if (e.key === 'Escape') {
                e.stopPropagation()
                setRenaming(null)
              }
            }}
            aria-label={`Name for scene ${renaming + 1}`}
          />
          <button onClick={() => rename(renaming)}>Name scene {renaming + 1}</button>
          <button onClick={() => setRenaming(null)}>Cancel</button>
        </div>
      ) : null}

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
