import { useState } from 'react'
import { blockColor } from '../lib/blockColors'

/**
 * The signal path, read live off the device.
 *
 * Fractal units don't agree on what a preset looks like. The FM3 and Axe-Fx III
 * lay one out on a matrix — four rows by twelve columns — where routing is part
 * of the picture. The AM4 is a straight chain of four slots with no routing at
 * all. Rendering a 4x12 matrix for an AM4 would be inventing structure the
 * device doesn't have.
 *
 * So the shape comes from the device's own capability report rather than from
 * an assumption about which unit is plugged in.
 */
export default function Grid({ preset, blocks, capabilities }) {
  const linear = capabilities?.slotModel === 'linear'
  const rows = capabilities?.grid?.rows ?? 4
  const cols = capabilities?.grid?.cols ?? 12

  if (linear) return <Chain preset={preset} blocks={blocks} />

  return <Matrix preset={preset} blocks={blocks} rows={rows} cols={cols} />
}

/** A straight signal chain — the AM4's four slots, in order. */
function Chain({ preset, blocks }) {
  return (
    <section className="grid-section">
      <Head preset={preset} />
      <div className="grid-scroll">
        <div className="chain">
          {blocks.map((block, i) => (
            <div key={block.effectId ?? i} className="chain-link">
              <div
                className="block"
                data-bypassed={String(block.bypassed)}
                style={{ '--block-fill': blockColor(block.slug).fill }}
              >
                <div className="block-name">{block.name}</div>
                <div className="block-meta">
                  <span>{block.effectId}</span>
                  {block.channel ? <span className="chan">CH {block.channel}</span> : null}
                </div>
              </div>
              {i < blocks.length - 1 ? <span className="chain-arrow">→</span> : null}
            </div>
          ))}
        </div>
      </div>
      <Legend blocks={blocks} />
    </section>
  )
}

function Head({ preset }) {
  return (
    <div className="grid-head">
      <div>
        <p className="silk-label">Loaded preset</p>
        <h2 className="preset-name">{preset?.name?.trim() || 'Untitled'}</h2>
      </div>
      <div className="preset-slot mono">
        {typeof preset?.number === 'number' ? `SLOT ${preset.number}` : ''}
      </div>
    </div>
  )
}

function Legend({ blocks, children }) {
  return (
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
      {children}
    </div>
  )
}

function Matrix({ preset, blocks, rows, cols }) {
  const [showAll, setShowAll] = useState(false)

  // Most presets live on row 1. Showing four rows of empty cells by default
  // buries the actual signal path in whitespace, so collapse to the rows in use.
  const usedRows = new Set(blocks.map((b) => b.row))
  const lastUsed = usedRows.size ? Math.max(...usedRows) : 1
  const visibleRows = showAll ? rows : lastUsed
  const hiddenRows = rows - visibleRows

  const byPosition = new Map()
  for (const b of blocks) {
    // rows come back 1-indexed from ForgeFX, columns 0-indexed
    byPosition.set(`${b.row}:${b.col}`, b)
  }

  const cells = []
  for (let row = 1; row <= visibleRows; row++) {
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
      <Head preset={preset} />

      <div className="grid-scroll">
        <div
          className="grid"
          role="table"
          aria-label="Preset routing grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(94px, 1fr))` }}
        >
          {cells}
        </div>
      </div>

      <Legend blocks={blocks}>
        {hiddenRows > 0 || showAll ? (
          <button className="chip" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Collapse empty rows' : `Show all ${rows} rows`}
          </button>
        ) : null}
      </Legend>
    </section>
  )
}
