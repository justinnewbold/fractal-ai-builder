import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { BlurView } from 'expo-blur'

import { color, font, radius, space, TAP } from '../lib/theme'
import Note from './Note'
import Press from './Press'

/** The shortest password the account service accepts. */
export const PASSWORD_MIN = 6

/**
 * A new password, typed high on the screen.
 *
 * "For the password change section, change it to where the box isn't just
 * showing New password." It sat open on the Setup page, under the account
 * line, for everyone who came to change the tile size — a password box with
 * nothing asked. Now it is asked for, from the account line, and comes up
 * over the screen the way the tempo box does: in the upper part, where the
 * keyboard cannot reach it, with the field focused and the keyboard already
 * up. Twice, because a password nobody can see is a password worth typing
 * twice; the two have to match before Change lights up.
 */
export default function PasswordBox({ open, onChange, onClose }) {
  const [first, setFirst] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { height } = useWindowDimensions()
  const field = useRef(null)
  const second = useRef(null)

  useEffect(() => {
    if (!open) return
    setFirst('')
    setAgain('')
    setBusy(false)
    setError(null)
  }, [open])

  const ready = first.length >= PASSWORD_MIN && first === again && !busy

  const commit = async () => {
    if (first.length < PASSWORD_MIN) {
      setError(`At least ${PASSWORD_MIN} characters.`)
      return
    }
    if (first !== again) {
      setError('The two do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onChange(first)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const box = (bad) => ({
    minHeight: TAP,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: bad ? color.fault : color.live,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: color.silk,
    fontSize: font.lead
  })

  return (
    <Modal visible={!!open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }}>
        <BlurView
          intensity={70}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={{
            flex: 1,
            alignItems: 'center',
            /* High, so the keyboard cannot reach it. See components/TempoBox. */
            paddingTop: Math.max(space.xxl, height * 0.1),
            paddingHorizontal: space.xl
          }}
        >
          <Pressable
            onPress={() => field.current?.focus()}
            style={{
              width: '100%',
              maxWidth: 420,
              gap: space.md,
              padding: space.lg,
              borderRadius: radius.lg * 2,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
              backgroundColor: 'rgba(255,255,255,0.04)'
            }}
          >
            <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.5 }}>NEW PASSWORD</Text>

            <TextInput
              ref={field}
              autoFocus
              value={first}
              onChangeText={(t) => {
                setFirst(t)
                setError(null)
              }}
              placeholder={`At least ${PASSWORD_MIN} characters`}
              placeholderTextColor={color.silkFaint}
              accessibilityLabel="New password"
              autoCapitalize="none"
              autoComplete="new-password"
              secureTextEntry
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => second.current?.focus()}
              style={box(false)}
            />
            <TextInput
              ref={second}
              value={again}
              onChangeText={(t) => {
                setAgain(t)
                setError(null)
              }}
              placeholder="The same again"
              placeholderTextColor={color.silkFaint}
              accessibilityLabel="New password, again"
              autoCapitalize="none"
              autoComplete="new-password"
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={commit}
              style={box(again.length > 0 && again !== first)}
            />

            {error ? <Note tone="fault">{error}</Note> : null}

            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Press grow label="Cancel" onPress={onClose} />
              <Press grow label={busy ? 'Changing…' : 'Change'} tone="signal" on disabled={!ready} onPress={commit} />
            </View>
          </Pressable>
        </BlurView>
      </Pressable>
    </Modal>
  )
}
