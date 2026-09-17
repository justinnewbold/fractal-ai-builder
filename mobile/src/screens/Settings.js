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
import { refreshPreset, refreshScene, useRig } from '../lib/rig'
import { sceneShape, setPresetName, setSceneName } from '../lib/device'
import { SIZES, loadSize, saveSize } from '../lib/gigSize'
import { sync, useStored } from '../lib/store'
import { savePlayMode } from '../lib/playMode'
import { AI } from '../lib/features'
import { isPairAccount } from '../lib/pairing'
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
/* The sections below that write to the unit are the ones the browser keeps
   under "Unit" in its own Setup: renaming is bench work, not something a thumb
   crosses between songs, which is exactly why neither app puts it on Play. */
export default function Settings({
  link,
  macName,
  playing,
  onPlayMode,
  onBack,
  onReconnect,
  onSignOut,
  onOpenGear
}) {
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

      {/* ------------------------------------------------------------ unit */}
      {/*
        Renaming, and how big the stage tiles are.

        "Would also like to be able to rename presets and scenes in the app
        directly without having to ask the chat." Both of those changed the
        unit's edit buffer only — the same as everything else this app writes —
        so they are permanent once the preset is saved to a slot, which happens
        at the Mac.
      */}
      {link === 'connected' ? <UnitBits /> : null}

      <View style={{ gap: space.md }}>
        <Section>Stage tiles</Section>
        <TileSize />
      </View>

      {onOpenGear ? (
        <View style={{ gap: space.md }}>
          <Section>Amp and pedal names</Section>
          <Press
            label="What your models really are"
            sub="Brit 800 2204 is a Marshall JCM800"
            onPress={onOpenGear}
          />
        </View>
      ) : null}

      {/* --------------------------------------------------------- playing */}
      {/*
        Gone with the AI, because hiding the ✦ Tone button is the only thing
        this switch has ever done and there is no such button in this build.
        A switch that takes away something already absent is a switch that
        reports success and changes nothing. See lib/features.js.
      */}
      {AI ? (
      <View style={{ gap: space.md }}>
        <Section>Playing</Section>
        {/*
          First, above the link panels, because it is the one thing in here
          somebody reaches for in a hurry with the lights down. The rest of this
          screen is read once, when something is wrong.
        */}
        <Press
          label={playing ? 'Play mode is on' : 'Play mode is off'}
          sub={playing ? 'The Tone button is hidden' : 'The Tone button is on the stage screen'}
          on={!!playing}
          tone="signal"
          disabled={playing === null}
          onPress={() => {
            const next = !playing
            onPlayMode?.(next)
            savePlayMode(next)
          }}
        />
        <Note>
          Play mode takes the ✦ Tone button off the stage screen, so nothing there can start
          building a sound. Everything else works the same. This phone remembers it.
        </Note>
      </View>
      ) : null}

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
          {isPairAccount(account?.email)
            ? 'Paired with your Mac, no account. What you save stays on this phone.'
            : account?.email
              ? `Signed in as ${account.email}.`
              : 'Signed in.'}
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

/**
 * Rename the preset, and rename its scenes.
 *
 * "Would also like to be able to rename presets and scenes in the app directly
 * without having to ask the chat."
 *
 * Both write the unit's EDIT BUFFER, like everything else this app does. The
 * new name is real the moment you type it and permanent once the preset is
 * saved to a slot — which happens at the Mac, because a phone is not allowed to
 * overwrite a slot and should not be.
 *
 * It lives in Setup rather than on the stage screen, which is the browser's
 * choice and the right one: "move the rename presets and scenes button to the
 * settings menu". Renaming is bench work, and the stage screen is the one a
 * thumb crosses between songs.
 */
function UnitBits() {
  const preset = useRig((st) => st.preset)
  const scenes = useRig((st) => st.sceneNames)
  const caps = useRig((st) => st.capabilities)
  const shape = sceneShape(caps)

  const [said, setSaid] = useState(null)
  const [failed, setFailed] = useState(null)

  const rename = async (name) => {
    const wanted = name.trim()
    if (!wanted || wanted === (preset?.name || '').trim()) return
    setFailed(null)
    try {
      await setPresetName(wanted)
      await refreshPreset()
      setSaid(`This preset is called ${wanted} now.`)
    } catch (err) {
      setFailed(err.message)
    }
  }

  const renameScene = async (index, name) => {
    const wanted = name.trim()
    if (!wanted || wanted === (scenes[index] || '').trim()) return
    setFailed(null)
    try {
      await setSceneName(index, wanted)
      await refreshScene()
      setSaid(`Scene ${index + 1} is called ${wanted} now.`)
    } catch (err) {
      setFailed(err.message)
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <Section>This preset</Section>
      {failed ? <Note tone="fault">{failed}</Note> : null}

      <NameField
        label="Preset name"
        value={preset?.name || ''}
        onDone={rename}
      />

      {shape.hasScenes
        ? Array.from({ length: shape.count }, (_, i) => (
            <NameField
              key={i}
              label={`Scene ${i + 1}`}
              value={scenes[i] || ''}
              onDone={(name) => renameScene(i, name)}
            />
          ))
        : null}

      {said ? <Note>{said}</Note> : null}
      <Note>
        A new name is on the unit straight away. It becomes permanent when the preset is saved to a
        slot, which happens at the Mac.
      </Note>
    </View>
  )
}

/**
 * One name, as a field you can type in.
 *
 * Held locally while it is being typed. A box bound straight to what the unit
 * says snapped back to the old name the moment the last letter was deleted, so
 * you could not clear it to type a new one.
 */
function NameField({ label, value, onDone }) {
  const [draft, setDraft] = useState(null)
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: color.silkFaint, fontSize: font.micro, letterSpacing: 1.2 }}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        value={draft ?? value}
        onChangeText={setDraft}
        onBlur={() => {
          if (draft !== null) onDone(draft)
          setDraft(null)
        }}
        onSubmitEditing={() => {
          if (draft !== null) onDone(draft)
          setDraft(null)
        }}
        returnKeyType="done"
        accessibilityLabel={label}
        placeholder="Untitled"
        placeholderTextColor={color.silkFaint}
        style={{
          minHeight: TAP,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color.rule,
          backgroundColor: color.panel,
          color: color.silk,
          fontSize: font.body
        }}
      />
    </View>
  )
}

/**
 * How big the stage tiles are.
 *
 * Five steps, the browser's own, because they are about a thumb rather than
 * about a window: Smallest is for somebody who wants the whole rig on one
 * screen and Largest for somebody playing in the dark. Kept under the same key
 * as the browser's, so a phone and a laptop on one account agree.
 */
function TileSize() {
  useStored()
  const now = loadSize(sync)
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {SIZES.map((size, i) => (
          <Press
            key={size.name}
            label={size.name}
            tone="signal"
            on={i === now}
            height={44}
            style={{ paddingHorizontal: space.md }}
            onPress={() => saveSize(i, sync)}
          />
        ))}
      </View>
      <Note>Bigger tiles are easier to hit without looking; smaller ones fit more of the rig on screen.</Note>
    </View>
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
