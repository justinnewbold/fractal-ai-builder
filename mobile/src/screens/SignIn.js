import { useEffect, useRef, useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { sendPasswordReset, signIn, signUp } from '../lib/relay'
import Note from '../components/Note'
import Press from '../components/Press'
import Connect from './Connect'
import { setDemo } from '../lib/demo'
import { usePurchase } from '../lib/purchases'
import { mayDrive } from '../lib/unlock-rule'
import { SETUP } from '../lib/onboarding'
import mailIcon from '../../assets/icons/mail.png'
import lockIcon from '../../assets/icons/lock.png'
import externalIcon from '../../assets/icons/external.png'

/**
 * One account, two ends.
 *
 * AND ONLY ONE WAY IN, WHICH IS THE CHANGE.
 *
 * "I want the QR code gone and the scanner gone. It has never worked once…
 * to use this app and connect it to your computer, you have to sign up.
 * That's the way we're doing it."
 *
 * There used to be a second route: the computer made an eight-character code
 * standing for a hidden account, the phone scanned it off a QR code or typed
 * it, and nobody made an account at all. It was the first thing this screen
 * offered. It is gone — camera, code box and all — because across every
 * attempt it never once worked end to end, and two routes meant two sets of
 * instructions, two failure modes and a different answer every time.
 *
 * What is left is the account. The demo is still free and still needs none;
 * the computer app is still free and still needs none. Joining a phone to a
 * computer is the one thing that does, and both ends sign into the same one.
 *
 * Nothing here mentions a channel, a relay, or the name of the account
 * service — that part has not changed.
 */
export default function SignIn({ onSignedIn, onDemo, onUnlock }) {
  const [mode_, setMode] = useState('in') // 'in' | 'up'
  /*
   * The instructions, from the one screen that needs them most.
   *
   * Somebody here has to get a computer running and signed into the same
   * account, and there was no way from this screen to find out which computer
   * or how. There is now.
   */
  /*
   * WHETHER AN ACCOUNT CAN BE MADE HERE AT ALL.
   *
   * "On the phones, only show the create account window after the phone has
   * been unlocked."
   *
   * An account exists to join this phone to a computer, and that is the paid
   * half. Offering to make one before the unlock is offering to set up the
   * thing they have not bought — and the account is no use on its own.
   *
   * `mayDrive` rather than `purchase.unlocked`, because it is the rule the
   * rest of the app already uses and it errs the right way: somebody the
   * store cannot be asked about is treated as unlocked, so a bad minute on a
   * hotel network does not hide the form from somebody who paid.
   */
  const purchase = usePurchase()
  const canMakeAccount = mayDrive(purchase)
  /* The store can answer late, so somebody can be on the Create Account form
     when the answer arrives and turns out to be no. Nothing snaps out from
     under them in that case — the form goes back to signing in, which is the
     only thing they can do anyway. */
  const mode = canMakeAccount ? mode_ : 'in'
  const [helping, setHelping] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)

  /*
   * UNLOCKED FROM THIS SCREEN, IT GOES STRAIGHT TO MAKING THE ACCOUNT.
   *
   * The unlock is the step before the account, so the moment it lands the
   * form turns into Create Account and says so, rather than leaving somebody
   * who has just paid looking at a sign-in form for an account they do not
   * have yet.
   */
  const couldMake = useRef(canMakeAccount)
  useEffect(() => {
    if (canMakeAccount && !couldMake.current) {
      setMode('up')
      setError(null)
      setNote('Unlocked. Now make your account — use the same one on your computer.')
    }
    couldMake.current = canMakeAccount
  }, [canMakeAccount])

  const ready = email.includes('@') && password.length >= 6

  const go = async () => {
    if (!ready) {
      setError(
        email.includes('@')
          ? 'Your password is at least 6 characters.'
          : 'Type your email address and password.'
      )
      return
    }
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      if (mode === 'up') {
        const { needsConfirmation } = await signUp({ email: email.trim(), password })
        if (needsConfirmation) {
          setNote('Account made. Confirm it from the email we just sent, then sign in.')
          setMode('in')
          return
        }
      } else {
        await signIn({ email: email.trim(), password })
      }
      onSignedIn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!email.includes('@')) {
      setError('Type your email address first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await sendPasswordReset(email.trim())
      setNote('Check your email for a link to set a new password.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const switchTo = (next) => {
    setMode(next)
    setError(null)
    setNote(null)
  }

  const fieldText = {
    flex: 1,
    minHeight: TAP,
    color: color.silk,
    fontSize: font.lead,
    paddingHorizontal: space.md
  }

  if (helping) return <Connect onBack={() => setHelping(false)} />

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        /*
         * NOT CENTRED ANY MORE, and that is the whole of the bug.
         *
         * "What is the button on the bottom that can't be seen and can't be
         * scrolled to??"
         *
         * `flexGrow: 1` with `justifyContent: 'center'` centres the content
         * inside a box the height of the screen. While the content is SHORTER
         * than the screen that is exactly what it is for, and this screen was
         * short once. It has grown: a title, a paragraph, two fields, four
         * buttons, a note. Once the content is TALLER than that box, centring
         * pushes the overflow out through BOTH ends — and a scroll view can
         * only scroll within its content size, so what hangs out the bottom
         * is not reachable by scrolling. It is drawn, and it cannot be got to.
         *
         * Starting at the top costs the short-screen case a little symmetry
         * and gives every screen back its last element. paddingBottom clears
         * the home indicator, which was the other thing in the way.
         */
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: space.xxl,
          gap: space.lg,
          flexGrow: 1
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/*
          HIS MOCKUP, TOP TO BOTTOM. "Redo this screen to match this photo in
          both the web app and the mobile apps." The mark, the name and the
          line under it; a card that says how the three pieces fit; the form
          with a picture in each field; Sign in, then Create account and
          Forgot password side by side; the way to the computer app, outlined
          in amber; and the demo last, quietest.

          The words are shared with the browser's version of this screen
          (shared/onboarding.mjs, SETUP), so the two cannot drift again.
        */}
        <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.lg }}>
          <Mark />
          <Text style={{ color: color.silk, fontSize: font.hero + 6, fontWeight: '800', textAlign: 'center' }}>
            Fractal Remote
          </Text>
          <Text style={{ color: color.silkDim, fontSize: font.lead, textAlign: 'center' }}>{SETUP.tagline}</Text>
        </View>

        <View
          style={{
            backgroundColor: color.panel,
            borderWidth: 1,
            borderColor: color.rule,
            borderRadius: radius.lg,
            padding: space.lg,
            gap: space.md
          }}
        >
          <Text style={{ color: color.silk, fontSize: font.title, fontWeight: '800' }}>{SETUP.title}</Text>
          {SETUP.steps.map((line, i) => (
            <View key={line} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: color.signal,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Text style={{ color: color.onSignal, fontSize: font.body, fontWeight: '800' }}>{i + 1}</Text>
              </View>
              <Text style={{ color: color.silk, fontSize: font.body + 1, lineHeight: 22, flexShrink: 1 }}>
                {line}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ gap: space.md }}>
          <Field icon={mailIcon}>
            <TextInput
              style={fieldText}
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={color.silkFaint}
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              inputMode="email"
              keyboardType="email-address"
              returnKeyType="next"
            />
          </Field>
          <Field icon={lockIcon}>
            <TextInput
              style={fieldText}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={color.silkFaint}
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={() => !busy && go()}
            />
          </Field>
        </View>

        {error ? <Note tone="fault">{error}</Note> : null}
        {note ? <Note>{note}</Note> : null}

        {/* Amber whether or not the fields are filled in, as drawn: a pale
            button reads as switched off, and the form says what is missing
            when it is pressed early. */}
        <Press
          label={busy ? 'Working…' : mode === 'up' ? 'Create account' : 'Sign in'}
          tone="signal"
          on
          disabled={busy}
          onPress={go}
        />

        {/*
          CREATE ACCOUNT FOR EVERYBODY, AS DRAWN — and still after the unlock.

          "On the phones, only show the create account window after the phone
          has been unlocked." The mockup shows the button to everybody, and
          both hold: before the unlock it opens the unlock, and the moment the
          unlock lands the form turns into Create account by itself (see
          couldMake above). The note and the separate Unlock button that stood
          here are gone into it.
        */}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Press
            grow
            label={mode === 'up' ? 'I already have one' : 'Create account'}
            disabled={busy}
            onPress={() =>
              mode === 'up' ? switchTo('in') : canMakeAccount ? switchTo('up') : onUnlock?.()
            }
          />
          {mode === 'in' ? (
            <Press grow label="Forgot password?" disabled={busy} onPress={reset} />
          ) : null}
        </View>

        {/* "Instead of saying connect my computer on the android app, have it
            say how to connect my computer." Outlined in amber, with the
            picture that says it opens something, as drawn. */}
        <Press
          label={SETUP.howTo}
          icon={externalIcon}
          disabled={busy}
          onPress={() => setHelping(true)}
          style={{ borderColor: color.signal }}
        />

        {/*
          The demo, offered here because here is where somebody with no
          computer is standing. It is a simulated unit — every screen works,
          nothing reaches hardware — and it is also the only way to tell this
          app being slow from the line to the computer being slow, because
          there is no line in it.

          THREE WORDS AND NO SUBTITLE. "Change just looking to just Try the
          Demo - no text underneath." It read "Just looking? Try the demo"
          over "A simulated FM3 — no computer needed", which asked a question
          nobody needed answering and then named one unit out of the five the
          demo can be.
        */}
        <Press
          label="Try the Demo"
          disabled={busy}
          onPress={() => {
            setDemo(true)
            onDemo?.()
          }}
        />

        {/*
          THE LINE THAT USED TO CLOSE THIS SCREEN IS GONE, AND IT WAS WRONG.

          "All changes made on the phone can be saved, and should be able to
          be saved to the unit. Remove this text."

          It read: "Saving to a slot, backups and firmware stay at the
          computer. Your computer refuses them from a distance, and it is
          right to." True when it was written — the computer did refuse a slot
          write from a handset, deliberately.

          It has not been true since the save flow was built. A phone asks
          the computer to write the slot, the computer does the writing, and
          the phone is told the moment it lands (see lib/saveViaComputer and
          components/SaveToSlot). So the sentence described a limit the app no
          longer has, on the first screen somebody reads.
        */}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/**
 * The mark over the name: five amber bars, tallest in the middle, as drawn.
 * Views rather than a picture, so it is sharp at every size and takes the
 * theme's amber in light mode too.
 */
function Mark() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 48 }}
    >
      {[14, 30, 46, 30, 14].map((h, i) => (
        <View key={i} style={{ width: 7, height: h, borderRadius: 4, backgroundColor: color.signal }} />
      ))}
    </View>
  )
}

/** A field with its picture on the left and a hairline between them, as drawn. */
function Field({ icon, children }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: TAP + 8,
        backgroundColor: color.panel,
        borderWidth: 1,
        borderColor: color.rule,
        borderRadius: radius.md
      }}
    >
      <Image source={icon} style={{ width: 22, height: 22, marginHorizontal: space.md, tintColor: color.silkDim }} />
      <View style={{ width: 1, alignSelf: 'stretch', marginVertical: space.sm, backgroundColor: color.rule }} />
      {children}
    </View>
  )
}
