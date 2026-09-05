import { useState } from 'react'
import { formatWhen } from '../lib/history'

/**
 * Everything you have generated, under the box you generated it in.
 *
 * Until now the only way back to a design was the presets sheet, behind the
 * bar, two taps from the screen where you had just made the thing you wanted
 * back. That is the wrong distance for the most common recovery there is:
 * "the one before this was better".
 *
 * Restoring is not writing. It runs the saved spec back through validation
 * against whatever the unit has loaded right now and drops you at the same
 * preview a fresh generation lands on — so a design made for one preset,
 * meeting a different chain or different parameter ranges, is checked rather
 * than blindly replayed. Nothing reaches the unit until you send it.
 *
 * A short list, not the whole library. This is the tail of what you were just
 * doing; the sheet is where you go to browse, and the link at the bottom says
 * so rather than growing this list until it owns the screen.
 */
const SHOWN = 6

export default function Recent({ entries, onRestore, onDelete, onSeeAll, busy }) {
  // Which row is asking. One at a time, cleared when the button loses focus, so
  // a half-pressed delete never sits armed on a screen nobody is looking at.
  const [confirmDelete, setConfirmDelete] = useState(null)

  // No empty state. A player with no history has nothing to recover, and a box
  // explaining that would be a permanent fixture on the screen of everyone who
  // has just started.
  if (!entries.length) return null

  const shown = entries.slice(0, SHOWN)

  return (
    <section className="recent">
      <h2 className="recent-head">Earlier generations</h2>
      <ul className="recent-list">
        {shown.map((entry) => (
          <li key={`${entry.where || 'local'}-${entry.id}`}>
            <button
              className="recent-row"
              disabled={busy}
              onClick={() => onRestore(entry)}
              /* The request that made it, on hover and to a reader. It is the
                 thing that actually identifies a design — two presets called
                 "Lead" tell you nothing apart. */
              title={entry.description || entry.summary || undefined}
            >
              <span className="recent-name">{entry.name || 'Untitled'}</span>
              <span className="recent-when mono">{formatWhen(entry.at)}</span>
            </button>
            {/*
              Throwing one away, from the list it is actually in.
              Deleting used to live only in the presets sheet, two taps behind
              the bar — and now that every generation is kept rather than only
              the ones that were sent, this list is where the clutter arrives
              and so it is where it has to be clearable.

              Confirmed before it happens: a row is one tap from Restore, the
              designs are not recoverable, and asking costs a second.
            */}
            {onDelete ? (
              <button
                className="recent-del icon-btn"
                disabled={busy}
                aria-label={`Delete ${entry.name || 'Untitled'}`}
                onClick={() => {
                  if (confirmDelete === entry.id) onDelete(entry)
                  else setConfirmDelete(entry.id)
                }}
                onBlur={() => setConfirmDelete((id) => (id === entry.id ? null : id))}
              >
                {confirmDelete === entry.id ? 'Sure?' : '×'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {/* Only when there is more than is shown. "See all 6" under a list of
          six is a button that does nothing anyone asked for. */}
      {entries.length > SHOWN ? (
        <button className="chip" onClick={onSeeAll} disabled={busy}>
          All {entries.length} presets
        </button>
      ) : null}
    </section>
  )
}
