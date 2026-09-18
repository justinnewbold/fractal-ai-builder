import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space } from '../lib/theme'
import { KINDS, MAX_MESSAGE, carriesLog, context, logPreview, sendReport } from '../lib/reports'
import { useRig } from '../lib/rig'
import Note from '../components/Note'
import Press from '../components/Press'

const face = Platform.select(mono)

/* Read off the rig here rather than handed down, the way the log screen does
   it: which unit is attached is a live fact, not something a caller should be
   trusted to have passed the current value of. */
const ofDeviceName = (s) => s.deviceName

/**
 * Telling us something is broken, or asking for something — from the phone.
 *
 * THE PHONE HAD NOWHERE TO SAY SO, which is the gap this fills. The browser
 * has had a box like this for a while, and a handset — the surface where the
 * bad evenings actually happen — could copy its log and nothing else. The
 * report only ever arrived if somebody remembered to paste it into a message
 * later, from another device, after the gig.
 *
 * TWO KINDS AND ONLY ONE CARRIES THE LOG. Somebody asking for a bigger tuner
 * has not offered a transcript of their evening, and this screen does not
 * quietly take one: the switch is not drawn at all on that side. On the bug
 * side it is drawn, it is on, and it can be turned off — and what it would
 * send can be read in full first, by the same function that sends it, so the
 * preview cannot drift from the thing being previewed.
 *
 * Nothing is gathered while somebody types. The log is read when Send is
 * pressed and at no other moment, so a report half-written and abandoned
 * leaves no copy of anything anywhere.
 */
export default function Report({ onBack, start = 'bug' }) {
  const deviceName = useRig(ofDeviceName)
  const [kind, setKind] = useState(KINDS.includes(start) ? start : 'bug')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [withLog, setWithLog] = useState(true)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  const bug = carriesLog(kind)

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await sendReport({ kind, message, contact, context: context({ deviceName }), withLog })
      // The text goes only once it is actually gone.
      setSent(true)
      setMessage('')
      setContact('')
      setPreview(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const box = {
    color: color.silk,
    fontSize: font.body,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: radius.md,
    padding: space.md
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      /* The message box sits low on the screen and the keyboard covers it on
         iOS. Android resizes the window itself, so asking twice there pushes
         the whole screen up and leaves a gap under it. */
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
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
              Tell us
            </Text>
            <Text style={{ color: color.silkDim, fontSize: font.small }}>
              Something broken, or something you want
            </Text>
          </View>
          <Press label="Done" height={40} onPress={onBack} />
        </View>

        {sent ? (
          <View style={{ gap: space.md }}>
            <Note tone="hint">Sent — thank you. It goes straight to the person who builds this.</Note>
            <Press label="Send another" onPress={() => setSent(false)} />
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {KINDS.map((k) => (
                <Press
                  key={k}
                  grow
                  height={48}
                  label={k === 'bug' ? 'Something is broken' : 'I want something'}
                  on={kind === k}
                  disabled={busy}
                  onPress={() => {
                    setKind(k)
                    /* A preview belongs to the kind it was made for. Left up
                       while switching to the side that sends no log, it would
                       show a log beside a form not sending one. */
                    setPreview(null)
                  }}
                />
              ))}
            </View>

            <TextInput
              value={message}
              onChangeText={setMessage}
              editable={!busy}
              multiline
              maxLength={MAX_MESSAGE}
              textAlignVertical="top"
              placeholder={
                bug
                  ? 'What happened, and what did you expect instead?'
                  : 'What would you like it to do?'
              }
              placeholderTextColor={color.silkFaint}
              accessibilityLabel={bug ? 'What went wrong' : 'What you want'}
              style={{ ...box, minHeight: 120, lineHeight: 22 }}
            />

            <TextInput
              value={contact}
              onChangeText={setContact}
              editable={!busy}
              placeholder="Email, if you want an answer (optional)"
              placeholderTextColor={color.silkFaint}
              accessibilityLabel="Your email, if you want an answer"
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="email"
              style={box}
            />

            {bug ? (
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
                <Press
                  label="Send the log of what the app just did"
                  on={withLog}
                  disabled={busy}
                  onPress={() => setWithLog(!withLog)}
                />
                <Press
                  label={preview === null ? 'See what that is' : 'Hide it'}
                  height={44}
                  disabled={busy || !withLog}
                  onPress={() => setPreview(preview === null ? logPreview(kind) : null)}
                />
                {preview !== null ? (
                  /* Its own scroller, capped: the log is long by design and a
                     screen that grew by two hundred lines would put Send off
                     the bottom of the phone. */
                  <ScrollView
                    nestedScrollEnabled
                    style={{
                      maxHeight: 220,
                      backgroundColor: color.chassis,
                      borderRadius: radius.sm
                    }}
                    contentContainerStyle={{ padding: space.sm }}
                  >
                    <Text
                      selectable
                      style={{ color: color.silkDim, fontSize: font.micro, fontFamily: face, lineHeight: 16 }}
                    >
                      {preview || '(nothing has been logged yet this session)'}
                    </Text>
                  </ScrollView>
                ) : null}
              </View>
            ) : (
              <Note tone="hint">No log goes with this one — just what you wrote.</Note>
            )}

            {error ? <Note tone="fault">{error}</Note> : null}

            <Press
              label={busy ? 'Sending…' : 'Send'}
              tone="signal"
              on={!busy && !!message.trim()}
              disabled={busy || !message.trim()}
              onPress={send}
            />

            <Text style={{ color: color.silkFaint, fontSize: font.micro, lineHeight: 18 }}>
              Your version, your phone&rsquo;s OS and which unit you&rsquo;re on are sent too, so it
              can be looked into.
              {bug && withLog ? ' The log goes as well — you can read it above first.' : ''} Nothing
              you&rsquo;ve built and no account details go with it.
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
