import { useEffect, useMemo, useRef, useState } from 'react'
import { selectPreset, liveMeters } from '../lib/forgefx'
import {
  useDevice,
  refreshBlocks as reReadChain,
  refreshScene,
  refreshSceneNames,
  writeScene,
  writeBypass,
  writeTuner
} from '../lib/deviceState'
import { remoteActive } from '../lib/remote'
import { EXCLUDED_BLOCKS } from '../lib/guardrails'
import { blockColor } from '../lib/blockColors'
import { tick as haptic } from '../lib/feedback'
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
/* Hoisted: a selector rebuilt each render re-reads the store on every notify. */
const ofScene = (s) => s.sceneIndex
const ofSceneNames = (s) => s.sceneNames
const ofBlocks = (s) => s.blocks
const ofTunerOn = (s) => s.tunerOn
const ofTuning = (s) => s.tuning

export default function Gig({ preset, device, capabilities, onError, onChanged, onPickPreset }) {
  /*
   * A view over the one device state, not a second client to the unit.
   *
   * This screen used to keep its own scene, its own block list, its own tuner
   * and its own subscription to the event stream — so two clients contended
   * for a serial port that serialises every request, and a footswitch press
   * arrived twice and was answered with two preset dumps.
   */
  const scene = useDevice(ofScene)
  const names = useDevice(ofSceneNames)
  const allBlocks = useDevice(ofBlocks)
  const tunerOn = useDevice(ofTunerOn)
  const tuning = useDevice(ofTuning)

  // Input, output, looper and gate are not stage controls.
  const blocks = useMemo(
    () => allBlocks.filter((b) => b.slug && !EXCLUDED_BLOCKS.includes(b.slug)),
    [allBlocks]
  )

  const [meters, setMeters] = useState([])
  const [working, setWorking] = useState(false)
  const [toggling, setToggling] = useState(null)
  const [xyOn, setXyOn] = useState(false)
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
    // The list lives in the store; what's local is whether the last read
    // worked. A unit that won't report its chain still gets scenes and preset
    // steps — but it says so rather than showing an empty row and letting you
    // assume the preset is empty.
    setChain((await reReadChain()) ? 'ok' : 'failed')
  }

  /*
   * A scene changed by footswitch is still a scene change — and it is the store
   * that hears it now, for every screen at once. What is left here is noting
   * that a reading arrived, which is how this screen tells a running tuner from
   * a silent one.
   */
  useEffect(() => {
    if (!tuning) return
    lastTunerAt.current = Date.now()
    setTunerStalled(false)
  }, [tuning])

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
      await refreshScene()
      // Names aren't in the scene query on either device family — they live in
      // the preset body. On stage the name is the whole point of the button:
      // "Lead" is findable at a glance, "3" means remembering what 3 was.
      await refreshSceneNames(preset?.number)
      if (!stop) await refreshBlocks()
    })()
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    try {
      // ForgeFX answers {ok:false} — not an error — when the attached unit has
      // no tuner path in this build. The store turns the tuner back off for
      // that answer; silence here looked exactly like a tuner that was warming
      // up, forever.
      const res = await writeTuner(next)
      if (next && res && res.ok === false) {
        onError('ForgeFX refused the tuner for this unit — its build may predate tuner support for it.')
      }
    } catch (err) {
      onError(err.message)
    }
  }

  /*
   * Leaving gig mode with the tuner running would leave the poll running for a
   * display nobody can see. Cleanup turns it off with the same best-effort
   * shrug as the toggle itself.
   */
  useEffect(() => {
    if (!tunerOn) return undefined
    // Through the store, so the shared tunerOn goes down with it. Turning the
    // unit's tuner off while the store still believed it was on left the top
    // bar's tuner button lit for a tuner nobody could see.
    return () => {
      writeTuner(false).catch(() => {})
    }
  }, [tunerOn])

  const pickScene = async (index) => {
    haptic()
    try {
      // Optimistic inside the store: the footswitch feel matters more than the
      // round trip, and a refusal puts the old scene back.
      await writeScene(index)
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
    haptic()
    const eid = block.effectId
    const wanted = !block.bypassed
    setToggling(eid)
    try {
      await writeBypass(eid, wanted)
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

  // `norm`, not `level` — the monitor route reports a normalised 0..1 per
  // monitored parameter. Reading the field the old mock invented pinned this
  // bar at zero on hardware, so the one thing on this screen that says "signal
  // is getting through" always said it wasn't.
  const peak = meters.length ? Math.max(...meters.map((m) => m.norm ?? 0)) : 0

  return (
    <div className="gig">
      {/*
        The name, big, and only the name.
        The unit and the slot are in the bar above this, at every moment, on
        every screen — repeating them here cost 30px on the one screen where
        vertical space is scenes you have to hit without looking. The name
        stays large because that is this screen's job: it is the thing you
        read from arm's length, in the dark, to know where you are.
      */}
      {/*
        The biggest word on the screen was the one thing you could not press.
        Everyone tries — it names the preset, so it should be the way to a
        different one. It opens the same menu the top bar opens rather than a
        second list of its own: one preset picker, two ways in.
      */}
      <div className="gig-preset">
        <button
          type="button"
          className="gig-name"
          onClick={onPickPreset}
          disabled={!onPickPreset}
          aria-label={`${preset?.name?.trim() || 'Untitled'} — choose another preset`}
        >
          <span>{preset?.name?.trim() || 'Untitled'}</span>
          <span className="gig-name-caret" aria-hidden="true">
            ⌄
          </span>
        </button>
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

      {/*
        Two modes, one row.
        They were a stacked pair of full-width buttons — 98px of the screen,
        between the preset you just changed and the scenes you are about to
        press, for two things you enter occasionally and never mid-phrase. Side
        by side they cost one row, and the panel each opens still lands
        directly underneath, in view, where the tap was.

        Same rule as scenes for the tuner: a unit whose driver reports none
        doesn't get a button that can only disappoint. Absent means unknown —
        an older ForgeFX predating the flag — and unknown still gets to try.
      */}
      <div className="gig-modes">
        {capabilities?.tuner !== false ? (
          <button
            className={`gig-mode ${tunerOn ? 'on' : ''}`}
            onClick={toggleTuner}
            aria-pressed={tunerOn}
          >
            Tuner
          </button>
        ) : null}
        <button
          className={`gig-mode ${xyOn ? 'on' : ''}`}
          onClick={() => setXyOn(!xyOn)}
          aria-pressed={xyOn}
        >
          XY pad
        </button>
      </div>

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

      {/* Live even while hidden would be wrong the other way: the pad holds no
          poll and writes only under a finger, so mount/unmount is free. */}
      {xyOn ? <XYPad blocks={blocks} onError={onError} /> : null}

      {/* Scenes lead. A scene is the bigger move and it sets every block state
          below it, so cause sits above effect rather than under it. */}
      {hasScenes ? (
        /* Named as a group. On screen the grid is obvious enough in context;
           read aloud it was eight buttons called "1" through "8", between two
           other grids of buttons, with nothing saying what any of them do. */
        <div className="gig-scenes" role="group" aria-label="Scenes">
          {Array.from({ length: sceneCount }, (_, i) => (
            <button
              key={i}
              className={`gig-scene ${i === scene ? 'current' : ''} ${
                names[i] ? 'named' : ''
              }`}
              /* The word "Scene" belongs in the label even though it is left
                 off the face, for the same reason the group is named: a bare
                 "3" is not a control anyone can identify. */
              aria-label={`Scene ${i + 1}${names[i] ? ` — ${names[i]}` : ''}`}
              aria-pressed={i === scene}
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

      {/*
        What that grid of numbers is, said once, to the only people who cannot
        tell.

        A preset whose scenes are named explains itself — "1 Rhythm, 2 Lead"
        needs no caption, and adding one would put a permanent line of grey
        text above the control every player uses most. A preset where none of
        them are named is eight numbered buttons between two other grids of
        buttons, which is exactly where a newcomer stalls. So the caption is
        tied to the ambiguity rather than to being new: name one scene and it
        goes, for good.

        The remote case has its own note directly below saying the names could
        not be read, which is a different and more specific thing to say — so
        these two are mutually exclusive rather than stacked.
      */}
      {hasScenes && !names.some((n) => (n || '').trim()) && !remoteActive() ? (
        <p className="gig-note">
          {/* Both routes named here are ones that really exist: a scene plan
              from Create writes each scene's name as it goes, and the Scenes
              sheet on Edit renames one directly. */}
          Those are scenes &mdash; the same blocks, switched on and off in different combinations.
          Tap one to hear it. Ask Create for a rhythm and a lead and it builds them named, or name
          them yourself under Scenes on Edit.
        </p>
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
