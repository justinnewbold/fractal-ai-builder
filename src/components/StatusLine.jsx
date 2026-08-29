/**
 * Where you are, on every screen.
 *
 * The single most important piece of state — which preset is loaded and whether
 * it's been changed since it was saved — was scattered: the slot in one panel,
 * the name in another, unsaved shown only when a bar happened to appear. On a
 * phone you could be three screens from any of it.
 *
 * One line, always present, always the same shape. Nothing here is a control;
 * it exists to answer "what am I about to change" before you change it.
 */
export default function StatusLine({ device, preset, dirty, remote }) {
  return (
    <div className="status-line" role="status">
      <span className={`lamp ${remote ? 'remote' : ''}`} data-state="live" />

      <span className="status-unit silk-label">
        {device?.short || device?.name || 'Unit'}
        {remote ? ' · remote' : ''}
      </span>

      <span className="status-preset">
        <span className="status-slot mono">{preset?.number ?? '--'}</span>
        <span className="status-name">{preset?.name?.trim() || 'Untitled'}</span>
      </span>

      {/* Said plainly rather than as a coloured dot on its own: unsaved is the
          one state here with a consequence, and a dot needs a legend. */}
      {dirty ? <span className="status-dirty">Unsaved</span> : null}
    </div>
  )
}
