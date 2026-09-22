import { useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'

import { CHAIN, P1, P2, P3, P4, P6, P7, P9, CLOSE } from '../lib/onboarding'
import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { Platform } from 'react-native'
import { UNITS } from '../lib/demoUnits'
import { setDemo, setDemoUnit } from '../lib/demo'
import { useRig } from '../lib/rig'
import { restorePurchase, usePurchase } from '../lib/purchases'
import { sendDownloadLink, DOWNLOADS_URL } from '../lib/downloadLink'
import Note from '../components/Note'
import Press from '../components/Press'

/**
 * The first minute, on the phone.
 *
 * Nine screens in the PDF, and the shape of them is a decision rather than a
 * sequence: this phone cannot reach a Fractal unit on its own, ever. It talks
 * to a computer, and the computer holds the cable. Everything here is either
 * explaining that or getting one of the two ends in place.
 *
 * WHICH IS WHY THE DEMO COMES FIRST AND COSTS NOTHING. Somebody who has just
 * installed this may have no computer running, no code, and no idea a
 * computer was part of the arrangement. Sending them to a pairing screen
 * would be sending them to a dead end. The demo is a whole app against a
 * simulated unit, so the answer to "can I look around" is yes, immediately.
 *
 * AND THE PURCHASE IS NOT OFFERED HERE AT ALL ANY MORE. It used to be, on a
 * screen that could say "Connection verified" because a pairing had just
 * succeeded one step earlier. Pairing left this screen with the codes: it is
 * a sign-in now, and signing in leaves the walkthrough. The Paywall asks the
 * question instead, which is where it was always asked for everybody who did
 * not arrive through here.
 *
 * Not one word is typed here: every string is from lib/onboarding, generated
 * from shared/onboarding.mjs. "Do not change any wording without asking me
 * first."
 */
const face = Platform.select(mono)

export default function Onboarding({ onEnterDemo, onAccount, replay, onClose }) {
  const [at, setAt] = useState('welcome')
  const [unit, setUnit] = useState(UNITS[0].key)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState(null)
  const [error, setError] = useState(null)
  const purchase = usePurchase()

  const unitName = UNITS.find((u) => u.key === unit)?.name || UNITS[0].name

  /*
   * THE UNIT THAT ACTUALLY ANSWERED, once one has.
   *
   * `unitName` above is the DEMO picker's choice and defaults to FM3. It was
   * also what the last two screens printed after a real pairing — so somebody
   * who had just connected an FM9 was told "Connection verified · FM3" and
   * then "FM3 · ONLINE", about hardware they do not own. The store learns the
   * real name from the computer a moment after the pairing lands; until then
   * this is the same guess it always was, and it corrects itself in place.
   */
  const detected = useRig((st) => st.deviceName)
  const provenUnit = detected || unitName

  /*
   * ONE WAY BETWEEN STEPS, AND IT CLEARS THE LAST SCREEN'S NOTES.
   *
   * `said` and `error` are one pair for the whole walkthrough, and every step
   * that has a note draws them. So a failed restore on this screen — "No
   * previous purchase was found on this account." — followed you onto the
   * next one and sat there under a heading it had nothing to do with. Same
   * for a mistyped pairing code: back out of the code screen and the
   * complaint about it came too.
   *
   * Moving between screens is the moment both stop being about anything, so
   * it is the moment they go. Handlers that want to SAY something set it
   * after the move, or do not move at all.
   */
  const go = (next) => {
    setSaid(null)
    setError(null)
    setAt(next)
  }

  /*
   * THE DEMO GETS THE LAST SCREEN TOO, which it never did.
   *
   * "When I did a fresh app install, not logged in, there's no tutorial,
   * nothing. So it just brings up the screen. This is a new user trying it
   * out. Not a very good experience."
   *
   * Picking a unit used to be the end: the mock was built and the app opened
   * on the Play screen, mid-stride, with nothing having said what any of it
   * is. And the screen that would have said so was already written — the one
   * at the end of the pairing path, PLAY and EDIT and SAVE in three lines. It
   * was reached only after a real pairing, so the one person who has never
   * seen this app before was the one person who never got it.
   *
   * The demo is switched on here rather than at the end, so the last screen
   * can name the unit the mock actually is. `onEnterDemo` is what finishes
   * the walkthrough, and it is the button on that screen that calls it.
   */
  const intoDemo = () => {
    setDemoUnit(unit)
    setDemo(true)
    go('connected')
  }

  /*
   * NO `connect` ANY MORE, and this is where it was.
   *
   * "I want the QR code gone and the scanner gone. It has never worked once…
   * to use this app and connect it to your computer, you have to sign up."
   *
   * It turned an eight-character code into a session by signing into the
   * hidden account the code stood for. Both halves of that are gone: the
   * screen that collected the code, and the code itself. Joining a phone to
   * a computer is `onAccount` now — the sign-in screen, which already signs
   * in, makes an account and resets a password, and is the only door.
   */
  const restore = async (then) => {
    setBusy(true)
    setError(null)
    const out = await restorePurchase()
    setBusy(false)
    if (out.ok) return go(then)
    setSaid(out.message)
  }

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
      {/*
        THE DOOR, WHEN SOMEBODY IS ONLY LOOKING.

        "I'm signed in and went to settings to restart the tutorial to get the
        screenshots. Now my only option is to start the demo again."

        Every button on these screens exists to get somebody SET UP — pick a
        demo unit, scan a code, buy the unlock. Somebody replaying it is
        already set up, so all of them are wrong, and the only one that looked
        like a way forward put them in the demo and off their own rig.

        First, because a way out at the bottom of a screen somebody is done
        with is a way out they have to go looking for.
      */}
      {replay ? (
        <Press label={CLOSE} height={TAP} onPress={() => onClose?.()} />
      ) : null}

      {at === 'welcome' ? (
        <>
          <Head>{P1.head}</Head>
          <Sub>{P1.sub}</Sub>
          <Press label={P1.go} tone="signal" on height={TAP} onPress={() => go('how')} />
          {/* Was "I already have a pairing code", which opened the scanner.
              Somebody who has been here before has an ACCOUNT now, and that
              is the one door. */}
          <Press label={P1.haveCode} height={TAP} onPress={() => onAccount?.()} />
        </>
      ) : null}

      {at === 'how' ? (
        <>
          <Count>{P2.count}</Count>
          <Eyebrow>{P2.eyebrow}</Eyebrow>
          <Head>{P2.head}</Head>
          {CHAIN.map((box) => (
            <View key={box.key} style={{ gap: space.xs }}>
              <Card>
                <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.2 }}>
                  {box.n}
                </Text>
                <Text style={{ color: color.silk, fontSize: font.body, fontWeight: '700' }}>
                  {box.phoneTitle}
                </Text>
                <Text style={{ color: color.silkDim, fontSize: font.small }}>{box.phoneBody}</Text>
              </Card>
              {box.phoneWire ? (
                <Text
                  style={{
                    color: color.silkFaint,
                    fontSize: font.micro,
                    letterSpacing: 1.2,
                    textAlign: 'center'
                  }}
                >
                  {box.phoneWire}
                </Text>
              ) : null}
            </View>
          ))}
          <Note>{P2.foot}</Note>
          <Press label={P2.go} tone="signal" on height={TAP} onPress={() => go('mode')} />
        </>
      ) : null}

      {at === 'mode' ? (
        <>
          <Count>{P3.count}</Count>
          <Head>{P3.head}</Head>

          <Card>
            <Text style={{ color: color.signal, fontSize: font.micro, letterSpacing: 1.2 }}>
              {P3.demo.tag}
            </Text>
            <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.2 }}>
              {P3.demo.eyebrow}
            </Text>
            <Text style={{ color: color.silk, fontSize: font.lead, fontWeight: '700' }}>
              {P3.demo.title}
            </Text>
            <Text style={{ color: color.silkDim, fontSize: font.small }}>{P3.demo.body}</Text>
            <Press
              label={P3.demo.go}
              tone="signal"
              on
              height={TAP}
              onPress={() => go('pick')}
            />
          </Card>

          <Card>
            <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.2 }}>
              {P3.real.eyebrow}
            </Text>
            <Text style={{ color: color.silk, fontSize: font.lead, fontWeight: '700' }}>
              {P3.real.title}
            </Text>
            <Text style={{ color: color.silkDim, fontSize: font.small }}>{P3.real.body}</Text>
            {/* The store's price where it knows one, his wording where it
                does not — see FALLBACK_PRICE in shared/onboarding.mjs. */}
            <Press label={P3.real.go(purchase.price)} height={TAP} onPress={() => go('app')} />
          </Card>

          <Press label={P3.restore} disabled={busy} height={TAP} onPress={() => restore('app')} />
          {/*
            THE OTHER WAY BACK IN, FOR SOMEBODY WHO ALREADY HAS ALL OF THIS.

            "Can we please add username and password login for this screen…
            if they've already purchased it they can either restore purchase
            from the App Store or they can login with their username and
            password."

            The two are not the same door and it is worth knowing which is
            which. RESTORE asks the App Store whether this Apple ID bought the
            unlock; it is the one that gets a paid app back on a new phone.
            SIGNING IN reaches a computer that was set up with an account
            rather than a pairing code — no code to scan, nothing on screen
            to type, and until now nothing on this screen for them at all.

            Somebody reinstalling usually needs both, so both are here rather
            than one buried behind the other. It is the same wording the
            pairing step uses for the same action, because one phrase for one
            thing is how the two stay from drifting apart.
          */}
          <Press label={P7.account} height={TAP} onPress={() => onAccount?.()} />
          {said ? <Note>{said}</Note> : null}
          <Note>{P3.foot}</Note>
        </>
      ) : null}

      {at === 'pick' ? (
        <>
          <Eyebrow>{P4.tag}</Eyebrow>
          <Eyebrow>{P4.eyebrow}</Eyebrow>
          <Head>{P4.head}</Head>
          <Sub>{P4.sub}</Sub>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {UNITS.map((u) => (
              <Press
                key={u.key}
                label={u.name}
                tone="signal"
                on={u.key === unit}
                height={44}
                style={{ paddingHorizontal: space.md }}
                onPress={() => setUnit(u.key)}
              />
            ))}
          </View>
          {/* Named by whichever is lit, so the button says what pressing it
              gets you rather than "continue". */}
          <Press label={P4.go(unitName)} tone="signal" on height={TAP} onPress={intoDemo} />
          {/*
            A WAY BACK, because this screen was a one-way door.

            Every other button here picks a unit, and the only one that went
            anywhere started the demo. Somebody who got this far and then
            decided they would rather connect their real rig had to enter the
            demo and leave it again through Setup. In a walkthrough that is a
            trap, and it is two steps from the screen that offers both.
          */}
          <Press label={P4.back} height={TAP} onPress={() => go('mode')} />
        </>
      ) : null}

      {at === 'app' ? (
        <>
          <Eyebrow>{P6.tag}</Eyebrow>
          <Eyebrow>{P6.eyebrow}</Eyebrow>
          <Head>{P6.head}</Head>
          {/*
            Both, from the one button the copy gives us. "Yes - show me the
            scanner" promises a scanner, so it opens one rather than landing
            on a screen with a camera you have to ask for again. Arriving here
            from "I already have a pairing code" does NOT open it: that route
            says they have the code, and a camera nobody asked for is a
            permission prompt nobody asked for.
          */}
          <Press
            label={P6.yes}
            tone="signal"
            on
            height={TAP}
            onPress={() => onAccount?.()}
          />

          <Eyebrow>{P6.notYet}</Eyebrow>
          {/*
            PRINTED, NOT PRESSED.
            
            "It just says download when you click on it. And it tries
            downloading it on the phone."

            It did. The address was a button, and tapping a button on a phone
            opens the thing on the phone — so it went to the downloads page on
            the handset and started fetching a Mac installer onto a device
            that can do nothing whatever with it.

            This phone is never the computer that needs this download. That is
            the whole difficulty of the step, and a button is a promise that
            pressing it does something useful. So the address is text to read
            and type somewhere else, with the eyebrow above it saying where,
            and the only thing to press is the one that sends the link to a
            machine that can use it.
          */}
          <Eyebrow>{P6.address}</Eyebrow>
          <Card>
            <Text selectable style={{ color: color.silk, fontSize: font.lead, fontFamily: face }}>
              {DOWNLOADS_URL}
            </Text>
          </Card>
          <Eyebrow>{P6.emailLabel}</Eyebrow>
          <Field
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
          />
          <Press
            label={P6.platforms[0].go}
            disabled={busy || !email.includes('@')}
            height={TAP}
            onPress={mail}
          />
          <Note>{P6.foot}</Note>
          {said ? <Note>{said}</Note> : null}
          {error ? <Note tone="fault">{error}</Note> : null}
          <Press label={P6.back} height={TAP} onPress={() => go('mode')} />
        </>
      ) : null}

      {/*
        `unlock` WAS HERE, and it cannot be reached any more.
        
        It said "Connection verified" and offered the purchase, and the only
        way in was a pairing that succeeded on the screen before it. Pairing
        does not happen inside the walkthrough now — signing in leaves it — so
        the premise of the screen is gone with the pairing code.
        
        Nothing is lost: the Paywall raises itself the moment somebody is in
        the app with a real rig and no unlock, which is the one place that
        question is asked (see App.js and lib/unlock-rule). The walkthrough
        stopped being one of them.
      */}
      {at === 'connected' ? (
        <>
          <Eyebrow>{P9.tag(provenUnit)}</Eyebrow>
          {/* The same three tips either way. Only the two lines above them
              change, because "You're connected" and "through your computer"
              are both false in the demo. */}
          {/* The demo's words, because the demo is the only way here now.
              The paired version of this screen went with the unlock step. */}
          <Head>{P9.demo.head}</Head>
          <Sub>{P9.demo.status(provenUnit)}</Sub>
          {P9.tips.map((tip) => (
            <Card key={tip.key}>
              <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.2 }}>
                {tip.label}
              </Text>
              <Text style={{ color: color.silkDim, fontSize: font.small }}>{tip.body}</Text>
            </Card>
          ))}
          <Press label={P9.go} tone="signal" on height={TAP} onPress={onEnterDemo} />
          <Note>{P9.foot}</Note>
        </>
      ) : null}
    </ScrollView>
  )
}

const Head = ({ children }) => (
  <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
    {children}
  </Text>
)

const Sub = ({ children }) => (
  <Text style={{ color: color.silkDim, fontSize: font.body, lineHeight: font.body * 1.45 }}>
    {children}
  </Text>
)

const Eyebrow = ({ children }) => (
  <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.5 }}>
    {children}
  </Text>
)

const Count = ({ children }) => (
  <Text style={{ color: color.signal, fontSize: font.micro, letterSpacing: 1.5 }}>{children}</Text>
)

const Card = ({ children }) => (
  <View
    style={{
      gap: space.sm,
      padding: space.lg,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.rule,
      backgroundColor: color.panel
    }}
  >
    {children}
  </View>
)

/** One box to type in, the app's own shape. */
function Field({ mono: isMono, ...rest }) {
  return (
    <TextInput
      {...rest}
      placeholderTextColor={color.silkFaint}
      autoCorrect={false}
      style={{
        color: color.silk,
        fontSize: font.body,
        fontFamily: isMono ? face : undefined,
        letterSpacing: isMono ? 2 : undefined,
        padding: space.md,
        minHeight: TAP,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.rule,
        backgroundColor: color.panel
      }}
    />
  )
}
