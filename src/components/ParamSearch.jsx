import { useEffect, useRef, useState } from 'react'
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
 *
 * The list is a listbox the field drives: ArrowDown and ArrowUp move the
 * active row, Enter opens it, Escape clears the search. The rows are still
 * buttons, so a mouse and a screen reader both get them — but they sit
 * outside the Tab order, because thirty tab stops between the field and the
 * row you want was the "mouse-only" search.
 */
const READ_DEBOUNCE = 200
const SLOW_AFTER = 300

export default function ParamSearch({ blocks, onPick, onError }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(null)
  const [reading, setReading] = useState(false)
  const [slow, setSlow] = useState(false)
  const [active, setActive] = useState(0)
  const loadedFor = useRef(null)
  const pending = useRef(null)
  const debounce = useRef(null)
  const list = useRef(null)

  const editable = blocks.filter((b) => !EXCLUDED_BLOCKS.includes(b.slug))
  const chainKey = editable.map((b) => b.effectId).join(',')

  /*
   * One read per chain, however fast someone types. The first version had
   * no in-flight guard: every keystroke past the second started another
   * serial read of every block, and each one's `finally` flipped the
   * "Reading the blocks…" line off while the others were still going —
   * the flicker.
   */
  const ensureIndex = () => {
    if (loadedFor.current === chainKey) return Promise.resolve()
    if (pending.current?.key === chainKey) return pending.current.promise
    setReading(true)
    const promise = buildParamIndex(blocks)
      .then((built) => {
        setIndex(built)
        loadedFor.current = chainKey
      })
      .finally(() => {
        if (pending.current?.key === chainKey) pending.current = null
        setReading(false)
      })
    pending.current = { key: chainKey, promise }
    return promise
  }

  const change = (value) => {
    setQuery(value)
    setActive(0)
    clearTimeout(debounce.current)
    if (value.trim().length >= 2) {
      debounce.current = setTimeout(() => {
        ensureIndex().catch((err) => onError(err.message))
      }, READ_DEBOUNCE)
    }
  }

  useEffect(() => () => clearTimeout(debounce.current), [])

  // "Reading the blocks…" only when the read is actually taking a moment,
  // and only for a first read: a re-read after the chain changed keeps the
  // old results on screen underneath instead of blanking them.
  useEffect(() => {
    if (!reading) {
      setSlow(false)
      return undefined
    }
    const t = setTimeout(() => setSlow(true), SLOW_AFTER)
    return () => clearTimeout(t)
  }, [reading])

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
  const current = hits[Math.min(active, Math.max(0, hits.length - 1))]
  const hitId = (h) => `param-hit-${h.block.effectId}-${h.param.id}`

  // Keep the active row in view as the arrows move it.
  useEffect(() => {
    if (!current || !list.current) return
    const el = list.current.querySelector(`#${hitId(current)}`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      change('')
      return
    }
    if (!hits.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (current) onPick(current.block.effectId, current.param.id)
    }
  }

  const open = needle.length >= 2 && !!index

  return (
    <div className="param-search">
      <input
        type="search"
        placeholder="Find a control — gain, mix, presence…"
        value={query}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Find a control by name"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="param-search-hits"
        aria-autocomplete="list"
        aria-activedescendant={open && current ? hitId(current) : undefined}
      />

      {slow && index === null ? <p className="hint mono">Reading the blocks…</p> : null}

      {open ? (
        hits.length ? (
          <div className="param-search-hits" id="param-search-hits" role="listbox" ref={list}>
            {hits.map((hit, i) => {
              const { block, param } = hit
              return (
                <button
                  key={`${block.effectId}-${param.id}`}
                  id={hitId(hit)}
                  role="option"
                  aria-selected={hit === current}
                  tabIndex={-1}
                  className={`param-search-hit ${hit === current ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(block.effectId, param.id)}
                >
                  <span className="hit-block">{block.name}</span>
                  <span className="hit-param">{param.name}</span>
                  <span className="hit-value mono">
                    {Math.round(param.value * 100) / 100}
                    {param.unit || ''}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="hint">No control called “{query.trim()}” in this preset.</p>
        )
      ) : null}
    </div>
  )
}
