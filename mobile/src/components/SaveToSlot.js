import { useState } from 'react'

import { colLabel } from '../lib/grid-plan'
import { parkSave, readSaveResult } from '../lib/device'
import { askComputerToSave } from '../lib/saveViaComputer'
import { useRig } from '../lib/rig'
import Note from './Note'
import Press from './Press'

const ofPreset = (s) => s.preset
const ofSlug = (s) => s.deviceSlug

/**
 * SAVE, and it asks twice.
 *
 * "There needs to be a save button that actually writes it and saves it to
 * the unit. Have it just say Save, then a pop up warning that says it will
 * override the current settings, and tap again to confirm."
 *
 * Everything this phone changes — a knob, a block, the chain, the preset's
 * name, a scene's name — lands in the unit's edit buffer and is gone on the
 * next preset change. This is what makes it stay. A phone cannot write a slot
 * itself (the computer refuses that from a handset, and should), so the
 * request is left for the computer, which writes it and answers. See
 * lib/saveViaComputer.
 *
 * One piece, used wherever something was changed: the Edit screen and the
 * naming section in Setup. "We need a way to save after editing either preset
 * names, parameters, adding blocks, editing the chain, things like that."
 */
export function useSaveToSlot() {
  const preset = useRig(ofPreset)
  const slug = useRig(ofSlug)
  const [armed, setArmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [said, setSaid] = useState(null)

  const save = async () => {
    if (!armed) {
      setArmed(true)
      setSaid(null)
      return
    }
    setArmed(false)
    setSaving(true)
    setSaid({ tone: 'hint', text: 'Asked the computer to save it. The computer writes it; this says so the moment it lands.' })
    const res = await askComputerToSave({
      park: (req) => parkSave(slug, req),
      readResult: () => readSaveResult(slug),
      slot: preset?.number,
      name: preset?.name || ''
    })
    setSaving(false)
    setSaid(res.ok ? { tone: 'hint', text: `Saved to slot ${res.slot}.` } : { tone: 'warn', text: res.error })
  }

  return {
    slot: Number.isInteger(preset?.number) ? preset.number : null,
    armed,
    saving,
    said,
    save,
    can: !saving && Number.isInteger(preset?.number),
    disarm: () => setArmed(false),
    dismiss: () => setSaid(null)
  }
}

/** The button: Save, then Tap again. */
export function SaveButton({ s, height = 40, grow = false }) {
  return (
    <Press
      label={s.saving ? 'Saving…' : s.armed ? 'Tap again' : 'Save'}
      tone="signal"
      on={s.armed}
      height={height}
      grow={grow}
      disabled={!s.can}
      onPress={s.save}
    />
  )
}

/** The warning while it is armed, and what became of it afterwards. */
export function SaveNotes({ s }) {
  return (
    <>
      {s.armed ? (
        <Note tone="warn" onDismiss={s.disarm}>
          {`This writes what the unit is playing now over slot ${
            s.slot !== null ? colLabel(s.slot) : '—'
          }, replacing what was saved there. Tap Save again to do it.`}
        </Note>
      ) : null}
      {s.said ? (
        <Note tone={s.said.tone} onDismiss={s.dismiss}>
          {s.said.text}
        </Note>
      ) : null}
    </>
  )
}
