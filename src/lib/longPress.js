/**
 * Hold a thing, or right-click it.
 *
 * "If you can hold one of the effects for a few seconds, it would be cool to
 * have a pop-up where you can quickly switch channels from ABCD. If the web
 * version doesn't support it at least do it on the mobile iOS and android
 * versions. On the Mac version, maybe we can do a right click."
 *
 * The web supports it, on all three. A hold is a pointer that goes down and
 * stays put, which is arithmetic, and a right-click is an event browsers have
 * always sent. Nothing here needs a native app — which matters, because the
 * phone apps do not exist yet and this works on the page they would wrap.
 *
 * Pointer events rather than touch events, deliberately. The three surfaces in
 * this app that bind `touchstart` themselves each carry a paragraph explaining
 * why, and the reason is always the same: React registers touch listeners as
 * passive, so cancelling the gesture means going around React. A hold never
 * needs to cancel anything — it only needs to know the finger did not move —
 * so it stays inside React and out of that whole category of bug.
 */
import { useCallback, useEffect, useRef } from 'react'

/** How long is a hold. Long enough not to fire on a tap, short enough to feel deliberate. */
export const HOLD_MS = 450

/**
 * How far a finger may wander and still count as holding still.
 *
 * Not zero: a thumb on a tile resting against a guitar moves a few pixels
 * without anybody intending it to. Past this it is a scroll, and a scroll that
 * opens a menu is worse than a hold that does not.
 */
export const HOLD_SLOP = 10

/**
 * Whether this press can become a hold.
 *
 * A right-click has its own path, and a middle-click is not a hold — but a
 * touch and a pen report no meaningful button, so only a mouse is asked.
 */
export const holdStarts = (e) => !(e.pointerType === 'mouse' && e.button !== 0)

/** Whether the finger has wandered far enough to be scrolling rather than holding. */
export function movedOut(from, x, y) {
  if (!from) return false
  return Math.hypot(x - from.x, y - from.y) > HOLD_SLOP
}

/**
 * Returns props to spread on the element that can be held.
 *
 * `onLong` is called once per press, from the timer or from a right-click,
 * never twice for the same one — Android fires its own contextmenu on a long
 * press, which would otherwise open the thing and immediately reopen it.
 *
 * The click that a press produces afterwards is swallowed. Without that, the
 * tile you held to change its channel also toggles the block off, which on a
 * stage is the failure that matters: silence, mid-song, from a gesture meant
 * to be safe.
 */
export function useLongPress(onLong, { enabled = true } = {}) {
  const timer = useRef(null)
  const from = useRef(null)
  const fired = useRef(false)
  const latest = useRef(onLong)
  latest.current = onLong

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    from.current = null
  }, [])

  // A component that unmounts mid-press must not wake up 450ms later.
  useEffect(() => stop, [stop])

  const fire = useCallback(() => {
    stop()
    fired.current = true
    latest.current?.()
  }, [stop])

  if (!enabled) {
    /* Nothing to hold: a tile with no channels opens an empty menu, which is
       worse than a gesture that does nothing. The click still works. */
    return {}
  }

  return {
    onPointerDown: (e) => {
      /* Only the plain press. A right-click has its own path below, and a
         middle-click is not a hold. */
      if (!holdStarts(e)) return
      fired.current = false
      from.current = { x: e.clientX, y: e.clientY }
      stop()
      timer.current = setTimeout(fire, HOLD_MS)
    },
    onPointerMove: (e) => {
      if (!from.current) return
      if (movedOut(from.current, e.clientX, e.clientY)) stop()
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onContextMenu: (e) => {
      /* Two jobs. On a desktop this is the right-click the request asked for.
         On Android it is the long-press menu the browser would have shown over
         the top of ours, and preventing it is the only way to stop that. (iOS
         sends no contextmenu at all; its callout is suppressed in CSS.) */
      e.preventDefault()
      if (fired.current) return
      fire()
    },
    onClickCapture: (e) => {
      if (!fired.current) return
      /* The press already did something. Letting the click through as well
         would toggle the block — silence, mid-song, from a safe gesture. */
      e.preventDefault()
      e.stopPropagation()
      fired.current = false
    }
  }
}
