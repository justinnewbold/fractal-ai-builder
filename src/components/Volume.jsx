import { useEffect, useMemo, useRef, useState } from 'react'
import { blockParams, clearDeviceCache, setParam } from '../lib/forgefx'
import { latestWriter, outputLevelParam, volumeLabel, volumePercent, volumeStep } from '../lib/volume'

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
   * Read on arrival and again whenever the preset is re-read: a generation
   * may have moved the amp, a footswitch may have changed the preset, and the
   * slider has to show where the unit actually is rather than where it was.
   * Never mid-drag — a read landing under a moving thumb would yank it back
   * to a value that is already stale.
   */
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
  }, [eid, preset])

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

  if (!param) return null

  const now = value ?? param.value
  const label = volumeLabel(now, param)

  return (
    <div className="gig-volume" role="group" aria-label="Volume">
      <span className="silk-label gig-volume-word" id="gig-volume-word">
        Volume
      </span>
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
      <span className="gig-volume-value mono" aria-hidden="true">
        {label}
      </span>
    </div>
  )
}
