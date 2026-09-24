import { useState } from 'react'
import { Image, ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { CONNECT, P6 } from '../lib/onboarding'
import laptopIcon from '../../assets/icons/laptop.png'
import mailIcon from '../../assets/icons/mail.png'
import sendIcon from '../../assets/icons/send.png'
import appleIcon from '../../assets/icons/apple.png'
import windowsIcon from '../../assets/icons/windows.png'
import linuxIcon from '../../assets/icons/linux.png'
import CopyAddress from '../components/CopyAddress'
import Note from '../components/Note'
import Press from '../components/Press'
import { sendDownloadLink } from '../lib/downloadLink'

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
    if (out.ok) setSaid(P6.sent(email.trim()))
    else setError(out.message)
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      {/*
        HIS MOCKUP, IN THE APP'S OWN COLOURS. "Can we update this screen to
        look like this? You could change the colors a little bit to match the
        rest of the app." The purple of the picture is the app's amber here,
        and the words are shared/onboarding.mjs's CONNECT.
      */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <View style={{ flex: 1, gap: space.sm }}>
          <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title + 6, fontWeight: '800' }}>
            {CONNECT.title}
          </Text>
          <Text style={{ color: color.silkDim, fontSize: font.lead, lineHeight: 24 }}>{CONNECT.sub}</Text>
        </View>
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      <View
        style={{
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: color.ok,
          backgroundColor: color.panel
        }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.ok }} />
        <Text style={{ color: color.ok, fontSize: font.small, fontWeight: '700', letterSpacing: 1 }}>
          {CONNECT.pill}
        </Text>
      </View>

      <View
        style={{
          padding: space.lg,
          gap: space.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: color.rule,
          backgroundColor: color.panel
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: radius.lg,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: color.panelHi
            }}
          >
            <Image source={laptopIcon} style={{ width: 34, height: 34, tintColor: color.signal }} />
          </View>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={{ color: color.silk, fontSize: font.title - 2, fontWeight: '800' }}>{CONNECT.card}</Text>
            <Text style={{ color: color.silkDim, fontSize: font.body, lineHeight: 21 }}>{CONNECT.cardBody}</Text>
          </View>
        </View>
        <CopyAddress row size={font.lead} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: color.rule }} />
        <Text style={{ color: color.silkDim, fontSize: font.small, letterSpacing: 1.2 }}>{CONNECT.or}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: color.rule }} />
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: TAP + 8,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color.rule,
          backgroundColor: color.panel
        }}
      >
        <Image source={mailIcon} style={{ width: 22, height: 22, marginHorizontal: space.md, tintColor: color.silkDim }} />
        <View style={{ width: 1, alignSelf: 'stretch', marginVertical: space.sm, backgroundColor: color.rule }} />
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
          returnKeyType="send"
          onSubmitEditing={() => !busy && email.includes('@') && mail()}
          style={{ flex: 1, minHeight: TAP, paddingHorizontal: space.md, color: color.silk, fontSize: font.lead }}
        />
      </View>
      <Press
        label="Send link"
        icon={sendIcon}
        tone="signal"
        on
        disabled={busy || !email.includes('@')}
        height={TAP + 8}
        onPress={mail}
      />
      {said ? <Note strong size={font.body}>{said}</Note> : null}
      {error ? <Note tone="fault">{error}</Note> : null}

      <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.md }}>
        <Text style={{ color: color.silkDim, fontSize: font.body }}>{CONNECT.foot}</Text>
        <View style={{ flexDirection: 'row', gap: space.xl }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {[appleIcon, windowsIcon, linuxIcon].map((src, i) => (
            <Image key={i} source={src} style={{ width: 24, height: 24, tintColor: color.silkDim }} />
          ))}
        </View>
      </View>
    </ScrollView>
  )
}
