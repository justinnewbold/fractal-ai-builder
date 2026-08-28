import { useState } from 'react'
import { remoteActive } from '../lib/remote'

/**
 * Where saving lives now: pinned to the bottom of the screen, always.
 *
 * It used to be a panel at the foot of the page, shown only once the app
 * believed something had changed. Two things were wrong with that on a phone.
 *
 * The first is that "the foot of the page" is a long way down. You make an edit
 * at the top, and the control for keeping it is off-screen behind a scroll you
 * have no reason to know about.
 *
 * The second is subtler and worse: the bar only existed while `dirty` was true,
 * and dirty is the app's belief, not the unit's. Turn a knob on the front panel
 * and the app doesn't know, so the button isn't there — and a button that
 * appears and disappears according to a rule nobody can see is a button you can
 * never find. It's always here now. Saving an unchanged preset writes the same
 * bytes back to the same slot, which costs nothing.
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
  onRevert,
  safety,
  onRestoreSafety,
  error,
  onDismissError
}) {
  const [open, setOpen] = useState(false)

  /*
   * A slot write is on ForgeFX's never-remote list, and it should be — a phone
   * at the far side of a room shouldn't be able to overwrite a slot. But the
   * refusal used to arrive AFTER the tap, as a message in a banner at the top of
   * a page you weren't looking at. From the floor that is indistinguishable from
   * a button that does nothing.
   *
   * So it's said before the tap instead, on the button itself.
   */
  const remote = remoteActive()
  const target = slot === '' ? preset?.number : Number(slot)
  const targetLabel = Number.isInteger(target) ? target : '--'

  return (
    <div className={`save-bar ${dirty ? 'unsaved' : 'clean'}`} role="region" aria-label="Saving">
      {error ? (
        <div className="save-bar-error" role="alert">
          <span>{error}</span>
          <button className="chip" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="save-sheet">
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
        </div>
      ) : null}

      <div className="save-bar-row">
        <div className="save-bar-state">
          <span className="lamp" data-state={dirty ? 'live' : 'idle'} />
          <span className="save-bar-text">
            {dirty ? (
              <>
                Unsaved changes to <strong>{preset?.name?.trim() || 'this preset'}</strong>
              </>
            ) : (
              <>
                <strong>{preset?.name?.trim() || 'Untitled'}</strong> · slot {preset?.number ?? '--'}
              </>
            )}
          </span>
        </div>

        <button
          className="save-options"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Name, slot and revert"
        >
          {open ? 'Close' : 'Options'}
        </button>

        {remote ? (
          /* Disabled, and saying why on its face — not in a banner elsewhere. */
          <button className="save-now" disabled title="ForgeFX won't take a slot write over a remote session">
            Saving happens at the Mac
          </button>
        ) : (
          <button className="save-now" onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : `Save to slot ${targetLabel}`}
          </button>
        )}
      </div>
    </div>
  )
}
