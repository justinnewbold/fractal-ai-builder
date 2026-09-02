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
  /*
   * The pickers are setup, and setup is not what this is for.
   *
   * "The pad you set up at home is the pad that opens at the gig" was already
   * half-true — the choices persisted, but you still landed on two dropdowns
   * with the pad underneath them. At a gig the pad is the thing; the dropdowns
   * are how it got here. So once both axes are chosen they fold away, and the
   * way back is one chip rather than a permanent pair of selects.
   */
  const [picking, setPicking] = useState(false)
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
   *
   * And the same second lesson: the touch is armed by a native listener rather
   * than by React. React's touch listeners are passive, so preventDefault in
   * one is ignored, and an effect that registers the move listener after a
   * state change runs a render too late — by which time iOS has decided the
   * gesture is a scroll and cancelled it. A pad you drag with a finger cannot
   * afford either.
   */
  const drag = useRef(null)
  const [dragging, setDragging] = useState(false)
  const live = useRef({ apply })
  useEffect(() => {
    live.current = { apply }
  })

  useEffect(() => {
    const el = padRef.current
    if (!el) return

    const find = (list) => Array.from(list).find((t) => t.identifier === drag.current?.touchId)

    const move = (e) => {
      const t = find(e.touches)
      if (!t) return
      if (e.cancelable) e.preventDefault()
      live.current.apply(t.clientX, t.clientY)
    }

    const end = (e) => {
      const t = find(e.changedTouches)
      if (!t) return
      live.current.apply(t.clientX, t.clientY, { final: true })
      drag.current = null
      setDragging(false)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
    }

    const begin = (e) => {
      if (drag.current) return
      const t = e.changedTouches[0]
      if (!t) return
      if (e.cancelable) e.preventDefault()
      errored.current = false
      drag.current = { touchId: t.identifier }
      setDragging(true)
      live.current.apply(t.clientX, t.clientY)
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
  }, [])

  // The mouse was never contested; it keeps the simple path.
  useEffect(() => {
    if (dragging !== 'mouse') return
    const move = (e) => live.current.apply(e.clientX, e.clientY)
    const end = (e) => {
      live.current.apply(e.clientX, e.clientY, { final: true })
      drag.current = null
      setDragging(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', end)
    }
  }, [dragging])

  const options = (index || []).map((e) => (
    <option key={controlKey(e.block.effectId, e.param.id)} value={controlKey(e.block.effectId, e.param.id)}>
      {e.block.name} · {e.param.name}
    </option>
  ))

  const ready = !!(xCtl && yCtl)
  /*
   * No "done" here on purpose: choosing the second axis IS done. The pickers
   * fold the moment both are set and the pad takes their place, so the only
   * control needed afterwards is the way back.
   */
  const showPickers = picking || !ready

  return (
    <div className="xy">
      {showPickers ? (
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
      ) : null}

      {ready ? (
        <>
          <div
            ref={padRef}
            className="xy-pad"
            onMouseDown={(e) => {
              if (e.button !== 0 || drag.current) return
              errored.current = false
              drag.current = { touchId: null }
              setDragging('mouse')
              apply(e.clientX, e.clientY)
            }}
            role="application"
            aria-label={`Pad controlling ${xCtl.param.name} across and ${yCtl.param.name} up`}
          >
            <div className="xy-line-h" style={{ top: `${(1 - (dot?.y ?? 0.5)) * 100}%` }} />
            <div className="xy-line-v" style={{ left: `${(dot?.x ?? 0.5) * 100}%` }} />
            {/* The puck is 26px across. Placed by percent its centre could sit
                on the edge and half of it hung outside; its centre now travels
                from 13px in to 13px short of the far side, so all of it stays. */}
            <div
              className="xy-dot"
              style={{
                left: `calc(13px + ${dot?.x ?? 0.5} * (100% - 26px))`,
                top: `calc(13px + ${1 - (dot?.y ?? 0.5)} * (100% - 26px))`
              }}
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
            {showPickers ? null : (
              <button className="chip xy-change" onClick={() => setPicking(true)}>
                Change
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
