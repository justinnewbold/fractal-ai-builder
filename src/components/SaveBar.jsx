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
export default function SaveBar({ preset, dirty, busy, saving, compact, onOpenSave, queued, savedHere }) {
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
   */
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
              : !dirty && savedHere
                ? 'Saved'
                : remote && !compact
                  ? 'Save at the Mac'
                  : 'Save'}
        </button>
      </div>
    </div>
  )
}
