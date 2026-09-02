import { useRef, useState } from 'react'
import { EXCLUDED_BLOCKS } from '../lib/guardrails'
import { buildParamIndex } from '../lib/paramIndex'

/**
 * Find a control by name, across every block at once.
 *
 * "Where does the presence live" has one good answer per preset and this is
 * it — typing three letters beats opening four blocks in turn to look. The
 * result rows navigate rather than edit: tapping one opens that block in the
 * editor below with the control highlighted, so there is exactly one place in
 * the app where values change, with its verified-write path and its history.
 *
 * Parameter lists load on the first keystroke, not on mount — a search box
 * someone never touches shouldn't cost a wire read per block.
 */
export default function ParamSearch({ blocks, onPick, onError }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(null)
  const [reading, setReading] = useState(false)
  const loadedFor = useRef(null)

  const editable = blocks.filter((b) => !EXCLUDED_BLOCKS.includes(b.slug))

  const ensureIndex = async () => {
    // Re-read when the chain itself changed, not on every keystroke.
    const key = editable.map((b) => b.effectId).join(',')
    if (loadedFor.current === key) return
    setReading(true)
    try {
      setIndex(await buildParamIndex(blocks))
      loadedFor.current = key
    } finally {
      setReading(false)
    }
  }

  const change = (value) => {
    setQuery(value)
    if (value.trim().length >= 2) ensureIndex().catch((err) => onError(err.message))
  }

  const needle = query.trim().toLowerCase()
  const hits =
    needle.length >= 2 && index
      ? index
          .filter(
            ({ block, param }) =>
              param.name.toLowerCase().includes(needle) ||
              `${block.name} ${param.name}`.toLowerCase().includes(needle)
          )
          .slice(0, 30)
      : []

  return (
    <div className="param-search">
      <input
        type="search"
        placeholder="Find a control — gain, mix, presence…"
        value={query}
        onChange={(e) => change(e.target.value)}
        aria-label="Find a control by name"
      />

      {reading ? <p className="hint mono">Reading the blocks…</p> : null}

      {needle.length >= 2 && index && !reading ? (
        hits.length ? (
          <div className="param-search-hits">
            {hits.map(({ block, param }) => (
              <button
                key={`${block.effectId}-${param.id}`}
                className="param-search-hit"
                onClick={() => onPick(block.effectId, param.id)}
              >
                <span className="hit-block">{block.name}</span>
                <span className="hit-param">{param.name}</span>
                <span className="hit-value mono">
                  {Math.round(param.value * 100) / 100}
                  {param.unit || ''}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="hint">No control called “{query.trim()}” in this preset.</p>
        )
      ) : null}
    </div>
  )
}
