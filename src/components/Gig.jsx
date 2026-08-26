import { useEffect, useState } from 'react'
import { getScene, setScene, selectPreset, liveMeters, readSceneNames } from '../lib/forgefx'

/**
 * The stand, not the bench.
 *
 * Nothing here designs anything. On stage you need to know what preset you're
 * on, get to the next one, and see that signal is arriving — with targets big
 * enough to hit without looking closely, on a phone, in the dark, possibly
 * mid-song.
 *
 * Everything else in this app is deliberately absent. A generate button within
 * reach of a stage tap is a hazard.
 */
export default function Gig({ preset, device, capabilities, onError, onChanged }) {
  const [scene, setSceneIndex] = useState(0)
  const [names, setNames] = useState([])
  const [meters, setMeters] = useState([])
  const [working, setWorking] = useState(false)

  const sceneCount = capabilities?.sceneCount || 8
  const hasScenes = capabilities?.hasScenes !== false

  useEffect(() => {
    let stop = false
    ;(async () => {
      try {
        const res = await getScene()
        if (!stop && typeof res?.index === 'number' && res.index >= 0) setSceneIndex(res.index)
      } catch {
        /* a unit without scenes just shows none */
      }

      // Names aren't in the scene query on either device family — they live in
      // the preset body. On stage the name is the whole point of the button:
      // "Lead" is findable at a glance, "3" means remembering what 3 was.
      try {
        const found = await readSceneNames(preset?.number)
        if (!stop) setNames(found)
      } catch {
        if (!stop) setNames([])
      }
    })()
    return () => {
      stop = true
    }
  }, [preset])

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const data = await liveMeters()
        if (!stop) setMeters(Array.isArray(data) ? data : data?.blocks || [])
      } catch {
        /* meters are a nicety here, not worth surfacing an error over */
      }
      if (!stop) setTimeout(tick, 500)
    }
    tick()
    return () => {
      stop = true
    }
  }, [])

  const pickScene = async (index) => {
    setSceneIndex(index) // optimistic: the footswitch feel matters more than the round trip
    try {
      await setScene(index)
    } catch (err) {
      onError(err.message)
    }
  }

  const step = async (delta) => {
    const next = (preset?.number ?? 0) + delta
    if (next < 0) return
    setWorking(true)
    try {
      await selectPreset(next)
      onChanged()
    } catch (err) {
      onError(err.message)
    } finally {
      setWorking(false)
    }
  }

  const peak = meters.length ? Math.max(...meters.map((m) => m.level ?? 0)) : 0

  return (
    <div className="gig">
      <div className="gig-preset">
        <span className="silk-label">
          {device?.short || device?.name || 'Device'} · slot {preset?.number}
        </span>
        <h2 className="gig-name">{preset?.name?.trim() || 'Untitled'}</h2>
      </div>

      <div className="gig-signal" aria-label="Signal level">
        <div className="gig-signal-fill" style={{ width: `${Math.round(peak * 100)}%` }} />
      </div>

      <div className="gig-nav">
        <button onClick={() => step(-1)} disabled={working || (preset?.number ?? 0) <= 0}>
          ‹ Previous
        </button>
        <button onClick={() => step(1)} disabled={working}>
          Next ›
        </button>
      </div>

      {hasScenes ? (
        <div className="gig-scenes">
          {Array.from({ length: sceneCount }, (_, i) => (
            <button
              key={i}
              className={`gig-scene ${i === scene ? 'current' : ''} ${
                names[i] ? 'named' : ''
              }`}
              onClick={() => pickScene(i)}
            >
              <span className="gig-scene-num mono">{i + 1}</span>
              <span className="gig-scene-name">{names[i] || `Scene ${i + 1}`}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
