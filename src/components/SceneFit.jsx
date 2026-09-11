import { useState } from 'react'
import { sceneRows, sceneLabel, defaultKeep } from '../lib/sceneFit'

/**
 * Which sounds come across, when a tone has more of them than the unit holds.
 *
 * "Most of these presets were created on the FM3 — can the user select which
 * of those eight scenes they want to load onto the AM4?"
 *
 * They can now, and this is where. Every scene the tone was written with, in
 * its own name, with a tick against the ones that are coming. The counter in
 * the button is the whole instruction: it reads "Load these 4" when four are
 * ticked and refuses to go above the unit's own number, so there is no way to
 * tick five and find out afterwards.
 *
 * Deliberately not a warning. A tone from a bigger unit is not damaged and the
 * blocks, the amp and every setting fit exactly — it is only the count of
 * footswitch sounds that differs, and this is the one screen where that is a
 * choice rather than a loss.
 */
export default function SceneFit({ entry, sceneCount, unit, onLoad, onCancel }) {
  const rows = sceneRows(entry?.spec)
  const [keep, setKeep] = useState(() => defaultKeep(entry?.spec, sceneCount))
  const room = Math.max(1, Math.floor(Number(sceneCount) || 8))
  const full = keep.length >= room

  const toggle = (index) =>
    setKeep((picked) =>
      picked.includes(index)
        ? picked.filter((i) => i !== index)
        : picked.length >= room
          ? picked
          : [...picked, index]
    )

  return (
    <div className="scene-fit">
      <p className="hint">
        {entry?.device ? `"${entry.name}" was made on the ${entry.device}. ` : ''}
        It has {rows.length} sounds and the {unit} holds {room}. Pick the {room} you want — they
        land in the order they are listed, keeping their names.
      </p>

      <ul className="scene-fit-list">
        {rows.map((row) => {
          const on = keep.includes(row.index)
          /* Where it lands, not where it came from. A tone off an FM3 whose
             lead was scene 6 arrives as scene 2 on an AM4, and the number
             under the footswitch is the one worth printing. */
          const landing = on ? keep.indexOf(row.index) + 1 : null
          return (
            <li key={row.index}>
              <label className={on ? 'scene-fit-row on' : 'scene-fit-row'}>
                <input
                  type="checkbox"
                  checked={on}
                  /* Full is not disabled — unticking is how you change your
                     mind, and a row you cannot touch cannot be untucked. */
                  onChange={() => toggle(row.index)}
                />
                <span className="scene-fit-name">{sceneLabel(row)}</span>
                <span className="scene-fit-where mono">
                  {on ? `scene ${landing}` : full ? 'no room' : 'not coming'}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <div className="scene-fit-acts">
        <button className="primary" disabled={!keep.length} onClick={() => onLoad(keep)}>
          Load {keep.length === rows.length ? 'all' : `these ${keep.length}`}
        </button>
        {/* The tone without its scene plan. Every block, every setting, one
            sound — which is what somebody wants when the sounds they came for
            were the two that do not fit. */}
        <button onClick={() => onLoad([])}>
          Load the sound only
          <span className="hint">No scenes written. The settings still come across.</span>
        </button>
        <button onClick={onCancel}>
          Not now
        </button>
      </div>
    </div>
  )
}
