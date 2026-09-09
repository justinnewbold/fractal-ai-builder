import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import { toggleFavourite } from '../lib/presetMarks'
import {
  ALL,
  STARRED,
  addTo,
  removeFrom,
  moveIn,
  createList,
  updateList,
  deleteList,
  setSource
} from '../lib/setlists'
import { slotLabel } from '../lib/slots'
import { presetLabel } from '../lib/presetName'
import { tick as haptic } from '../lib/feedback'

/**
 * The sheet behind the button between Previous and Next.
 *
 * Two jobs, top to bottom: choose what the two buttons step through, and build
 * the setlist they step through. They are one sheet because they are one
 * decision — you pick a setlist and the songs in it are right there under it,
 * in order, to be fixed on the spot when the running order changes at the
 * venue.
 *
 * Everything here writes straight to storage and says nothing back: the lib
 * fires a change event on every write, and Play re-reads. So this sheet never
 * holds a copy of the lists that could drift from the one the buttons use.
 *
 * `slots` is the picker's own list — every slot on the unit with whatever name
 * has been read for it — so a song reads as "045 Rhythm Crunch" here the same
 * as it does there.
 */
export default function Setlists({
  open,
  onClose,
  deviceKey,
  preset,
  slots,
  addressing,
  favourites,
  lists,
  source
}) {
  const current = preset?.number
  const chosen = lists.find((l) => l.id === source) || null
  const starred = Number.isInteger(current) && favourites.includes(current)
  /*
   * Adding a song that is not the one playing needs a way to find it: a
   * filter box over the picker's list. Closed until asked for — the sheet is
   * mostly used to pick a source and glance at an order, and a search box on
   * top of that is a search box in the way.
   */
  const [adding, setAdding] = useState(false)
  const [needle, setNeedle] = useState('')
  /* Delete asks twice. One tap on a sheet you are scrolling is one tap. */
  const [armed, setArmed] = useState(false)
  /*
   * The name as it is being typed. Stored names are never blank, so a box
   * bound straight to storage snapped back to the old name the moment the
   * last letter was deleted — you could not clear it to type a new one.
   */
  const [draft, setDraft] = useState(null)

  useEffect(() => {
    if (!open) {
      setAdding(false)
      setNeedle('')
      setArmed(false)
      setDraft(null)
    }
  }, [open])
  useEffect(() => {
    setArmed(false)
    setAdding(false)
    setNeedle('')
    setDraft(null)
  }, [source])

  const nameOf = (n) => {
    const slot = slots?.find((s) => s.number === n)
    const name = (slot?.name || '').trim()
    return name || (n === current ? presetLabel(preset) : '')
  }

  const choose = (src) => {
    haptic()
    setSource(deviceKey, src)
  }

  const star = () => {
    if (!Number.isInteger(current)) return
    haptic()
    toggleFavourite(deviceKey, current)
  }

  const fresh = () => {
    haptic()
    const list = createList(deviceKey)
    // A new setlist is the one you are about to build, so it is the one the
    // buttons follow — and the one this sheet opens for editing, below.
    setSource(deviceKey, list.id)
  }

  const setPresets = (presets) => {
    if (!chosen) return
    updateList(deviceKey, chosen.id, { presets })
  }

  const rename = (name) => {
    if (!chosen) return
    setDraft(name)
    if (name.trim()) updateList(deviceKey, chosen.id, { name: name.trim() })
  }

  const add = (n) => {
    if (!chosen) return
    haptic()
    setPresets(addTo(chosen.presets, n))
  }

  const remove = () => {
    if (!chosen) return
    if (!armed) {
      setArmed(true)
      return
    }
    haptic()
    deleteList(deviceKey, chosen.id)
    setArmed(false)
  }

  /*
   * What "Add another…" offers: the named slots, filtered by what is typed —
   * and never the ones already in the list, which would be a row whose + does
   * nothing. Capped, because the sheet is scrolled with a thumb and a 512-row
   * list under a search box is the picker, which this is not.
   */
  const q = needle.trim().toLowerCase()
  const named = adding ? (slots || []).filter((s) => (s.name || '').trim()) : []
  const candidates = named
    .filter((s) => !(chosen?.presets || []).includes(s.number))
    .filter((s) => !q || (s.name || '').toLowerCase().includes(q) || String(s.number) === q)
    .slice(0, 40)

  const here = Number.isInteger(current)
    ? `${slotLabel(current, addressing)} ${presetLabel(preset)}`.trim()
    : ''

  return (
    <Sheet open={open} onClose={onClose} title="Setlist" note="What Previous and Next step through">
      <div className="setlist-sources" role="group" aria-label="What Previous and Next step through">
        <SourceRow on={source === ALL} onPick={() => choose(ALL)} name="All presets" note="Slot by slot, in order" />
        <SourceRow
          on={source === STARRED}
          onPick={() => choose(STARRED)}
          name="★ Starred"
          note={favourites.length ? `${favourites.length} preset${favourites.length === 1 ? '' : 's'}, in slot order` : 'Nothing starred yet'}
        />
        {lists.map((l) => (
          <SourceRow
            key={l.id}
            on={source === l.id}
            onPick={() => choose(l.id)}
            name={l.name}
            note={l.presets.length ? `${l.presets.length} song${l.presets.length === 1 ? '' : 's'}` : 'Empty'}
          />
        ))}
        <button type="button" className="chip setlist-new" onClick={fresh}>
          + New setlist
        </button>
      </div>

      {/*
        The star, here as well as in the picker: this is the sheet you have
        open when you decide the preset you are on belongs in tonight's order.
      */}
      {Number.isInteger(current) ? (
        <div className="setlist-here">
          <button
            type="button"
            className={`setlist-star ${starred ? 'on' : ''}`}
            onClick={star}
            aria-pressed={starred}
            aria-label={`${starred ? 'Unstar' : 'Star'} preset ${current}`}
          >
            <span aria-hidden="true">{starred ? '★' : '☆'}</span>
            <span>{starred ? 'Starred' : 'Star this preset'}</span>
          </button>
          {chosen ? (
            <button
              type="button"
              className="setlist-add-here"
              onClick={() => add(current)}
              disabled={chosen.presets.includes(current)}
            >
              {chosen.presets.includes(current) ? `In ${chosen.name}` : `Add to ${chosen.name}`}
            </button>
          ) : null}
          <span className="hint setlist-here-name">{here}</span>
        </div>
      ) : null}

      {chosen ? (
        <div className="setlist-edit">
          <label className="setlist-name">
            <span className="silk-label">Name</span>
            <input
              type="text"
              value={draft ?? chosen.name}
              onChange={(e) => rename(e.target.value)}
              onBlur={() => setDraft(null)}
              aria-label="Setlist name"
            />
          </label>

          {chosen.presets.length ? (
            <ol className="setlist-songs" aria-label={`Songs in ${chosen.name}`}>
              {chosen.presets.map((n, i) => (
                <li key={n} className={`setlist-song ${n === current ? 'current' : ''}`}>
                  <span className="setlist-song-pos mono">{i + 1}</span>
                  <span className="setlist-song-name">
                    <span className="mono setlist-song-slot">{slotLabel(n, addressing)}</span>
                    <span>{nameOf(n) || 'Unnamed'}</span>
                  </span>
                  <button
                    type="button"
                    className="setlist-move"
                    onClick={() => setPresets(moveIn(chosen.presets, i, i - 1))}
                    disabled={i === 0}
                    aria-label={`Move ${nameOf(n) || `preset ${n}`} up`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="setlist-move"
                    onClick={() => setPresets(moveIn(chosen.presets, i, i + 1))}
                    disabled={i === chosen.presets.length - 1}
                    aria-label={`Move ${nameOf(n) || `preset ${n}`} down`}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="setlist-remove"
                    onClick={() => setPresets(removeFrom(chosen.presets, n))}
                    aria-label={`Remove ${nameOf(n) || `preset ${n}`} from ${chosen.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint">
              No songs yet. Add the preset you are on, or find one below. Next goes to the first
              song, and after the last one it starts over.
            </p>
          )}

          {adding ? (
            <div className="setlist-find">
              <input
                type="text"
                className="setlist-filter"
                value={needle}
                placeholder="Find a preset"
                onChange={(e) => setNeedle(e.target.value)}
                aria-label="Find a preset to add"
                autoFocus
              />
              {candidates.length ? (
                <div className="setlist-found">
                  {candidates.map((s) => (
                    <button
                      type="button"
                      key={s.number}
                      className="setlist-found-row"
                      onClick={() => add(s.number)}
                    >
                      <span className="mono setlist-song-slot">{slotLabel(s.number, addressing)}</span>
                      <span className="setlist-found-name">{s.name}</span>
                      <span aria-hidden="true">+</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="hint">
                  {q
                    ? `Nothing named like “${needle}”.`
                    : named.length
                      ? 'Every named preset is already in this setlist.'
                      : 'No preset names read yet — open the preset list and press ⟳ to read them off the unit.'}
                </p>
              )}
            </div>
          ) : (
            <button type="button" className="chip" onClick={() => setAdding(true)}>
              Add another…
            </button>
          )}

          <button
            type="button"
            className={`chip setlist-delete ${armed ? 'armed' : ''}`}
            onClick={remove}
            onBlur={() => setArmed(false)}
          >
            {armed ? 'Tap again to delete this setlist' : 'Delete this setlist'}
          </button>
        </div>
      ) : null}

      <p className="hint setlist-note">
        Setlists live in this browser. Build one here on the phone and it stays on the phone.
      </p>
    </Sheet>
  )
}

function SourceRow({ on, onPick, name, note }) {
  return (
    <button type="button" className={`setlist-source ${on ? 'current' : ''}`} onClick={onPick} aria-pressed={on}>
      <span className="setlist-source-name">{name}</span>
      <span className="setlist-source-note">{note}</span>
    </button>
  )
}
