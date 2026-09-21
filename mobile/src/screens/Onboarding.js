import { useState } from 'react'
import { Linking, ScrollView, Text, TextInput, View } from 'react-native'

import { CHAIN, P1, P2, P3, P4, P6, P7, P8, P9, CLOSE } from '../lib/onboarding'
import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { Platform } from 'react-native'
import { UNITS } from '../lib/demoUnits'
import { setDemo, setDemoUnit } from '../lib/demo'
import { formatPairCode, isPairCode, pairCredentials } from '../lib/pairing'
import { signIn } from '../lib/relay'
import { useRig } from '../lib/rig'
import { buyUnlock, restorePurchase, usePurchase } from '../lib/purchases'
import { shouldAskToPay } from '../lib/unlock-rule'
import { sendDownloadLink, DOWNLOADS_URL } from '../lib/downloadLink'
import ScanCode from '../components/ScanCode'
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
 * AND THE PURCHASE IS OFFERED LAST, AFTER THE COMPUTER IS PROVEN. P8 says
 * "Connection verified" because by the time it is drawn, it has been — the
 * pairing on P7 succeeded. Asking for money before knowing the thing they are
 * buying can work at all is how refunds happen.
 *
 * Not one word is typed here: every string is from lib/onboarding, generated
 * from shared/onboarding.mjs. "Do not change any wording without asking me
 * first."
 */
const face = Platform.select(mono)

export default function Onboarding({ onDone, onEnterDemo, onAccount, replay, onClose }) {
  const [at, setAt] = useState('welcome')
  const [unit, setUnit] = useState(UNITS[0].key)
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
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

  /* The demo, started for real: the mock is built and the app opens on it. */
  const intoDemo = () => {
    setDemoUnit(unit)
    setDemo(true)
    onEnterDemo()
  }

  /*
   * The code becomes a session, through the same call the sign-in screen
   * makes. One way a phone gets paired, not two that can drift.
   */
  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      await signIn(pairCredentials(code))
      /*
       * AND THE PHONE ANSWERS FOR ITSELF, which is the half of this that was
       * missing.
       *
       * "If they wanna connect a phone to the Mac, the phone needs to be able
       * to accept or deny that they've unlocked it… the phone needs to be
       * able to tell, hey, you did not unlock this, or yes, you did unlock
       * it."
       *
       * It only ever said one of those. Every successful pair went to the
       * unlock step and asked for money — including somebody who had already
       * paid, reinstalled, and was watching their own app ask them to buy it
       * a second time. That is the worst version of this screen and it was
       * the ordinary case for anybody on a new phone.
       *
       * THE SAME RULE THE PAYWALL USES, not a second one. Every false in it
       * is a reason not to charge and three of them are reasons not to be
       * SURE: still asking the store, no store to ask, or already unlocked.
       * An unanswered question is not a "no", and the person most likely to
       * be on bad wifi is the one standing on a stage. See lib/unlock-rule.
       */
      go(shouldAskToPay({ inApp: true, demo: false, ...purchase }) ? 'unlock' : 'connected')
    } catch (err) {
      setError(
        /didn’t match|invalid login/i.test(err.message || '')
          ? 'No computer is paired with that code. Check it against the code your computer shows.'
          : err.message
      )
    } finally {
      setBusy(false)
    }
  }

  const buy = async () => {
    setBusy(true)
    setError(null)
    const out = await buyUnlock()
    setBusy(false)
    if (out.ok) return go('connected')
    if (!out.cancelled) setError(out.message)
  }

  /*
   * RESTORING DOES NOT CONNECT ANYTHING, which is what the old destination
   * claimed.
   *
   * This runs from two screens. From the unlock step a pairing has already
   * succeeded, so "You're connected" is true. From the "where do you want to
   * start" step NOTHING has been paired — and it landed on that same screen,
   * which announced a unit online that nobody had plugged in. A restored
   * purchase means they own it; it says nothing about whether their computer
   * is running. So the caller says where a success goes.
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
          <Press label={P1.haveCode} height={TAP} onPress={() => go('scan')} />
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
            onPress={() => {
              go('scan')
              setScanning(true)
            }}
          />

          <Eyebrow>{P6.notYet}</Eyebrow>
          {/*
            The address, on screen, for anybody happy to type it. The button
            under it is for everybody else — this phone is not the computer
            that needs the download, which is the whole difficulty.
          */}
          <Press
            label={DOWNLOADS_URL}
            height={TAP}
            onPress={() => Linking.openURL(`https://${DOWNLOADS_URL}`)}
          />
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

      {at === 'scan' ? (
        <>
          <Eyebrow>{P7.tag}</Eyebrow>
          <Eyebrow>{P7.eyebrow}</Eyebrow>
          <Head>{P7.head}</Head>
          {/*
            The same scanner the sign-in screen uses, opened the same way. It
            is a modal over the screen rather than a camera embedded in it —
            passing it no `open` would have left a camera that never appears
            and a button that does nothing.
          */}
          <ScanCode
            open={scanning}
            onClose={() => setScanning(false)}
            onCode={(found) => {
              setCode(formatPairCode(found))
              setScanning(false)
            }}
            /* The same door the button below this offers, reached from the
               square that sent them here. */
            onAccount={() => {
              setScanning(false)
              onAccount?.()
            }}
          />
          <Eyebrow>{P7.codeLabel}</Eyebrow>
          <Field
            value={code}
            onChangeText={(t) => setCode(formatPairCode(t))}
            placeholder="XXXX-XXXX"
            autoCapitalize="characters"
            mono
          />
          <Note>{P7.foot}</Note>
          {error ? <Note tone="fault">{error}</Note> : null}
          <Press
            label={P7.go}
            tone="signal"
            on
            disabled={busy || !isPairCode(code)}
            height={TAP}
            onPress={connect}
          />
          <Press label={P7.noCode} height={TAP} onPress={() => go('app')} />
          {/*
            THE WAY IN FOR SOMEBODY WHO ALREADY HAS AN ACCOUNT.

            This screen offers a square to scan and a code to type, and both
            of those come off a computer that is running right now. Anybody
            signed in on another device has neither, and had nothing here at
            all — the walkthrough sent them round to the demo and no further,
            which is how Justin ended up locked out of his own iPad.

            It hands over to the sign-in screen rather than growing a second
            email and password form: that one already signs in, makes an
            account and resets a password, and two of those would drift.
          */}
          <Press label={P7.account} height={TAP} onPress={() => onAccount?.()} />
        </>
      ) : null}

      {at === 'unlock' ? (
        <>
          <Eyebrow>{P8.tag}</Eyebrow>
          {/* It has been verified, because the pairing above just succeeded. */}
          <Text style={{ color: color.ok, fontSize: font.small, fontFamily: face }}>
            {P8.verified(provenUnit)}
          </Text>
          <Eyebrow>{P8.eyebrow}</Eyebrow>
          <Head>{P8.head(purchase.price)}</Head>
          <Sub>{P8.sub}</Sub>
          {P8.gets.map((g) => (
            <Card key={g.key}>
              <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.2 }}>
                {g.label}
              </Text>
              <Text style={{ color: color.silk, fontSize: font.body }}>{g.body}</Text>
            </Card>
          ))}
          {error ? <Note tone="fault">{error}</Note> : null}
          {said ? <Note>{said}</Note> : null}
          <Press
            label={P8.go(purchase.price)}
            tone="signal"
            on
            disabled={busy}
            height={TAP}
            onPress={buy}
          />
          <Press label={P8.restore} disabled={busy} height={TAP} onPress={() => restore('connected')} />
          <Press label={P8.keep} height={TAP} onPress={() => go('pick')} />
          <Note>{P8.foot}</Note>
        </>
      ) : null}

      {at === 'connected' ? (
        <>
          <Eyebrow>{P9.tag(provenUnit)}</Eyebrow>
          <Head>{P9.head}</Head>
          <Sub>{P9.status({ unit: provenUnit, scenes: null })}</Sub>
          {P9.tips.map((tip) => (
            <Card key={tip.key}>
              <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.2 }}>
                {tip.label}
              </Text>
              <Text style={{ color: color.silkDim, fontSize: font.small }}>{tip.body}</Text>
            </Card>
          ))}
          <Press label={P9.go} tone="signal" on height={TAP} onPress={onDone} />
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
