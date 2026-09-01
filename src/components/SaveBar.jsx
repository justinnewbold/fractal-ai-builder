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
export default function SaveBar({ preset, dirty, busy, saving, compact, onOpenSave, queued }) {
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

  return (
    <div className="save-cluster">
      <div className="save-cluster-row">
        {/* Unsaved gets the lit dot; the bar around it says the word. */}
        {dirty ? <span className="lamp" data-state="live" title="Unsaved changes" /> : null}

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
              : remote && !compact
                ? 'Save at the Mac'
                : 'Save'}
        </button>
      </div>
    </div>
  )
}
