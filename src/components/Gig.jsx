import { useEffect, useMemo, useRef, useState } from 'react'
import { selectPreset, liveMeters, setChannel, setMetersWanted, tapTempo } from '../lib/forgefx'
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
import { sceneColor } from '../lib/sceneColors'
import { shortBlock } from '../lib/shortName'
import { presetLabel } from '../lib/presetName'
import { tick as haptic } from '../lib/feedback'
import { useLongPress } from '../lib/longPress'
import { useDismiss } from '../lib/dismiss'
import { Tuner } from './Console'
import { sizeVars, SIZES } from '../lib/gigSize'

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

export default function Gig({ preset, device, capabilities, size, onSize, onError, onChanged, onPickPreset }) {
  /*
   * How big the buttons are is decided in the tab bar, a row this screen does
   * not own, so the step arrives as a prop. Only the CSS variables are applied
   * here — on the element the two grids actually read them from. See App's
   * `size` state and lib/gigSize.
   */
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
  /* What a block can be switched between, straight off the unit's own report —
     the same list the block sheet on Edit has always used. */
  const channels = capabilities?.channelNames

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
   * The signal bar, at a cadence the connection can afford — and asking for
   * ONE block, not all of them.
   *
   * This asked for every block's monitors twice a second. The host can only
   * answer that by fetching the whole grid first, and its own note in
   * gen3.ts liveMonitors() says what that costs: grid()'s cache lasts 500ms,
   * so an all-blocks call on a 500ms tick fires "a full ~24KB preset dump on
   * every tick", serialised ahead of every other read on a port that takes one
   * request at a time. That author called the all-blocks form "(rare)". This
   * screen made it the resting state, and on a phone this screen is the app.
   *
   * The unit was doing all of that while also making sound — reported as the
   * audio cutting out whenever the app was open and stopping the moment it was
   * closed.
   *
   * One block is all this bar ever needed. It draws a single number, the peak,
   * and the output block is where the signal leaving the unit actually is. If
   * the chain has not arrived yet there is nothing to ask about, and asking
   * anyway is what fetched the grid.
   */
  const meterEid = useMemo(
    () => allBlocks.find((b) => b.slug === 'output')?.effectId ?? null,
    [allBlocks]
  )

  /*
   * And tell the HOST, which is the expensive half.
   *
   * Stopping this screen's own poll stops one request every 500ms. The host's
   * telemetry supervisor is the other thing, and it does not watch this
   * screen: it starts on its first event listener and runs four output-meter
   * round trips every 100ms for as long as anything is subscribed — about
   * forty SysEx transactions a second at a unit that is also making sound.
   * Nothing here could reach it, so nothing did.
   *
   * Off, it keeps the front-panel scene and channel watches (a footswitch
   * press still lands) and drops to two reads every 800ms.
   */
  useEffect(() => {
    const wanted = meterEid !== null && size !== 0
    setMetersWanted(wanted).catch(() => {
      /* An older host without the route keeps the behaviour it already had. */
    })
  }, [meterEid, size])

  useEffect(() => {
    // Hidden at the smallest size, and a bar nobody can see is not worth a
    // round trip to the unit — let alone one every half second, on the size
    // step whose whole reason to exist is a rig that has to fit.
    if (meterEid === null || size === 0) {
      setMeters([])
      return undefined
    }
    let stop = false
    const tick = async () => {
      const remote = remoteActive()
      if (!(typeof document !== 'undefined' && document.hidden)) {
        try {
          const data = await liveMeters(meterEid)
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
  }, [meterEid, size])

  /**
   * The tuner, on this screen, where tuning actually happens.
   *
   * There is nothing to open on the unit — the AM4's tuner block is always
   * live, and what "the tuner works in Axis" turned out to mean is a display in
   * the app, fed by the same poll. So that is what this is.
   *
   * The line that used to sit here said the readings travel the relay "so it
   * works the same from a phone". They did not, and it did not: the host bridged
   * five kinds of event and dropped the tuner with the meter cadence, so a phone
   * got a display and no numbers. Two comments in this one file disagreed about
   * it, and the wrong one was the one next to the code. The host relays them now
   * (forgefx.lock.json), which is what makes this true rather than intended.
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
        onError('The unit refused the tuner — the Fractal app on the Mac may need updating.')
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

  /*
   * Tap tempo, which had no button anywhere.
   *
   * forgefx.js has carried tapTempo() the whole time and nothing called it —
   * so the one control on this screen a player uses WHILE PLAYING, in time,
   * was the one control that did not exist. It sits in the bar at the bottom
   * next to the tuner: the two things you reach for between songs rather than
   * inside one, and the two that were competing with the scenes for the
   * middle of the screen.
   */
  const [tapping, setTapping] = useState(false)
  const tap = async () => {
    setTapping(true)
    try {
      await tapTempo()
      haptic()
    } catch (err) {
      onError(err.message)
    } finally {
      setTapping(false)
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
    /*
     * At the smallest step this is not just smaller tiles: the chrome above
     * the grids gives way too. Measured on a 440x790 phone, that chrome was
     * 441px — more than half the screen — before a single scene appeared, and
     * the preset name inside it is already in the bar at the top of the app.
     * Smallest is the setting for someone who wants the whole rig on one
     * screen, so it spends the screen on the rig.
     */
    <div
      className="gig"
      data-compact={size === 0 ? 'yes' : undefined}
      /* Three effects to a row still fits a name; four does not. The switch to
         three letters rides the column count rather than a width guess. */
      data-fx-abbr={SIZES[size].fx >= 4 ? 'yes' : undefined}
      style={sizeVars(size)}
    >
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
          aria-label={`${presetLabel(preset)} — choose another preset`}
        >
          <span>{presetLabel(preset)}</span>
          <span className="gig-name-caret" aria-hidden="true">
            ⌄
          </span>
        </button>
        {/*
          The size control, beside the thing it sizes.
          It lived at the far right of the tab row, which is a different strip
          of the app from the screen it changes, and on a phone that row now
          carries one word. Here it reads as what it is: this screen, bigger or
          smaller. Same state, same storage — App still owns the step, because
          the first paint has to know it before this component mounts.
        */}
        {onSize ? (
          <div className="gig-size" role="group" aria-label="Button size">
            {/* The step's name stays. He read it off the screen to tell me
                "this says it's the smallest" — a control with five positions
                and no readout is one you have to press to interrogate. */}
            <span className="gig-size-label">{SIZES[size].name}</span>
            <button
              className="gig-size-step"
              onClick={() => onSize(size - 1)}
              disabled={size <= 0}
              aria-label="Smaller buttons"
            >
              −
            </button>
            <button
              className="gig-size-step"
              onClick={() => onSize(size + 1)}
              disabled={size >= SIZES.length - 1}
              aria-label="Bigger buttons"
            >
              +
            </button>
          </div>
        ) : null}
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

      {tunerOn ? (
        <div className="gig-tuner">
          <Tuner reading={tuning} on={tunerOn} />
        </div>
      ) : null}

      {/*
        Your unit's screen not changing is not a fault.

        "On the AM4, hitting the tuner doesn't turn the tuner on the device."
        Correct, and deliberate — in the device server, not here. A gen-3 unit
        is sent a tuner-page open, which is why an FM3 lights up; the AM4's
        tuner block is always live, so it is simply polled and the unit is
        never switched into tuner mode. Same readings, no page. Said here
        because from the outside it looks exactly like a button that missed.
      */}
      {tunerOn && device?.gen ? (
        device.gen !== 3 ? (
          <p className="gig-note">
            Your {device.short || device.name || 'unit'} stays on the screen it&rsquo;s on &mdash; the
            app reads its tuner without switching the unit into tuner mode. Nothing is wrong.
          </p>
        ) : null
      ) : null}

      {/* The tuner is running — POST /tuner said ok — but nothing has arrived. */}
      {tunerOn && tunerStalled ? (
        <p className="gig-note">
          {remoteActive() ? (
            <>
              {/*
                This has been wrong twice, in opposite directions, and both cost
                somebody an evening. First "only the app at the Mac. Tune there."
                — false, a phone on the same wifi always worked. Then "readings
                don't cross the phone-remote link" — true when written, and no
                longer: the host bridges them now, throttled.

                So it stops naming a cause it cannot see. What is left is the two
                things that are actually still possible, in the order worth
                trying, and neither of them is a guess about the unit.
              */}
              No readings are reaching this phone. The Mac needs to be running this version of the
              app too &mdash; older ones don&rsquo;t send tuner readings over the link at all. On the
              same wifi as the Mac it works either way.
            </>
          ) : (
            <>
              No readings are arriving from the unit. Some units only send them while their own tuner
              is engaged &mdash; on an AM4 that is holding the footswitch down rather than tapping
              it. If it is already engaged and making sound, the Fractal app on the Mac may need
              updating.
            </>
          )}
        </p>
      ) : null}

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
              /* Identity, not state. See sceneColors: the fill says which
                 scene, the edge-against-fill says whether it is the live one. */
              style={{ '--scene-fill': sceneColor(i).fill, '--scene-ink': sceneColor(i).ink }}
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
          Scene names aren&rsquo;t readable from the phone. Open this preset once at the
          Mac and they&rsquo;ll show here from then on.
        </p>
      ) : null}

      {chain === 'failed' ? (
        <div className="gig-note gig-note-action">
          <span>
            Couldn&rsquo;t read the chain{remoteActive() ? ' from the phone' : ''}, so
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
            <BlockTile
              key={block.effectId}
              block={block}
              channels={channels}
              busy={toggling === block.effectId}
              onToggle={() => toggle(block)}
              onError={onError}
              onChanged={onChanged}
            />
          ))}
        </div>
      ) : null}

      {/*
        The bar along the bottom: the two things you press between songs.
        Sticky rather than fixed. Fixed would float over the last row of
        effects and, on iOS, fight the URL bar for the same strip of glass;
        sticky keeps its place in the layout — so nothing is ever underneath
        it — and still holds the bottom of the screen while the page scrolls at
        the larger sizes. At Smallest the page fits, and it simply sits where a
        bar should.

        Tuner only where the unit has one. Absent means unknown, an older host
        predating the flag, and unknown still gets to try.
      */}
      <div className="gig-bar" role="group" aria-label="Tuner and tempo">
        {capabilities?.tuner !== false ? (
          <button
            className={`gig-bar-btn ${tunerOn ? 'on' : ''}`}
            onClick={toggleTuner}
            aria-pressed={tunerOn}
          >
            Tuner
          </button>
        ) : null}
        <button className="gig-bar-btn" onClick={tap} disabled={tapping} aria-label="Tap tempo">
          Tap
        </button>
      </div>
    </div>
  )
}

/**
 * One block on the stage screen: tap to switch it, hold to change its channel.
 *
 * "If you can hold one of the effects for a few seconds, it would be cool to
 * have a pop-up where you can quickly switch channels from ABCD... On the Mac
 * version, maybe we can do a right click."
 *
 * Both, and on the web — a hold is a pointer that stays put and a right-click
 * is an event browsers have always sent, so none of this waits on the phone
 * apps that do not exist yet.
 *
 * The channels were reachable already, on the Edit screen, three taps into a
 * sheet. That is the right place to study a block and the wrong one to change
 * it between two bars of a song, which is the whole reason this screen exists.
 */
function BlockTile({ block, channels, busy, onToggle, onError, onChanged }) {
  const [open, setOpen] = useState(false)
  const [writing, setWriting] = useState(null)
  const cell = useRef(null)

  /* Only where there is something to choose. Not every block is channelled,
     and a menu with one entry in it is a menu that wasted a gesture. */
  const has = (channels?.length || 0) > 1
  const hold = useLongPress(
    () => {
      haptic()
      setOpen(true)
    },
    { enabled: has && !busy }
  )

  useDismiss(cell, () => setOpen(false), { open })

  const pick = async (ch) => {
    setWriting(ch)
    try {
      await setChannel(block.effectId, ch)
      /* Closed on the way out rather than on the way back: the write goes down
         a serial port and a menu that sits there through it reads as a tap
         that missed. */
      setOpen(false)
      onChanged?.(`${block.name || block.slug} → channel ${ch}`)
    } catch (err) {
      onError?.(err.message)
    } finally {
      setWriting(null)
    }
  }

  return (
    <div className="gig-block-cell" ref={cell}>
      <button
        className={`gig-block ${block.bypassed ? 'off' : 'on'}`}
        style={{
          '--block-fill': blockColor(block.slug).fill,
          '--block-ink': blockColor(block.slug).ink
        }}
        onClick={onToggle}
        disabled={busy}
        aria-pressed={!block.bypassed}
        {...hold}
      >
        {/*
          Two names, one shown at a time by CSS.

          Four effects to a row leaves about ninety pixels a tile, and a whole
          name in ninety pixels is an ellipsis. The abbreviation is what a
          player reads at that width; the full name is what a mouse hovers and
          what a screen reader says, so both are here and neither is faked with
          a character count in JavaScript.
        */}
        <span className="gig-block-name" title={block.name || block.slug}>
          <span className="gig-block-full">{block.name || block.slug}</span>
          <span className="gig-block-abbr mono" aria-hidden="true">
            {shortBlock(block)}
          </span>
        </span>
        <span className="gig-block-state">
          {block.bypassed ? 'Off' : 'On'}
          {/*
            The channel, beside the on/off.

            A scene remembers a channel per block, and each channel holds its
            own models and values — so which one a block is on is half of what
            the scene is, and the tile said nothing about it. "On this screen,
            also list the channels (A/B/C/D) on each block."

            Only when the block has one: not every block is channelled, and a
            bare letter on something without channels would be a lie about the
            hardware.
          */}
          {block.channel ? <span className="gig-block-channel">{block.channel}</span> : null}
        </span>
      </button>

      {open ? (
        <div className="gig-chan" role="group" aria-label={`Channel for ${block.name || block.slug}`}>
          {channels.map((ch) => (
            <button
              key={ch}
              className={`gig-chan-btn ${block.channel === ch ? 'current' : ''}`}
              onClick={() => pick(ch)}
              disabled={writing !== null}
              aria-pressed={block.channel === ch}
            >
              {ch}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
