import { useRef, useState } from 'react'
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
 * Input is pointer events with capture. The old window-level touch listeners
 * read touches[0], so with a finger on each of two knobs both knobs tracked
 * whichever finger landed first. Capture ties each drag to the pointer that
 * started it, and scrolling is refused by touch-action in CSS rather than by
 * preventDefault gymnastics.
 */
const START = 135 // degrees, 7 o'clock
const SWEEP = 270 // to 5 o'clock

export default function Knob({ param, value, onChange, onCommit, size = 58, label }) {
  // The pointer that owns this knob, or null. Coarse means a finger or pen —
  // anything where the pointer is also the thing hiding the knob.
  const [drag, setDrag] = useState(null)
  const origin = useRef({ y: 0, norm: 0 })

  const norm = clamp01(toNormalized(value, param) ?? 0)

  const begin = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = { y: event.clientY, norm }
    setDrag({ pointerId: event.pointerId, coarse: event.pointerType !== 'mouse' })
  }

  const handleMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const delta = origin.current.y - event.clientY
    // 180px of travel covers the full range on a mouse. A thumb is less
    // precise and a phone screen is shorter, so touch gets a longer throw.
    const scale = event.shiftKey ? 600 : drag.coarse ? 260 : 180
    const next = clamp01(origin.current.norm + delta / scale)
    onChange(round3(fromNormalized(next, param)))
  }

  const end = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    setDrag(null)
    onCommit?.()
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
        onPointerDown={begin}
        onPointerMove={handleMove}
        onPointerUp={end}
        onPointerCancel={end}
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
        {drag?.coarse ? (
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
