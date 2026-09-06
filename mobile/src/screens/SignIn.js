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

/**
 * One account, two ends.
 *
 * Nothing here mentions a channel, a relay, or the name of the account service.
 * What a player needs to know is that this is the same sign-in as the Mac, and
 * that being signed in as the same person is the whole of why the two ends find
 * each other — so that is what it says.
 */
export default function SignIn({ onSignedIn }) {
  const [mode, setMode] = useState('in') // 'in' | 'up'
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
            Sign in with the same account as the Mac your unit is plugged into, and this phone
            becomes its remote — from anywhere, not just the same wifi.
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
          label={busy ? 'Working…' : mode === 'up' ? 'Create account' : 'Sign in'}
          tone="signal"
          on={ready && !busy}
          disabled={!ready || busy}
          onPress={go}
        />

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Press
            grow
            label={mode === 'up' ? 'I already have one' : 'Make an account'}
            disabled={busy}
            onPress={() => {
              setMode(mode === 'up' ? 'in' : 'up')
              setError(null)
              setNote(null)
            }}
          />
          {mode === 'in' ? (
            <Press grow label="Forgot password" disabled={busy} onPress={reset} />
          ) : null}
        </View>

        <Text style={{ color: color.silkFaint, fontSize: font.micro, lineHeight: 18 }}>
          Saving to a slot, backups and firmware stay at the Mac. Your Mac refuses them from a
          distance, and it is right to.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
