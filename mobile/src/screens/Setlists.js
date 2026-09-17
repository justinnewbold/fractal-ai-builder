import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'

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
import { useRig } from '../lib/rig'
import { tick } from '../lib/feedback'
import Note from '../components/Note'
import Press from '../components/Press'

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

  const choose = (src) => setSource(device, src)

  const setPresets = (presets) => {
    if (!chosen) return
    updateList(device, chosen.id, { presets })
  }

  /** Save what was typed, if it is a name and it is a different one. */
  const commitName = () => {
    const name = (draft ?? '').trim()
    setDraft(null)
    if (!chosen || !name || name === chosen.name) return
    updateList(device, chosen.id, { name })
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
    // A new setlist is the one you are about to build, so it is the one the
    // buttons follow — and the one this screen opens for editing, below.
    const list = createList(device)
    setSource(device, list.id)
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
   * row whose + does nothing. Capped, because this is scrolled with a thumb and
   * a 512-row list under a search box is the preset picker, which this is not.
   */
  const q = needle.trim().toLowerCase()
  const candidates = adding
    ? namedSlots()
        .filter((s) => !(chosen?.presets || []).includes(s.number))
        .filter((s) => !q || s.name.toLowerCase().includes(q) || String(s.number) === q)
        .slice(0, 40)
    : []

  return (
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
              : 'Nothing starred yet'
          }
        />
        {lists.map((l) => (
          <SourceRow
            key={l.id}
            on={source === l.id}
            onPress={() => choose(l.id)}
            name={l.name}
            note={l.presets.length ? `${l.presets.length} song${l.presets.length === 1 ? '' : 's'}` : 'Empty'}
          />
        ))}
        <Press label="+ New setlist" onPress={fresh} />
      </View>

      {/*
        The star, here as well as in the picker: this is the screen you have
        open when you decide the preset you are on belongs in tonight's order.
      */}
      {here ? (
        <View style={{ gap: space.sm }}>
          <Label>This preset</Label>
          <Text style={{ color: color.silkDim, fontSize: font.small, fontFamily: face }}>
            {`${slotLabel(current, addressing)}  ${presetLabel(preset)}`}
          </Text>
          <Press
            label={starred ? '★ Starred' : '☆ Star this preset'}
            tone="signal"
            on={starred}
            onPress={() => toggleFavourite(device, current)}
          />
          {chosen ? (
            <Press
              label={
                chosen.presets.includes(current) ? `Already in ${chosen.name}` : `Add to ${chosen.name}`
              }
              disabled={chosen.presets.includes(current)}
              onPress={() => setPresets(addTo(chosen.presets, current))}
            />
          ) : null}
        </View>
      ) : null}

      {/* ----------------------------------------------------------- edit */}
      {chosen ? (
        <View style={{ gap: space.md }}>
          <View style={{ gap: space.sm }}>
            <Label>Name</Label>
            <TextInput
              value={draft ?? chosen.name}
              onChangeText={setDraft}
              onBlur={commitName}
              onSubmitEditing={commitName}
              returnKeyType="done"
              blurOnSubmit
              accessibilityLabel="Setlist name"
              placeholderTextColor={color.silkFaint}
              style={{
                minHeight: TAP,
                paddingHorizontal: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: color.rule,
                backgroundColor: color.panel,
                color: color.silk,
                fontSize: font.body
              }}
            />
          </View>

          {chosen.presets.length ? (
            <View style={{ gap: space.sm }}>
              <Label>{`Songs in ${chosen.name}`}</Label>
              {chosen.presets.map((n, i) => (
                <Song
                  key={n}
                  position={i + 1}
                  slot={slotLabel(n, addressing)}
                  name={nameOfSlot(n) || 'Unnamed'}
                  playing={n === current}
                  first={i === 0}
                  last={i === chosen.presets.length - 1}
                  onUp={() => setPresets(moveIn(chosen.presets, i, i - 1))}
                  onDown={() => setPresets(moveIn(chosen.presets, i, i + 1))}
                  onRemove={() => setPresets(removeFrom(chosen.presets, n))}
                />
              ))}
            </View>
          ) : (
            <Note>
              No songs yet. Add the preset you are on, or find one below. Next goes to the first
              song, and after the last one it starts over.
            </Note>
          )}

          {adding ? (
            <View style={{ gap: space.sm }}>
              <TextInput
                autoFocus
                value={needle}
                onChangeText={setNeedle}
                placeholder="Find a preset"
                placeholderTextColor={color.silkFaint}
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="Find a preset to add"
                style={{
                  minHeight: TAP,
                  paddingHorizontal: space.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: color.rule,
                  backgroundColor: color.panel,
                  color: color.silk,
                  fontSize: font.body
                }}
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
                      ? 'Every preset whose name we have read is already in this setlist.'
                      : 'No preset names read yet — open the preset list and scroll it to read them off the unit.'}
                </Note>
              )}
            </View>
          ) : (
            <Press label="Add another song" onPress={() => setAdding(true)} />
          )}

          <Press
            label={armed ? 'Tap again to delete this setlist' : 'Delete this setlist'}
            on={armed}
            onPress={remove}
          />
        </View>
      ) : null}

      {/*
        Where they live. The phone is signed in by definition — it cannot reach
        the Mac otherwise — so this is not the browser's two answers, it is the
        one that is always true here.
      */}
      <Note>
        Setlists and stars are kept with your account, so one built here is on the Mac too.
      </Note>
    </ScrollView>
  )
}

/** One choice of what Previous and Next walk. */
function SourceRow({ on, onPress, name, note }) {
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
      <Text numberOfLines={1} style={{ color: color.silk, fontSize: font.body, fontWeight: '600' }}>
        {name}
      </Text>
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
function Song({ position, slot, name, playing, first, last, onUp, onDown, onRemove }) {
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
      <Text style={{ color: color.silkDim, fontSize: font.small, fontFamily: face, minWidth: 18 }}>
        {position}
      </Text>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: color.silk, fontSize: font.body }}>
          {name}
        </Text>
        <Text style={{ color: color.silkFaint, fontSize: font.micro, fontFamily: face }}>{slot}</Text>
      </View>
      <Nudge label={`Move ${name} up`} glyph="▲" disabled={first} onPress={onUp} />
      <Nudge label={`Move ${name} down`} glyph="▼" disabled={last} onPress={onDown} />
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
