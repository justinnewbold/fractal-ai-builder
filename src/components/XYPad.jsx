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

  const writeAxis = (axis, ctl, frac) => {
    const g = gate.current[axis]
    const now = performance.now()
    const interval = remoteActive() ? 150 : 60
    if (!gateWrite({ now, lastAt: g.at, lastFrac: g.frac, frac, interval })) return
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

  const move = (e) => {
    if (!xCtl || !yCtl || !padRef.current) return
    const { x, y } = padFraction(e.clientX, e.clientY, padRef.current.getBoundingClientRect())
    setDot({ x, y })
    writeAxis('x', xCtl, x)
    writeAxis('y', yCtl, y)
  }

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
            onPointerDown={(e) => {
              errored.current = false
              e.currentTarget.setPointerCapture(e.pointerId)
              move(e)
            }}
            onPointerMove={(e) => e.buttons > 0 && move(e)}
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
