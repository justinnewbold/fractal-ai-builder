import { Linking, ScrollView, Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'
import Note from '../components/Note'
import Press from '../components/Press'

const RELEASES = 'https://github.com/justinnewbold/fractal-ai-builder/releases/latest'
const FORGEFX = 'https://github.com/sKuhLight/ForgeFX'
const CODEC = 'https://github.com/sKuhLight/forgefx-midi'

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
 * THREE ROUTES, AND ONLY ONE OF THEM EXISTS TODAY — which is the whole reason
 * this is written the way it is. The Mac app is real and downloadable now.
 * Running ForgeFX by hand is real and genuinely technical, and is the only
 * thing a Windows or Linux machine can do until the apps are built. The Windows
 * app is not written. A page that dressed all three up as equals would send
 * somebody looking for a download that does not exist, so each one says plainly
 * where it stands.
 *
 * NO COMMANDS ARE INVENTED HERE. The terminal route names the two repositories
 * and the version of Node they need, because those are true; there is no
 * one-line installer yet, and saying so is better than printing a command that
 * does not work on the other end of somebody's evening.
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
            Three ways, and what each one costs you
          </Text>
        </View>
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      {/*
        The one thing somebody has to understand before any of the three makes
        sense. It is not obvious and nothing else in the app says it.
      */}
      <Note>
        Your unit plugs into a computer with a USB cable. That computer talks to the unit, and this
        phone tells the computer what to do — over wifi at the venue, or over the internet from
        anywhere. The phone never talks to the unit directly.
      </Note>

      {/* ------------------------------------------------------------ mac */}
      <Way
        number="1"
        title="The Mac app"
        note="Ready now — this is the easy one"
        steps={[
          'On the Mac, open the download page below and get the latest Fractal Remote.',
          'Drag it to Applications and open it.',
          'Plug your unit into the Mac with its USB cable.',
          'Quit FM3-Edit or Axe-Edit if either is open. Only one program can hold the USB port, and whichever got there first keeps it.',
          'In the app, choose Set up phone remote. It shows a code of 16 letters and numbers.',
          'Type that code on this phone, on the sign-in screen. That is the whole of it — no account needed.'
        ]}
        link={{ label: 'Download Fractal Remote for Mac', url: RELEASES }}
      />

      {/* -------------------------------------------------------- windows */}
      <Way
        number="2"
        title="The Windows app"
        note="Not built yet"
        steps={[
          'There is no Windows app to download at the moment.',
          'When there is, it will be the same handful of steps as the Mac one: install it, plug the unit in, and type the code it shows on this phone.',
          'Until then, a Windows machine can run ForgeFX itself — the next one down.'
        ]}
      />

      {/* -------------------------------------------------------- forgefx */}
      <Way
        number="3"
        title="ForgeFX in a terminal"
        note="Any computer, but this one is properly technical"
        steps={[
          'ForgeFX is the part that actually talks to the unit. The Mac app carries a copy of it inside; on Windows or Linux you can run it yourself.',
          'It needs Node 20 installed, and two repositories checked out next to each other: ForgeFX, and the codec it depends on.',
          'Build the codec first, then start the server inside ForgeFX. It listens on port 5056 on that machine.',
          'With it running and the unit plugged in, sign in on this phone with the same account and it will find it.',
          'There is no one-file installer for this yet. When there is, it will be here.'
        ]}
        link={{ label: 'ForgeFX', url: FORGEFX }}
        second={{ label: 'forgefx-midi (the codec)', url: CODEC }}
      />

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
function Way({ number, title, note, steps, link, second }) {
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
          {title}
        </Text>
      </View>
      <Text style={{ color: color.silkDim, fontSize: font.small }}>{note}</Text>

      <View style={{ gap: space.sm, marginTop: space.xs }}>
        {steps.map((step, i) => (
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

      {link ? <Press label={link.label} onPress={() => Linking.openURL(link.url)} /> : null}
      {second ? <Press label={second.label} onPress={() => Linking.openURL(second.url)} /> : null}
    </View>
  )
}
