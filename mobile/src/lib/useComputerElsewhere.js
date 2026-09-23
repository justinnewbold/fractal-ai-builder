import { useEffect, useState } from 'react'

import { computerElsewhere } from './relay'

/**
 * Whether a computer on this wifi is signed into a different account, asked
 * while `active` and again every half minute, because the answer changes the
 * moment somebody signs the computer in again. See relay.js.
 */
export function useComputerElsewhere(active, everyMs = 30000) {
  const [elsewhere, setElsewhere] = useState(false)
  useEffect(() => {
    if (!active) {
      setElsewhere(false)
      return undefined
    }
    let live = true
    const ask = () => computerElsewhere().then((yes) => live && setElsewhere(yes))
    ask()
    const t = setInterval(ask, everyMs)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [active, everyMs])
  return elsewhere
}
