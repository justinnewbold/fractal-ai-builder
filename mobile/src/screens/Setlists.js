import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { Platform } from 'react-native'
import { presetLabel, slotLabel } from '../lib/device'
import {
  ALL,
  STARRED,
  addTo,
  createList,
  deleteList,
  listsFor,
  marksFor,
  moveIn,
  removeFrom,
  setSource,
  sourceFor,
  toggleFavourite,
  updateList
} from '../lib/lists'
import { nameOf, namedSlots, useNames } from '../lib/presetNames'
import { useStored } from '../lib/store'
import { loadPreset, useRig } from '../lib/rig'
import { tick } from '../lib/feedback'
import Note from '../components/Note'
import Press from '../components/Press'

/** How many presets "Add another" shows at a time. */
const ADD_PAGE = 40

const face = Platform.select(mono)

const ofPreset = (s) => s.preset
const ofCaps = (s) => s.capabilities
const ofSlug = (s) => s.deviceSlug

/**
 * What Previous and Next step through, and the setlist they step through.
 *
 * The browser's Setlist sheet, as a screen. Two jobs, top to bottom: choose the
 * source, and build the list. They are one screen because they are one
 * decision — you pick a setlist and the songs in it are right there under it,
 * in order, to be fixed on the spot when the running order changes at the
 * venue.
 *
 * THE NAME IS EDITED IN THE CARD, and that is the shape of the whole screen.
 * "When creating a new list it should only show one text entry box, have it
 * already highlight the setlist created, to rename just by typing." It had
 * two: the chosen card at the top, in amber, saying the name, and a Name box
 * a screen further down — behind the keyboard, on Android, the moment it
 * opened. So the chosen card IS the box now. Press + New setlist and the new
 * card appears chosen, its name selected, the keyboard up: type, and that is
 * its name. Tap the name on any chosen card to rename it.
 *
 * Everything here writes straight to storage and says nothing back: lib/store
 * announces every write and the stage screen re-reads. So this screen never
 * holds a copy of the lists that could drift from the one the buttons use.
 *
 * WHAT IT SHARES WITH THE MAC, which is the part worth being plain about. The
 * deciding is the browser's own `setlists.js` and `presetMarks.js`, copied here
 * by `npm run sync:rules` rather than rewritten — a setlist that played in a
 * different order on the phone than at the Mac would be worse than no setlist.
 * They are filed under the same per-unit key, derived by the same shared rule,
 * so the two ends have something to match on when the account syncs them.
 */
export default function Setlists({ onBack }) {
  const preset = useRig(ofPreset)
  const caps = useRig(ofCaps)
  const device = useRig(ofSlug)
  const addressing = caps?.presets?.addressing

  /* Every write, here or on the picker, lands as a re-render. */
  useStored()
  /* Names for the songs already in the list, read a few at a time. */
  useNames()

  const lists = listsFor(device)
  const source = sourceFor(device)
  const favourites = marksFor(device).favourites
  const chosen = lists.find((l) => l.id === source) || null

  const current = preset?.number
  const here = Number.isInteger(current)
  const starred = here && favourites.includes(current)
  const inList = here && !!chosen && chosen.presets.includes(current)

  /*
   * Adding a song that is not the one playing needs a way to find it: a filter
   * box over the names already read. Closed until asked for — this screen is
   * mostly used to pick a source and glance at an order, and a search box on
   * top of that is a search box in the way.
   */
  const [adding, setAdding] = useState(false)
  const [needle, setNeedle] = useState('')
  /* Delete asks twice. One tap on a screen you are scrolling is one tap. */
  const [armed, setArmed] = useState(false)
  /*
   * The name as it is being typed, and NOTHING ELSE TOUCHED UNTIL IT IS TYPED.
   *
   * "When deleting the name to rename it won't let the entire name delete, it
   * stops at the first letter." And: "when adding a set list it adds the names
   * twice." One bug, wearing two hats.
   *
   * It saved on every keystroke. Each save writes storage, which announces,
   * which re-renders this whole screen — every setlist row, every candidate
   * song — between one letter and the next. A React text box is told what it
   * contains by its `value`, and a `value` that arrives a frame late is a box
   * that puts back the letter you just deleted. Deleting faster than the screen
   * could redraw deleted nothing; typing faster than it could redraw is how a
   * name ends up carrying pieces of itself twice.
   *
   * So the box is the only thing that knows the name while you are typing it,
   * and storage is told once, when you are done — on blur, on the keyboard's
   * Done, or on leaving the screen. Nothing re-renders in between.
   *
   * An empty box is allowed while typing, which it has to be: you cannot type a
   * new name without first clearing the old one. It is simply not what is
   * saved.
   */
  const [draft, setDraft] = useState(null)
  /*
   * The setlist just made, whose card opens with its name selected and the
   * keyboard up. Only ever the one just pressed into being: a card that
   * grabbed the keyboard every time it was chosen would be a card you cannot
   * choose without typing.
   */
  const [justMade, setJustMade] = useState(null)

  useEffect(() => {
    setArmed(false)
    setAdding(false)
    setNeedle('')
    setDraft(null)
  }, [source])

  const nameOfSlot = (n) => {
    const read = nameOf(n)
    if (typeof read === 'string' && read) return read
    return n === current ? presetLabel(preset) : ''
  }

  const setPresets = (presets) => {
    if (!chosen) return
    updateList(device, chosen.id, { presets })
  }

  /** Save what was typed, if it is a name and it is a different one. */
  const commitName = () => {
    setJustMade(null)
    const name = (draft ?? '').trim()
    setDraft(null)
    if (!chosen || !name || name === chosen.name) return
    updateList(device, chosen.id, { name })
  }

  /*
   * Choosing another card takes the box away with the card it was in, and a
   * box that goes away is not blurred — so a name typed and then chosen away
   * from is saved here, before the card changes.
   */
  const choose = (src) => {
    commitName()
    setSource(device, src)
  }

  /*
   * And once more on the way out, because tapping Done at the top of this
   * screen unmounts it without the box ever being blurred — a rename typed and
   * then left would simply not have happened.
   */
  const live = useRef({ draft: null, chosen: null, device: null })
  useEffect(() => {
    live.current = { draft, chosen, device }
  })
  useEffect(
    () => () => {
      const { draft: d, chosen: c, device: unit } = live.current
      const name = (d ?? '').trim()
      if (c && name && name !== c.name) updateList(unit, c.id, { name })
    },
    []
  )

  const fresh = () => {
    commitName()
    // A new setlist is the one you are about to build, so it is the one the
    // buttons follow — and the one whose card opens ready to be named.
    const list = createList(device)
    setSource(device, list.id)
    setJustMade(list.id)
  }

  const remove = () => {
    if (!chosen) return
    if (!armed) {
      setArmed(true)
      return
    }
    deleteList(device, chosen.id)
    setArmed(false)
  }

  /*
   * What "Add another" offers: the slots whose names have been read, filtered
   * by what is typed — and never the ones already in the list, which would be a
   * row whose + does nothing.
   *
   * A page at a time, and it SAYS SO. It was cut at forty rows with nothing
   * on screen to say the rest existed: "It stopped at number 41 here, and I
   * couldn't scroll anymore to find more songs." Forty is still the right
   * first page — this is scrolled with a thumb, and a 512-row list under a
   * search box is the preset picker, which this is not — but a cut has to be
   * visible and undoable: how many are hidden, and a button for the next
   * forty. Typing narrows the whole list, not the page.
   */
  const q = needle.trim().toLowerCase()
  const [pages, setPages] = useState(1)
  useEffect(() => setPages(1), [q, adding])
  const offered = adding
    ? namedSlots()
        .filter((s) => !(chosen?.presets || []).includes(s.number))
        .filter((s) => !q || s.name.toLowerCase().includes(q) || String(s.number) === q)
    : []
  const candidates = offered.slice(0, ADD_PAGE * pages)
  const hidden = offered.length - candidates.length

  const box = {
    minHeight: TAP,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.panel,
    color: color.silk,
    fontSize: font.body
  }

  return (
    /*
     * The page moves out from under the keyboard, the way the sign-in screen
     * does. The name box is in the top half of the page, so on most phones the
     * keyboard never reaches it; this is for the search box further down.
     */
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
          <View style={{ flexShrink: 1 }}>
            <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
              Setlist
            </Text>
            <Text style={{ color: color.silkDim, fontSize: font.small }}>
              What Previous and Next step through
            </Text>
          </View>
          <Press label="Done" height={40} onPress={onBack} />
        </View>

        {/* --------------------------------------------------------- source */}
        <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
          <SourceRow
            on={source === ALL}
            onPress={() => choose(ALL)}
            name="All presets"
            note="Slot by slot, in order"
          />
          <SourceRow
            on={source === STARRED}
            onPress={() => choose(STARRED)}
            name="★ Starred"
            note={
              favourites.length
                ? `${favourites.length} preset${favourites.length === 1 ? '' : 's'}, in slot order`
                : 'Nothing starred yet — star one below'
            }
          />
          {lists.map((l) => (
            <SourceRow
              key={l.id}
              on={source === l.id}
              onPress={() => choose(l.id)}
              name={l.name}
              note={
                source === l.id
                  ? `${songs(l)} · tap the name to rename`
                  : songs(l)
              }
              /* The chosen card is the name box. See the note at the top. */
              editing={
                source === l.id
                  ? {
                      value: draft ?? l.name,
                      setDraft,
                      commitName,
                      selectAll: justMade === l.id
                    }
                  : null
              }
            />
          ))}
          <Press label="+ New setlist" onPress={fresh} />
        </View>

        {/* --------------------------------------------------------- songs */}
        {chosen ? (
          <View style={{ gap: space.md }}>
            <Label>{`Songs in ${chosen.name}`}</Label>

            {/*
              The preset you are on, first: this is the screen you have open
              when you decide it belongs in tonight's order, and the button that
              puts it there sits right above the order it goes into.
            */}
            {here ? (
              <Press
                label={inList ? `${presetLabel(preset)} is in this setlist` : `+ Add ${presetLabel(preset)}`}
                sub={`${slotLabel(current, addressing)} · the preset you are on`}
                tone="signal"
                disabled={inList}
                onPress={() => setPresets(addTo(chosen.presets, current))}
              />
            ) : null}

            {chosen.presets.length ? (
              chosen.presets.map((n, i) => (
                <Song
                  key={n}
                  position={i + 1}
                  slot={slotLabel(n, addressing)}
                  name={nameOfSlot(n) || 'Unnamed'}
                  playing={n === current}
                  first={i === 0}
                  last={i === chosen.presets.length - 1}
                  alone={chosen.presets.length === 1}
                  onPlay={() => loadPreset(n)}
                  onUp={() => setPresets(moveIn(chosen.presets, i, i - 1))}
                  onDown={() => setPresets(moveIn(chosen.presets, i, i + 1))}
                  onRemove={() => setPresets(removeFrom(chosen.presets, n))}
                />
              ))
            ) : (
              <Note>No songs yet. Next goes to the first song, and after the last one it starts over.</Note>
            )}

            {adding ? (
              <View style={{ gap: space.sm }}>
                <TextInput
                  autoFocus
                  value={needle}
                  onChangeText={setNeedle}
                  placeholder="Find a preset by name or number"
                  placeholderTextColor={color.silkFaint}
                  autoCorrect={false}
                  autoCapitalize="none"
                  accessibilityLabel="Find a preset to add"
                  style={box}
                />
                {candidates.length ? (
                  candidates.map((s) => (
                    <Press
                      key={s.number}
                      label={s.name}
                      sub={`${slotLabel(s.number, addressing)}   +`}
                      onPress={() => setPresets(addTo(chosen.presets, s.number))}
                    />
                  ))
                ) : (
                  <Note>
                    {q
                      ? `Nothing named like “${needle}”.`
                      : namedSlots().length
                        ? 'Every preset whose name is known is already in this setlist.'
                        : 'No preset names known yet. Open Presets once and they will be.'}
                  </Note>
                )}
                {hidden > 0 ? (
                  <Press
                    label={`Show ${Math.min(ADD_PAGE, hidden)} more`}
                    sub={`${candidates.length} of ${offered.length} shown — or type a name to narrow it`}
                    height={TAP}
                    onPress={() => setPages((n) => n + 1)}
                  />
                ) : null}
                <Press label="Done adding" height={40} onPress={() => setAdding(false)} />
              </View>
            ) : (
              <Press label="Find another song…" onPress={() => setAdding(true)} />
            )}

            <Press
              label={armed ? 'Tap again to delete this setlist' : 'Delete this setlist'}
              on={armed}
              tone={armed ? 'signal' : 'plain'}
              onPress={remove}
            />
          </View>
        ) : null}

        {/* ---------------------------------------------------------- star */}
        {here ? (
          <View style={{ gap: space.sm }}>
            <Label>This preset</Label>
            <Press
              label={starred ? `★ ${presetLabel(preset)} is starred` : `☆ Star ${presetLabel(preset)}`}
              sub={`${slotLabel(current, addressing)} · starred presets are what ★ Starred walks`}
              tone="signal"
              on={starred}
              onPress={() => toggleFavourite(device, current)}
            />
          </View>
        ) : null}

        {/*
          Where they live. The phone is signed in by definition — it cannot
          reach the Mac otherwise — so this is not the browser's two answers, it
          is the one that is always true here.
        */}
        <Note>Setlists and stars are kept with your account, so one built here is on the computer too.</Note>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/** "3 songs", "1 song", "Empty". */
const songs = (l) => (l.presets.length ? `${l.presets.length} song${l.presets.length === 1 ? '' : 's'}` : 'Empty')

/**
 * One choice of what Previous and Next walk.
 *
 * With `editing`, the name is a text box in the card — the chosen setlist's
 * card, which is where the name is read and so where it is changed. It is
 * still the card: a tap outside the name chooses it, as ever.
 */
function SourceRow({ on, onPress, name, note, editing = null }) {
  const { setDraft, commitName, selectAll } = editing || {}
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on, checked: on }}
      accessibilityLabel={`${name}, ${note}`}
      onPress={() => {
        tick()
        onPress()
      }}
      style={({ pressed }) => ({
        minHeight: TAP,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        borderWidth: on ? 2 : 1,
        borderColor: on ? color.signal : color.rule,
        backgroundColor: on ? color.signalWash : color.panel,
        opacity: pressed ? 0.7 : 1
      })}
    >
      {editing ? (
        <TextInput
          value={editing.value}
          onChangeText={setDraft}
          onBlur={commitName}
          onSubmitEditing={commitName}
          returnKeyType="done"
          blurOnSubmit
          /*
           * A new setlist opens with its name selected and the keyboard up, so
           * typing replaces "Setlist 1" rather than appending to it.
           */
          autoFocus={selectAll}
          selectTextOnFocus
          accessibilityLabel="Setlist name"
          placeholder="Name this setlist"
          placeholderTextColor={color.silkFaint}
          style={{
            color: color.silk,
            fontSize: font.body,
            fontWeight: '600',
            paddingVertical: 0,
            paddingHorizontal: 0,
            marginVertical: -2,
            minHeight: 28
          }}
        />
      ) : (
        <Text numberOfLines={1} style={{ color: color.silk, fontSize: font.body, fontWeight: '600' }}>
          {name}
        </Text>
      )}
      <Text numberOfLines={1} style={{ color: color.silkDim, fontSize: font.micro, marginTop: 2 }}>
        {note}
      </Text>
    </Pressable>
  )
}

/**
 * One song in the running order.
 *
 * Up, down and remove as three separate targets rather than a drag: dragging a
 * row on a phone with a thumb, between songs, is a gesture that goes wrong
 * quietly. Three buttons go wrong loudly and are undone by pressing the other
 * one.
 */
function Song({ position, slot, name, playing, first, last, alone, onPlay, onUp, onDown, onRemove }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.sm,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        borderWidth: playing ? 2 : 1,
        borderColor: playing ? color.signal : color.rule,
        backgroundColor: color.panel
      }}
    >
      {/*
        THE NAME IS A BUTTON: tap a song and the unit goes to it, the way a row
        in the preset list does. "Clicking on the actual preset name doesn't
        work." It was a label; a running order you cannot jump around in is a
        list to read, not a setlist. Not awaited, like every preset load from a
        phone: the rig shows the new slot on the press and confirms it behind.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? `${name}, playing` : `Play ${name}`}
        onPress={() => {
          tick()
          onPlay()
        }}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, opacity: pressed ? 0.7 : 1 })}
      >
        <Text style={{ color: color.silkDim, fontSize: font.small, fontFamily: face, minWidth: 18 }}>
          {position}
        </Text>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: color.silk, fontSize: font.body }}>
            {name}
          </Text>
          <Text style={{ color: color.silkFaint, fontSize: font.micro, fontFamily: face }}>
            {playing ? `${slot} · playing` : `${slot} · tap to play`}
          </Text>
        </View>
      </Pressable>
      {/* One song has nowhere to move: no arrows, rather than two greyed ones
          that read as broken. "The little arrows to go up and down don't work." */}
      {alone ? null : (
        <>
          <Nudge label={`Move ${name} up`} glyph="▲" disabled={first} onPress={onUp} />
          <Nudge label={`Move ${name} down`} glyph="▼" disabled={last} onPress={onDown} />
        </>
      )}
      <Nudge label={`Remove ${name}`} glyph="✕" onPress={onRemove} />
    </View>
  )
}

/*
 * 44 rather than the app's 56.
 *
 * The 56 in `Press` is a stage rule — a target you hit without looking, in the
 * dark, mid-song. Nothing on this screen is pressed mid-song: the running order
 * is fixed at soundcheck or between songs, with the phone in your hand and your
 * eyes on it. 44 is the platform's own minimum, and three of them fit on the
 * row beside a song's name, which 56 does not.
 */
function Nudge({ label, glyph, disabled = false, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        tick()
        onPress()
      }}
      style={({ pressed }) => ({
        width: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: color.rule,
        backgroundColor: color.panelHi,
        opacity: disabled ? 0.35 : pressed ? 0.7 : 1
      })}
    >
      <Text style={{ color: color.silk, fontSize: font.small }}>{glyph}</Text>
    </Pressable>
  )
}

function Label({ children }) {
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: color.silkFaint,
        fontSize: font.micro,
        letterSpacing: 1.5,
        textTransform: 'uppercase'
      }}
    >
      {children}
    </Text>
  )
}
