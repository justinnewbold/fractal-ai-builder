import { useState } from 'react'

import { logDebug } from '../lib/debugLog'
import { colLabel } from '../lib/grid-plan'
import { parkSave, readSaveResult } from '../lib/device'
import { askComputerToSave } from '../lib/saveViaComputer'
import { savedToSlot, useRig } from '../lib/rig'
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
    logDebug('write', `save to slot ${preset?.number}`, res.ok ? 'saved' : `failed — ${res.error}`)
    if (res.ok) savedToSlot(res.slot)
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

/**
 * The button: Save, then Tap again to confirm.
 *
 * FILLED THE MOMENT THERE IS SOMETHING TO LOSE. `waiting` is "this phone has
 * changed something that is not written yet" — a renamed preset, a moved
 * knob — and while that is true this is the only thing on the screen worth
 * pressing, so it stops being an outline among outlines.
 *
 * "If a user has changed the preset name, make the save button yellow and
 * obvious that that's how they save it."
 *
 * It matters more here than anywhere else in the app, because the thing it
 * protects is invisible: a new name is on the unit the instant it is typed
 * and is gone at the next preset change. Somebody who types a name, sees it
 * take, and walks away has lost it and will not find out until the gig.
 *
 * Armed keeps the same fill rather than a louder one. The step between "you
 * have unsaved work" and "this will overwrite slot 1" is carried by the
 * words — on the button and in the warning above it — because two ambers
 * would have to be told apart at a glance on a dark stage, and they would
 * not be.
 */
export function SaveButton({ s, height = 40, grow = false, waiting = false }) {
  return (
    <Press
      label={s.saving ? 'Saving…' : s.armed ? 'Tap again to confirm' : 'Save'}
      tone="signal"
      on={s.armed || waiting}
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
          }, replacing what was saved there. Tap Save again to confirm.`}
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
