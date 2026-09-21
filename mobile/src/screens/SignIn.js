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
import { formatPairCode, isPairCode, pairCredentials, PAIR_LENGTH, PAIR_LENGTHS } from '../lib/pairing'
import ScanCode from '../components/ScanCode'
import Note from '../components/Note'
import Press from '../components/Press'
import Connect from './Connect'
import { setDemo } from '../lib/demo'

/**
 * One account, two ends — and a way in that never mentions it.
 *
 * Nothing here mentions a channel, a relay, or the name of the account service.
 * The first thing offered is the code the Mac shows: type it and the phone is
 * the Mac's remote, with nobody making an account. Signing in is the second
 * thing, for a person who wants presets to follow them between devices — so
 * that is what it says.
 */
export default function SignIn({ onSignedIn, onDemo }) {
  const [mode, setMode] = useState('code') // 'code' | 'in' | 'up'
  /*
   * The instructions, from the one screen that needs them most.
   *
   * This screen asks for "the code your computer shows" — which is a fine
   * sentence for somebody who has the app open on a computer two feet away, and
   * a dead end for everybody else. There was no way from here to find out which
   * computer, or how to make one show a code at all.
   */
  const [helping, setHelping] = useState(false)
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)

  const ready = mode === 'code' ? isPairCode(code) : email.includes('@') && password.length >= 6

  const go = async () => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      if (mode === 'code') {
        try {
          await signIn(pairCredentials(code))
        } catch (err) {
          // No such account is a mistyped code, or a Mac paired again since.
          if (/didn’t match|invalid login/i.test(err.message || '')) {
            throw new Error('No computer is paired with that code. Check it against the code your computer shows.')
          }
          throw err
        }
      } else if (mode === 'up') {
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
      {/*
        A scanned code is typed code: it lands in the same box, formatted the
        same way, and Connect does the same thing with it. So a scan that read
        the wrong square is still something you can see and correct, rather
        than a sign-in that happens to you.
      */}
      <ScanCode
        open={scanning}
        onClose={() => setScanning(false)}
        onCode={(c) => setCode(formatPairCode(c))}
        /* Somebody who aimed at a computer with an account lands on the form
           that joins it, rather than being told to go and find one. */
        onAccount={() => {
          setScanning(false)
          switchTo('in')
        }}
      />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, flexGrow: 1, justifyContent: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space.xs }}>
          <Text style={{ color: color.silk, fontSize: font.hero, fontWeight: '700' }}>
            Fractal Remote
          </Text>
          <Text style={{ color: color.silkDim, fontSize: font.body, lineHeight: 22 }}>
            {mode === 'code'
              ? 'Scan the square your computer shows under Set up phone remote — or type the code under it — and this phone becomes its remote, from anywhere, with no account.'
              : 'Sign in with the same account as the computer your unit is plugged into. Your presets and what the AI has learned about your taste follow you to any device.'}
          </Text>
        </View>

        {mode === 'code' ? (
          <View style={{ gap: space.md }}>
            {/*
              The camera first, because it is the one that always works: the
              code is 8 characters of a deliberately unambiguous alphabet, and
              reading it off a screen across the room and typing it is still
              the part people get wrong.
            */}
            <Press label="Scan a code" tone="signal" disabled={busy} onPress={() => setScanning(true)} />
            <TextInput
            style={{ ...field, textAlign: 'center', letterSpacing: 2, fontVariant: ['tabular-nums'] }}
            value={code}
            onChangeText={(text) => setCode(formatPairCode(text))}
            placeholder={formatPairCode('X'.repeat(PAIR_LENGTH))}
            placeholderTextColor={color.silkFaint}
            accessibilityLabel="The pairing code your computer shows"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="one-time-code"
            /* Room for the longest code still accepted, dashes and all, so a
               phone paired before codes got shorter can still be re-typed. */
            maxLength={Math.max(...PAIR_LENGTHS) + Math.ceil(Math.max(...PAIR_LENGTHS) / 4) - 1}
            returnKeyType="go"
            onSubmitEditing={() => ready && !busy && go()}
            />
          </View>
        ) : (
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
        )}

        {error ? <Note tone="fault">{error}</Note> : null}
        {note ? <Note>{note}</Note> : null}

        <Press
          label={busy ? 'Working…' : mode === 'up' ? 'Create Account' : mode === 'in' ? 'Sign in' : 'Connect'}
          tone="signal"
          on={ready && !busy}
          disabled={!ready || busy}
          onPress={go}
        />

        {mode === 'code' ? (
          <Press label="Sign in with an account instead" disabled={busy} onPress={() => switchTo('in')} />
        ) : (
          <View style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Press
                grow
                label={mode === 'up' ? 'I already have one' : 'Create Account'}
                disabled={busy}
                onPress={() => switchTo(mode === 'up' ? 'in' : 'up')}
              />
              {mode === 'in' ? (
                <Press grow label="Forgot password" disabled={busy} onPress={reset} />
              ) : null}
            </View>
            <Press label="Use the code from the computer instead" disabled={busy} onPress={() => switchTo('code')} />
          </View>
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

        <Text style={{ color: color.silkFaint, fontSize: font.micro, lineHeight: 18 }}>
          Saving to a slot, backups and firmware stay at the computer. Your computer refuses them from a
          distance, and it is right to.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
