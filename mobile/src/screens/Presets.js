import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { Platform } from 'react-native'
import { slotCount, slotLabel } from '../lib/device'
import { nameOf, namedSlots, readFailed, useNames, want } from '../lib/presetNames'
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

  const seen = useCallback(({ viewableItems }) => {
    for (const v of viewableItems) if (typeof v.item === 'number') want(v.item)
  }, [])

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
        <Press label="Done" height={40} onPress={onBack} />
      </View>

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
        data={shown}
        keyExtractor={(n) => String(n)}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}
        initialNumToRender={20}
        windowSize={5}
        onViewableItemsChanged={seen}
        viewabilityConfig={useRef({ itemVisiblePercentThreshold: 10 }).current}
        renderItem={({ item: n }) => {
          const name = nameOf(n)
          const here = n === preset?.number
          const starred = favourites.includes(n)
          return (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Press
                grow
                label={typeof name === 'string' ? (name || 'Empty') : `Slot ${slotLabel(n, addressing)}`}
                sub={slotLabel(n, addressing)}
                tone="signal"
                on={here}
                haptic={thud}
                onPress={async () => {
                  await loadPreset(n)
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
