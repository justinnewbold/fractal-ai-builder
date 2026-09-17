import { useEffect, useState } from 'react'
import { FlatList, Platform, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import { color, font, mono, radius, space } from '../lib/theme'
import { clearDebugLog, formatDebugLog, formatLine, getDebugLog, onDebugLog } from '../lib/debugLog'
import { APP_VERSION } from '../lib/version'
import { linkState } from '../lib/link'
import { pastRuns } from '../lib/logKeep'
import { useRig } from '../lib/rig'
import Note from '../components/Note'
import Press from '../components/Press'

const face = Platform.select(mono)

const ofDeviceName = (s) => s.deviceName
const ofPreset = (s) => s.preset

/** When a kept run last reached the disk, as a clock time. */
const ended = (at) => (at ? new Date(at).toLocaleTimeString() : 'at an unknown time')

/** One line of the log, this run's or a kept one's. Red when it is the bad kind. */
function Line({ text, hot }) {
  return (
    <Text
      selectable
      style={{
        color: hot ? color.fault : color.silkDim,
        fontSize: font.micro,
        fontFamily: face,
        lineHeight: 16,
        paddingVertical: 2,
        paddingHorizontal: space.sm,
        borderRadius: radius.sm,
        backgroundColor: color.panel
      }}
    >
      {text}
    </Text>
  )
}

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

  /*
   * And what the run before this one had to say.
   *
   * The whole reason this exists: the run that needs reading is the one that
   * ended, and until now it took its log with it.
   */
  const [before, setBefore] = useState([])
  useEffect(() => {
    let alive = true
    pastRuns().then((runs) => alive && setBefore(runs))
    return () => {
      alive = false
    }
  }, [])

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
      computer: link.macName || 'none',
      /*
       * The version at the other end, which is the thing that could not be
       * answered from a pasted log before: "Does the Mac app need to be updated
       * to the latest version?" A computer too old to say so is itself the
       * answer, so that case is named rather than left blank.
       */
      'computer app': link.hostVersion || 'did not say (older than 7.192.0)',
      link: link.link
    },
    /*
     * The previous run's tail goes in the same paste, under its own heading.
     * If this launch is the one AFTER a crash, that block is the crash — and
     * it is the half somebody actually needs.
     */
    before.length
      ? before
          .map((run, i) =>
            [
              `${i === 0 ? 'THE RUN BEFORE THIS ONE' : `${i + 1} RUNS AGO`} — ${run.lines.length} lines, oldest first, last written ${ended(run.at)}`,
              '(if the app crashed or was killed, this is what it said on the way)',
              ...run.lines
            ].join('\n')
          )
          .join('\n\n')
      : '')
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
            {`${lines.length} line${lines.length === 1 ? '' : 's'} in the log${
              before.length ? ` · ${before[0].lines.length} kept from the run before` : ''
            }`}
          </Text>
        </View>
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
        <Press
          label="Copy the log"
          /*
            Named on the button, because it is the reason to press it after a
            crash: the copy carries the end of the previous run as well as this
            one, and after a crash that block is the crash.
          */
          sub={before.length ? `This run and the ${before.length === 1 ? 'one' : before.length} before it` : 'Then paste it into the chat'}
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
        renderItem={({ item }) => <Line text={formatLine(item)} hot={item.source === 'crash' || /fail|gave up|refused/i.test(item.message)} />}
        /*
          THE RUNS BEFORE THIS ONE, ON THE SCREEN. They were in the copy and
          nowhere else, so a person who opened this after a crash saw this
          run's handful of lines and nothing from the run that died — "it
          looks like the debug log is not persisting through crashes". It was;
          it was not being shown. Under this run's lines, each run under its
          own heading, oldest line first because that half reads as a story.
        */
        ListFooterComponent={
          before.length ? (
            <View style={{ gap: space.xs, paddingTop: space.lg }}>
              {before.map((run, i) => (
                <View key={`${run.at}-${i}`} style={{ gap: space.xs }}>
                  <Text style={{ color: color.signal, fontSize: font.micro, fontWeight: '700', letterSpacing: 1.5, paddingTop: space.sm }}>
                    {`${i === 0 ? 'THE RUN BEFORE THIS ONE' : `${i + 1} RUNS AGO`} · ${run.lines.length} lines · last written ${ended(run.at)}`}
                  </Text>
                  <Text style={{ color: color.silkFaint, fontSize: font.micro }}>
                    If the app crashed or was killed, this is what it said on the way. Oldest line first.
                  </Text>
                  {run.lines.map((text, j) => (
                    <Line key={j} text={text} hot={/\[crash\]|fail|gave up|refused/i.test(text)} />
                  ))}
                </View>
              ))}
            </View>
          ) : null
        }
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
