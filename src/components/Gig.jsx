import { useEffect, useState } from 'react'
import {
  getScene,
  setScene,
  selectPreset,
  liveMeters,
  readSceneNames,
  presetBlocks,
  setBypass,
  subscribeEvents
} from '../lib/forgefx'
import { remoteActive } from '../lib/remote'
import { EXCLUDED_BLOCKS } from '../lib/guardrails'

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
  const [blocks, setBlocks] = useState([])
  const [toggling, setToggling] = useState(null)
  /*
   * 'reading' | 'ok' | 'failed'.
   *
   * A read that fell over and a preset with nothing in it used to look the same
   * on this screen: no buttons, no explanation. They are not the same, and the
   * difference matters most on the one where you can't see the unit — a phone at
   * the far side of a stage, where the read travels a relay and can time out.
   */
  const [chain, setChain] = useState('reading')

  /**
   * What's on and what's off, as the unit currently has it.
   *
   * Read rather than remembered. Each scene carries its own bypass states, so
   * the answer changes the moment a scene does — and it can change without this
   * app doing anything, from a footswitch or the unit's own front panel.
   */
  const refreshBlocks = async ({ quiet = false } = {}) => {
    if (!quiet) setChain('reading')
    try {
      const list = await presetBlocks()
      const usable = (Array.isArray(list) ? list : []).filter(
        (b) => b.slug && !EXCLUDED_BLOCKS.includes(b.slug)
      )
      setBlocks(usable)
      setChain('ok')
    } catch {
      // A unit that won't report its chain still gets scenes and preset steps —
      // but it says so rather than showing an empty row and letting you assume
      // the preset is empty.
      setBlocks([])
      setChain('failed')
    }
  }

  /*
   * A scene changed by footswitch is still a scene change.
   *
   * On stage most switching happens on the floor, not in this app. Without
   * this the buttons would show the states of whatever scene was last picked
   * here, which is worse than showing nothing — it would look authoritative and
   * be wrong.
   */
  useEffect(() => {
    const unsubscribe = subscribeEvents((event) => {
      if (event?.type === 'scene' && typeof event.index === 'number') setSceneIndex(event.index)
      if (event?.type === 'scene' || event?.type === 'changed') refreshBlocks({ quiet: true })
    })
    return unsubscribe
  }, [])

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

      if (!stop) await refreshBlocks()
    })()
    return () => {
      stop = true
    }
  }, [preset])

  /*
   * The signal bar, at a cadence the connection can afford.
   *
   * Twice a second is nothing over localhost. Over the relay it is a broadcast
   * round trip every 500ms competing for the same serial port as the reads that
   * actually matter — the block list on an AM4 is a full preset dump, and a
   * meter poll in front of it is why that read was timing out. Meters are a
   * nicety; the chain is the screen.
   */
  useEffect(() => {
    let stop = false
    const tick = async () => {
      const remote = remoteActive()
      if (!(typeof document !== 'undefined' && document.hidden)) {
        try {
          const data = await liveMeters()
          if (!stop) setMeters(Array.isArray(data) ? data : data?.blocks || [])
        } catch {
          /* meters are a nicety here, not worth surfacing an error over */
        }
      }
      if (!stop) setTimeout(tick, remote ? 2000 : 500)
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
      // The new scene brings its own on/off states with it.
      await refreshBlocks()
    } catch (err) {
      onError(err.message)
    }
  }

  /**
   * Turn one block on or off.
   *
   * Optimistic, then confirmed. On a stage the tap has to look like it worked
   * immediately; the read that follows is what makes sure it actually did, and
   * puts the button back if it didn't.
   */
  const toggle = async (block) => {
    const eid = block.effectId
    const wanted = !block.bypassed
    setToggling(eid)
    setBlocks((prev) => prev.map((b) => (b.effectId === eid ? { ...b, bypassed: wanted } : b)))
    try {
      await setBypass(eid, wanted)
      await refreshBlocks()
    } catch (err) {
      onError(err.message)
      await refreshBlocks()
    } finally {
      setToggling(null)
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

      {/* Scenes lead. A scene is the bigger move and it sets every block state
          below it, so cause sits above effect rather than under it. */}
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
              {/* No name means no name — repeating the number as "Scene 3"
                  fills the row with a word that carries nothing, and makes an
                  unnamed scene look identical to a named one. */}
              {names[i] ? <span className="gig-scene-name">{names[i]}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* An AM4 keeps its scene names inside a preset dump, and dumps don't
          travel the relay. Silence there reads as "this preset has unnamed
          scenes", which is a different and wrong thing to believe. */}
      {hasScenes && !names.some((n) => (n || '').trim()) && remoteActive() ? (
        <p className="gig-note">
          Scene names aren&rsquo;t readable over a remote session. Open this preset once at the
          Mac and they&rsquo;ll show here from then on.
        </p>
      ) : null}

      {chain === 'failed' ? (
        <div className="gig-note gig-note-action">
          <span>
            Couldn&rsquo;t read the chain{remoteActive() ? ' over the remote session' : ''}, so
            there&rsquo;s nothing to switch here yet.
          </span>
          <button onClick={() => refreshBlocks()}>Try again</button>
        </div>
      ) : chain === 'reading' && !blocks.length ? (
        <p className="gig-note">Reading the chain&hellip;</p>
      ) : !blocks.length ? (
        <p className="gig-note">Nothing switchable in this preset.</p>
      ) : null}

      {blocks.length ? (
        <div className="gig-blocks">
          {blocks.map((block) => (
            <button
              key={block.effectId}
              className={`gig-block ${block.bypassed ? 'off' : 'on'}`}
              onClick={() => toggle(block)}
              disabled={toggling === block.effectId}
              aria-pressed={!block.bypassed}
            >
              <span className="gig-block-name">{block.name || block.slug}</span>
              <span className="gig-block-state">{block.bypassed ? 'Off' : 'On'}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
