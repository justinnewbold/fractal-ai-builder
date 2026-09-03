import { useEffect, useRef } from 'react'

/**
 * The two ways anyone expects to leave a thing that opened over the page:
 * a tap outside it, and Escape. Both on the document, both only while open,
 * and focus goes back to where it was when the thing closes.
 *
 * `ignore` is the trigger's selector. The button that opened a popover
 * toggles it, and letting the outside-tap close it too races the toggle and
 * reopens on the same tap — the preset menu learned this the hard way.
 *
 * Sheets keep their own machinery (inert page, scroll lock, Tab wrap); this
 * is for the small things: a chip's popover, a menu under the bar.
 */
export function useDismiss(ref, onClose, { open, ignore, restoreFocus = true } = {}) {
  const latest = useRef(onClose)
  latest.current = onClose
  useEffect(() => {
    if (!open) return undefined
    const cameFrom = document.activeElement
    const away = (e) => {
      if (ref.current?.contains(e.target)) return
      if (ignore && e.target.closest?.(ignore)) return
      latest.current?.()
    }
    const key = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      latest.current?.()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
      if (restoreFocus && cameFrom && document.contains(cameFrom)) cameFrom.focus?.({ preventScroll: true })
    }
  }, [open, ref, ignore, restoreFocus])
}
