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
export function Refine({ onRefine, busy, disabled }) {
  const [text, setText] = useState('')

  const submit = (value) => {
    const instruction = (value ?? text).trim()
    if (instruction) {
      onRefine(instruction)
      setText('')
    }
  }

  return (
    <section className="refine">
      <p className="silk-label">Not quite right?</p>

      <div className="refine-row">
        <input
          type="text"
          className="refine-input"
          value={text}
          disabled={disabled}
          placeholder="Tell it what to change"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="What to change about this tone"
        />
        <button onClick={() => submit()} disabled={busy || disabled || !text.trim()}>
          {busy ? 'Working…' : 'Adjust'}
        </button>
      </div>

      <div className="examples">
        {QUICK.map((q) => (
          <button key={q} className="chip" onClick={() => submit(q)} disabled={busy || disabled}>
            {q}
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * A/B two versions of a tone on the hardware.
 *
 * Scenes don't hold parameter values — they hold which blocks are engaged and
 * which channel each block is using. Values live on channels. So a real A/B is
 * two channels: variant A written to channel A, variant B to channel B, and two
 * scenes pointing at them. Then it's a footswitch away and you compare by ear,
 * which is the only comparison that settles anything.
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
