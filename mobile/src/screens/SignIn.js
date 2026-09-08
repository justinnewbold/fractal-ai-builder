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
import { formatPairCode, isPairCode, pairCredentials } from '../lib/pairing'
import Note from '../components/Note'
import Press from '../components/Press'

/**
 * One account, two ends — and a way in that never mentions it.
 *
 * Nothing here mentions a channel, a relay, or the name of the account service.
 * The first thing offered is the code the Mac shows: type it and the phone is
 * the Mac's remote, with nobody making an account. Signing in is the second
 * thing, for a person who wants presets to follow them between devices — so
 * that is what it says.
 */
export default function SignIn({ onSignedIn }) {
  const [mode, setMode] = useState('code') // 'code' | 'in' | 'up'
  const [code, setCode] = useState('')
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
            throw new Error('No Mac is paired with that code. Check it against the code your Mac shows.')
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
            {mode === 'code'
              ? 'Type the code your Mac shows under Set up phone remote, and this phone becomes its remote — from anywhere, with no account.'
              : 'Sign in with the same account as the Mac your unit is plugged into. Your presets and what the AI has learned about your taste follow you to any device.'}
          </Text>
        </View>

        {mode === 'code' ? (
          <TextInput
            style={{ ...field, textAlign: 'center', letterSpacing: 2, fontVariant: ['tabular-nums'] }}
            value={code}
            onChangeText={(text) => setCode(formatPairCode(text))}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            placeholderTextColor={color.silkFaint}
            accessibilityLabel="The pairing code your Mac shows"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="one-time-code"
            maxLength={19}
            returnKeyType="go"
            onSubmitEditing={() => ready && !busy && go()}
          />
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
          label={busy ? 'Working…' : mode === 'up' ? 'Create account' : mode === 'in' ? 'Sign in' : 'Connect'}
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
                label={mode === 'up' ? 'I already have one' : 'Make an account'}
                disabled={busy}
                onPress={() => switchTo(mode === 'up' ? 'in' : 'up')}
              />
              {mode === 'in' ? (
                <Press grow label="Forgot password" disabled={busy} onPress={reset} />
              ) : null}
            </View>
            <Press label="Use the code from the Mac instead" disabled={busy} onPress={() => switchTo('code')} />
          </View>
        )}

        <Text style={{ color: color.silkFaint, fontSize: font.micro, lineHeight: 18 }}>
          Saving to a slot, backups and firmware stay at the Mac. Your Mac refuses them from a
          distance, and it is right to.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
