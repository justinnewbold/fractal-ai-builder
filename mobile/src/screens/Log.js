import { useEffect, useState } from 'react'
import { FlatList, Platform, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import { color, font, mono, radius, space } from '../lib/theme'
import { clearDebugLog, formatDebugLog, formatLine, getDebugLog, onDebugLog } from '../lib/debugLog'
import { APP_VERSION } from '../lib/version'
import { linkState } from '../lib/link'
import { useRig } from '../lib/rig'
import Note from '../components/Note'
import Press from '../components/Press'

const face = Platform.select(mono)

const ofDeviceName = (s) => s.deviceName
const ofPreset = (s) => s.preset

/**
 * What happened, in the order it happened, and a button that copies it.
 *
 * "I need a debug log with a copy log button so I can paste the log for you to
 * debug."
 *
 * THIS MATTERS MORE ON A PHONE THAN ANYWHERE ELSE and the phone had none. A
 * browser has a console somebody can open; a phone on a dark stage has nowhere
 * at all for a failure to go, so every bad evening was unreconstructable — the
 * screen showed the latest state and nothing about the sequence that produced
 * it. "It kept dropping" cannot be answered from a screen that says
 * "Connected".
 *
 * WHAT GOES IN IT is written at the two choke points every trip passes through:
 * lib/relay logs the shape of each request that failed or took a noticeable
 * moment, and lib/link logs every change of mind about the Mac. Bodies are
 * deliberately not kept — this is written to be pasted into a chat, and a
 * preset dump is neither readable nor anybody else's business.
 *
 * THE COPY CARRIES A HEADER, because the first three questions about any report
 * are which build, which unit and which end of the link — and none of them can
 * be read off the lines themselves.
 */
export default function Log({ onBack }) {
  const [lines, setLines] = useState(() => getDebugLog())
  const [said, setSaid] = useState(null)
  const deviceName = useRig(ofDeviceName)
  const preset = useRig(ofPreset)

  useEffect(() => onDebugLog(() => setLines(getDebugLog())), [])

  useEffect(() => {
    if (!said) return undefined
    const t = setTimeout(() => setSaid(null), 3000)
    return () => clearTimeout(t)
  }, [said])

  const copy = async () => {
    const link = linkState()
    const text = formatDebugLog({
      app: `Fractal Remote (phone) v${APP_VERSION}`,
      platform: `${Platform.OS} ${Platform.Version}`,
      unit: deviceName || 'not detected',
      preset: Number.isInteger(preset?.number) ? `${preset.number} ${preset.name || ''}`.trim() : 'none',
      mac: link.macName || 'none',
      link: link.link
    })
    try {
      await Clipboard.setStringAsync(text)
      setSaid(`Copied ${lines.length} line${lines.length === 1 ? '' : 's'}. Paste it into the chat.`)
    } catch (err) {
      setSaid(`Couldn’t copy: ${err.message}`)
    }
  }

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
            Help & fixes
          </Text>
          <Text style={{ color: color.silkDim, fontSize: font.small }}>
            {`${lines.length} line${lines.length === 1 ? '' : 's'} in the log`}
          </Text>
        </View>
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
        <Press
          label="Copy the log"
          sub="Then paste it into the chat"
          tone="signal"
          onPress={copy}
          disabled={!lines.length}
        />
        {said ? <Note>{said}</Note> : null}
        {!lines.length ? (
          <Note>
            Nothing has gone wrong yet this session. The log fills up on its own — leave the app
            open, do the thing that misbehaves, then come back and copy it.
          </Note>
        ) : null}
      </View>

      <FlatList
        data={[...lines].reverse()}
        keyExtractor={(entry, i) => `${entry.at}-${i}`}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.xs }}
        initialNumToRender={30}
        windowSize={7}
        renderItem={({ item }) => (
          <Text
            selectable
            style={{
              color: item.source === 'crash' || /fail|gave up|refused/i.test(item.message) ? color.fault : color.silkDim,
              fontSize: font.micro,
              fontFamily: face,
              lineHeight: 16,
              paddingVertical: 2,
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              backgroundColor: color.panel
            }}
          >
            {formatLine(item)}
          </Text>
        )}
      />

      {lines.length ? (
        <View style={{ padding: space.lg }}>
          {/*
            Newest first on screen, oldest first in the copy. Reading on a phone
            you want the thing that just happened; reading a paste you want the
            story in order.
          */}
          <Press label="Clear the log" onPress={() => { clearDebugLog(); setLines([]) }} />
        </View>
      ) : null}
    </View>
  )
}
