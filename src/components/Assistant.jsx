import { useEffect, useRef, useState } from 'react'

const EXAMPLES = [
  'Change gain to 7 on the amp',
  'Save this to slot 67',
  'Turn up the gain a little and cut the bass',
  'Bypass the reverb',
  'What amp is this?',
  'Set the tempo to 96'
]

/**
 * The main way to work the unit: say what you want.
 *
 * This is deliberately not a panel inside one view. It sits above everything and
 * stays there, because the split between "the AI does this" and "you do that by
 * hand" was the app's invention, not the player's. Anything reachable through a
 * knob here is reachable through a sentence.
 *
 * Safe changes run on arrival. Only the ones that can lose work — saving over a
 * slot, loading a different preset, clearing a cell — stop and ask. Requiring a
 * confirmation click for "set gain to 7" is the kind of ceremony that makes
 * people go back to the knobs.
 */
export default function Assistant({ turns, onAsk, onConfirm, onCancel, busy, progress }) {
  const [text, setText] = useState('')
  const tail = useRef(null)

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [turns, progress])

  const submit = (value) => {
    const instruction = (value ?? text).trim()
    if (!instruction || busy) return
    onAsk(instruction)
    setText('')
  }

  return (
    <section className="assistant">
      <div className="assistant-log" role="log" aria-live="polite">
        {turns.length === 0 ? (
          <p className="hint assistant-empty">
            Tell me what you want and I&rsquo;ll do it &mdash; change a control, move a block,
            rename it, save it to a slot. Ask a question and I&rsquo;ll just answer.
          </p>
        ) : null}

        {turns.map((turn, i) => (
          <div key={i} className={`turn turn-${turn.role}`}>
            {/* Hand edits are shown as a quiet note: they are context for what
                comes next, not something anyone said. */}
            <p className="turn-text">
              {turn.role === 'system' ? `You: ${turn.text}` : turn.text}
            </p>

            {turn.actions?.length ? (
              <ul className="turn-actions">
                {turn.actions.map((a, j) => (
                  <li key={j} className="mono">
                    {turn.pending ? a.label : `${turn.failed?.includes(a.label) ? '×' : '✓'} ${a.label}`}
                  </li>
                ))}
              </ul>
            ) : null}

            {turn.pending ? (
              <div className="turn-confirm">
                <span className="hint">
                  {turn.actions.some((a) => a.kind === 'savePreset')
                    ? 'This overwrites whatever is in that slot.'
                    : turn.actions.some((a) => a.kind === 'loadPreset')
                      ? 'Anything unsaved goes with it.'
                      : 'This removes something.'}
                </span>
                <button className="save-now" onClick={() => onConfirm(i)} disabled={busy}>
                  Do it
                </button>
                <button className="chip" onClick={() => onCancel(i)} disabled={busy}>
                  Leave it
                </button>
              </div>
            ) : null}

            {turn.problems?.length ? (
              <ul className="turn-problems">
                {turn.problems.map((p, j) => (
                  <li key={j} className="mono problem">
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}

        {progress ? <p className="hint assistant-progress mono">{progress}</p> : null}
        <div ref={tail} />
      </div>

      <div className="refine-row assistant-row">
        <input
          type="text"
          className="refine-input"
          value={text}
          disabled={busy}
          placeholder="Change gain to 7 on the amp…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="What you want done"
        />
        <button onClick={() => submit()} disabled={busy || !text.trim()}>
          {busy ? 'Working…' : 'Send'}
        </button>
      </div>

      {turns.length === 0 ? (
        <div className="examples">
          {EXAMPLES.map((example) => (
            <button key={example} className="chip" onClick={() => submit(example)} disabled={busy}>
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
