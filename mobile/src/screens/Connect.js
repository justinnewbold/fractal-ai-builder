import { Linking, ScrollView, Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'
import Note from '../components/Note'
import Press from '../components/Press'
import { WAYS } from '../lib/ways-in'

/**
 * How to get a computer on the other end of this, in the order people will
 * actually do it.
 *
 * "We also need to make instructions that teach people how to connect by either
 * downloading the Mac app, installing forgefx with a helper file for terminal
 * or a windows app (after we build those ones later)."
 *
 * WHAT THIS SCREEN IS FOR is the person holding a phone that says NO COMPUTER,
 * who has no idea that a computer was ever part of the arrangement. Nothing in
 * the app said so. The sign-in screen asked for a code "your computer shows"
 * and there was no way from there to find out which computer, or how to make
 * one show anything.
 *
 * THE ROUTES THEMSELVES LIVE IN shared/ways-in.mjs, so the browser offers the
 * same four with the same honest status. What is here is the phone's way of
 * drawing them and nothing else — see that file for why one of them says "not
 * built yet" rather than being quietly left out.
 */
export default function Connect({ onBack }) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <Text
            accessibilityRole="header"
            style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}
          >
            Connecting a computer
          </Text>
          <Text style={{ color: color.silkDim, fontSize: font.small }}>
            Four ways, and what each one costs you
          </Text>
        </View>
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      {/*
        The one thing somebody has to understand before any of the four makes
        sense. It is not obvious and nothing else in the app says it.
      */}
      <Note>
        Your unit plugs into a computer with a USB cable. That computer talks to the unit, and this
        phone tells the computer what to do — over wifi at the venue, or over the internet from
        anywhere. The phone never talks to the unit directly.
      </Note>

      {/*
        The routes themselves, from the list both ends share — see
        shared/ways-in.mjs, which also holds what each one costs you.

        NOT REORDERED HERE, and that is deliberate. waysFor puts the routes for
        YOUR computer first, and a phone cannot know which computer that is:
        knowing this app is running on an iPhone says nothing about whether
        there is a Mac or a PC on the desk. So the phone takes the list as it
        comes, which opens on the one route that exists today, and the browser
        — which IS running on the computer in question — does the sorting.
      */}
      {WAYS.map((way, i) => (
        <Way key={way.id} number={String(i + 1)} way={way} />
      ))}

      <Note tone="warn">
        Whichever way you go: only one program at a time can hold the unit’s USB port. If the
        computer says it cannot find your unit, something else has it — the Fractal editor, or a
        second copy of this app.
      </Note>
    </ScrollView>
  )
}

/**
 * One route, numbered, with what it costs said before the steps rather than
 * discovered half way down them.
 */
function Way({ number, way }) {
  return (
    <View
      style={{
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.rule,
        backgroundColor: color.panel
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
        <Text style={{ color: color.signal, fontSize: font.lead, fontWeight: '700' }}>{number}</Text>
        <Text style={{ color: color.silk, fontSize: font.lead, fontWeight: '700', flex: 1 }}>
          {way.title}
        </Text>
      </View>
      <Text style={{ color: color.silkDim, fontSize: font.small }}>{way.note}</Text>

      <View style={{ gap: space.sm, marginTop: space.xs }}>
        {way.steps.map((step, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
            <Text style={{ color: color.silkFaint, fontSize: font.small, minWidth: 18 }}>
              {`${i + 1}.`}
            </Text>
            <Text style={{ color: color.silk, fontSize: font.small, lineHeight: 20, flex: 1 }}>
              {step}
            </Text>
          </View>
        ))}
      </View>

      {way.links.map((link) => (
        <Press key={link.url} label={link.label} onPress={() => Linking.openURL(link.url)} />
      ))}
    </View>
  )
}
