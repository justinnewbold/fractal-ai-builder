import { useEffect, useState } from 'react'
import { fcModel } from '../lib/forgefx'

/**
 * What each footswitch does.
 *
 * Read-only. The unit reports its layout, and knowing what switch 3 is bound to
 * is most of the value — the FM3 has three switches doing very different things
 * depending on layout and view, and that is easy to lose track of. Changing
 * bindings is a job for the hardware menu, where you can see the switch you are
 * about to reassign.
 */
export default function Footswitches({ onError }) {
  const [model, setModel] = useState(undefined)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let stop = false
    ;(async () => {
      try {
        const res = await fcModel()
        if (!stop) setModel(res || null)
      } catch (err) {
        if (!stop) {
          setModel(null)
          onError?.(err.message)
        }
      }
    })()
    return () => {
      stop = true
    }
  }, [onError])

  if (!model) return null

  const switches = model.switches || model.footswitches || []
  const layouts = model.layouts ?? model.layoutCount

  return (
    <section className="footswitches">
      <div className="log-head">
        <button className="chip" onClick={() => setOpen(!open)}>
          {open ? 'Hide footswitches' : 'Footswitches'}
        </button>
      </div>

      {open ? (
        switches.length ? (
          <>
            <div className="fc-row">
              {switches.map((sw, i) => (
                <div className="fc-switch" key={sw.id ?? i}>
                  <span className="fc-num mono">{sw.id ?? i + 1}</span>
                  <span className="fc-label">{sw.name || sw.label || '—'}</span>
                  {sw.function ? <span className="fc-fn mono">{sw.function}</span> : null}
                </div>
              ))}
            </div>
            {layouts ? (
              <p className="hint">
                {layouts} layout{layouts === 1 ? '' : 's'} available — switch them on the unit.
              </p>
            ) : null}
          </>
        ) : (
          <p className="hint">
            This unit reported a footswitch model but no per-switch detail.
          </p>
        )
      ) : null}
    </section>
  )
}
