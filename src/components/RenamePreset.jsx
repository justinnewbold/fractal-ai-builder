import { useEffect, useState } from 'react'

/**
 * The preset's name, as a field you can type in.
 *
 * "Would also like to be able to rename presets and scenes in the app
 * directly without having to ask the chat." Scenes already had it — the
 * Edit name button under the tiles. The preset did not: its name could be
 * changed by a design, by the chat, or at the Mac, and from the phone by
 * nothing you could put your thumb on. This is that field, at the top of the
 * same sheet the scene names live in, reached from the pencil beside the
 * preset on the Play screen.
 *
 * It renames the loaded preset — the unit's edit buffer — the same way a
 * design does. Like everything in that buffer it is permanent only once the
 * preset is saved to a slot, which the save sheet now proposes under this
 * name rather than the one it had before.
 */
export default function RenamePreset({ preset, busy, onRename }) {
  const [name, setName] = useState(preset?.name || '')
  // A different preset, or the same one renamed elsewhere, refills the field.
  useEffect(() => {
    setName(preset?.name || '')
  }, [preset?.number, preset?.name])
  const current = (preset?.name || '').trim()
  const wanted = name.trim()
  const changed = wanted !== '' && wanted !== current
  return (
    <form
      className="rename-preset"
      onSubmit={(e) => {
        e.preventDefault()
        if (changed && !busy) onRename(wanted)
      }}
    >
      <label className="save-field">
        <span className="silk-label">Preset name</span>
        <input
          type="text"
          value={name}
          maxLength={31}
          onChange={(e) => setName(e.target.value)}
          placeholder="Preset name"
          aria-label="Name of the loaded preset"
        />
      </label>
      <p className="hint">
        Renames the preset that is loaded. It sticks once you save it to a slot.
      </p>
      <button type="submit" className="chip" disabled={busy || !changed}>
        {busy ? 'Renaming…' : 'Rename'}
      </button>
    </form>
  )
}
