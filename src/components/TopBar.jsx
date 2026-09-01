import { isDemo } from '../lib/forgefx'
import LinkChip from './LinkChip'

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
  onOpenPresets,
  onOpenSettings,
  link,
  onLinkAction,
  presetsOpen,
  menu,
  children
}) {
  const demo = isDemo()
  // A phone driving the Mac from a distance. Handed in as state rather than
  // read from the connection module at render, which was only ever as fresh
  // as the last unrelated re-render.
  const remote = link?.role === 'remote'

  /*
   * The short name is the point: "FM3", not a sentence.
   *
   * A phone that is not connected is not a fault. "No device" in red over a
   * screen that calmly says "Connect to your Mac" is two answers to one
   * question, and the loud one is wrong — so on a phone the bar says the
   * quiet thing and leaves the state to the chip.
   */
  const settled = remote && status !== 'live'
  const unit = settled
    ? 'Not connected'
    : status === 'live'
      ? device?.short || device?.name || 'Connected'
      : status === 'fault'
        ? 'No device'
        : 'Looking…'
  const lampState = demo ? 'demo' : settled ? 'idle' : status

  /*
   * The word beside the lamp. On a phone the chip on the right already says
   * the state of the link — connected, no answer — so the bar does not say it
   * twice; here the word is about the unit.
   */
  const how = demo
    ? 'demo'
    : remote
      ? ''
      : status === 'live'
        ? 'connected'
        : status === 'fault'
          ? 'offline'
          : ''

  return (
    <div className="topbar" data-status={lampState}>
      <div className="topbar-row">
        <span className="lamp" data-state={lampState} />
        <span className="topbar-unit silk-label">{unit}</span>
        {/* The word carries the state as well as saying it: green when the unit
            is answering, red when it isn't, so the bar reads at a glance. */}
        {how ? (
          <span className="topbar-how mono" data-state={lampState}>
            {how}
          </span>
        ) : null}

        {/* The preset is a button because it's the thing you change most, and
            because a slot number nobody can act on is trivia. */}
        {status === 'live' ? (
          <button
            className={`topbar-preset ${presetsOpen ? 'open' : ''}`}
            onClick={onOpenPresets}
            aria-label="Choose a preset"
            aria-expanded={!!presetsOpen}
          >
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

        <LinkChip compact link={link} onAction={onLinkAction} />

        {/* Setup is a sheet now, not a fold under the bar. It carries the
            host address, the sign-in, the ports and the diagnostics, so it was
            always too much to hang off a 44px bar — and a fold that pushes the
            whole page down is the opposite of what this bar is for. */}
        <button
          className="topbar-gear"
          onClick={onOpenSettings}
          aria-label="Connection and setup"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>

      {/*
        The preset menu hangs off the bar rather than off the button, for the
        same reason the save popover does: the button sits mid-row, and a menu
        anchored to it runs off the edge of a phone. The bar spans the screen.
      */}
      {menu}
    </div>
  )
}
