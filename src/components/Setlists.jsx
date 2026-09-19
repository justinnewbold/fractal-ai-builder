import { useEffect, useRef, useState } from 'react'
import Sheet from './Sheet'
import { landingIndex } from '../../shared/lane-order.mjs'
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
  source,
  synced = false
}) {
  const current = preset?.number
  const chosen = lists.find((l) => l.id === source) || null

  /*
   * DRAGGING A SONG UP OR DOWN THE RUNNING ORDER.
   *
   * "It should be drag and drop for rearranging songs in created setlists.
   * For starred items and when it shows all, you can leave those in order
   * where they can't be rearranged."
   *
   * Which is already true by construction: this editor is drawn only for a
   * list somebody made. All presets and Starred are slot order, they are not
   * in `lists`, and there is nothing here to drag them with.
   *
   * The phone has had this since setlists arrived and the browser never got
   * it — same seam, opposite way round from the demo picker. The maths is the
   * chain editor's, out of shared/lane-order.mjs, so a song lands where a
   * block would: pointer events, so a mouse and a finger are one drag, and
   * capture so it survives the finger leaving the grip.
   */
  /* var(--s-1), the gap `.setlist-songs` lays the rows out with. */
  const GAP = 4
  const [drag, setDrag] = useState(null)
  const rows = useRef({})
  const from = useRef({ y: 0, heights: [] })

  const songCount = chosen?.presets?.length || 0

  const gripDown = (e, i) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    /* Only the rows that exist: a removed song leaves its height behind. */
    const heights = []
    for (let n = 0; n < songCount; n++) heights.push(rows.current[n]?.getBoundingClientRect().height || 0)
    from.current = { y: e.clientY, heights }
    setDrag({ index: i, dy: 0, to: i })
  }
  const gripMove = (e, i) => {
    if (!drag || drag.index !== i) return
    const dy = e.clientY - from.current.y
    setDrag({ index: i, dy, to: landingIndex(from.current.heights, i, dy, GAP) })
  }
  const gripUp = (i) => {
    if (!drag || drag.index !== i) return
    const to = drag.to
    setDrag(null)
    if (to !== i) setPresets(moveIn(chosen.presets, i, to))
  }

  /*
   * And by keyboard, because a grip that only answers a pointer takes the
   * running order away from anybody driving this with one. The arrows that
   * were here did that job; the grip inherits it rather than dropping it.
   */
  const gripKey = (e, i) => {
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!step) return
    e.preventDefault()
    const to = i + step
    if (to < 0 || to >= songCount) return
    setPresets(moveIn(chosen.presets, i, to))
  }

  /* Where each row is drawn mid-drag: the lifted one under the pointer, the
     ones it has passed stepped out of its way. */
  const shiftFor = (i) => {
    if (!drag) return 0
    if (i === drag.index) return drag.dy
    const h = (from.current.heights[drag.index] || 0) + GAP
    if (drag.to > drag.index && i > drag.index && i <= drag.to) return -h
    if (drag.to < drag.index && i >= drag.to && i < drag.index) return h
    return 0
  }
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
   * The name as it is being typed, and NOTHING ELSE TOUCHED UNTIL IT IS TYPED.
   *
   * This is the phone's rule, brought over with the box. Saving on every
   * keystroke writes storage, which announces, which re-renders this whole
   * sheet between one letter and the next — and a React text box is told what
   * it contains by its `value`, so a `value` arriving a frame late is a box
   * that puts back the letter you just deleted. On the phone that showed up as
   * a name you could not clear and a name that carried pieces of itself twice.
   *
   * So the box is the only thing that knows the name while you are typing it,
   * and storage is told once: on blur, on Enter, on choosing another setlist,
   * and on closing the sheet.
   */
  const [draft, setDraft] = useState(null)
  /*
   * The setlist just made, whose box opens with its name selected and ready to
   * be typed over. Only ever the one just pressed into being: a row that
   * grabbed the keyboard every time it was chosen would be a row you cannot
   * choose without typing.
   */
  const [justMade, setJustMade] = useState(null)

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

  /** Save what was typed, if it is a name and it is a different one. */
  const commitName = () => {
    setJustMade(null)
    const name = (draft ?? '').trim()
    setDraft(null)
    if (!chosen || !name || name === chosen.name) return
    updateList(deviceKey, chosen.id, { name })
  }

  /*
   * Choosing another setlist takes the box away with the row it was in, and a
   * box that goes away is not blurred — so a name typed and then chosen away
   * from is saved here, before the row changes.
   */
  const choose = (src) => {
    haptic()
    commitName()
    setSource(deviceKey, src)
  }

  const star = () => {
    if (!Number.isInteger(current)) return
    haptic()
    toggleFavourite(deviceKey, current)
  }

  const fresh = () => {
    haptic()
    commitName()
    // A new setlist is the one you are about to build, so it is the one the
    // buttons follow — and the one whose row opens ready to be named.
    const list = createList(deviceKey)
    setSource(deviceKey, list.id)
    setJustMade(list.id)
  }

  const setPresets = (presets) => {
    if (!chosen) return
    updateList(deviceKey, chosen.id, { presets })
  }

  /*
   * And once more on the way out, because closing the sheet takes the box off
   * the screen without ever blurring it — a rename typed and then closed on
   * would simply not have happened.
   */
  const live = useRef({ draft: null, chosen: null, deviceKey: null })
  useEffect(() => {
    live.current = { draft, chosen, deviceKey }
  })
  useEffect(() => {
    if (open) return
    const { draft: d, chosen: c, deviceKey: unit } = live.current
    const name = (d ?? '').trim()
    if (c && name && name !== c.name) updateList(unit, c.id, { name })
    setAdding(false)
    setNeedle('')
    setArmed(false)
    setDraft(null)
    setJustMade(null)
  }, [open])

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
            note={
              source === l.id
                ? `${songs(l)} \u00b7 tap the name to rename`
                : songs(l)
            }
            /* The chosen row IS the name box, exactly as it is on the phone.
               See the note above it. */
            editing={
              source === l.id
                ? { value: draft ?? l.name, setDraft, commitName, selectAll: justMade === l.id }
                : null
            }
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
          {chosen.presets.length ? (
            <ol className="setlist-songs" aria-label={`Songs in ${chosen.name}`}>
              {chosen.presets.map((n, i) => (
                <li
                  key={n}
                  ref={(el) => {
                    if (el) rows.current[i] = el
                    else delete rows.current[i]
                  }}
                  className={`setlist-song ${n === current ? 'current' : ''} ${
                    drag?.index === i ? 'lifted' : ''
                  }`}
                  style={shiftFor(i) ? { transform: `translateY(${shiftFor(i)}px)` } : undefined}
                >
                  <span className="setlist-song-pos mono">{i + 1}</span>
                  <span className="setlist-song-name">
                    <span className="mono setlist-song-slot">{slotLabel(n, addressing)}</span>
                    <span>{nameOf(n) || 'Unnamed'}</span>
                  </span>
                  {/*
                    One song has nowhere to move, so it gets no grip rather
                    than one that does nothing — the lesson the phone learned
                    out loud: "the little arrows to go up and down don't work."
                    They did work; there was simply only one song, and a
                    disabled arrow looks exactly like a broken one.
                  */}
                  {chosen.presets.length > 1 ? (
                    <button
                      type="button"
                      className="setlist-grip"
                      aria-label={`Move ${nameOf(n) || `preset ${n}`} — hold and drag, or use the arrow keys`}
                      title="Hold and drag up or down to move it in the running order"
                      onPointerDown={(e) => gripDown(e, i)}
                      onPointerMove={(e) => gripMove(e, i)}
                      onPointerUp={() => gripUp(i)}
                      onPointerCancel={() => gripUp(i)}
                      onKeyDown={(e) => gripKey(e, i)}
                    >
                      ≡
                    </button>
                  ) : null}
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

      {/*
        Where they live, which is now a question with two answers.

        "This says that setlists stay in this browser. Can we set that up to
        save to the database across the cloud if user is signed in?" It does —
        so signed in, this says so, and signed out it still says the truth
        rather than an aspiration, because a setlist built on a phone that is
        not signed in really does stay on that phone.
      */}
      <p className="hint setlist-note">
        {synced
          ? 'Setlists and stars are kept with your account. Build one here and it is on every machine you sign in from.'
          : 'Setlists live in this browser. Sign in and they follow your account onto every machine instead.'}
      </p>
    </Sheet>
  )
}

/** "3 songs", "1 song", "Empty". */
const songs = (l) => (l.presets.length ? `${l.presets.length} song${l.presets.length === 1 ? '' : 's'}` : 'Empty')

/**
 * One choice of what Previous and Next walk.
 *
 * With `editing`, the name is a text box in the row — the chosen setlist's
 * row, which is where the name is read and so where it is changed.
 *
 * "Typing should happen in the blue cell and the duplicate deleted." There
 * were two names for one setlist an inch apart: the row you had just tapped,
 * and a NAME box under it that the phone app has not had for a while. Two
 * boxes for one name is a question about which one is the real one.
 *
 * The chosen row is a div rather than a button because a text box inside a
 * button is a text box a browser will not reliably let you into. Nothing is
 * lost: it is the row that is already chosen, so there is no choosing left to
 * do in it.
 */
function SourceRow({ on, onPick, name, note, editing = null }) {
  if (editing) {
    return (
      <div className="setlist-source current setlist-source-named" aria-current="true">
        <input
          type="text"
          className="setlist-source-name"
          value={editing.value}
          onChange={(e) => editing.setDraft(e.target.value)}
          onBlur={editing.commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          /* A new setlist opens with its name selected, so typing replaces
             "Setlist 1" rather than landing after it. */
          autoFocus={editing.selectAll}
          onFocus={(e) => editing.selectAll && e.currentTarget.select()}
          placeholder="Name this setlist"
          aria-label="Setlist name"
        />
        <span className="setlist-source-note">{note}</span>
      </div>
    )
  }
  return (
    <button type="button" className={`setlist-source ${on ? 'current' : ''}`} onClick={onPick} aria-pressed={on}>
      <span className="setlist-source-name">{name}</span>
      <span className="setlist-source-note">{note}</span>
    </button>
  )
}
