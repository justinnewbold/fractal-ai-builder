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
export function Compare({ onCompare, state, onClear, busy, progress, sceneNames, disabled }) {
  const [description, setDescription] = useState('')
  // The scenes by the names the player gave them, because "scene 2" is not what
  // they call it once they have named it Lead.
  const label = (i) => (sceneNames?.[i]?.trim() ? `scene ${i + 1} · ${sceneNames[i].trim()}` : `scene ${i + 1}`)

  return (
    <section className="compare">
      <p className="silk-label">Compare two takes</p>

      {state?.error ? (
        <div className="notice" data-kind="fault">
          <h2>That didn&rsquo;t work</h2>
          <p className="mono problem">{state.error}</p>
          <button className="chip" onClick={onClear}>
            Close
          </button>
        </div>
      ) : state?.done ? (
        <div className="notice">
          <h2>Two versions on the unit</h2>
          <p>
            <strong>{label(0)}</strong> — {state.a}
          </p>
          <p>
            <strong>{label(1)}</strong> — {state.b}
          </p>
          <p>
            Footswitch between those two scenes and pick by ear. Each one plays its own channel of
            the amp, so they are two real sounds rather than one with something switched on.
            Whichever wins, save it from above.
          </p>

          {/*
            What did not land. Both of these used to be thrown away, so a run
            where the unit refused every write still announced two takes to
            listen to — and the person went looking for a difference that was
            never written.
          */}
          {state.failures?.length ? (
            <div className="problems">
              <p className="silk-label">The unit refused</p>
              {state.failures.map((f, i) => (
                <p key={i} className="mono problem">
                  {f}
                </p>
              ))}
            </div>
          ) : null}
          {state.rejected?.length ? (
            <div className="problems">
              <p className="silk-label">Dropped during checking</p>
              {state.rejected.map((p, i) => (
                <p key={i} className="mono problem">
                  {p}
                </p>
              ))}
            </div>
          ) : null}

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
          {/*
            Said while it happens, where it is happening. This wait is two
            generations plus two rounds of writes — minutes — and the line
            describing it rendered on a different screen, so the panel sat
            saying "Building…" and nothing else until it finished or didn't.
          */}
          {busy && progress ? <p className="hint mono compare-progress">{progress}</p> : null}
          <p className="hint">
            Dials the same description twice, once on each block&rsquo;s channel A and once on
            channel B, and sets up {label(0)} and {label(1)} to play them. Two goes at designing it,
            so it takes about twice as long as building one.
          </p>
        </>
      )}
    </section>
  )
}
