import { useEffect, useRef, useState } from 'react'

/**
 * The screens a viewport reaches, side by side under the thumb.
 *
 * How many that is depends on the viewport — see `viewsFor`. A desktop has
 * three; a phone has the stage screen alone, and none of what follows runs,
 * because there is nowhere to swipe to.
 *
 * Where there is more than one: the tabs are a row of small words at the top
 * of the page, and the page is long. Changing screens meant scrolling back up,
 * finding the word and hitting it. A swipe is where the hand already is.
 *
 * The one rule is that this surface never wins an argument. It is every
 * control on the screen at once, so it takes nothing on touchstart — no
 * preventDefault, which would eat the tap iOS synthesises from the press — and
 * it only claims a drag once the finger has plainly gone sideways. Anything
 * that already owns a sideways gesture (the chain strip, a scrolling grid, a
 * knob, a pad, a text field) keeps it: a swipe that starts there is theirs.
 *
 * Native listeners for the same reason the knob, the pad and the sheet use
 * them: React registers touch listeners as passive, so a preventDefault inside
 * one is ignored and the page scrolls under the drag.
 */
export const ORDER = ['play', 'ask', 'shape']

/**
 * The bench screens, as opposed to the stage one.
 *
 * Ask designs a sound and Edit rebuilds a chain. Both are sit-down work: a
 * conversation to read and reply to, and a 4x12 grid to drag blocks around on.
 * Play is the other kind — what preset, which scene, that block off, am I in
 * tune — and it is the only one worth having under a thumb in the dark.
 *
 * The phone apps in `mobile/` have never carried either, and say why in
 * Stage.js: "a generate button within reach of a stage tap is a hazard". The
 * web app on a phone had both, one sideways swipe from the stage screen. This
 * is that same rule, applied to the surface that was missing it.
 */
export const BENCH = ['ask', 'shape']

/**
 * Which screens a viewport reaches.
 *
 * A phone gets the stage screen alone. Everything else keeps all three: a
 * desktop browser is where the bench work belongs, so this hides it rather
 * than removing it.
 */
export const viewsFor = (narrow) => (narrow ? ORDER.filter((id) => !BENCH.includes(id)) : ORDER)

/** Where a sideways drag already means something else. */
export const YIELDS =
  '.chain-strip, .grid-scroll, .views, .diag-table, .knob, input, textarea, select, [data-no-swipe]'

const INTENT = 24 // px sideways before a drag is a swipe at all
const SLACK = 1.5 // and this many times more sideways than down
const COMMIT = 80 // px on release that changes the screen
const FLICK = 0.35 // px/ms — a short, fast flick changes it too
const WINDOW = 100 // ms of drag the flick speed is read over
const EDGE = 3 // past the last screen the page follows at a third: there is nothing there

const stillness = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Screens({ view, enabled, order = ORDER, onChange, children }) {
  const outer = useRef(null)
  const inner = useRef(null)
  const [entering, setEntering] = useState(null)
  const last = useRef(view)

  /*
   * The new screen arrives from the side it lives on — Edit slides in from the
   * right of Play whether a swipe or a tab press brought it. The order decides,
   * not the gesture, so the two routes feel like one thing.
   */
  useEffect(() => {
    if (last.current === view) return undefined
    const from = ORDER.indexOf(view) > ORDER.indexOf(last.current) ? 'right' : 'left'
    last.current = view
    if (stillness()) return undefined
    setEntering(from)
    const t = setTimeout(() => setEntering(null), 260)
    return () => clearTimeout(t)
  }, [view])

  useEffect(() => {
    const node = outer.current
    const page = inner.current
    // One screen is not a set of screens: with nowhere to swipe to, the
    // listener is pure cost and every drag on the stage screen would be
    // measured against a decision that cannot come out either way.
    if (!node || !page || !enabled || order.length < 2) return undefined
    const at = order.indexOf(view)
    let touch = null

    const release = () => {
      touch = null
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', cancel)
      delete node.dataset.swiping
    }

    const rest = () => {
      page.style.transition = ''
      page.style.transform = ''
    }

    const move = (e) => {
      if (!touch) return
      const t = [...e.touches].find((x) => x.identifier === touch.id)
      if (!t) return
      const dx = t.clientX - touch.x
      const dy = t.clientY - touch.y

      if (!touch.axis) {
        if (Math.abs(dx) > INTENT && Math.abs(dx) > SLACK * Math.abs(dy)) {
          touch.axis = 'x'
          node.dataset.swiping = 'yes'
          page.style.transition = 'none'
        } else if (Math.abs(dy) > INTENT) {
          // Down or up: the page scroll has it, and nothing here should twitch.
          release()
          return
        } else {
          return
        }
      }

      if (e.cancelable) e.preventDefault()
      const now = performance.now()
      const next = order[at + (dx < 0 ? 1 : -1)]
      const shown = next ? dx : dx / EDGE
      // Speed over the last stretch of the drag, not the last event: one
      // late event would read as a stop, and one early one as a flick.
      touch.trail.push({ t: now, dx: shown })
      while (touch.trail.length > 1 && now - touch.trail[0].t > WINDOW) touch.trail.shift()
      const first = touch.trail[0]
      touch.v = first === touch.trail[touch.trail.length - 1] ? 0 : (shown - first.dx) / Math.max(1, now - first.t)
      touch.dx = shown
      // Reduced motion: the switch still happens on release, the page does
      // not travel under the finger to get there.
      if (!touch.still) page.style.transform = `translateX(${shown}px)`
    }

    const end = () => {
      if (!touch) return
      const { axis, dx, v } = touch
      release()
      if (axis !== 'x') return
      const next = order[at + (dx < 0 ? 1 : -1)]
      // A fast flick back the way you came is a change of mind, however far
      // the page had travelled.
      const undo = Math.abs(v) > FLICK && Math.sign(v) !== Math.sign(dx)
      const far = Math.abs(dx) > COMMIT || (Math.abs(dx) > INTENT && Math.abs(v) > FLICK)
      if (next && far && !undo) {
        // The new screen animates itself in; the old one just goes.
        rest()
        onChange(next)
        return
      }
      // Not far enough, or nothing that way: spring back.
      page.style.transition = 'transform var(--t-2) ease'
      page.style.transform = 'translateX(0)'
      const done = () => {
        page.removeEventListener('transitionend', done)
        rest()
      }
      page.addEventListener('transitionend', done)
    }

    const cancel = () => {
      if (!touch) return
      release()
      rest()
    }

    const begin = (e) => {
      if (touch) return
      const t = e.changedTouches[0]
      if (!t) return
      if (e.target?.closest?.(YIELDS)) return
      touch = {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        trail: [{ t: performance.now(), dx: 0 }],
        axis: null,
        dx: 0,
        v: 0,
        still: stillness()
      }
      window.addEventListener('touchmove', move, { passive: false })
      window.addEventListener('touchend', end)
      window.addEventListener('touchcancel', cancel)
    }

    // Passive on purpose. This listener only looks; the taps underneath it
    // are the whole app.
    node.addEventListener('touchstart', begin, { passive: true })
    return () => {
      node.removeEventListener('touchstart', begin)
      release()
      rest()
    }
  }, [view, enabled, order, onChange])

  return (
    <div className="screens" ref={outer} data-enter={entering || undefined}>
      <div className="screen" ref={inner}>
        {children}
      </div>
    </div>
  )
}
