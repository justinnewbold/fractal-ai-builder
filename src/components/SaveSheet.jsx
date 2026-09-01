import { PresetList } from './Console'

/**
 * Where a preset goes, chosen rather than typed.
 *
 * The slot used to be a numeric field, which asks you to know that the tone
 * you want to keep belongs in 287 — and to remember what is already in 287.
 * Nobody knows that. The list here is the same `PresetList` the preset menu
 * uses, so picking a destination shows you what you would be writing over,
 * which is the question actually being asked.
 *
 * The field stays. Someone who knows the number should not have to scroll to
 * it, and a 512-slot list on a phone is a scroll.
 */
export default function SaveSheet({
  preset,
  saveName,
  onName,
  slot,
  onSlot,
  onSave,
  onRevert,
  safety,
  onRestoreSafety,
  busy,
  saving,
  dirty,
  remote,
  queued,
  error,
  onDismissError,
  slots,
  deviceSlots,
  addressing,
  scanning,
  progress,
  onScan,
  onStopScan
}) {
  const target = slot === '' ? preset?.number : Number(slot)
  const targetLabel = Number.isInteger(target) ? target : '--'
  const elsewhere = Number.isInteger(target) && target !== preset?.number
  const occupant = slots?.find((s) => s.number === target)

  return (
    <div className="save-sheet">
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

      {/*
        The one sentence that makes an overwrite a decision rather than an
        accident: what is in the slot you are about to write. Only when it is
        not the slot already loaded — saying "this will replace the preset you
        are editing" about the preset you are editing is noise.
      */}
      {elsewhere ? (
        <p className="hint save-target-warn">
          Slot {targetLabel} currently holds{' '}
          <strong>{occupant?.name?.trim() || (occupant ? 'an empty slot' : 'something not yet read')}</strong>. Saving
          replaces it.
        </p>
      ) : null}

      <button className="primary save-confirm" onClick={onSave} disabled={busy || !!queued}>
        {saving
          ? 'Saving…'
          : remote
            ? `Ask the Mac to save to slot ${targetLabel}`
            : `Save to slot ${targetLabel}`}
      </button>

      {!dirty ? <p className="hint">Nothing has changed since this was last saved.</p> : null}

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

      <p className="silk-label save-pick-label">Or pick a slot</p>
      <PresetList
        slots={slots}
        current={target}
        deviceSlots={deviceSlots}
        addressing={addressing}
        scanning={scanning}
        progress={progress}
        onStop={onStopScan}
        onScan={onScan}
        /* Picking here chooses a destination. It must not load the preset —
           that would throw away the edit you are trying to keep. */
        onSelect={(n) => onSlot(String(n))}
      />
    </div>
  )
}
