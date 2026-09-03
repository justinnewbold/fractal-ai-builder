import { useEffect } from 'react'

/**
 * Whether there is more of a horizontal scroller off its right edge.
 *
 * Written onto the element as data-overflow="yes"|"no", kept current on
 * resize and scroll, so CSS can fade the edge only while something is past
 * it. The chain strip did this for itself on phones; the 12-column grid,
 * which clips at every width, had nothing.
 */
export function useOverflow(ref, deps = []) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const look = () => {
      el.dataset.overflow = el.scrollWidth - el.clientWidth - el.scrollLeft > 1 ? 'yes' : 'no'
    }
    look()
    const ro = new ResizeObserver(look)
    ro.observe(el)
    el.addEventListener('scroll', look, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', look)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps])
}
