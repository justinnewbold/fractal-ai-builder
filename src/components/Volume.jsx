import { useEffect, useMemo, useRef, useState } from 'react'
import { blockParams, clearDeviceCache, setParam } from '../lib/forgefx'
import {
  latestWriter,
  nudged,
  outputLevelParam,
  volumeLabel,
  volumeNudge,
  volumePercent,
  volumeStep
} from '../lib/volume'

/**
 * The volume, on the stage screen, under the meter that shows it.
 *
 * "Add volume slider to the play screen to quickly turn volume up or down."
 *
 * It moves the Output block's Level — the whole preset's volume, the control a
 * soundperson means when they say "give me a bit less". It was reachable, on
 * Edit, as a read-only number at the bottom of the Output block's sheet; the
 * only way to actually change it was the knob on the unit. A slider here is
 * what the front-panel knob is: one thing, the right size for a thumb, that
 * does not need looking at.
 *
 * lib/volume.js says why the Output level is the player's to move when the
 * model may not, and how a drag becomes writes the port can keep up with.
 */
const RELEASE_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])

export default function Volume({ eid, preset, onError }) {
  // The Level parameter as the unit last reported it: range, unit, value.
  const [param, setLevel] = useState(null)
  // Where the thumb is while it is being moved; null when it is the unit's.
  const [value, setValue] = useState(null)
  const dragging = useRef(false)

  /*
   * Read on arrival and again when the preset CHANGES — a footswitch, Next,
   * the picker — so the slider shows where the unit actually is.
   *
   * On the preset's number, not on every re-read of it. The app re-reads the
   * preset after a tempo, a channel, a generation; keyed on the object that
   * came back, this asked the unit for the output block on each of those,
   * and that read wants the preset dump the block list and the scene names
   * are already asking for at the same moment. One more dump-hungry read on
   * a port that is still loading the preset is how "expected func 0x77, got
   * 0x78" reached the screen. Nothing on the app's side moves the Output
   * level but this slider — the model may not touch it — so between preset
   * changes the value it holds is the value the unit holds.
   *
   * Never mid-drag — a read landing under a moving thumb would yank it back
   * to a value that is already stale.
   */
  const slot = preset?.number
  useEffect(() => {
    if (eid === null || eid === undefined) {
      setLevel(null)
      return undefined
    }
    let stop = false
    ;(async () => {
      try {
        const res = await blockParams(eid)
        if (stop || dragging.current) return
        setLevel(outputLevelParam(res?.named))
      } catch {
        /* A read that lost the port leaves the slider as it was; the next
           preset read tries again. Nothing on stage is worth an error banner
           for a number that is not yet known. */
      }
    })()
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid, slot])

  /* One write on the wire at a time; the newest value wins. See lib/volume. */
  const writer = useMemo(
    () => (param ? latestWriter((v) => setParam(eid, param.id, v, param)) : null),
    [eid, param]
  )

  const move = (v) => {
    if (!writer) return
    dragging.current = true
    setValue(v)
    writer.send(v)
  }

  /*
   * Let go: wait for the wire, then read back what the unit actually holds.
   *
   * The unit accepts a write it then ignores and reports success either way,
   * so the number under the slider is the unit's answer, not the thumb's
   * position. The cache is cleared first for the same reason setParamConfirmed
   * clears it: without that the read hands back the value just sent.
   */
  const release = async () => {
    if (!dragging.current || !writer) return
    const err = await writer.settled()
    dragging.current = false
    if (err) onError?.(err.message)
    try {
      await clearDeviceCache().catch(() => {})
      const res = await blockParams(eid)
      const fresh = outputLevelParam(res?.named)
      if (fresh) setLevel(fresh)
    } catch {
      /* The slider keeps the value it sent. */
    }
    setValue(null)
  }

  /*
   * The pointer can leave the slider before it lifts — a thumb slides off the
   * track on the way up — and a release the input never hears would leave the
   * slider believing it is still being dragged. The window hears every lift.
   */
  const grab = () => {
    dragging.current = true
    const lift = () => {
      window.removeEventListener('pointerup', lift)
      window.removeEventListener('pointercancel', lift)
      release()
    }
    window.addEventListener('pointerup', lift)
    window.addEventListener('pointercancel', lift)
  }

  /*
   * The − and + either side of the track, one dB a press.
   *
   * "Do a plus minus on the sides of the volume slider that does 1 dB at a
   * time." A slider is for the sweep; a thumb cannot reliably land it on
   * exactly one dB less, and on a dark stage the buttons are the thing you
   * can hit without looking. Each press goes through the same writer as the
   * drag and the same read-back as letting go, so the number beside it is
   * still the unit's answer.
   */
  const nudge = (delta) => {
    if (!writer || !param) return
    const next = nudged(value ?? param.value, param, delta)
    if (next === (value ?? param.value)) return
    dragging.current = true
    setValue(next)
    writer.send(next)
    release()
  }

  if (!param) return null

  const now = value ?? param.value
  const label = volumeLabel(now, param)
  const by = volumeNudge(param)
  const unit = param.unit ? ` ${param.unit}` : ''

  return (
    <div className="gig-volume" role="group" aria-label="Volume">
      <button
        type="button"
        className="gig-volume-step"
        onClick={() => nudge(-by)}
        disabled={typeof now === 'number' && now <= param.min}
        aria-label={`Volume down ${by}${unit}`}
      >
        −
      </button>
      <input
        type="range"
        className="gig-volume-slider"
        min={param.min}
        max={param.max}
        step={volumeStep(param)}
        value={typeof now === 'number' ? now : param.min}
        aria-labelledby="gig-volume-word"
        aria-valuetext={label}
        style={{ '--vol': `${volumePercent(now, param)}%` }}
        onChange={(e) => move(Number(e.target.value))}
        onPointerDown={grab}
        onKeyUp={(e) => {
          if (RELEASE_KEYS.has(e.key)) release()
        }}
        onBlur={release}
      />
      <button
        type="button"
        className="gig-volume-step"
        onClick={() => nudge(by)}
        disabled={typeof now === 'number' && now >= param.max}
        aria-label={`Volume up ${by}${unit}`}
      >
        +
      </button>
      {/*
        The word and the figure, stacked at the right.

        "Add the word volume somewhere on the volume slider bar." The word
        stood at the left on a Mac and stepped aside on a phone, where the
        track needs the width more — so on the phone the row was a slider,
        two buttons and a number with nothing saying what it was. Over the
        figure it costs no width at all, and the number it captions is the
        one thing on the row that already draws the eye.
      */}
      <span className="gig-volume-read">
        <span className="silk-label gig-volume-word" id="gig-volume-word">
          Volume
        </span>
        <span className="gig-volume-value mono" aria-hidden="true">
          {label}
        </span>
      </span>
    </div>
  )
}
