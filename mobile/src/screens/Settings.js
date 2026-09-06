import { useEffect, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import {
  changePassword,
  currentAccount,
  hostConflict,
  pickHost,
  remoteChosenHost,
  remoteHosts
} from '../lib/relay'
import { useRig } from '../lib/rig'
import Lamp from '../components/Lamp'
import Note from '../components/Note'
import Press from '../components/Press'

const ofDeviceName = (s) => s.deviceName

/**
 * Everything that isn't playing.
 *
 * Folded off the stage screen on purpose: which Mac, which account, and a new
 * password are all things done about once, and none of them should be within
 * reach of a thumb that is looking for the next scene.
 */
export default function Settings({ link, macName, onBack, onReconnect, onSignOut }) {
  const deviceName = useRig(ofDeviceName)
  const [account, setAccount] = useState(null)
  const [hosts, setHosts] = useState(remoteHosts())
  const [chosen, setChosen] = useState(remoteChosenHost())
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    currentAccount().then((a) => alive && setAccount(a))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    setHosts(remoteHosts())
    setChosen(remoteChosenHost())
  }, [link])

  const conflict = hostConflict(hosts, chosen)
  const lamp = link === 'connected' ? 'live' : link === 'no-answer' ? 'fault' : 'idle'

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
          Setup
        </Text>
        <Press label="Done" height={40} onPress={onBack} />
      </View>

      {/* ------------------------------------------------------------ link */}
      <View style={{ gap: space.md }}>
        <Section>The link</Section>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Lamp state={lamp} />
          <Text style={{ color: color.silk, fontSize: font.body, flex: 1 }}>
            {link === 'connected'
              ? `Connected to ${macName || 'your Mac'}${deviceName ? ` — ${deviceName}` : ''}`
              : link === 'joining'
                ? 'Finding your Mac.'
                : link === 'no-answer'
                  ? 'Your Mac isn’t answering.'
                  : 'Not connected.'}
          </Text>
        </View>

        {link === 'no-answer' ? (
          <Note tone="warn">
            Open the Fractal app on the Mac and make sure the Mac is awake. This keeps trying on its
            own.
          </Note>
        ) : null}

        <Press label="Try now" onPress={onReconnect} />
      </View>

      {/* ----------------------------------------------------------- which */}
      {hosts.length > 1 ? (
        <View style={{ gap: space.md }}>
          <Section>Which Mac</Section>
          {conflict ? <Note tone="fault">{conflict}</Note> : null}
          {hosts.map((name, i) => (
            <Press
              key={`${name}-${i}`}
              label={name}
              tone="live"
              on={name === chosen}
              onPress={async () => {
                await pickHost(name)
                setChosen(remoteChosenHost())
              }}
            />
          ))}
        </View>
      ) : null}

      {/* --------------------------------------------------------- account */}
      <View style={{ gap: space.md }}>
        <Section>Account</Section>
        <Text style={{ color: color.silkDim, fontSize: font.small }}>
          {account?.email ? `Signed in as ${account.email}.` : 'Signed in.'}
        </Text>

        <TextInput
          style={{
            minHeight: TAP,
            backgroundColor: color.panel,
            borderWidth: 1,
            borderColor: color.rule,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            color: color.silk,
            fontSize: font.lead
          }}
          value={password}
          onChangeText={setPassword}
          placeholder="New password"
          placeholderTextColor={color.silkFaint}
          accessibilityLabel="New password"
          autoCapitalize="none"
          autoComplete="new-password"
          secureTextEntry
        />
        <Press
          label={busy ? 'Changing…' : 'Change password'}
          disabled={busy || password.length < 6}
          onPress={async () => {
            setBusy(true)
            setError(null)
            setNote(null)
            try {
              await changePassword(password)
              setPassword('')
              setNote('Password changed.')
            } catch (err) {
              setError(err.message)
            } finally {
              setBusy(false)
            }
          }}
        />

        {note ? <Note>{note}</Note> : null}
        {error ? <Note tone="fault">{error}</Note> : null}

        <Press label="Sign out on this phone" onPress={onSignOut} />
        <Text style={{ color: color.silkFaint, fontSize: font.micro, lineHeight: 18 }}>
          The Mac stays signed in — signing out here must not drop the link mid-set.
        </Text>
      </View>

      {/* ------------------------------------------------------- the rules */}
      <View style={{ gap: space.md }}>
        <Section>What stays at the Mac</Section>
        <Note>
          Saving to a slot, backups, restores, firmware and raw SysEx are refused from a distance —
          by your Mac, not by this app. A phone on a dark stage should not be able to overwrite a
          preset you spent a week on.
        </Note>
      </View>
    </ScrollView>
  )
}

function Section({ children }) {
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: color.silkFaint,
        fontSize: font.micro,
        letterSpacing: 1.5,
        textTransform: 'uppercase'
      }}
    >
      {children}
    </Text>
  )
}
