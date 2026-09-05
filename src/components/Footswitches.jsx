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
 *
 * No fold of its own. This lives inside a Setup section that already opens and
 * closes, and it used to carry a second toggle inside that one — so opening
 * FOOTSWITCHES showed a lone "Hide footswitches" button and, under it, a
 * sentence about per-switch detail. Two folds for one thing, and the inner one
 * offering to hide something that was not shown.
 */
export default function Footswitches({ onError }) {
  const [model, setModel] = useState(undefined)

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

  /*
   * The unit has switches and will not say what they are set to.
   *
   * True on an FM3, which is most of the units this will ever run on, so this
   * is the normal case rather than the exception. It used to read "This unit
   * reported a footswitch model but no per-switch detail" — every word of that
   * is about the wire protocol, and none of it tells a player what to do about
   * their own pedalboard.
   */
  if (!switches.length) {
    return (
      <section className="footswitches">
        <p className="hint">
          Your unit has footswitches, but it doesn&rsquo;t tell this app what each one is set to.
          You can see and change them on the unit itself &mdash; on an FM3 that&rsquo;s the
          Footswitch menu under Setup.
        </p>
      </section>
    )
  }

  return (
    <section className="footswitches">
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
          {layouts} layout{layouts === 1 ? '' : 's'} available &mdash; switch them on the unit.
        </p>
      ) : null}
    </section>
  )
}
