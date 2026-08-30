import { useEffect, useRef, useState } from 'react'
import {
  getScene,
  setScene,
  selectPreset,
  liveMeters,
  readSceneNames,
  presetBlocks,
  setBypass,
  setTuner,
  subscribeEvents
} from '../lib/forgefx'
import { remoteActive } from '../lib/remote'
import { EXCLUDED_BLOCKS } from '../lib/guardrails'
import { blockColor } from '../lib/blockColors'
import { Tuner } from './Console'
import XYPad from './XYPad'

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
  const [tunerOn, setTunerOn] = useState(false)
  const [xyOn, setXyOn] = useState(false)
  const [tuning, setTuning] = useState(null)
  /*
   * Whether readings are actually arriving while the tuner is on.
   *
   * The tuner can be genuinely running on the unit with nothing reaching this
   * screen: ForgeFX starts the poll for any client, but its remote relay
   * deliberately doesn't bridge the tuner stream (it filters high-frequency
   * telemetry), so on a phone the overlay would sit at "Play a string" forever
   * while the Mac quietly polls the port. That silence needs words. Tracked by
   * time rather than a boolean so a patched or newer ForgeFX that does bridge
   * the stream lights this screen up with no app change.
   */
  const [tunerStalled, setTunerStalled] = useState(false)
  const lastTunerAt = useRef(0)
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
      if (event?.type === 'tuner') {
        lastTunerAt.current = Date.now()
        setTunerStalled(false)
        setTuning(event)
      }
    })
    return unsubscribe
  }, [])

  // Five seconds of a running tuner with no reading is not "play louder".
  useEffect(() => {
    if (!tunerOn) {
      setTunerStalled(false)
      return
    }
    const since = Date.now()
    const timer = setTimeout(() => {
      if (lastTunerAt.current < since) setTunerStalled(true)
    }, 5000)
    return () => clearTimeout(timer)
  }, [tunerOn])

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

  /**
   * The tuner, on this screen, where tuning actually happens.
   *
   * There is nothing to open on the unit — the AM4's tuner block is always
   * live, and what "the tuner works in Axis" turned out to mean is a display in
   * the app, fed by the same poll. So that is what this is. POST /tuner and the
   * bridged events both travel the relay, so it works the same from a phone.
   */
  const toggleTuner = async () => {
    const next = !tunerOn
    setTunerOn(next)
    if (!next) setTuning(null)
    try {
      const res = await setTuner(next)
      // ForgeFX answers {ok:false} — not an error — when the attached unit has
      // no tuner path in this build. Silence here looked exactly like a tuner
      // that was warming up, forever.
      if (next && res && res.ok === false) {
        setTunerOn(false)
        onError('ForgeFX refused the tuner for this unit — its build may predate tuner support for it.')
      }
    } catch (err) {
      setTunerOn(!next)
      onError(err.message)
    }
  }

  /*
   * Leaving gig mode with the tuner running would leave the poll running for a
   * display nobody can see. Cleanup turns it off with the same best-effort
   * shrug as the toggle itself.
   */
  useEffect(() => {
    if (!tunerOn) return
    return () => setTuner(false).catch(() => {})
  }, [tunerOn])

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

      {/* Same rule as scenes: a unit whose driver reports no tuner doesn't get
          a tuner button that can only disappoint. Absent means unknown (an
          older ForgeFX that predates the flag), and unknown still gets to try. */}
      {capabilities?.tuner !== false ? (
        <button
          className={`gig-tuner-btn ${tunerOn ? 'on' : ''}`}
          onClick={toggleTuner}
          aria-pressed={tunerOn}
        >
          {tunerOn ? 'Tuner off' : 'Tuner'}
        </button>
      ) : null}

      {tunerOn ? (
        <div className="gig-tuner">
          <Tuner reading={tuning} on={tunerOn} />
        </div>
      ) : null}

      {/* The tuner is running — POST /tuner said ok — but nothing has arrived.
          Over a remote session that is ForgeFX's relay by design: it bridges
          discrete changes and filters the high-frequency tuner stream, so the
          unit is being polled at the Mac and every reading stays there. Saying
          so beats a needle that never moves. */}
      {tunerOn && tunerStalled ? (
        <p className="gig-note">
          {remoteActive()
            ? 'The tuner is running on the unit, but ForgeFX doesn’t send tuner readings over a remote session yet — they only reach the app at the Mac. Tune there, or from a browser on the Mac’s own address.'
            : 'No readings are arriving from ForgeFX. If the unit is making sound, this ForgeFX build may not support the tuner on it — try updating ForgeFX.'}
        </p>
      ) : null}

      <button
        className={`gig-tuner-btn ${xyOn ? 'on' : ''}`}
        onClick={() => setXyOn(!xyOn)}
        aria-pressed={xyOn}
      >
        {xyOn ? 'Close XY pad' : 'XY pad'}
      </button>

      {/* Live even while hidden would be wrong the other way: the pad holds no
          poll and writes only under a finger, so mount/unmount is free. */}
      {xyOn ? <XYPad blocks={blocks} onError={onError} /> : null}

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
              style={{
                '--block-fill': blockColor(block.slug).fill,
                '--block-ink': blockColor(block.slug).ink
              }}
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
