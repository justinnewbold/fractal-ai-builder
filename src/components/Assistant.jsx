import { useEffect, useRef, useState } from 'react'

/**
 * Things worth saying, typed out one at a time in the empty box.
 *
 * The placeholder is the only place a new player finds out what this understands.
 * A single fixed example teaches one trick; rotating through them shows the
 * range — a control by name, a whole tone, a question, saving, structure — which
 * is the actual answer to "what can I say to it".
 */
const SUGGESTIONS = [
  'Change gain to 7 on the amp',
  'Tight modern metal rhythm in drop A',
  'Turn up the gain a little and cut the bass',
  'Save this to slot 67',
  'What amp is this?',
  'Bypass the reverb',
  'Move the drive before the amp',
  'Warm clean with a bit of shimmer',
  'Set the tempo to 96',
  'Keep this as Drop A Rhythm',
  'Rename this to something that describes it',
  'Set high cut to 5k',
  'Make the delay slower',
  'Re-read the preset'
]

const TYPE_MS = 55
const DELETE_MS = 28
const HOLD_MS = 1900

/**
 * Type one suggestion, hold it, wipe it, move to the next.
 *
 * Stops the moment there's anything to stop for: text in the box, focus in the
 * box, or a system that has asked for less motion. A placeholder animating under
 * someone's cursor while they think is a distraction, not a hint.
 */
function useTypedSuggestion(active) {
  const [text, setText] = useState('')
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('typing')

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

  useEffect(() => {
    if (!active || reduced) return undefined

    const full = SUGGESTIONS[index % SUGGESTIONS.length]

    // One timeout per step, phase in state. An interval would be fought by this
    // effect re-running on every character it wrote.
    if (phase === 'typing') {
      if (text.length >= full.length) {
        setPhase('holding')
        return undefined
      }
      const t = setTimeout(() => setText(full.slice(0, text.length + 1)), TYPE_MS)
      return () => clearTimeout(t)
    }

    if (phase === 'holding') {
      const t = setTimeout(() => setPhase('deleting'), HOLD_MS)
      return () => clearTimeout(t)
    }

    if (text.length === 0) {
      setIndex((i) => (i + 1) % SUGGESTIONS.length)
      setPhase('typing')
      return undefined
    }
    const t = setTimeout(() => setText(full.slice(0, text.length - 1)), DELETE_MS)
    return () => clearTimeout(t)
  }, [text, index, phase, active, reduced])

  if (reduced) return SUGGESTIONS[0]
  if (!active) return SUGGESTIONS[index % SUGGESTIONS.length]
  return text
}

export default function Assistant({ turns, onAsk, onConfirm, onCancel, busy, progress }) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const tail = useRef(null)

  // Only animate in an idle, empty box.
  const typed = useTypedSuggestion(!text && !focused && !busy)

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
                  {turn.reason === 'broad'
                    ? `That's ${turn.actions.length} changes — worth a look first.`
                    : turn.actions.some((a) => a.kind === 'savePreset')
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
          placeholder={typed ? `${typed}\u258f` : ''}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          // The placeholder moves, so it can't be what a screen reader is told
          // this box is for.
          aria-label="What you want done"
        />
        <button onClick={() => submit()} disabled={busy || !text.trim()}>
          {busy ? 'Working…' : 'Send'}
        </button>
      </div>

      {turns.length === 0 ? (
        <div className="examples">
          {SUGGESTIONS.slice(0, 6).map((example) => (
            <button key={example} className="chip" onClick={() => submit(example)} disabled={busy}>
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
