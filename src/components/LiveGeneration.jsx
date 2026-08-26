import { useEffect, useRef, useState } from 'react'

/**
 * Messages shown while the model is working.
 *
 * The model call is the one step whose duration nothing can predict — it
 * depends on how much of the preset is being changed. A static "designing…"
 * for fifteen seconds reads as a hang, so these describe what's actually
 * happening rather than counting.
 */
const STAGES = [
  'Reading what your unit can do',
  'Matching the description to real gear',
  'Choosing an amp',
  'Setting the gain structure',
  'Shaping the EQ',
  'Balancing the drive against the amp',
  'Choosing a cabinet',
  'Setting time and space',
  'Checking it against the ranges your unit reports',
  'Nearly there'
]

export function Stages({ active }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) return setIndex(0)
    const id = setInterval(() => {
      // Hold on the last message rather than looping — looping would suggest
      // it's started over, which is worse than admitting it's still going.
      setIndex((i) => Math.min(i + 1, STAGES.length - 1))
    }, 2600)
    return () => clearInterval(id)
  }, [active])

  if (!active) return null
  return <span>{STAGES[index]}…</span>
}

/**
 * What the model is producing, as it produces it.
 *
 * Partials arrive in the order the model decides things, so the chain appears
 * block by block. Collapsed by default — most of the time the summary line is
 * enough, and the detail is for when a result surprises you.
 */
export function LiveGeneration({ partial, open, onToggle }) {
  const scroller = useRef(null)

  useEffect(() => {
    if (open && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [partial, open])

  if (!partial) return null

  const blocks = partial.blocks || []

  return (
    <div className="live-gen">
      <button className="chip" onClick={onToggle} aria-expanded={open}>
        {open ? 'Hide live output' : `Live output · ${blocks.length} block${blocks.length === 1 ? '' : 's'}`}
      </button>

      {open ? (
        <div className="live-body" ref={scroller}>
          {partial.presetName ? (
            <p className="live-name">{partial.presetName}</p>
          ) : (
            <p className="hint">Naming it…</p>
          )}

          {partial.summary ? <p className="live-summary">{partial.summary}</p> : null}

          {blocks.map((block, i) => (
            <div className="live-block" key={block?.eid ?? i}>
              <div className="live-block-head mono">
                <span>eid {block?.eid ?? '…'}</span>
                {block?.typeName ? <span className="live-model">{block.typeName}</span> : null}
                {block?.bypassed === true ? <span className="tag off">bypass</span> : null}
              </div>
              {(block?.params || []).map((param, j) => (
                <div className="live-param mono" key={param?.id ?? j}>
                  {param?.name || `#${param?.id ?? '…'}`}
                  {param?.value !== undefined ? ` → ${param.value}` : ''}
                </div>
              ))}
            </div>
          ))}

          {partial.notes ? <p className="live-summary">{partial.notes}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
