import { useRef, useState } from 'react'
import { checkBpm } from '../../shared/tempo.mjs'

/**
 * The tempo readout you can type into.
 *
 * Tap gets you close; typing gets you exact. Shows "120 BPM" at rest; a tap
 * into it drops the unit and selects the number so typing replaces it. Enter
 * or tapping away commits, Escape abandons, and the device's own 20–400 range
 * is enforced (in shared/tempo.mjs, with the phone apps) so an impossible
 * tempo is refused with words rather than silently clamped downstream.
 *
 * It lived in App.jsx with nothing rendering it. Now it is the box that opens
 * when the Tap button is held or right-clicked, so it takes `autoFocus` and
 * tells its owner when it is finished either way.
 */
export default function BpmBox({ bpm, onSet, onError, onDone, autoFocus = false }) {
  const [text, setText] = useState(autoFocus && Number.isFinite(bpm) ? String(Math.round(bpm)) : null)
  const abandon = useRef(false)

  const finish = () => {
    if (abandon.current) {
      abandon.current = false
      setText(null)
      onDone?.()
      return
    }
    if (text === null) return
    const typed = text
    setText(null)
    const checked = checkBpm(typed)
    if (checked.error) {
      onError?.(checked.error)
    } else if (checked.bpm !== undefined && checked.bpm !== Math.round(bpm)) {
      onSet(checked.bpm)
    }
    onDone?.()
  }

  return (
    <input
      className="bpm-box mono"
      type="text"
      inputMode="numeric"
      autoFocus={autoFocus}
      value={text !== null ? text : Number.isFinite(bpm) ? `${Math.round(bpm)} BPM` : ''}
      placeholder="BPM"
      onFocus={(e) => {
        if (text === null) setText(Number.isFinite(bpm) ? String(Math.round(bpm)) : '')
        const el = e.target
        requestAnimationFrame(() => el.select())
      }}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          abandon.current = true
          e.currentTarget.blur()
        }
      }}
      aria-label="Tempo in BPM"
    />
  )
}
