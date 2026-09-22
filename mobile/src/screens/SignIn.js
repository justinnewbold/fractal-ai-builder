import { useState } from 'react'
import {
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
export default function SignIn({ onSignedIn, onDemo }) {
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

  const ready = email.includes('@') && password.length >= 6

  const go = async () => {
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

  const field = {
    minHeight: TAP,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: color.silk,
    fontSize: font.lead
  }

  if (helping) return <Connect onBack={() => setHelping(false)} />

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, flexGrow: 1, justifyContent: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space.xs }}>
          <Text style={{ color: color.silk, fontSize: font.hero, fontWeight: '700' }}>
            Fractal Remote
          </Text>
          <Text style={{ color: color.silkDim, fontSize: font.body, lineHeight: 22 }}>
            {/*
              ONE SENTENCE NOW, because there is one way in. It used to
              switch on whether the code box or the email box was showing.

              AND IT NO LONGER PROMISES TWO THINGS THAT ARE NOT TRUE.

              "Read the text. We don't have AI features in this app anymore."

              It said "your presets and what the AI has learned about your
              taste follow you to any device". The AI half is gone from the
              app. The other half was wrong on its own terms: presets live on
              the unit, not in an account. What an account actually carries
              between devices is the setlists you built and the presets you
              starred, so that is what it says. MY WORDING.
            */}
            Sign in with the same account as the computer your unit is plugged into. Your setlists
            and starred presets follow you to any device.
          </Text>
        </View>

        <View style={{ gap: space.md }}>
            <TextInput
              style={field}
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
            <TextInput
              style={field}
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
              onSubmitEditing={() => ready && !busy && go()}
            />
        </View>

        {error ? <Note tone="fault">{error}</Note> : null}
        {note ? <Note>{note}</Note> : null}

        <Press
          label={busy ? 'Working…' : mode === 'up' ? 'Create Account' : 'Sign in'}
          tone="signal"
          on={ready && !busy}
          disabled={!ready || busy}
          onPress={go}
        />

        {/* Create Account and Sign in are the same form with one button
            swapped, which is why they are one screen and not two. The third
            button that used to sit under these — "Use the code from the
            computer instead" — is gone with the codes. */}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {canMakeAccount ? (
            <Press
              grow
              label={mode === 'up' ? 'I already have one' : 'Create Account'}
              disabled={busy}
              onPress={() => switchTo(mode === 'up' ? 'in' : 'up')}
            />
          ) : null}
          {mode === 'in' ? (
            <Press grow label="Forgot password" disabled={busy} onPress={reset} />
          ) : null}
        </View>
        {/* Said rather than left to be guessed at: a sign-in form with no way
            to sign up looks broken to somebody who has never made one. */}
        {canMakeAccount ? null : (
          <Note>
            An account is what joins this phone to your computer. Unlock the app first and you can
            make one here — the demo needs no account at all.
          </Note>
        )}

        <Press label="How do I connect a computer?" disabled={busy} onPress={() => setHelping(true)} />

        {/*
          The demo, offered here because here is where somebody with no
          computer is standing. It is a simulated FM3 — every screen works,
          nothing reaches hardware — and it is also the only way to tell this
          app being slow from the line to the computer being slow, because
          there is no line in it.
        */}
        <Press
          label="Just looking? Try the demo"
          sub="A simulated FM3 — no computer needed"
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
