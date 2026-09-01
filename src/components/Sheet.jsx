import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A surface that arrives.
 *
 * The app's answer to "where does this go" has been a panel, stacked below the
 * last one, folded away behind a summary. Seventeen of them, and the thing you
 * opened landed below the fold on a phone. A sheet arrives over the screen
 * instead: you are looking at it the moment it exists, and the way out is a
 * gesture you already know.
 *
 * On a wide screen the same component is a rail down the right — not a floating
 * window over a dimmed page, which wastes the width and blocks the thing you
 * opened it to work on. One component, one set of contents; the size of the
 * window decides which it is.
 *
 * Three rules earned the hard way, all of them things that break silently:
 *
 *   - **Drag-to-dismiss lives on the handle, never the body.** The block editor
 *     is full of knobs, and knobs are vertical drags. A dismiss handler on the
 *     sheet body would fight every one of them, which is precisely the work
 *     that took three attempts to get right on iOS.
 *   - **Blur on the scrim, transform on the sheet.** A backdrop-filter on an
 *     element that is also animating its transform tears in Safari.
 *   - **The back gesture closes it.** With no router, a phone's back swipe
 *     leaves the app instead — so opening pushes a history entry and popping it
 *     is what closes.
 */
const DESK = '(min-width: 1000px)'

const asks = (query) => {
  try {
    return window.matchMedia(query).matches
  } catch {
    return false
  }
}

/**
 * A media query, answered and then kept answered.
 *
 * Read once at mount and this is wrong the moment a window is resized or a
 * phone is turned — and being wrong here isn't cosmetic: `rail` decides whether
 * the page behind is made inert and whether the scroll is locked, so a stale
 * answer can leave a desktop window unscrollable with nothing over it.
 */
function useAsks(query) {
  const [yes, setYes] = useState(() => asks(query))
  useEffect(() => {
    let mq
    try {
      mq = window.matchMedia(query)
    } catch {
      return undefined
    }
    const answer = () => setYes(mq.matches)
    answer()
    // Safari didn't have addEventListener on a MediaQueryList until 14.
    if (mq.addEventListener) mq.addEventListener('change', answer)
    else mq.addListener(answer)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', answer)
      else mq.removeListener(answer)
    }
  }, [query])
  return yes
}

/*
 * Pops a sheet caused itself, which no sheet may read as a back gesture.
 *
 * Closing a sheet pops the entry it pushed, and that pop lands a beat later —
 * by which time a second sheet opened in the same action has registered its
 * own listener and catches it. The symptom is a sheet that opens and closes
 * again about a third of a second later, entirely on its own: "Show the
 * introduction" from inside Settings did exactly that, and it would have hit
 * anything that ever wanted to close one sheet and open another.
 *
 * A counter rather than a boolean because two sheets can tear down at once,
 * and each teardown owes exactly one swallowed pop.
 *
 * The debt is only ever created when somebody is left to pay it. A sheet
 * closing on its own removes its listener and then pops, and if no other
 * sheet is listening that pop reaches nobody — so an unconditional increment
 * is never spent, and the next genuine back gesture is swallowed instead.
 * Three open-and-close cycles were enough to leave a sheet that would not
 * close on back at all, which is far worse than the bug this fixes.
 */
let selfPops = 0

/** Sheets currently listening for a pop — i.e. open, on a phone. */
let listening = 0

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export default function Sheet({ open, onClose, title, note, footer, children }) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const [drag, setDrag] = useState(0)
  const panel = useRef(null)
  const handle = useRef(null)
  const cameFrom = useRef(null)
  const pushed = useRef(false)

  const still = useAsks('(prefers-reduced-motion: reduce)')
  const rail = useAsks(DESK)

  /*
   * `close` never changes identity, and that is load-bearing.
   *
   * A caller writes `onClose={() => setThing(false)}`, so onClose is a new
   * function on every render of the parent. Depend on it and the history effect
   * below tears down and rebuilds itself on every unrelated re-render — and its
   * teardown calls history.back(), whose popstate lands a beat later and is
   * caught by the listener the rebuild just added. The sheet closed itself
   * about a second after any knob commit, because committing re-renders App.
   */
  const latest = useRef(onClose)
  latest.current = onClose
  const close = useCallback(() => latest.current?.(), [])

  /*
   * Mounting and the animation are separate: the sheet has to exist for a frame
   * at its closed position before it can be transitioned away from it, and it
   * has to outlive `open` for as long as the way out takes.
   */
  useEffect(() => {
    if (open) {
      setMounted(true)
      setDrag(0)
      const id = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    if (!mounted) return undefined
    // Long enough for the way out to finish. Under reduced motion the way out
    // is a 120ms fade rather than a 320ms slide, but it is still a way out —
    // a surface that vanishes between frames reads as a glitch, not as calm.
    const id = setTimeout(() => setMounted(false), still ? 120 : 320)
    return () => clearTimeout(id)
  }, [open, mounted, still])

  /* The back gesture is the way out of a layer on a phone, and there is no
     router here to hear it. */
  useEffect(() => {
    if (!open || rail) return undefined
    const mark = () => {
      try {
        window.history.pushState({ sheet: true }, '')
        pushed.current = true
      } catch {
        pushed.current = false
      }
    }
    mark()
    const back = () => {
      if (selfPops > 0) {
        selfPops--
        /*
         * Another sheet's teardown popped an entry, and this listener heard
         * it. Not a back gesture, so this sheet stays — but the entry that
         * went was the one this sheet pushed, so it has to be put back or the
         * next real back press leaves the app instead of closing this.
         */
        mark()
        return
      }
      pushed.current = false
      close()
    }
    window.addEventListener('popstate', back)
    listening++
    return () => {
      window.removeEventListener('popstate', back)
      listening--
      // Closed by a button rather than by going back: take the entry with us,
      // or the next back press does nothing visible.
      if (!pushed.current) return
      pushed.current = false
      /*
       * Deferred by a task, and that is the whole trick.
       *
       * React flushes every cleanup before any setup, so at this instant a
       * sheet handing over to another looks exactly like a sheet closing on
       * its own — the incoming sheet has not run its effect yet, and asking
       * "is anyone still listening?" here always answers no. One task later
       * it has, and the question gives the right answer.
       */
      setTimeout(() => {
        try {
          // Only owe a swallowed pop if a sheet is there to hear it. With
          // none, this pop lands on nobody and the debt would sit waiting to
          // eat someone's real back gesture instead.
          if (listening > 0) selfPops++
          window.history.back()
        } catch {
          // A history the page isn't allowed to move is not worth failing over.
          if (listening > 0) selfPops--
        }
      }, 0)
    }
  }, [open, rail, close])

  /*
   * While a sheet is over the screen, the screen is not there: nothing behind
   * it takes focus, and the page under it doesn't scroll. A rail is beside the
   * page rather than over it, so it does neither.
   */
  /*
   * A docked rail is fixed to the right edge — it has to be, because the sheet
   * renders into document.body rather than into whatever laid the page out. So
   * the page is told to leave room for it, which is the difference between a
   * panel docked beside the work and a panel sitting on top of it.
   */
  useEffect(() => {
    // Held for as long as the sheet is mounted, not as long as it is open: drop
    // it the instant `open` goes false and the page reflows out from under a
    // rail that is still sliding away.
    if (!mounted || !rail) return undefined
    const html = document.documentElement
    html.dataset.rail = 'on'
    return () => {
      delete html.dataset.rail
    }
  }, [mounted, rail])

  useEffect(() => {
    if (!open || rail) return undefined
    const root = document.getElementById('root')
    const html = document.documentElement
    const scroll = html.style.overflow
    cameFrom.current = document.activeElement
    html.style.overflow = 'hidden'
    if (root) root.inert = true
    const id = requestAnimationFrame(() => {
      const first = panel.current?.querySelector(FOCUSABLE)
      ;(first || panel.current)?.focus?.({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(id)
      html.style.overflow = scroll
      if (root) root.inert = false
      cameFrom.current?.focus?.({ preventScroll: true })
    }
  }, [open, rail])

  useEffect(() => {
    if (!open) return undefined
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
        return
      }
      if (e.key !== 'Tab' || rail) return
      // Nothing behind the sheet is reachable, so the tab order has to close on
      // itself or focus walks out into a page that has been made inert.
      const all = [...(panel.current?.querySelectorAll(FOCUSABLE) || [])]
      if (!all.length) return
      const first = all[0]
      const last = all[all.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, rail, close])

  /*
   * Drag to dismiss, from the header alone — never the body, which is full of
   * knobs, and knobs are vertical drags.
   *
   * Native and non-passive, the same as the knob and the pad: React registers
   * touch listeners as passive, so preventDefault inside one is ignored and iOS
   * takes the gesture as a scroll before the first move is answered.
   *
   * The header is not only a handle, though: the close button lives in it. See
   * `begin` for why that costs the press if the grab is taken indiscriminately.
   */
  useEffect(() => {
    const grip = handle.current
    if (!grip || !mounted || rail) return undefined
    let from = null

    const move = (e) => {
      const t = [...e.touches].find((x) => x.identifier === from?.id)
      if (!t) return
      if (e.cancelable) e.preventDefault()
      setDrag(Math.max(0, t.clientY - from.y))
    }
    const end = () => {
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
      setDrag((d) => {
        // Far enough to mean it, or the sheet springs back.
        if (d > 90) close()
        return 0
      })
      from = null
    }
    const begin = (e) => {
      const t = e.changedTouches[0]
      if (!t) return
      // A control in the header is a tap, not a grab. preventDefault on a
      // touchstart suppresses the click iOS would have synthesised from it, so
      // grabbing this one would eat the press: the close button did nothing on
      // a phone while the swipe it shares the header with worked fine.
      if (e.target?.closest?.(FOCUSABLE)) return
      if (e.cancelable) e.preventDefault()
      from = { id: t.identifier, y: t.clientY }
      window.addEventListener('touchmove', move, { passive: false })
      window.addEventListener('touchend', end)
      window.addEventListener('touchcancel', end)
    }

    grip.addEventListener('touchstart', begin, { passive: false })
    return () => {
      grip.removeEventListener('touchstart', begin)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
    }
  }, [mounted, rail, close])

  if (!mounted) return null

  const sheet = (
    <div className={`sheet-layer ${rail ? 'rail' : ''}`} data-shown={shown ? 'yes' : 'no'}>
      {/* The scrim carries the blur and takes the tap. It never transforms. */}
      {rail ? null : (
        <button className="sheet-scrim" onClick={close} tabIndex={-1} aria-label="Close" />
      )}

      <section
        className="sheet"
        ref={panel}
        role="dialog"
        aria-modal={rail ? undefined : 'true'}
        aria-label={title}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
      >
        <header className="sheet-head" ref={handle}>
          <span className="sheet-grip" aria-hidden="true" />
          <div className="sheet-titles">
            <span className="sheet-title">{title}</span>
            {note ? <span className="sheet-note">{note}</span> : null}
          </div>
          <button className="sheet-close" onClick={close} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {/* Its own scroller, and its own overscroll: a sheet scrolled to the
            end must not hand the gesture to the page underneath it. */}
        <div className="sheet-body">{children}</div>

        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </section>
    </div>
  )

  return createPortal(sheet, document.body)
}
