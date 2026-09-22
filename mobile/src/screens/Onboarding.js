import { useState } from 'react'
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native'

import { CHAIN, P1, P2, P3, P4, P6, P7, P9, CLOSE } from '../lib/onboarding'
import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { Platform } from 'react-native'
import { UNITS } from '../lib/demoUnits'
import { setDemo, setDemoUnit } from '../lib/demo'
import { useRig } from '../lib/rig'
import { tick } from '../lib/feedback'
/* An ES import rather than require(): Metro resolves both, but require is not
   a name this app has anywhere, and a test is right to refuse it. */
import unitFm3 from '../../assets/unit-fm3.png'
import { restorePurchase } from '../lib/purchases'
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
          {/*
            HIS MOCKUP, BUILT. The words were already right — CHAIN has said
            YOUR UNIT / YOUR COMPUTER / THIS PHONE and the two wire labels for
            months. What it did not have was the drawing: three numbered boxes
            joined by a lit cable, which is the whole idea in one look.

            Everything here is Views and type. No SVG library, no new asset
            pipeline, nothing native — so a screen that reads like a product
            shot still ships over the air and costs no build.
          */}
          <Progress count={P2.count} at={0} of={2} />
          <Eyebrow>{P2.eyebrow}</Eyebrow>
          <Head>{P2.head}</Head>
          <Sub>{P2.sub}</Sub>
          <View style={{ gap: 0 }}>
            {CHAIN.map((box, i) => (
              <View key={box.key}>
                <ChainBox n={i + 1} title={box.phoneTitle} body={box.phoneBody} kind={box.key} />
                {box.phoneWire ? <Wire label={box.phoneWire} /> : null}
              </View>
            ))}
          </View>
          <Note>{P2.foot}</Note>
          <Press label={`${P2.go}  ›`} tone="signal" on height={TAP} onPress={() => go('mode')} />
        </>
      ) : null}

      {at === 'mode' ? (
        <>
          <Progress count={P3.count} at={1} of={2} title={P3.title} />
          <Head>{P3.head}</Head>
          <Sub>{P3.sub}</Sub>

          {/*
            HIS MOCKUP. Two cards, and only one of them is lit.

            They used to be the same card twice, which made the screen a pair
            of equal choices — and they are not equal. The demo costs nothing
            and works this second; the real rig wants a computer and a
            purchase. So the demo card carries the amber edge and the solid
            button, the hardware card is outlined and quiet, and the shape of
            the screen says which one to press if you do not know.
          */}
          <Choice
            lit
            eyebrow={P3.demo.eyebrow}
            title={P3.demo.title}
            body={P3.demo.body}
            art={<UnitShot />}
          >
            <Press label={P3.demo.go} tone="signal" on height={TAP} onPress={() => go('pick')} />
          </Choice>

          <Choice
            eyebrow={P3.real.eyebrow}
            title={P3.real.title}
            body={P3.real.body}
            art={<Lock size={58} faint />}
          >
            {/* No price on this button: it takes no money. It opens the
                computer-app step, and the store's own sheet quotes the price
                at the paywall.

                His mockup puts a small lock in the button too. Press has no
                icon slot and widening a component used on every screen for
                one glyph is the wrong trade — the card's own lock, above
                right, already says it. */}
            <Press label={P3.real.go} height={TAP} onPress={() => go('app')} />
          </Choice>

          {/*
            THE TWO WAYS BACK IN, FOR SOMEBODY WHO ALREADY HAS ALL OF THIS.

            RESTORE asks the store whether this account bought the unlock; it
            is the one that gets a paid app back on a new phone. SIGNING IN
            reaches a computer that was set up with an account. Somebody
            reinstalling usually needs both, so both are here.

            As a footnote rather than two full-width buttons: they are the
            smallest things on the screen and were shouting over the choice it
            exists to ask.
          */}
          <Footnote
            question={P3.already}
            links={[
              { label: P3.restore, onPress: () => restore('app'), disabled: busy },
              { label: P3.signIn, onPress: () => onAccount?.() }
            ]}
          />
          {said ? <Note>{said}</Note> : null}
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
            The one way on from here. An account is the only thing that joins
            a phone to a computer, so the button goes to sign-in — and the
            label says so, where it used to promise a scanner that no longer
            exists.
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

/**
 * Which step this is, as a number and as dots.
 *
 * His mockup puts both in the corner: "1 OF 2" beside two dots with the
 * current one lit. The number is what you read; the dots are what you see
 * without reading, which is the point of having both.
 */
const Progress = ({ count, at, of, title }) => (
  <View style={{ gap: space.md }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flex: 1 }} />
      {title ? (
        <Text style={{ color: color.silk, fontSize: font.body, fontWeight: '700' }}>{title}</Text>
      ) : null}
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Count>{count}</Count>
      </View>
    </View>
    {/* Bars rather than dots, from the later mockup. A bar reads as ground
        covered; a dot only reads as a position. Filled means reached, so at
        the last step both are lit — which is what his 2 of 2 shows. */}
    <View style={{ flexDirection: 'row', gap: space.xs, justifyContent: 'center' }}>
      {Array.from({ length: of }, (_, i) => (
        <View
          key={i}
          style={{
            width: 64,
            height: 4,
            borderRadius: 2,
            backgroundColor: i <= at ? color.signal : color.rule
          }}
        />
      ))}
    </View>
  </View>
)

/**
 * The FM3 from his mockup, as an asset.
 *
 * "I sent the photo with the FM3 in it. Use that exact mockup." So this is
 * literally that picture: cropped out of the screenshot he sent, with its
 * edges faded to transparent so it melts into the card rather than sitting in
 * a visible dark rectangle over the amber wash.
 *
 * Measured, because it decides whether this costs him anything: an image in
 * mobile/assets does NOT move the Expo fingerprint. Artwork ships over the
 * air. What would cost a build is an icon FONT — expo-font moves both
 * fingerprints, which is why the chain-block icons in his other mockup are
 * waiting for a native build and this is not.
 */
const UnitShot = () => (
  <Image
    source={unitFm3}
    style={{ width: 132, height: 105 }}
    resizeMode="contain"
    accessible={false}
  />
)

/**
 * A padlock, drawn.
 *
 * There is no icon set in this app and adding one is a dependency for a
 * shape that is four rectangles. The shackle is a rounded box with its
 * bottom edge dropped behind the body, which is the whole trick.
 */
const Lock = ({ size = 18, faint }) => {
  const tint = faint ? color.rule : color.silk
  const w = size * 0.72
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View
        style={{
          width: w * 0.62,
          height: size * 0.42,
          borderTopLeftRadius: size,
          borderTopRightRadius: size,
          borderWidth: Math.max(1.5, size * 0.08),
          borderBottomWidth: 0,
          borderColor: tint,
          marginBottom: -1
        }}
      />
      <View
        style={{
          width: w,
          height: size * 0.5,
          borderRadius: Math.max(2, size * 0.12),
          borderWidth: Math.max(1.5, size * 0.08),
          borderColor: tint
        }}
      />
    </View>
  )
}

/**
 * One of the two ways in, and whether this is the one to press.
 *
 * `lit` is the whole difference: an amber edge, a warm wash behind it and a
 * solid button. The other card is outlined and quiet. Two identical cards
 * made the screen a coin toss, and these two choices are not a coin toss.
 */
const Choice = ({ lit, eyebrow, title, body, art, children }) => (
  <View
    style={{
      gap: space.sm,
      padding: space.lg,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: lit ? color.signal : color.rule,
      backgroundColor: lit ? color.signalWash : color.panel
    }}
  >
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text
          style={{
            color: lit ? color.signal : color.silkFaint,
            fontSize: font.micro,
            letterSpacing: 1.5
          }}
        >
          {eyebrow}
        </Text>
        <Text style={{ color: color.silk, fontSize: font.lead, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: color.silkDim, fontSize: font.small, lineHeight: font.small * 1.45 }}>
          {body}
        </Text>
      </View>
      {art ? <View style={{ paddingTop: space.xs }}>{art}</View> : null}
    </View>
    {children}
  </View>
)

/**
 * The small print at the bottom: one question, and the short answers.
 *
 * Restore and Sign in were two full-width buttons — the smallest things on
 * the screen, shouting over the choice it exists to ask. A rule either side
 * of the question puts them where they belong without hiding them.
 */
const Footnote = ({ question, links }) => (
  <View style={{ gap: space.md, marginTop: space.sm }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, height: 1, backgroundColor: color.rule }} />
      <Text style={{ color: color.silkDim, fontSize: font.small }}>{question}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: color.rule }} />
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md }}>
      {links.map((l, i) => (
        <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          {i > 0 ? (
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color.silkFaint }} />
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={l.disabled}
            onPress={() => {
              tick()
              l.onPress?.()
            }}
            hitSlop={12}
            style={{ minHeight: TAP, justifyContent: 'center', paddingHorizontal: space.xs }}
          >
            <Text style={{ color: l.disabled ? color.silkFaint : color.signal, fontSize: font.body }}>
              {l.label}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  </View>
)

/**
 * A device, drawn rather than photographed.
 *
 * His mockup has renders of a rack unit, a laptop and a phone. Those are
 * image files and I do not have them, so these are the same three shapes in
 * the app's own materials: a wide chassis with a screen and knobs, a lid over
 * a base, a handset with a bar meter. Recognisable at a glance, which is all
 * the row needs them to be.
 *
 * WHEN THE REAL ART ARRIVES it drops in here and nothing else moves — the row
 * already gives it a fixed box to sit in.
 */
const Art = ({ kind }) => {
  const box = { width: 92, height: 56, alignItems: 'center', justifyContent: 'center' }
  const skin = { backgroundColor: color.panelHi, borderWidth: 1, borderColor: color.rule }
  if (kind === 'computer') {
    return (
      <View style={box}>
        <View style={{ ...skin, width: 74, height: 44, borderRadius: radius.sm }} />
        <View style={{ ...skin, width: 88, height: 5, borderRadius: 3, marginTop: 2 }} />
      </View>
    )
  }
  if (kind === 'phone') {
    return (
      <View style={box}>
        <View
          style={{
            ...skin,
            width: 34,
            height: 56,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 2
          }}
        >
          {[8, 14, 10, 16, 9].map((h, i) => (
            <View key={i} style={{ width: 2, height: h, borderRadius: 1, backgroundColor: color.signal }} />
          ))}
        </View>
      </View>
    )
  }
  /* The unit: a chassis, a lit display and a row of knobs. */
  return (
    <View style={box}>
      <View
        style={{
          ...skin,
          width: 92,
          height: 40,
          borderRadius: radius.sm,
          padding: 5,
          justifyContent: 'space-between'
        }}
      >
        <View
          style={{
            height: 16,
            borderRadius: 2,
            backgroundColor: color.chassis,
            borderWidth: 1,
            borderColor: color.signalWash
          }}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View
              key={i}
              style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.rule }}
            />
          ))}
        </View>
      </View>
    </View>
  )
}

/** One of the three boxes: a number, what it is, and a picture of it. */
const ChainBox = ({ n, title, body, kind }) => (
  <View
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      padding: space.lg,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.rule,
      backgroundColor: color.panel
    }}
  >
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1.5,
        borderColor: color.signal,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Text style={{ color: color.signal, fontSize: font.body, fontWeight: '700' }}>{n}</Text>
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: color.silk, fontSize: font.body, fontWeight: '700', letterSpacing: 0.6 }}>
        {title}
      </Text>
      <Text style={{ color: color.silkDim, fontSize: font.small }}>{body}</Text>
    </View>
    <Art kind={kind} />
  </View>
)

/**
 * The cable between two boxes: a lit line with its name on it.
 *
 * The label used to sit on its own between two cards and read as a heading for
 * the card under it. On the line it reads as what it is — the thing joining
 * the box above to the box below.
 */
const Wire = ({ label }) => (
  <View style={{ alignItems: 'center' }}>
    <View style={{ width: 2, height: 14, backgroundColor: color.signal }} />
    <View
      style={{
        paddingHorizontal: space.md,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: color.signal,
        backgroundColor: color.chassis
      }}
    >
      <Text style={{ color: color.signal, fontSize: font.micro, letterSpacing: 1.2 }}>{label}</Text>
    </View>
    <View style={{ width: 2, height: 14, backgroundColor: color.signal }} />
  </View>
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
