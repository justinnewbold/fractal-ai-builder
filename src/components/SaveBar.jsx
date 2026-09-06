import { useEffect, useState } from 'react'
import { remoteActive } from '../lib/remote'

/**
 * Where saving lives now: the top right of the screen, in the masthead.
 *
 * This control has moved three times, each for a reason worth remembering. It
 * started as a panel at the foot of the page that existed only while the app
 * believed something had changed — out of sight and intermittent. Then a bar
 * pinned to the bottom of the viewport: always findable, but a permanent
 * floater eating a strip of every screen, which on a phone is a strip you feel.
 * Then the top bar, with an "Options" button beside it holding name, slot and
 * revert.
 *
 * Now it is one button, and it opens a sheet rather than writing.
 *
 * That last change is not only about clearing a button out of a crowded bar.
 * This app has argued from the beginning that a slot overwrite must not sit
 * within reach of a mis-tap mid-song — and yet Save wrote, immediately, on one
 * press, to whatever slot was loaded. The sheet is where that gets settled:
 * the write is still two taps from anywhere, but the second tap is on a button
 * that names the slot, next to the list of what is in it.
 */
/** How long "Saved" stays up before the button gets out of the way. */
const SAVED_FOR_MS = 4000

export default function SaveBar({ preset, dirty, busy, saving, compact, onOpenSave, queued, savedAt }) {
  /*
   * A slot write is on ForgeFX's never-remote list, and it should be — a phone
   * at the far side of a room shouldn't be able to overwrite a slot on a mis-tap.
   * That refusal stands. What changed is the answer given to the player: it used
   * to be a disabled button reading "saving happens at the Mac", which is true
   * and useless after ten minutes of work on a tone with the amp across the room.
   *
   * The request now travels the host's document store — the one road the relay
   * leaves open — and the page at the Mac carries it out. So the button saves;
   * it just says who does the writing, and waits for word back rather than
   * claiming a slot was written the moment it was asked for.
   */
  const remote = remoteActive()

  /*
   * The button carries the state. There used to be a tiny amber UNSAVED
   * word beside it and a cyan dot in front of it, while the button itself
   * was amber whether or not anything had changed — so the one control
   * everyone looks at said nothing, and the word that did was the smallest
   * thing in the bar (and hidden on phones). Now: quiet "Saved" when there
   * is nothing to save, amber "Save" when there is.
   *
   * "Saved" only once something actually was. `dirty` answers "is there
   * anything unsaved", which is not the same question — on a preset freshly
   * loaded, or one just generated and written to the unit but never put in a
   * slot, there is nothing pending and nothing saved either, and the button
   * claimed the second. "This says 'Saved' when there is nothing saved yet. It
   * should say SAVE if it hasn't been saved yet."
   *
   * And then it said "Save" instead, on a preset nobody had touched, which is
   * the same fault wearing the other word: a button offering to do a thing
   * there is no thing to do. "Only show the Save button is there something to
   * save. I literally just loaded a brand new scene and it still says save."
   *
   * So it is not a label any more, it is a presence. Nothing pending, nothing
   * in flight, nothing just done — no button. The bar on a phone is four
   * controls wide and every one of them has to be earning it.
   */

  /*
   * "Saved" is the one state with no work behind it, so it is the one that has
   * to expire. Four seconds is long enough to be read by somebody watching for
   * it and short enough that walking away leaves a clean bar.
   *
   * The timer only exists to re-render when the window closes; the answer is
   * computed from the clock, so a component that mounts long after a save is
   * already past it and says nothing.
   */
  const [, redraw] = useState(0)
  const justSaved = !!savedAt && Date.now() - savedAt < SAVED_FOR_MS
  useEffect(() => {
    if (!justSaved) return undefined
    const left = SAVED_FOR_MS - (Date.now() - savedAt)
    const timer = setTimeout(() => redraw((n) => n + 1), Math.max(left, 0))
    return () => clearTimeout(timer)
  }, [justSaved, savedAt])

  // Nothing to save, nothing being saved, nothing just saved: no button.
  if (!queued && !saving && !dirty && !justSaved) return null

  return (
    <div className="save-cluster" data-dirty={dirty ? 'yes' : 'no'}>
      <div className="save-cluster-row">
        <button
          className="save-now"
          onClick={onOpenSave}
          disabled={busy || !!queued}
          title={remote ? 'The page at your Mac does the writing' : undefined}
        >
          {/* `saving`, not `busy`: busy is true for every long operation in the
              app, so this button used to announce a slot write while a tone was
              merely being designed. */}
          {queued
            ? compact
              ? 'Waiting…'
              : 'Waiting for the Mac…'
            : saving
              ? 'Saving…'
              : !dirty && justSaved
                ? 'Saved'
                : remote && !compact
                  ? 'Save at the Mac'
                  : 'Save'}
        </button>
      </div>
    </div>
  )
}
