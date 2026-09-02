import { useEffect, useState } from 'react'

/** A media query, answered once. */
export const asks = (query) => {
  try {
    return window.matchMedia(query).matches
  } catch {
    return false
  }
}

/**
 * A media query, answered and then kept answered.
 *
 * Read once at mount and this is wrong the moment a window is resized, a
 * phone is turned, or a reduced-motion setting is flipped — and being wrong
 * is not always cosmetic: the sheet's `rail` decides whether the page behind
 * is made inert and whether the scroll is locked, so a stale answer can leave
 * a desktop window unscrollable with nothing over it. Shared, so the typed
 * placeholder stops the moment motion is turned down rather than at the next
 * unrelated re-render.
 */
export function useAsks(query) {
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
