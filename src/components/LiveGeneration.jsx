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
  'Setting time and space'
]

/**
 * How long this has been going, and after a while, the truth.
 *
 * These lines are a guess at what a model is doing, and they were presented as
 * if they were status: the script ran out after half a minute, parked on
 * "Nearly there…", and then said that identical thing whether the model was a
 * token from finishing or the request had died two minutes earlier. Someone
 * watching it for four minutes was watching an animation.
 *
 * So the script now describes only the window it can honestly describe, and
 * after that this counts out loud. A generation that is genuinely working shows
 * its work in the live output beside this; one that isn't shows a clock going
 * up, which is the fact.
 */
export function Stages({ active, startedAt }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  if (!active) return null

  const seconds = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0
  const scripted = STAGES[Math.min(Math.floor(seconds / 3), STAGES.length - 1)]
  const clock = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`

  // Under half a minute a generation is simply running; past it, the honest
  // thing is the clock and, further out, that this is no longer normal.
  if (!startedAt) return <span>{scripted}…</span>
  if (seconds < 24) return <span>{scripted}…</span>
  if (seconds < 60) return <span>Waiting on the model — {clock}</span>
  return (
    <span>
      Still waiting — {clock}. Longer than usual; Stop is safe, nothing has been written.
    </span>
  )
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
