import { useState } from 'react'
import { Dimensions, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native'

import { CHAIN, P1, P2, P3, P4, P6, P7, P9, CLOSE } from '../lib/onboarding'
import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { Platform } from 'react-native'
import { UNITS } from '../lib/demoUnits'
import { setDemo, setDemoUnit } from '../lib/demo'
import { tick } from '../lib/feedback'
/* An ES import rather than require(): Metro resolves both, but require is not
   a name this app has anywhere, and a test is right to refuse it. */
import unitFm3 from '../../assets/unit-fm3.png'
import pieceUnit from '../../assets/piece-unit.png'
import pieceComputer from '../../assets/piece-computer.png'
import piecePhone from '../../assets/piece-phone.png'
/* The first screen's pictures: his FM3 photograph, sent for it, and the five
   tile pictures cut out of his mockup of the screen, white so they take the
   theme's colour. The browser draws the same files. */
import welcomeFm3 from '../../assets/welcome/fm3.jpg'
import featurePresets from '../../assets/welcome/presets.png'
import featureScenes from '../../assets/welcome/scenes.png'
import featureBlocks from '../../assets/welcome/blocks.png'
import featureTuner from '../../assets/welcome/tuner.png'
import featureTempo from '../../assets/welcome/tempo.png'
import { WELCOME_NOTICE } from '../lib/affiliation'
import { at as tint } from '../lib/vivid'
import { restorePurchase } from '../lib/purchases'
import { sendDownloadLink, DOWNLOADS_URL } from '../lib/downloadLink'
import CopyAddress from '../components/CopyAddress'
import Note from '../components/Note'
import Press from '../components/Press'
import { TipCard } from '../components/Walk'
import playIcon from '../../assets/icons/play.png'
import slidersIcon from '../../assets/icons/sliders.png'
import saveIcon from '../../assets/icons/save.png'
import arrowIcon from '../../assets/icons/arrow.png'
import gearIcon from '../../assets/icons/setup.png'
import chevronIcon from '../../assets/icons/chevron.png'

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

export default function Onboarding({ onEnterDemo, onSettings, onAccount, onUnlock, replay, onClose }) {
  const [at, setAt] = useState('welcome')
  const [unit, setUnit] = useState(UNITS[0].key)
  /* The box under Connect my real rig. Unlock stays grey until it is ticked. */
  const [agreed, setAgreed] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState(null)
  const [error, setError] = useState(null)
  /* Whether the download help on the "installed?" step is open — see there. */
  const [needsApp, setNeedsApp] = useState(false)

  const unitName = UNITS.find((u) => u.key === unit)?.name || UNITS[0].name

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

      {/*
        THE FIRST SCREEN, FROM HIS MOCKUP, as the browser's is. "The changes we
        made with the walk-through screen on the web, we need to make those
        exact same changes using the same screen mockups that I sent you for
        the mobile versions as well." His FM3 in a card, the heading and the
        line under it centred, the five tiles, the two ways in, his
        disclaimer, and the contour lines down both edges.
      */}
      {at === 'welcome' ? (
        <View style={{ gap: space.md }}>
          <Contours />
          <View
            style={{
              alignItems: 'center',
              padding: space.sm,
              borderRadius: radius.lg * 1.4,
              borderWidth: 1,
              borderColor: color.rule,
              /* His photograph's own off-white, so its edges vanish into the
                 card in either theme. */
              backgroundColor: '#f7f6f3'
            }}
          >
            <Image
              source={welcomeFm3}
              style={{ width: '100%', height: Math.round(Dimensions.get('window').height * 0.24) }}
              resizeMode="contain"
              accessibilityLabel="A Fractal Audio FM3"
            />
          </View>
          <Text
            accessibilityRole="header"
            style={{
              color: color.silk,
              fontSize: font.hero,
              lineHeight: Math.round(font.hero * 1.08),
              fontWeight: '800',
              textAlign: 'center',
              marginTop: space.xs
            }}
          >
            {P1.head}
          </Text>
          <Text style={{ color: color.silkDim, fontSize: font.lead, lineHeight: font.lead * 1.35, textAlign: 'center' }}>
            {P1.sub}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm, marginVertical: space.xs }}>
            {P1.features.map((label) => (
              <View key={label} style={{ flex: 1, alignItems: 'center', gap: space.xs }}>
                <View
                  style={{
                    width: '100%',
                    aspectRatio: 1,
                    borderRadius: radius.md,
                    backgroundColor: tint(color.signal, 0.1),
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Image
                    source={FEATURE_PICTURES[label]}
                    style={{ width: 30, height: 30, tintColor: color.signal }}
                    resizeMode="contain"
                    accessible={false}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  /* A size under micro, so TAP TEMPO fits a tile on the
                     narrowest phone without leaning on the shrink-to-fit
                     that not every platform does. */
                  style={{ color: color.silkDim, fontSize: font.micro - 1, letterSpacing: 0.3 }}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>
          {/* Get started with its arrow at the far end, as drawn. */}
          <View>
            <Press label={P1.go} tone="signal" on height={TAP} onPress={() => go('how')} style={{ borderRadius: radius.lg * 1.4 }} />
            <View
              pointerEvents="none"
              style={{ position: 'absolute', right: space.lg, top: 0, bottom: 0, justifyContent: 'center' }}
            >
              <Text style={{ color: color.onSignal, fontSize: font.lead, fontWeight: '700' }}>→</Text>
            </View>
          </View>
          {/* Was "I already have a pairing code", which opened the scanner.
              Somebody who has been here before has an ACCOUNT now, and that
              is the one door. */}
          <Press label={P1.haveCode} height={TAP} onPress={() => onAccount?.()} style={{ borderRadius: radius.lg * 1.4 }} />
          <Text style={{ color: color.silkFaint, fontSize: font.micro, lineHeight: font.micro * 1.45, textAlign: 'center', marginTop: space.xs }}>
            {WELCOME_NOTICE}
          </Text>
        </View>
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
          <Steps at={0} of={3} label={P2.count} />
          <Head>{P2.head}</Head>
          <View style={{ gap: 0 }}>
            {CHAIN.map((box, i) => (
              <View key={box.key}>
                <ChainBox n={i + 1} title={box.phoneTitle} body={box.phoneBody} kind={box.key} />
                {box.phoneWire ? <Wire label={box.phoneWire} /> : null}
              </View>
            ))}
          </View>
          <Note>{P2.foot}</Note>
          <Cta label={P2.go} onPress={() => go('mode')} />
        </>
      ) : null}

      {at === 'mode' ? (
        <>
          <Steps at={1} of={3} label={P3.count} />
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
            <Cta label={P3.demo.go} onPress={() => go('pick')} />
          </Choice>

          <Choice
            eyebrow={P3.real.eyebrow}
            title={P3.real.title}
            body={P3.real.body}
            art={<Lock size={58} faint />}
          >
            {/*
                IT OPENS THE PAYWALL. It used to open the computer-app step.

                The reasoning at the time was that this button takes no money
                and the store's own sheet quotes the price, so the walkthrough
                should go on explaining the arrangement and let the purchase
                happen later. That is defensible and it is not what the screen
                says: a button reading Unlock, under a lock, under "Unlock
                live control for your Fractal hardware", promises a purchase.

                What actually happened when Justin pressed it: "the unlock
                button and the two buttons at the bottom where it says sign in
                and the button where it says restore purchase, all take you to
                the other screen" — the sign-in form, three times over, from
                three buttons that say three different things.

                No price on the button itself. The store quotes it in its own
                sheet a moment later, and a price here would be this app's
                guess at one.

                His mockup puts a small lock in the button too. Press has no
                icon slot and widening a component used on every screen for
                one glyph is the wrong trade — the card's own lock, above
                right, already says it.
            */}
            <Agree on={agreed} label={P3.real.agree} onPress={() => setAgreed((v) => !v)} />
            <Press label={P3.real.go} height={TAP} disabled={!agreed} onPress={() => agreed && onUnlock?.()} />
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
          <Steps at={1} of={3} label={P3.count} />
          <Eyebrow>{P4.eyebrow}</Eyebrow>
          <Head>{P4.head}</Head>
          <Sub>{P4.sub}</Sub>
          {/* Two to a row, big enough to read from arm's length, the lit one
              amber-edged like the tiles on the last screen. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {UNITS.map((u) => (
              <UnitTile key={u.key} name={u.name} on={u.key === unit} onPress={() => setUnit(u.key)} />
            ))}
          </View>
          {/* Named by whichever is lit, so the button says what pressing it
              gets you rather than "continue". */}
          <Cta label={P4.go(unitName)} onPress={intoDemo} />
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
          <Steps at={1} of={3} label={P3.count} />
          <Head>{P6.head}</Head>
          {/*
            The one way on from here. An account is the only thing that joins
            a phone to a computer, so the button goes to sign-in — and the
            label says so, where it used to promise a scanner that no longer
            exists.
          */}
          <Cta label={P6.yes} onPress={() => onAccount?.()} />
          {/*
            HIDDEN UNTIL ASKED FOR. "Hide information on how to download the
            computer app until they click no." Somebody who already has it
            installed sees two buttons and nothing to read; the address and
            the email box open under No, and No shows it is open.
          */}
          <Press label={P6.no} on={needsApp} height={TAP} onPress={() => setNeedsApp((open) => !open)} />
          {needsApp ? (
            <>
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
              <CopyAddress />
              <Text style={{ color: color.silk, fontSize: font.body, fontWeight: '700' }}>{P6.emailLabel}</Text>
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
              {said ? <Note strong size={font.body}>{said}</Note> : null}
              {error ? <Note tone="fault">{error}</Note> : null}
            </>
          ) : null}
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
          {/*
            HIS "HERE'S THE APP" MOCKUP, which every other page now copies.

            The unit's name and "simulated" came off the top: the mockup
            puts the one sentence that matters there instead — this app
            needs a computer with the unit on its USB. The demo's words,
            because the demo is the only way here now.

            Each card goes into the app, the same as the button; the row at
            the foot goes in and straight to Settings, where the walkthrough
            can be shown again.
          */}
          <Steps at={2} of={3} label={P9.count} />
          <Head>{P9.demo.head}</Head>
          <Sub>{P9.demo.sub}</Sub>
          {P9.tips.map((tip) => (
            <TipCard key={tip.key} icon={TIP_ICONS[tip.key]} label={tip.label} body={tip.body} onPress={onEnterDemo} />
          ))}
          <Cta label={P9.go} onPress={onEnterDemo} />
          <FootRow text={P9.foot} onPress={onSettings || onEnterDemo} />
        </>
      ) : null}
    </ScrollView>
  )
}

/* The five tiles' pictures, by the label under each. */
const FEATURE_PICTURES = {
  PRESETS: featurePresets,
  SCENES: featureScenes,
  BLOCKS: featureBlocks,
  TUNER: featureTuner,
  'TAP TEMPO': featureTempo
}

/*
 * The faint contour lines down both edges of his mockup: rings centred off
 * each side of the screen, drawn as bordered circles so they need nothing
 * native. Behind everything, and never in the way of a tap.
 */
function Contours() {
  const { width } = Dimensions.get('window')
  const line = tint(color.silk, 0.07)
  /* Centred well off each side and only as large as reaches the outer third,
     so they stay at the edges the way the browser fades them there. */
  const RINGS = Array.from({ length: 8 }, (_, i) => width * 0.78 + i * 20)
  const ring = (cx, cy, r, key) => (
    <View
      key={key}
      style={{
        position: 'absolute',
        left: cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        borderWidth: 1,
        borderColor: line
      }}
    />
  )
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: -space.lg, left: -space.lg, width, height: 1400, overflow: 'hidden' }}
    >
      {RINGS.map((r, i) => ring(-width * 0.6, 420, r, `l${i}`))}
      {RINGS.map((r, i) => ring(width * 1.6 - space.lg, 300, r, `r${i}`))}
    </View>
  )
}

/*
 * THE LOOK OF EVERY PAGE, FROM HIS "HERE'S THE APP" MOCKUP.
 *
 * "Update this screen across all platforms to look like this. And actually,
 * if you could go through all pages of any tutorials and onboarding type
 * stuff so that we can make them all look more robust like this." So these
 * few pieces are the whole of it, and every page is built from them: the
 * step dots, a big heading with a quiet line under it, cards with an amber
 * picture tile, one amber button with its arrow, and the settings row at the
 * foot. The browser's walkthrough and the computer's are drawn the same.
 */
const Head = ({ children }) => (
  <Text
    accessibilityRole="header"
    style={{ color: color.silk, fontSize: font.hero, fontWeight: '800', lineHeight: font.hero * 1.15 }}
  >
    {children}
  </Text>
)

const Sub = ({ children }) => (
  <Text style={{ color: color.silkDim, fontSize: font.lead, lineHeight: font.lead * 1.4 }}>{children}</Text>
)

/** Dots joined by lines, the reached ones amber, and "2 of 3" under them. */
const Steps = ({ at, of, label }) => (
  <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.sm }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {Array.from({ length: of }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
          {i ? <View style={{ width: 56, height: 1, backgroundColor: i <= at ? color.signal : color.rule }} /> : null}
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              marginHorizontal: space.sm,
              backgroundColor: i <= at ? color.signal : color.rule
            }}
          />
        </View>
      ))}
    </View>
    <Text style={{ color: color.silkDim, fontSize: font.small }}>{label || `${Math.min(at, of - 1) + 1} of ${of}`}</Text>
  </View>
)

/** The one amber button: the words on the left, the arrow at the far end. */
const Cta = ({ label, onPress, disabled }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    disabled={disabled}
    onPress={() => {
      tick()
      onPress?.()
    }}
    style={({ pressed }) => ({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: TAP + 16,
      paddingHorizontal: space.xl,
      borderRadius: radius.lg,
      backgroundColor: color.signal,
      opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      shadowColor: color.signal,
      shadowOpacity: 0.35,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6
    })}
  >
    <Text style={{ color: color.onSignal, fontSize: font.title - 2, fontWeight: '800' }}>{label}</Text>
    <Image source={arrowIcon} style={{ width: 26, height: 26, tintColor: color.onSignal }} />
  </Pressable>
)

/** The foot: a hairline, then the gear, a quiet line, and a chevron. */
const FootRow = ({ text, onPress }) => (
  <View style={{ gap: space.lg, marginTop: space.sm }}>
    <View style={{ height: 1, backgroundColor: color.rule }} />
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm }}
    >
      <Image source={gearIcon} style={{ width: 26, height: 26, tintColor: color.silkDim }} />
      <Text style={{ flex: 1, color: color.silkDim, fontSize: font.body }}>{text}</Text>
      {onPress ? <Image source={chevronIcon} style={{ width: 14, height: 14, tintColor: color.silkDim }} /> : null}
    </Pressable>
  </View>
)

const TIP_ICONS = { play: playIcon, edit: slidersIcon, save: saveIcon }

/** One of the units to simulate: a big card, the lit one amber-edged. */
const UnitTile = ({ name, on, onPress }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected: !!on }}
    onPress={() => {
      tick()
      onPress?.()
    }}
    style={({ pressed }) => ({
      width: '47%',
      flexGrow: 1,
      minHeight: TAP + 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.lg,
      borderWidth: on ? 2 : 1,
      borderColor: on ? color.signal : color.rule,
      backgroundColor: on ? tint(color.signal, 0.14) : pressed ? color.panelHi : color.panel
    })}
  >
    <Text style={{ color: on ? color.signal : color.silk, fontSize: font.lead, fontWeight: '800' }}>{name}</Text>
  </Pressable>
)

const Eyebrow = ({ children }) => (
  <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.5 }}>
    {children}
  </Text>
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
/**
 * THE THREE PIECES, PHOTOGRAPHED RATHER THAN DRAWN.
 *
 * "Crop the laptop and phone artwork from the second mockup to replace the
 * shapes I drew."
 *
 * They were three little assemblies of Views — a rounded rectangle with a
 * lid for the laptop, a rectangle with five amber bars for the phone, a
 * chassis with a display and five dots for the unit. Honest placeholders, and
 * they read as diagrams of the things rather than the things.
 *
 * What is here instead is cut straight out of his own mockup of this screen,
 * the same way the play screen's icons were. The edges are feathered to
 * transparent so each one sits on its card rather than on a rectangle of
 * somebody else's background.
 *
 * Kept as `Art` with the same `kind` so the three boxes below did not have to
 * learn anything new, and at the same 92×56 box so nothing above or below
 * moves.
 */
const PIECES = { unit: pieceUnit, computer: pieceComputer, phone: piecePhone }

const Art = ({ kind }) => (
  <Image
    source={PIECES[kind] || PIECES.unit}
    accessible={false}
    resizeMode="contain"
    style={{ width: 92, height: 56 }}
  />
)

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
        backgroundColor: color.signal,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Text style={{ color: color.onSignal, fontSize: font.body, fontWeight: '800' }}>{n}</Text>
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

/**
 * The tick box Unlock waits on: a square that fills when it is on, and the
 * sentence beside it pressable too, since that is the bigger target. The
 * checkbox role, so a screen reader says "checked" rather than "selected".
 */
function Agree({ on, label, onPress }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!on }}
      accessibilityLabel={label}
      onPress={() => {
        tick()
        onPress?.()
      }}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.xs }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.sm,
          borderWidth: on ? 0 : 1,
          borderColor: color.silkFaint,
          backgroundColor: on ? color.signal : color.panel,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {on ? <Text style={{ color: color.onSignal, fontSize: font.body, fontWeight: '700' }}>✓</Text> : null}
      </View>
      <Text style={{ flex: 1, color: color.silk, fontSize: font.small, lineHeight: font.small * 1.5 }}>{label}</Text>
    </Pressable>
  )
}
