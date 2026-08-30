import { useCallback, useEffect, useRef, useState } from 'react'
import { toNormalized, fromNormalized } from '../lib/scale'

/**
 * A rotary control.
 *
 * Fractal's editors use knobs because the hardware does, and because a knob
 * shows where a value sits in its range at a glance in a way a number never
 * does. The arc is that: sweep from the 7 o'clock start to the current
 * position.
 *
 * Dragging is vertical only. Circular tracking sounds right and isn't — the
 * pointer leaves the knob, and small movements near the centre produce huge
 * jumps. Every hardware editor uses vertical drag for the same reason.
 *
 * The listeners are mouse and touch on the window, not pointer events with
 * capture. Capture is the right shape for this and WebKit doesn't deliver it:
 * on iOS, once a captured touch moves off the element the pointermove stream
 * stops, and a vertical drag leaves a 58px knob almost immediately — which
 * shipped as knobs that wouldn't turn at all on an iPhone. Window listeners
 * hear the whole drag wherever the finger goes. Each drag stores the
 * identifier of the touch that started it and reads only that touch, so a
 * finger on each of two knobs turns two knobs, not one finger's knob twice.
 *
 * And the touch is armed in a native listener, synchronously, rather than by
 * React. Two things made that necessary, and together they cost the knobs a
 * second round of not turning on an iPhone:
 *
 *   - React registers touchstart and touchmove on the root as PASSIVE, so
 *     preventDefault inside a React handler is ignored. iOS decides on the
 *     first move whether a gesture is a scroll, and nothing had told it no.
 *   - The move listener was added by an effect that ran after a state change,
 *     which is a render too late: by then iOS had already claimed the gesture
 *     and cancelled the touch out from under the drag.
 *
 * So touchstart is bound to the element itself with passive:false, it calls
 * preventDefault there, and it registers the move listeners in the same tick.
 * The drag lives in a ref for that reason — nothing about starting one waits on
 * a render. The state flag exists only for what is drawn.
 */
const START = 135 // degrees, 7 o'clock
const SWEEP = 270 // to 5 o'clock

export default function Knob({ param, value, onChange, onCommit, size = 58, label }) {
  // What owns the knob, in a ref: a touch identifier, or null for the mouse.
  // A ref because arming a drag must not wait for a render — see above.
  const drag = useRef(null)
  const [dragging, setDragging] = useState(null) // 'touch' | 'mouse', for what's drawn
  const origin = useRef({ y: 0, norm: 0 })
  const knob = useRef(null)

  const norm = clamp01(toNormalized(value, param) ?? 0)

  /*
   * What a native listener needs to know, kept current for it.
   *
   * The touch handlers are bound once, at mount, so they close over the first
   * render's props forever. Reading through a ref is what lets them write the
   * value the knob has now rather than the one it had when the page loaded.
   */
  const live = useRef({ norm, param, onChange, onCommit })
  useEffect(() => {
    live.current = { norm, param, onChange, onCommit }
  })

  const apply = useCallback((y, { shift = false, coarse = false } = {}) => {
    const { param: p, onChange: change } = live.current
    const delta = origin.current.y - y
    // 180px of travel covers the full range on a mouse. A thumb is less
    // precise and a phone screen is shorter, so touch gets a longer throw.
    const scale = shift ? 600 : coarse ? 260 : 180
    const next = clamp01(origin.current.norm + delta / scale)
    change(round3(fromNormalized(next, p)))
  }, [])

  useEffect(() => {
    const el = knob.current
    if (!el) return

    const stop = () => {
      drag.current = null
      setDragging(null)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
      live.current.onCommit?.()
    }

    const move = (e) => {
      const t = Array.from(e.touches).find((x) => x.identifier === drag.current?.touchId)
      if (!t) return
      // Allowed because this listener is registered passive:false, and needed
      // twice over: iOS has shipped versions where touch-action on a child of
      // an overflow container is ignored and the page scrolls under the finger.
      if (e.cancelable) e.preventDefault()
      apply(t.clientY, { coarse: true })
    }

    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === drag.current?.touchId) return stop()
    }

    const begin = (e) => {
      if (drag.current) return // one finger owns a knob; a second is ignored
      const t = e.changedTouches[0]
      if (!t) return
      // This is the line that keeps the gesture. iOS reads the first moments of
      // a touch to decide whether it is scrolling the page, and a passive
      // listener has no vote — which is exactly what React's are.
      if (e.cancelable) e.preventDefault()
      origin.current = { y: t.clientY, norm: live.current.norm }
      drag.current = { touchId: t.identifier }
      setDragging('touch')
      // In the same tick as the touch that started it, so the very first move
      // is heard and answered.
      window.addEventListener('touchmove', move, { passive: false })
      window.addEventListener('touchend', end)
      window.addEventListener('touchcancel', end)
    }

    el.addEventListener('touchstart', begin, { passive: false })
    return () => {
      el.removeEventListener('touchstart', begin)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
    }
  }, [apply])

  // The mouse keeps React's handlers: nothing about a mouse drag is contested,
  // and mousemove on the window has always been delivered in full.
  useEffect(() => {
    if (dragging !== 'mouse') return
    const move = (e) => apply(e.clientY, { shift: e.shiftKey })
    const stop = () => {
      drag.current = null
      setDragging(null)
      live.current.onCommit?.()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
  }, [dragging, apply])

  const beginMouse = (event) => {
    if (event.button !== 0 || drag.current) return
    origin.current = { y: event.clientY, norm }
    drag.current = { touchId: null }
    setDragging('mouse')
  }

  const nudge = (event) => {
    const step = event.shiftKey ? 0.002 : 0.01
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      onChange(round3(fromNormalized(clamp01(norm + step), param)))
      onCommit?.()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      onChange(round3(fromNormalized(clamp01(norm - step), param)))
      onCommit?.()
    }
  }

  const r = size / 2 - 4
  const cx = size / 2
  const cy = size / 2
  const angle = START + norm * SWEEP

  return (
    <div className="knob-wrap">
      {label ? <span className="knob-label">{label}</span> : null}

      <div
        ref={knob}
        className={`knob ${dragging ? 'dragging' : ''}`}
        style={{ width: size, height: size }}
        onMouseDown={beginMouse}
        onKeyDown={nudge}
        role="slider"
        tabIndex={0}
        aria-label={label || param?.name}
        aria-valuenow={value}
        aria-valuemin={param?.min}
        aria-valuemax={param?.max}
      >
        <svg width={size} height={size} aria-hidden="true">
          <path d={arc(cx, cy, r, START, START + SWEEP)} className="knob-track" />
          <path d={arc(cx, cy, r, START, angle)} className="knob-arc" />
          <circle cx={cx} cy={cy} r={r - 6} className="knob-body" />
          <circle
            cx={cx + (r - 11) * Math.cos(toRad(angle))}
            cy={cy + (r - 11) * Math.sin(toRad(angle))}
            r="2"
            className="knob-dot"
          />
        </svg>

        {/* A finger covers the knob and the readout below it at once, so while
            it drags, the value floats above where it can be seen. */}
        {dragging === 'touch' ? (
          <span className="knob-flag mono" aria-hidden="true">
            {fmt(value)}
            {param?.unit ? ` ${param.unit}` : ''}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function toRad(deg) {
  return ((deg + 90) * Math.PI) / 180
}

function arc(cx, cy, r, from, to) {
  const a = polar(cx, cy, r, from)
  const b = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`
}

function polar(cx, cy, r, deg) {
  const rad = toRad(deg)
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function fmt(n) {
  if (typeof n !== 'number') return '—'
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString()
  return n.toFixed(2)
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
