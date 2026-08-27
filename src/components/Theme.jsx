import { useEffect, useState } from 'react'
import { getMode, setMode, apply, watchSystem, MODES } from '../lib/theme'

const LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' }

export default function Theme() {
  const [mode, setLocal] = useState(getMode)

  useEffect(() => {
    apply(mode)
    return watchSystem(() => {})
  }, [mode])

  return (
    <div className="theme-toggle" role="group" aria-label="Appearance">
      {MODES.map((m) => (
        <button
          key={m}
          className={m === mode ? 'current' : ''}
          onClick={() => {
            setMode(m)
            setLocal(m)
          }}
          aria-pressed={m === mode}
        >
          {LABEL[m]}
        </button>
      ))}
    </div>
  )
}
