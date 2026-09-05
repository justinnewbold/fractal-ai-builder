/**
 * What the AI was given, and what it sent back.
 *
 * For the question "why did this tone miss", which cannot be answered from the
 * result alone. Each section is one of the things the model actually received,
 * in the order it received them, plus the spec it returned and what the app
 * then rejected — because a tone can also miss by being right and then being
 * refused on the way to the unit.
 */
import { useState } from 'react'
import { sections, setTraceEnabled, traceEnabled } from '../lib/devtrace'

/** The switch. Lives in Setup; the panel below only appears once it is on. */
export function TraceSwitch() {
  const [on, setOn] = useState(traceEnabled())
  return (
    <div className="devtrace-switch">
      <label>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setTraceEnabled(e.target.checked)
            setOn(e.target.checked)
          }}
        />{' '}
        Record what the AI was given
      </label>
      {/*
        Where it actually is, which is not where this used to say.
        The panel stood on its own under the tone until the tone became a card
        and everything explanatory moved behind its fold. The switch went on
        promising "a panel under each new tone", so somebody turned it on,
        looked under the tone, and found nothing. "Where do I view the
        generation from the AI?" — a fair question about a setting that had
        already worked.
      */}
      <p className="hint">
        Records everything the model received and everything it sent back. On the next tone you
        ask for, tap <strong>Show every change</strong> and it is at the bottom, under the cost.
        Off by default because it makes each generation a little bigger &mdash; turn it on when a
        tone comes out wrong and you want to know why.
      </p>
    </div>
  )
}

/**
 * The panel, under a design.
 *
 * `spec` is what came back and `problems` is what the app refused, both of
 * which matter as much as the input: a tone that arrived correct and lost half
 * its writes to validation looks identical, from the outside, to one the model
 * got wrong.
 */
export default function DevTrace({ trace, spec, problems }) {
  const [open, setOpen] = useState(null)
  const parts = sections(trace)
  if (!parts.length && !spec) return null

  const rows = [
    ...parts,
    ...(spec
      ? [
          {
            key: 'spec',
            title: 'What it sent back',
            body: JSON.stringify(spec, null, 2),
            note: 'Before the app checked it against your unit.'
          }
        ]
      : []),
    ...(problems?.length
      ? [
          {
            key: 'problems',
            title: 'What the app then refused',
            body: problems.join('\n'),
            note: 'Written by this app, not the model. A tone can arrive right and still lose half of itself here.'
          }
        ]
      : [])
  ]

  return (
    <div className="devtrace">
      <p className="silk-label">What the AI was working from</p>
      <p className="hint">
        There is no reference library behind this. Apart from your unit&rsquo;s own model names and
        control ranges, everything about how a tone should sound comes from what the model already
        knows &mdash; aimed by the rules, your words, and your own history below.
      </p>
      {rows.map((s) => (
        <details
          key={s.key}
          open={open === s.key}
          onToggle={(e) => e.currentTarget.open && setOpen(s.key)}
          className="devtrace-part"
        >
          <summary>{s.title}</summary>
          {s.note ? <p className="hint">{s.note}</p> : null}
          <pre className="devtrace-body mono">{s.body}</pre>
        </details>
      ))}
    </div>
  )
}
