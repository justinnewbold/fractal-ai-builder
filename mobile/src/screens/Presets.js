import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { Platform } from 'react-native'
import { presetName, slotCount } from '../lib/device'
import { loadPreset, useRig } from '../lib/rig'
import { thud } from '../lib/feedback'
import Note from '../components/Note'
import Press from '../components/Press'

const face = Platform.select(mono)

const ofPreset = (s) => s.preset
const ofCaps = (s) => s.capabilities

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
 * had before and is never wrong.
 *
 * ONE READ AT A TIME, deliberately. The relay is a single channel to one Mac
 * holding one serial port, and firing twenty reads at it does not make the unit
 * answer faster — it makes the queue longer and the tuner, the scene change and
 * everything else on that channel wait behind them.
 */
export default function Presets({ onBack }) {
  const preset = useRig(ofPreset)
  const caps = useRig(ofCaps)
  const slots = slotCount(caps)

  const [names, setNames] = useState({})
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')

  /* Slots asked for, so a row scrolled past twice is not read twice. */
  const asked = useRef(new Set())
  /* The queue, and whether it is draining. */
  const queue = useRef([])
  const draining = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const drain = useCallback(async () => {
    if (draining.current) return
    draining.current = true
    try {
      while (queue.current.length && alive.current) {
        const n = queue.current.shift()
        try {
          const got = await presetName(n)
          if (!alive.current) return
          setNames((was) => ({ ...was, [n]: got.empty ? '' : got.name }))
        } catch {
          /*
           * One slot failing is one slot. A unit that has gone will fail every
           * one of them, and the note below says so once rather than per row —
           * but the list keeps working for the slots already named.
           */
          if (alive.current) setFailed(true)
        }
      }
    } finally {
      draining.current = false
    }
  }, [])

  const want = useCallback(
    (n) => {
      if (asked.current.has(n)) return
      asked.current.add(n)
      queue.current.push(n)
      drain()
    },
    [drain]
  )

  const rows = Array.from({ length: slots || 0 }, (_, i) => i)
  const hunting = query.trim().length > 0
  const shown = hunting
    ? rows.filter((n) => {
        const name = names[n]
        const q = query.trim().toLowerCase()
        if (String(n).includes(q)) return true
        return typeof name === 'string' && name.toLowerCase().includes(q)
      })
    : rows

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

      {failed ? (
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
            Searching the names read so far. Scroll the full list to read more.
          </Text>
        </View>
      ) : null}

      <FlatList
        data={shown}
        keyExtractor={(n) => String(n)}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}
        initialNumToRender={20}
        windowSize={5}
        onViewableItemsChanged={useRef(({ viewableItems }) => {
          for (const v of viewableItems) if (typeof v.item === 'number') want(v.item)
        }).current}
        viewabilityConfig={useRef({ itemVisiblePercentThreshold: 10 }).current}
        renderItem={({ item: n }) => {
          const name = names[n]
          const here = n === preset?.number
          return (
            <Press
              label={typeof name === 'string' ? (name || 'Empty') : `Slot ${n}`}
              sub={String(n)}
              tone="signal"
              on={here}
              haptic={thud}
              onPress={async () => {
                await loadPreset(n)
                onBack?.()
              }}
            />
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
