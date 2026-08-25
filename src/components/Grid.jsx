/**
 * The routing grid, read live off the device.
 *
 * The FM3 lays a preset out on a 4-row by 12-column matrix. That matrix is the
 * most characteristic thing about the instrument, so it is what this app leads
 * with — not a form, not a list of effects. Engaged blocks carry the signal
 * colour on their leading edge; bypassed blocks recede to an outline.
 */
export default function Grid({ preset, blocks, rows = 4, cols = 12 }) {
  const byPosition = new Map()
  for (const b of blocks) {
    // rows come back 1-indexed from ForgeFX, columns 0-indexed
    byPosition.set(`${b.row}:${b.col}`, b)
  }

  const cells = []
  for (let row = 1; row <= rows; row++) {
    for (let col = 0; col < cols; col++) {
      const block = byPosition.get(`${row}:${col}`)
      cells.push(
        block ? (
          <div
            key={`${row}:${col}`}
            className="block"
            data-bypassed={String(block.bypassed)}
            title={`${block.name} — effect id ${block.effectId}`}
          >
            <div className="block-name">{block.name}</div>
            <div className="block-meta">
              <span>{block.effectId}</span>
              {block.channel ? <span className="chan">CH {block.channel}</span> : null}
            </div>
          </div>
        ) : (
          <div key={`${row}:${col}`} className="cell" />
        )
      )
    }
  }

  return (
    <section className="grid-section">
      <div className="grid-head">
        <div>
          <p className="silk-label">Loaded preset</p>
          <h2 className="preset-name">{preset?.name?.trim() || 'Untitled'}</h2>
        </div>
        <div className="preset-slot mono">
          {typeof preset?.number === 'number' ? `SLOT ${preset.number}` : ''}
        </div>
      </div>

      <div className="grid-scroll">
        <div className="grid" role="table" aria-label="Preset routing grid">
          {cells}
        </div>
      </div>

      <div className="grid-legend">
        <div className="legend-item">
          <div className="swatch" />
          <span>Engaged</span>
        </div>
        <div className="legend-item">
          <div className="swatch" data-kind="bypassed" />
          <span>Bypassed</span>
        </div>
        <div className="legend-item">
          <span className="mono" style={{ fontSize: '11px', color: 'var(--silk-faint)' }}>
            {blocks.length} blocks placed
          </span>
        </div>
      </div>
    </section>
  )
}
