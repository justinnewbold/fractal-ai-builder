import { useEffect, useState } from 'react'

/**
 * Panels you can drag into the order you want.
 *
 * Deliberately a reorderable column rather than free-floating windows. Windows
 * that sit at absolute coordinates want a fixed canvas, and this page has to
 * work on a phone at a gig — where there is no room to arrange anything, where
 * a drag competes with the scroll, and where a panel parked off the edge is a
 * panel you cannot reach. A column keeps every arrangement legible at any width.
 *
 * The order is per screen and kept in this browser, because it's a preference
 * about your own workspace rather than anything to do with the unit.
 */
export default function SectionStack({ id, children }) {
  const key = `fractal.layout.${id}`
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean)
  const ids = items.map((child) => String(child.key ?? '').replace(/^\.\$/, ''))

  const [order, setOrder] = useState([])
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]')
      setOrder(Array.isArray(saved) ? saved : [])
    } catch {
      setOrder([])
    }
  }, [key])

  /*
   * A saved order can name panels that no longer exist, and miss ones that
   * appeared since — a unit without scenes shows fewer, a firmware update could
   * add one. So the saved order is a preference applied to today's list, not a
   * description of it: known ids first in the order chosen, then anything new in
   * its natural position.
   */
  // Deduped: a saved order with a repeated id would render the same panel twice
  // and hand React two children with the same key.
  const sorted = [
    ...new Set([...order.filter((x) => ids.includes(x)), ...ids.filter((x) => !order.includes(x))])
  ]

  const commit = (next) => {
    setOrder(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // A full or disabled localStorage costs the preference, not the feature.
    }
  }

  const drop = (target) => {
    if (!dragging || dragging === target) return
    const next = sorted.filter((x) => x !== dragging)
    next.splice(next.indexOf(target), 0, dragging)
    commit(next)
    setDragging(null)
    setOver(null)
  }

  /** Keyboard equivalent — a drag nobody can do with a keyboard isn't finished. */
  const nudge = (item, delta) => {
    const from = sorted.indexOf(item)
    const to = from + delta
    if (to < 0 || to >= sorted.length) return
    const next = [...sorted]
    next.splice(to, 0, next.splice(from, 1)[0])
    commit(next)
  }

  const byId = new Map(items.map((child, i) => [ids[i], child]))

  return (
    <div className="stack">
      {sorted.map((item) => {
        const child = byId.get(item)
        if (!child) return null
        return (
          <div
            key={item}
            className={`stack-item ${dragging === item ? 'dragging' : ''} ${
              over === item ? 'over' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(item)
            }}
            onDragLeave={() => setOver((v) => (v === item ? null : v))}
            onDrop={(e) => {
              e.preventDefault()
              drop(item)
            }}
          >
            <div
              className="stack-grip"
              draggable
              role="button"
              tabIndex={0}
              aria-label="Drag to reorder, or use the arrow keys"
              title="Drag to reorder"
              onDragStart={() => setDragging(item)}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  nudge(item, -1)
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  nudge(item, 1)
                }
              }}
            />
            {child}
          </div>
        )
      })}

      {order.length ? (
        <button className="chip stack-reset" onClick={() => commit([])}>
          Reset this order
        </button>
      ) : null}
    </div>
  )
}
