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
 */
const START = 135 // degrees, 7 o'clock
const SWEEP = 270 // to 5 o'clock

export default function Knob({ param, value, onChange, onCommit, size = 58, label }) {
  // What owns the knob: null, { touchId } for a finger, { touchId: null }
  // for the mouse. State rather than a ref so the bubble follows it.
  const [drag, setDrag] = useState(null)
  const origin = useRef({ y: 0, norm: 0 })

  const norm = clamp01(toNormalized(value, param) ?? 0)

  const apply = useCallback(
    (y, { shift = false, coarse = false } = {}) => {
      const delta = origin.current.y - y
      // 180px of travel covers the full range on a mouse. A thumb is less
      // precise and a phone screen is shorter, so touch gets a longer throw.
      const scale = shift ? 600 : coarse ? 260 : 180
      const next = clamp01(origin.current.norm + delta / scale)
      onChange(round3(fromNormalized(next, param)))
    },
    [onChange, param]
  )

  useEffect(() => {
    if (!drag) return

    const stop = () => {
      setDrag(null)
      onCommit?.()
    }

    if (drag.touchId === null) {
      const move = (e) => apply(e.clientY, { shift: e.shiftKey })
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', stop)
      return () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', stop)
      }
    }

    const move = (e) => {
      const t = Array.from(e.touches).find((t) => t.identifier === drag.touchId)
      if (!t) return
      // Belt and braces with the touch-action CSS: iOS has shipped versions
      // where touch-action on a child of an overflow container is ignored and
      // the page scrolls under the finger. The listener is registered
      // passive:false precisely so this call is allowed.
      if (e.cancelable) e.preventDefault()
      apply(t.clientY, { coarse: true })
    }
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === drag.touchId) return stop()
    }
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', end)
    window.addEventListener('touchcancel', end)
    return () => {
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
    }
  }, [drag, apply, onCommit])

  const beginMouse = (event) => {
    if (event.button !== 0) return
    origin.current = { y: event.clientY, norm }
    setDrag({ touchId: null })
  }

  const beginTouch = (event) => {
    if (drag) return // one finger owns a knob; a second is ignored, not merged
    const t = event.changedTouches[0]
    origin.current = { y: t.clientY, norm }
    setDrag({ touchId: t.identifier })
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
        className={`knob ${drag ? 'dragging' : ''}`}
        style={{ width: size, height: size }}
        onMouseDown={beginMouse}
        onTouchStart={beginTouch}
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
        {drag && drag.touchId !== null ? (
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
