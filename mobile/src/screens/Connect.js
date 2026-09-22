import { useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { Platform } from 'react-native'
import Note from '../components/Note'
import Press from '../components/Press'
import { DOWNLOADS_URL, sendDownloadLink } from '../lib/downloadLink'

/**
 * How to get a computer on the other end of this — asked from a phone.
 *
 * WHAT THIS SCREEN USED TO BE, and why that was wrong.
 *
 * "This screen should not show up on the phone. A phone can't download
 * desktop software, it also isn't suppose to go to GitHub directly."
 *
 * It drew all of shared/ways-in.mjs: three routes, each with its own install
 * steps — take the newest .dmg, drag it to Applications, click More info then
 * Run anyway — and under each one a button that opened the GitHub releases
 * page. On a phone every line of that is advice about a machine the reader is
 * not holding, ending in a download the handset cannot use, on a page nobody
 * should be sent to.
 *
 * WHAT IT IS NOW. The same question, answered with the two things a phone can
 * actually do about it: an address to type on the computer, and a link sent
 * somewhere the computer can open it. Both were already here in the
 * walkthrough's version of this step; this is that screen agreeing with it.
 *
 * The install steps are not lost — they are on the downloads page, which is
 * where somebody sitting at the computer will read them.
 *
 * THE ROUTES LIST STAYS IN shared/ways-in.mjs for the browser, which IS
 * running on the computer in question and can sort them by what it is.
 *
 * AND THEN THE PROSE WENT TOO, for the same reason the routes did.
 *
 * "On the connect a computer page remove all text except what's in the
 * screen shot and make the stuff that's visible in the screenshot larger on
 * the screen. The [same thing] is on the download page that they go to, so we
 * don't need it here."
 *
 * Three paragraphs were still here: what a USB cable is for, what to do once
 * the app is installed, and the warning that only one program can hold the
 * port. Every one of them is on the page this screen is sending somebody to,
 * and every one of them is about the machine they are not holding — which is
 * the same fault as the routes, in sentences instead of buttons. Read on a
 * phone they pushed the two things you CAN act on down the screen.
 *
 * What is left is the address and the email box, at sizes you can read at
 * arm's length. The subtitle went with them: it promised "what it is", and
 * what it is has moved to the page that explains it.
 */
const face = Platform.select(mono)

export default function Connect({ onBack }) {
  const [email, setEmail] = useState('')
  const [said, setSaid] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const mail = async () => {
    setBusy(true)
    setError(null)
    setSaid(null)
    const out = await sendDownloadLink(email)
    setBusy(false)
    if (out.ok) setSaid(`Sent to ${email.trim()}.`)
    else setError(out.message)
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
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
        </View>
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      {/*
        PRINTED, NOT PRESSED — the same rule as the walkthrough's version of
        this. A button on a phone opens the thing on the phone, and what is at
        the far end of this one is a Mac installer.
      */}
      <Text style={{ color: color.silkFaint, fontSize: font.small, letterSpacing: 1.2 }}>
        TYPE THIS ON YOUR COMPUTER · NOT ON THIS PHONE
      </Text>
      <View
        style={{
          padding: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color.rule,
          backgroundColor: color.panel
        }}
      >
        <Text selectable style={{ color: color.silk, fontSize: font.title, fontFamily: face }}>
          {DOWNLOADS_URL}
        </Text>
      </View>
      <Note size={font.body}>
        That page has the Mac, Windows and Linux downloads, and the steps for each. The computer app
        is free.
      </Note>

      <Text style={{ color: color.silkFaint, fontSize: font.small, letterSpacing: 1.2 }}>
        OR HAVE THE LINK SENT TO YOU
      </Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={color.silkFaint}
        accessibilityLabel="Where to send the download link"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        inputMode="email"
        keyboardType="email-address"
        style={{
          minHeight: TAP,
          backgroundColor: color.panel,
          borderWidth: 1,
          borderColor: color.rule,
          borderRadius: radius.md,
          paddingHorizontal: space.md,
          color: color.silk,
          fontSize: font.title
        }}
      />
      <Press
        label="Send link"
        disabled={busy || !email.includes('@')}
        height={TAP}
        onPress={mail}
      />
      {said ? <Note>{said}</Note> : null}
      {error ? <Note tone="fault">{error}</Note> : null}
    </ScrollView>
  )
}
