import { useEffect, useRef, useState } from 'react'
import { setParam, currentDeviceSlug } from '../lib/forgefx'
import { fromNormalized, toNormalized } from '../lib/scale'
import { remoteActive } from '../lib/remote'
import { buildParamIndex, controlKey } from '../lib/paramIndex'
import { gateWrite, padFraction } from '../lib/xy'

const STORE = 'fractal.xy'

/**
 * Two controls under one finger.
 *
 * Pick a control for each axis, then drag: right is more X, up is more Y. The
 * classic pairing is delay mix against reverb mix, but any two controls the
 * preset has will do — the pickers are the same flat index the search box uses.
 *
 * Writes ride the fast unverified path, gated on time and movement, because a
 * finger produces coordinates far faster than a serial port takes them and
 * every relay write is a broadcast round trip. The gate widens when remote.
 * Fractions write as-is through the same scaling as every knob, so a
 * logarithmic control feels right under the finger instead of cramming its
 * useful range into one corner.
 *
 * Choices persist per unit: the pad you set up at home is the pad that opens
 * at the gig.
 */
export default function XYPad({ blocks, onError }) {
  const [index, setIndex] = useState(null)
  const [axes, setAxes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`${STORE}.${currentDeviceSlug()}`)) || {}
    } catch {
      return {}
    }
  })
  const [dot, setDot] = useState(null)
  const padRef = useRef(null)
  const gate = useRef({ x: { at: 0, frac: null }, y: { at: 0, frac: null } })
  const errored = useRef(false)

  useEffect(() => {
    buildParamIndex(blocks)
      .then(setIndex)
      .catch((err) => onError(err.message))
    // eslint-disable-next-line
  }, [blocks])

  const lookup = (key) => {
    if (!key || !index) return null
    const [eid, pid] = key.split(':').map(Number)
    return index.find((e) => e.block.effectId === eid && e.param.id === pid) || null
  }

  const xCtl = lookup(axes.x)
  const yCtl = lookup(axes.y)

  // The dot opens where the values actually are, not at zero.
  useEffect(() => {
    if (!xCtl || !yCtl || dot) return
    const x = toNormalized(xCtl.param.value, xCtl.param)
    const y = toNormalized(yCtl.param.value, yCtl.param)
    if (x !== null && y !== null) setDot({ x, y })
  }, [xCtl, yCtl, dot])

  const pick = (axis, key) => {
    const next = { ...axes, [axis]: key || undefined }
    setAxes(next)
    setDot(null)
    try {
      localStorage.setItem(`${STORE}.${currentDeviceSlug()}`, JSON.stringify(next))
    } catch {
      // Session-only is fine when storage says no.
    }
  }

  const writeAxis = (axis, ctl, frac, { final = false } = {}) => {
    const g = gate.current[axis]
    const now = performance.now()
    const interval = remoteActive() ? 150 : 60
    // The lift is the value the player chose, so it goes out even when the
    // gate would swallow it — otherwise the control rests a few pixels shy of
    // where the finger left it. Only an exact repeat of the last write is
    // skipped.
    if (final ? frac === g.frac : !gateWrite({ now, lastAt: g.at, lastFrac: g.frac, frac, interval }))
      return
    g.at = now
    g.frac = frac
    setParam(ctl.block.effectId, ctl.param.id, fromNormalized(frac, ctl.param), ctl.param).catch(
      (err) => {
        // One report per drag, not one per rejected write.
        if (!errored.current) {
          errored.current = true
          onError(err.message)
        }
      }
    )
  }

  const apply = (clientX, clientY, opts) => {
    if (!xCtl || !yCtl || !padRef.current) return
    const { x, y } = padFraction(clientX, clientY, padRef.current.getBoundingClientRect())
    setDot({ x, y })
    writeAxis('x', xCtl, x, opts)
    writeAxis('y', yCtl, y, opts)
  }

  /*
   * Mouse and touch on the window, not pointer capture — same lesson as the
   * knob: WebKit stops delivering a captured touch's moves once it leaves the
   * element, and holding the edge of the pad to pin a control at its extreme
   * is exactly a finger past the boundary. The drag remembers which touch
   * started it and follows only that one.
   */
  const [drag, setDrag] = useState(null)

  useEffect(() => {
    if (!drag) return

    if (drag.touchId === null) {
      const move = (e) => apply(e.clientX, e.clientY)
      const end = (e) => {
        apply(e.clientX, e.clientY, { final: true })
        setDrag(null)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', end)
      return () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', end)
      }
    }

    const find = (list) => Array.from(list).find((t) => t.identifier === drag.touchId)
    const move = (e) => {
      const t = find(e.touches)
      if (!t) return
      if (e.cancelable) e.preventDefault()
      apply(t.clientX, t.clientY)
    }
    const end = (e) => {
      const t = find(e.changedTouches)
      if (!t) return
      apply(t.clientX, t.clientY, { final: true })
      setDrag(null)
    }
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', end)
    window.addEventListener('touchcancel', end)
    return () => {
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
    }
    // eslint-disable-next-line
  }, [drag, xCtl, yCtl])

  const options = (index || []).map((e) => (
    <option key={controlKey(e.block.effectId, e.param.id)} value={controlKey(e.block.effectId, e.param.id)}>
      {e.block.name} · {e.param.name}
    </option>
  ))

  return (
    <div className="xy">
      <div className="xy-pickers">
        <label>
          <span className="silk-label">Across →</span>
          <select value={axes.x || ''} onChange={(e) => pick('x', e.target.value)}>
            <option value="">Choose…</option>
            {options}
          </select>
        </label>
        <label>
          <span className="silk-label">Up ↑</span>
          <select value={axes.y || ''} onChange={(e) => pick('y', e.target.value)}>
            <option value="">Choose…</option>
            {options}
          </select>
        </label>
      </div>

      {xCtl && yCtl ? (
        <>
          <div
            ref={padRef}
            className="xy-pad"
            onMouseDown={(e) => {
              if (e.button !== 0 || drag) return
              errored.current = false
              apply(e.clientX, e.clientY)
              setDrag({ touchId: null })
            }}
            onTouchStart={(e) => {
              if (drag) return
              errored.current = false
              const t = e.changedTouches[0]
              apply(t.clientX, t.clientY)
              setDrag({ touchId: t.identifier })
            }}
            role="application"
            aria-label={`Pad controlling ${xCtl.param.name} across and ${yCtl.param.name} up`}
          >
            <div className="xy-line-h" style={{ top: `${(1 - (dot?.y ?? 0.5)) * 100}%` }} />
            <div className="xy-line-v" style={{ left: `${(dot?.x ?? 0.5) * 100}%` }} />
            <div
              className="xy-dot"
              style={{ left: `${(dot?.x ?? 0.5) * 100}%`, top: `${(1 - (dot?.y ?? 0.5)) * 100}%` }}
            />
          </div>
          <div className="xy-readout mono">
            <span>
              {xCtl.param.name}{' '}
              {dot ? Math.round(fromNormalized(dot.x, xCtl.param) * 100) / 100 : '—'}
              {xCtl.param.unit || ''}
            </span>
            <span>
              {yCtl.param.name}{' '}
              {dot ? Math.round(fromNormalized(dot.y, yCtl.param) * 100) / 100 : '—'}
              {yCtl.param.unit || ''}
            </span>
          </div>
        </>
      ) : (
        <p className="hint">Pick a control for each axis and the pad appears.</p>
      )}
    </div>
  )
}
