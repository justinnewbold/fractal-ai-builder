import { useState } from 'react'
import { remoteActive } from '../lib/remote'

/**
 * Where saving lives now: the top right of the screen, in the masthead.
 *
 * This control has moved twice, each time for a reason worth remembering. It
 * started as a panel at the foot of the page that existed only while the app
 * believed something had changed — out of sight and intermittent. Then it was
 * a bar pinned to the bottom of the viewport — always findable, but a
 * permanent floater eating a strip of every screen, which on a phone is a
 * strip you feel. Now it's a fixed point that costs nothing: the header, top
 * right, same place every time, with the StatusLine still carrying the
 * "Unsaved" flag on every screen for the scrolled-away case.
 *
 * Options — name, slot, revert, the pre-edit copy — drop down from their own
 * button as an anchored menu, because the common save is to the slot already
 * loaded and needs no fields at all.
 */
export default function SaveBar({
  preset,
  dirty,
  busy,
  saveName,
  onName,
  slot,
  onSlot,
  onSave,
  queued,
  onRevert,
  safety,
  onRestoreSafety,
  error,
  onDismissError
}) {
  const [open, setOpen] = useState(false)

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
  const target = slot === '' ? preset?.number : Number(slot)
  const targetLabel = Number.isInteger(target) ? target : '--'

  return (
    <div className="save-cluster">
      <div className="save-cluster-row">
        {/* Unsaved gets the lit dot; the StatusLine says the word. */}
        {dirty ? <span className="lamp" data-state="live" title="Unsaved changes" /> : null}

        <button
          className="save-options"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Name, slot and revert"
        >
          {open ? 'Close' : 'Options'}
        </button>

        {remote ? (
          <button
            className="save-now"
            onClick={onSave}
            disabled={busy || !!queued}
            title="The page at your Mac does the writing"
          >
            {queued ? 'Waiting for the Mac…' : `Save at the Mac · ${targetLabel}`}
          </button>
        ) : (
          <button className="save-now" onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : `Save to slot ${targetLabel}`}
          </button>
        )}
      </div>

      {open || error || queued ? (
        <div className="save-pop">
          {queued ? (
            <p className="hint">
              Slot {queued.slot} is queued. The page at your Mac writes it &mdash; open there if it
              isn&rsquo;t, and this says so the moment it lands.
            </p>
          ) : null}
          {error ? (
            <div className="save-error" role="alert">
              <span>{error}</span>
              <button className="chip" onClick={onDismissError}>
                Dismiss
              </button>
            </div>
          ) : null}

          {open ? (
            <>
              <label className="save-field">
                <span className="silk-label">Name</span>
                <input
                  type="text"
                  value={saveName}
                  maxLength={31}
                  onChange={(e) => onName(e.target.value)}
                  placeholder={preset?.name || 'Preset name'}
                  aria-label="Name to save the preset under"
                />
              </label>

              <label className="save-field save-field-slot">
                <span className="silk-label">Slot</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={slot === '' ? String(preset?.number ?? '') : slot}
                  onChange={(e) => onSlot(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="Slot"
                  aria-label="Preset slot to save into"
                />
              </label>

              <div className="save-sheet-actions">
                <button className="chip" onClick={onRevert} disabled={busy}>
                  Revert to saved
                </button>
                {safety ? (
                  <button className="chip" onClick={onRestoreSafety} disabled={busy}>
                    Load pre-edit copy
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
