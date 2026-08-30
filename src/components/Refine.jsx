import { useState } from 'react'

const QUICK = [
  'Too dark — open up the top end',
  'Too bright, it\u2019s harsh',
  'More bite in the mids',
  'Back off the gain a touch',
  'Tighter low end',
  'Needs more room around it',
  'Too compressed, let it breathe',
  'Push it harder'
]

/**
 * Refining, rather than starting over.
 *
 * Dialling an amp is iterative — you play it, react, and move one thing. Every
 * generation starting from a blank description throws away the tone you just
 * heard, which is the opposite of how anyone actually works. The previous spec
 * goes back as the subject and the instruction is an adjustment to it.
 */
export function Compare({ onCompare, state, onClear, busy, disabled }) {
  const [description, setDescription] = useState('')

  return (
    <section className="compare">
      <p className="silk-label">Compare two takes</p>

      {state?.done ? (
        <div className="notice">
          <h2>Two versions on the unit</h2>
          <p>
            <strong>Channel A</strong> — {state.a}
          </p>
          <p>
            <strong>Channel B</strong> — {state.b}
          </p>
          <p>
            Scene 1 uses channel A, scene 2 uses channel B. Footswitch between them and pick by
            ear. Whichever wins, save it from above.
          </p>
          <button className="chip" onClick={onClear}>
            Done comparing
          </button>
        </div>
      ) : (
        <>
          <div className="refine-row">
            <input
              type="text"
              className="refine-input"
              value={description}
              disabled={disabled}
              placeholder="One description, two interpretations"
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && description.trim() && onCompare(description)}
              aria-label="Tone description to compare two takes of"
            />
            <button
              onClick={() => onCompare(description)}
              disabled={busy || disabled || !description.trim()}
            >
              {busy ? 'Building…' : 'Build both'}
            </button>
          </div>
          <p className="hint">
            Writes one take to channel A and another to channel B, then points scenes 1 and 2 at
            them. Two generations, so twice the cost of a single run.
          </p>
        </>
      )}
    </section>
  )
}
