import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { Platform } from 'react-native'
import { slotCount, slotLabel } from '../lib/device'
import { knownCount, nameOf, namedSlots, readFailed, refresh, useNames, wantOnly } from '../lib/presetNames'
import { marksFor, toggleFavourite } from '../lib/lists'
import { useStored } from '../lib/store'
import { loadPreset, useRig } from '../lib/rig'
import { thud, tick } from '../lib/feedback'
import Note from '../components/Note'
import Press from '../components/Press'

const face = Platform.select(mono)

const ofPreset = (s) => s.preset
const ofCaps = (s) => s.capabilities
const ofSlug = (s) => s.deviceSlug

/**
 * How tall one row is, and the space under it.
 *
 * WRITTEN DOWN RATHER THAN MEASURED, because `getItemLayout` needs a number and
 * a list of five hundred slots cannot be measured to find one. Everything in a
 * row is pinned to this: the button, the star, and the gap. A row that grew
 * taller than this without the number moving would send "jump to preset 99" to
 * somewhere near preset 99, which is worse than not jumping.
 *
 * The gap is a margin rather than the container's `gap` for the same reason —
 * `gap` is invisible to getItemLayout, so the error would compound down the
 * list and be fine at the top and useless at the bottom.
 */
const ROW = TAP
const GAP = 8
const STRIDE = ROW + GAP

/**
 * Every slot on the unit, by name, so you can get to one.
 *
 * Previous and Next are the right controls mid-song and the wrong ones between
 * songs. "Two more presses and I am on SCHISM" is a thing you can do; finding
 * SCHISM among five hundred slots by stepping is not, and that was the whole of
 * the phone's preset story until now.
 *
 * WHY THE NAMES ARRIVE SLOWLY, which is the thing worth understanding before
 * changing anything here. Asking the unit what slot 412 is called makes it read
 * that preset off its own hardware — `relay-rules` counts `/presets/{n}` among
 * the slow reads for exactly that reason. Five hundred of them on opening this
 * screen would lock up the unit for a minute while somebody waited to press one
 * button.
 *
 * So the list draws immediately with numbers, and names fill in for the rows
 * actually on screen, a few at a time. Scrolling asks for more. A row whose
 * name has not arrived yet is not blank — it says its number, which is what it
 * had before and is never wrong. The reading itself lives in lib/presetNames,
 * shared with the setlist sheet so the same slot is never read twice.
 *
 * THE STAR is the second thing this list does. Starred presets are one of the
 * three things Previous and Next can walk, and the star belongs where you are
 * looking at the preset — so it is the right-hand end of every row, on its own
 * target, away from the part of the row that loads the preset.
 */
export default function Presets({ onBack }) {
  const preset = useRig(ofPreset)
  const caps = useRig(ofCaps)
  const device = useRig(ofSlug)
  const slots = slotCount(caps)
  const addressing = caps?.presets?.addressing

  /* Re-renders as names land, and keeps the reading queue draining. */
  useNames()
  /* Re-renders when a star is pressed — here or on the setlist sheet. */
  useStored()
  const favourites = marksFor(device).favourites

  const [query, setQuery] = useState('')

  /*
   * Refresh: the computer's list again, and the rows on screen read again.
   *
   * "Then we could put a button that will manually refresh them if the user
   * wants to, if some things change." Most of the names arrive from the
   * computer's own list the moment the phone connects (see presetNames), so
   * this is for the day something was renamed after that. The rows on screen
   * are the only ones re-read from the unit, because each of those is a
   * preset dump; the computer's list is free.
   */
  const [refreshing, setRefreshing] = useState(false)
  const refreshNow = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refreshing])

  const rows = Array.from({ length: slots || 0 }, (_, i) => i)
  const hunting = query.trim().length > 0
  const shown = hunting
    ? rows.filter((n) => {
        const name = nameOf(n)
        const q = query.trim().toLowerCase()
        if (String(n).includes(q)) return true
        return typeof name === 'string' && name.toLowerCase().includes(q)
      })
    : rows

  /*
   * What is on screen is what gets asked for, and nothing else.
   *
   * This used to ask for every row it saw and never take one back, so a flick
   * down the list queued hundreds of preset dumps at the unit and the whole app
   * waited behind them. See presetNames.wantOnly.
   */
  const seen = useCallback(({ viewableItems }) => {
    wantOnly(viewableItems.map((v) => v.item).filter((n) => typeof n === 'number'))
  }, [])

  /*
   * Open on the preset you are playing, in the middle of the screen.
   *
   * "I'm on preset 99. When preset button is tapped have it go to the current
   * preset on the list in the middle of the screen." It opened at slot 0 every
   * time, so the first thing the list did was hide the one row you already knew
   * you wanted — five hundred slots away.
   *
   * `initialScrollIndex` gets the list to render THERE rather than rendering a
   * hundred rows on the way, and the nudge below centres it: the index alone
   * puts the row at the top of the screen, which answers "where is it" and not
   * "what is around it". Once, on opening — a re-centre every time the preset
   * changed would yank the list out from under a thumb that is scrolling it.
   */
  const list = useRef(null)
  const centred = useRef(false)
  useEffect(() => {
    if (centred.current || hunting) return
    if (!slots || !Number.isInteger(preset?.number)) return
    centred.current = true
    const at = Math.min(preset.number, slots - 1)
    /* A frame later, so the jump happens to a list that has been laid out. */
    const id = requestAnimationFrame(() => {
      try {
        list.current?.scrollToIndex({ index: at, viewPosition: 0.5, animated: false })
      } catch {
        /* A list that will not scroll there is a list showing the top of
           itself, which is where it used to always be. Not worth a message. */
      }
    })
    return () => cancelAnimationFrame(id)
  }, [slots, preset?.number, hunting])

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: space.lg,
          gap: space.md
        }}
      >
        <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
          Presets
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Press label={refreshing ? 'Reading…' : 'Refresh'} height={40} onPress={refreshNow} />
          <Press label="Done" height={40} onPress={onBack} />
        </View>
      </View>

      {/*
        How full the list is, so "still loading" and "that slot has no name"
        stop looking the same. Most of it arrives from the computer at once;
        this is the line that shows it did.
      */}
      {slots ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.xs }}>
          <Text style={{ color: color.silkFaint, fontSize: font.micro }}>
            {knownCount() >= slots
              ? `All ${slots} names known`
              : `${knownCount()} of ${slots} names known · the rest fill in as you scroll`}
          </Text>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Find by name or number"
          placeholderTextColor={color.silkFaint}
          autoCorrect={false}
          autoCapitalize="none"
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

      {readFailed() ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <Note tone="warn">
            The unit stopped answering while we were reading names. The slots already listed are
            still right, and the rest show their numbers.
          </Note>
        </View>
      ) : null}

      {/*
        Searching only matches names that have arrived. Said out loud rather
        than left to be discovered, because a search that silently misses the
        preset you are looking for is worse than one that admits it is still
        filling in.
      */}
      {hunting ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <Text style={{ color: color.silkDim, fontSize: font.micro }}>
            Searching the {namedSlots().length} names read so far. Scroll the full list to read more.
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={list}
        data={shown}
        keyExtractor={(n) => String(n)}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
        initialNumToRender={20}
        windowSize={5}
        onViewableItemsChanged={seen}
        viewabilityConfig={useRef({ itemVisiblePercentThreshold: 10 }).current}
        /* Fixed rows, so the list can be told to go to one without having drawn
           the ones before it. See ROW. */
        getItemLayout={(_, i) => ({ length: STRIDE, offset: STRIDE * i, index: i })}
        initialScrollIndex={
          !hunting && slots && Number.isInteger(preset?.number)
            ? Math.min(preset.number, slots - 1)
            : undefined
        }
        onScrollToIndexFailed={() => {
          /* Only reachable while the list is still measuring. The centring
             effect has already run by then; the list simply stays where it is,
             which is the top — the behaviour this replaced. */
        }}
        renderItem={({ item: n }) => {
          const name = nameOf(n)
          const here = n === preset?.number
          const starred = favourites.includes(n)
          return (
            <View style={{ flexDirection: 'row', gap: space.sm, height: ROW, marginBottom: GAP }}>
              {/*
                The one you are on, in the amber this app uses for "this is
                live" everywhere else — the lit scene, the engaged block. It was
                already marked; the trouble was that the list opened five
                hundred slots away from it, so nobody ever saw the mark.

                The caption says so in a word as well as in a colour, because
                amber on its own is a thing to learn and "Playing" is not.
              */}
              <Press
                grow
                height={ROW}
                label={typeof name === 'string' ? (name || 'Empty') : `Slot ${slotLabel(n, addressing)}`}
                /* Two lines on every row, always: a third one on the current
                   row alone would make it taller than ROW and put the jump to
                   slot 99 somewhere near slot 99. */
                sub={here ? `${slotLabel(n, addressing)} · Playing` : slotLabel(n, addressing)}
                tone="signal"
                on={here}
                haptic={thud}
                /*
                 * Not awaited, deliberately. The rig shows the new slot on the
                 * press and confirms it behind this screen; waiting here is
                 * what put two seconds between the tap and anything happening.
                 */
                onPress={() => {
                  loadPreset(n)
                  onBack?.()
                }}
              />
              <Star
                on={starred}
                label={`${starred ? 'Unstar' : 'Star'} ${name || `slot ${slotLabel(n, addressing)}`}`}
                onPress={() => toggleFavourite(device, n)}
              />
            </View>
          )
        }}
        ListEmptyComponent={
          slots ? (
            <Note>Nothing matches that.</Note>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
              <ActivityIndicator color={color.silkDim} />
            </View>
          )
        }
      />
    </View>
  )
}

/**
 * The star at the end of a row.
 *
 * Its own target rather than a corner of the preset button, because the two do
 * opposite things: one loads a preset and one does not, and a mis-hit while
 * building a setlist between songs would change what the unit is playing.
 */
function Star({ on, label, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={() => {
        tick()
        onPress()
      }}
      style={({ pressed }) => ({
        width: TAP,
        minHeight: TAP,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: on ? color.signal : color.rule,
        backgroundColor: color.panel,
        opacity: pressed ? 0.7 : 1
      })}
    >
      <Text style={{ color: on ? color.signal : color.silkFaint, fontSize: font.title, fontFamily: face }}>
        {on ? '★' : '☆'}
      </Text>
    </Pressable>
  )
}
