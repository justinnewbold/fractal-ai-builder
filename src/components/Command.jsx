import { useState } from 'react'

const EXAMPLES = [
  'Move the drive before the amp',
  'Turn up the gain a little and cut the bass',
  'Swap the amp for something with more headroom',
  'Bypass the reverb in scene 1',
  'Put a delay after the cab',
  'Set the tempo to 96',
  'Rename this to something that describes it'
]

/**
 * Ask for a change in words.
 *
 * The preset generator designs a whole tone; this is for the one or two things
 * you'd otherwise go into the editor to do. Anything a player can do by hand
 * should be sayable, so the action list covers structure, models, parameters,
 * channels, scenes, tempo and naming — not just knob values.
 *
 * Nothing runs on arrival. The plan is shown, checked, and waits.
 */
export default function Command({ onPlan, onRun, plan, running, busy, onDismiss, progress }) {
  const [text, setText] = useState('')

  const submit = (value) => {
    const instruction = (value ?? text).trim()
    if (instruction) {
      onPlan(instruction)
      setText('')
    }
  }

  return (
    <section className="command">
      <p className="silk-label">Ask for a change</p>

      <div className="refine-row">
        <input
          type="text"
          className="refine-input"
          value={text}
          disabled={busy}
          placeholder="Move the drive before the amp…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="What to change"
        />
        <button onClick={() => submit()} disabled={busy || !text.trim()}>
          {busy ? 'Working…' : 'Ask'}
        </button>
      </div>

      {!plan ? (
        <div className="examples">
          {EXAMPLES.map((example) => (
            <button key={example} className="chip" onClick={() => submit(example)} disabled={busy}>
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {progress ? <p className="progress mono">{progress}</p> : null}

      {plan ? (
        <div className="plan">
          {plan.understood ? <p className="summary">{plan.understood}</p> : null}

          {plan.actions.length === 0 ? (
            <div className="notice" data-kind="fault">
              <h2>Nothing to do</h2>
              <p>{plan.refused || 'None of that could be applied to this preset.'}</p>
              {plan.problems.map((p, i) => (
                <p key={i} className="mono problem">
                  {p}
                </p>
              ))}
              <button className="chip" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          ) : (
            <>
              <ol className="action-list">
                {plan.actions.map((action, i) => (
                  <li key={i} className={action.destructive ? 'destructive' : ''}>
                    <span className="action-label">{action.label}</span>
                    {action.why ? <span className="action-why">{action.why}</span> : null}
                  </li>
                ))}
              </ol>

              {plan.problems.length ? (
                <div className="problems">
                  <p className="silk-label">Dropped during checking</p>
                  {plan.problems.map((p, i) => (
                    <p key={i} className="mono problem">
                      {p}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="plan-actions">
                <button className="primary" onClick={onRun} disabled={running}>
                  {running
                    ? 'Working…'
                    : `Do ${plan.actions.length} thing${plan.actions.length === 1 ? '' : 's'}`}
                </button>
                <button onClick={onDismiss} disabled={running}>
                  Discard
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}
