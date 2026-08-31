import { useEffect, useRef, useState } from 'react'
import { isDemo } from '../lib/forgefx'
import { remoteActive } from '../lib/remote'
import DeviceDetail from './DeviceDetail'
import PhoneLink from './PhoneLink'

/**
 * One line, above everything, in every state.
 *
 * What it replaces: a wordmark, a sentence explaining the app to someone
 * already using it, a version badge, a collapsible device bar, a status line,
 * and a save cluster — six stacked elements, about 290px, before the first
 * thing anyone came here to do. On a phone that was 35-40% of the screen, and
 * the six of them between them said the unit's name four times, the preset
 * twice and the connection three times.
 *
 * So: one bar, 44px, and the single place any of those facts is written. The
 * unit and its lamp on the left, the loaded preset in the middle — a button,
 * because the preset is the thing you change most — unsaved and saving on the
 * right, and setup behind the gear.
 *
 * Sticky rather than fixed. A fixed bar is pinned to the layout viewport, which
 * on iOS means the keyboard slides underneath it and the page scrolls behind
 * it; sticky moves with the document and needs none of the compensation the
 * assistant already carries for its own input.
 *
 * It renders at every status, including none. The gear is how you reach the
 * host address and the sign-in when nothing is connected, which is exactly when
 * you need them and precisely when the old device bar was easiest to miss.
 */
export default function TopBar({
  status,
  device,
  preset,
  dirty,
  busy,
  onOpenPresets,
  onRetry,
  onError,
  onRemoteChanged,
  children
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)

  const demo = isDemo()
  const remote = remoteActive()

  // The short name is the point: "FM3", not a sentence.
  const unit =
    status === 'live'
      ? device?.short || device?.name || 'Connected'
      : status === 'fault'
        ? 'No device'
        : 'Looking…'

  const how = demo
    ? 'demo'
    : status === 'live'
      ? remote
        ? 'remote'
        : 'connected'
      : status === 'fault'
        ? 'offline'
        : ''

  // A tap outside is the ordinary way to dismiss a menu on a phone.
  useEffect(() => {
    if (!open) return
    const away = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false)
    }
    const key = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div className="topbar" data-status={demo ? 'demo' : status} ref={wrap}>
      <div className="topbar-row">
        <span className="lamp" data-state={demo ? 'demo' : status} />
        <span className="topbar-unit silk-label">{unit}</span>
        {/* The word carries the state as well as saying it: green when the unit
            is answering, red when it isn't, so the bar reads at a glance. */}
        {how ? (
          <span className="topbar-how mono" data-state={demo ? 'demo' : status}>
            {how}
          </span>
        ) : null}

        {/* The preset is a button because it's the thing you change most, and
            because a slot number nobody can act on is trivia. */}
        {status === 'live' ? (
          <button className="topbar-preset" onClick={onOpenPresets} aria-label="Choose a preset">
            <span className="topbar-slot mono">{preset?.number ?? '--'}</span>
            <span className="topbar-name">{preset?.name?.trim() || 'Untitled'}</span>
            <span className="topbar-caret" aria-hidden="true" />
          </button>
        ) : (
          <span className="topbar-gap" />
        )}

        {/* Said plainly rather than as a coloured dot on its own: unsaved is the
            one state here with a consequence, and a dot needs a legend. */}
        {dirty ? <span className="topbar-dirty">Unsaved</span> : null}

        {children}

        <PhoneLink compact onChanged={onRemoteChanged} onError={onError} />

        <button
          className={`topbar-gear ${open ? 'open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Connection and setup"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>

      {open ? <DeviceDetail status={status} device={device} onRetry={onRetry} busy={busy} /> : null}
    </div>
  )
}
