import { useEffect, useMemo, useState } from 'react'
import { FlatList, Platform, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { GEAR_FAMILIES, GEAR_GROUPS, gearTotal, groupsFor, searchAll } from '../lib/gearCatalog'
import { blockTypes } from '../lib/device'
import { useRig } from '../lib/rig'
import Note from '../components/Note'
import Press from '../components/Press'

const face = Platform.select(mono)

/**
 * What every model on the unit really is.
 *
 * "Add an info page like this to settings listing the real life equivalents of
 * each amp and effects pedals."
 *
 * Fractal cannot print "Marshall JCM800" on a menu, so the unit says "Brit 800
 * 2204 High". Everybody who has played one for a year knows the translation and
 * nobody who unboxed one on Saturday does — and the phone is the thing in your
 * hand while you are standing in front of the unit wondering.
 *
 * THE SEARCH READS BOTH COLUMNS, which is the difference between a sheet that
 * works and a list you scroll. The word somebody actually types is "tube
 * screamer" — the real name, which appears nowhere in the unit's own "TS808
 * OD". A search over the left-hand column alone would answer nothing for every
 * query a person really has.
 *
 * THE COUNTS ON THE TABS MOVE WITH THE SEARCH, or they mislead: typing "tube
 * screamer" while Amps is open finds nothing, and a row of tabs still reading
 * "Amps 331" gives no hint that the five answers are one tap away.
 *
 * The rows are not buttons. There is nothing to choose here: it is a reference,
 * and a row that depresses under a thumb promises something it cannot do.
 */
export default function Gear({ onBack }) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(GEAR_GROUPS[0].key)

  /*
   * What THIS unit has, asked of the unit.
   *
   * "Make sure they are specific to the unit connected as well as AM4 would
   * have different ones versus FM9 or Axefx 3 or VP4."
   *
   * Keeping five tables and researching the other three would have been wrong
   * twice: wrong the day a firmware adds a model, and wrong for the unit nobody
   * here has ever had in front of them. Every one of these units knows its own
   * list and will hand it over, so the sheet asks.
   *
   * One family at a time, in order, and slowly on purpose — each of these is a
   * round trip down the same serial port, and firing five at once only queues
   * them somewhere less visible. The printed catalog is on screen the whole
   * time; each answer replaces its own tab as it lands.
   */
  const unit = useRig(ofDeviceName)
  const [rosters, setRosters] = useState({})

  useEffect(() => {
    if (!unit) return undefined
    let alive = true
    ;(async () => {
      for (const family of GEAR_FAMILIES) {
        try {
          const said = await blockTypes(family.key)
          if (!alive) return
          if (Array.isArray(said) && said.length) {
            setRosters((was) => ({ ...was, [family.key]: said }))
          }
        } catch {
          /* A block this unit does not have, or a read that did not come back.
             Either way the printed catalog stays, which is the honest fallback:
             a reference sheet that empties itself when a cable is out is worse
             than one that is a little too generous. */
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [unit])

  const built = useMemo(() => groupsFor(rosters), [rosters])
  const groups = useMemo(() => searchAll(query, built), [query, built])
  const here = groups.find((g) => g.key === group) || groups[0]
  const rows = here?.hits || []
  const total = useMemo(() => gearTotal(built), [built])
  /* Said plainly, because "your unit's models" was a claim the screen could not
     back up until it started asking. */
  const asked = built.some((g) => g.fromUnit)

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
        <View style={{ flexShrink: 1 }}>
          <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
            Amp and pedal names
          </Text>
          <Text style={{ color: color.silkDim, fontSize: font.small }}>
            {asked
              ? `What ${total} of your ${unit || 'unit'}’s models are really based on`
              : `What ${total} models are really based on — plug in to see only yours`}
          </Text>
        </View>
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Marshall, tube screamer, Brit 800…"
          placeholderTextColor={color.silkFaint}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Find an amp or pedal"
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

      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm }}
      >
        {groups.map((g) => (
          <Press
            key={g.key}
            label={g.label}
            sub={String(g.hits.length)}
            tone="signal"
            on={g.key === here?.key}
            height={44}
            style={{ paddingHorizontal: space.md }}
            onPress={() => setGroup(g.key)}
          />
        ))}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row, i) => `${row.name}-${i}`}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}
        initialNumToRender={20}
        windowSize={7}
        renderItem={({ item }) => (
          <View
            style={{
              paddingVertical: space.sm,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: color.rule,
              backgroundColor: color.panel
            }}
          >
            <Text style={{ color: color.silk, fontSize: font.body, fontFamily: face }}>{item.name}</Text>
            {item.gear ? (
              <Text style={{ color: color.ok, fontSize: font.small, marginTop: 2 }}>{item.gear}</Text>
            ) : (
              <Text style={{ color: color.silkFaint, fontSize: font.micro, marginTop: 2 }}>
                Nobody has recorded what this one is based on.
              </Text>
            )}
          </View>
        )}
        ListEmptyComponent={
          <Note>{`Nothing here matches “${query.trim()}”. The other tabs above may have it.`}</Note>
        }
      />
    </View>
  )
}

const ofDeviceName = (s) => s.deviceName
