import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'
import { FIXES, FIRMWARE_NOTE, versionsInSync } from '../lib/troubleshooting'
import { APP_VERSION } from '../lib/version'
import Note from '../components/Note'
import Press from '../components/Press'

/**
 * What to try when it isn't working.
 *
 * The screen somebody wants at the exact moment nothing else in the app is any
 * use, which is why it works with the computer off: it is a list of things to
 * do, not a question for the unit. The only live part is the version check,
 * and that says so when it has nothing to compare.
 *
 * The guide itself is shared with the browser — see shared/troubleshooting.mjs
 * — so a fix reads the same wherever somebody standing in front of a dead rig
 * happens to look it up. This file is the phone's way of showing it and
 * nothing else.
 *
 * `open` is the id an error note sent us here with, so the thing you pressed
 * about is the thing already unfolded. Everything else starts shut: four
 * problems and their steps all at once is a wall of text on a handset.
 */
export default function Fixes({ onBack, open = null, hostVersion = null }) {
  const [shown, setShown] = useState(open)
  const sync = versionsInSync({ app: APP_VERSION, host: hostVersion })

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
            Fixes
          </Text>
          <Text style={{ color: color.silkDim, fontSize: font.small }}>
            What to try, in the order worth trying it
          </Text>
        </View>
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      {FIXES.map((fix) => {
        const isOpen = shown === fix.id
        return (
          <View key={fix.id} style={{ gap: space.sm }}>
            <Press
              label={fix.title}
              sub={fix.when}
              on={isOpen}
              onPress={() => setShown(isOpen ? null : fix.id)}
            />
            {isOpen ? (
              <View
                style={{
                  gap: space.md,
                  padding: space.md,
                  borderWidth: 1,
                  borderColor: color.rule,
                  borderRadius: radius.md,
                  backgroundColor: color.panel
                }}
              >
                {fix.steps.map((step, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
                    <Text
                      style={{ color: color.silkFaint, fontSize: font.body, fontVariant: ['tabular-nums'] }}
                    >
                      {i + 1}.
                    </Text>
                    <Text style={{ color: color.silk, fontSize: font.body, lineHeight: 22, flex: 1 }}>
                      {step}
                    </Text>
                  </View>
                ))}

                {/*
                  The version check itself, rather than a step telling somebody
                  to go and compare two numbers by hand. Two of the three: the
                  unit's own firmware is not something this app can read, and
                  it says so rather than leaving a row that looks like a check
                  nobody ran.
                */}
                {fix.id === 'versions' ? (
                  <View style={{ gap: space.sm }}>
                    <Note tone={sync.state === 'ok' ? 'hint' : sync.state === 'unknown' ? 'hint' : 'warn'}>
                      {sync.says}
                    </Note>
                    <Text style={{ color: color.silkFaint, fontSize: font.micro, lineHeight: 18 }}>
                      {FIRMWARE_NOTE}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        )
      })}
    </ScrollView>
  )
}
