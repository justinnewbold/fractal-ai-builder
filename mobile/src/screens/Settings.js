import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { APP_VERSION } from '../lib/version'
import { getDebugLog } from '../lib/debugLog'
import { tick } from '../lib/feedback'
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

const face = Platform.select(mono)

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
  onOpenGear,
  onOpenLog
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

  /**
   * Which page of Setup is open, or null for the list of them.
   *
   * SETUP IS A LIST OF DOORS, not a scroll of everything at once. That is the
   * browser's shape and it was arrived at the hard way — "I wanna overhaul this
   * whole settings set-up screen" — and the phone had the pile it replaced, with
   * eight scene-name boxes as the FIRST thing you saw. Nobody opens Setup to
   * rename scene 6.
   *
   * Each row carries the one fact you would have opened it to learn: which unit
   * and whether it answers, which Mac the phone is on, what size the tiles are.
   */
  const [page, setPage] = useState(null)

  const linkWord =
    link === 'connected'
      ? `Connected to ${macName || 'your Mac'}`
      : link === 'joining'
        ? 'Finding your Mac'
        : link === 'no-answer'
          ? 'Your Mac isn’t answering'
          : 'Not connected'

  const head = (title, onDone) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
      {onDone === 'back' ? (
        <Press label="‹ Setup" height={40} onPress={() => setPage(null)} />
      ) : (
        <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
          {title}
        </Text>
      )}
      {onDone === 'back' ? (
        <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.lead, fontWeight: '700' }}>
          {title}
        </Text>
      ) : (
        <Press label="Done" height={40} onPress={onBack} />
      )}
    </View>
  )

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      {page === null ? (
        <>
          {head('Setup')}
          <Text style={{ color: color.silkFaint, fontSize: font.small, fontFamily: face }}>
            {`v${APP_VERSION}`}
          </Text>
          <View style={{ gap: 0 }}>
            <SetupRow
              title="Unit"
              status={link === 'connected' ? `${deviceName || 'Unit'} · connected` : 'Not connected'}
              onPress={() => setPage('unit')}
            />
            <SetupRow title="Phone & Mac" status={linkWord} onPress={() => setPage('link')} />
            <SetupRow
              title="Play screen"
              status={SIZES[loadSize(sync)]?.name || 'Small'}
              onPress={() => setPage('play')}
            />
            {onOpenGear ? (
              <SetupRow
                title="Amp & pedal names"
                status="What each model on your unit really is"
                onPress={onOpenGear}
              />
            ) : null}
            {onOpenLog ? (
              <SetupRow
                title="Help & fixes"
                status={`${getDebugLog().length} line${getDebugLog().length === 1 ? '' : 's'} in the log`}
                onPress={onOpenLog}
              />
            ) : null}
            <SetupRow title="About" status={`v${APP_VERSION}`} onPress={() => setPage('about')} />
          </View>
        </>
      ) : null}

      {/* ------------------------------------------------------------ unit */}
      {page === 'unit' ? (
        <>
          {head('Unit', 'back')}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Lamp state={lamp} />
            <Text style={{ color: color.silk, fontSize: font.body, flex: 1 }}>
              {link === 'connected'
                ? `${deviceName || 'Your unit'} — answering`
                : 'No unit, because the Mac isn’t answering.'}
            </Text>
          </View>
          {/*
            Renaming is here and not on the front page. "Move the rename presets
            and scenes button to the settings menu" put it in the browser's Unit
            page; the phone had the boxes themselves as the first thing in Setup,
            which is eight empty fields in front of everything anybody actually
            opened Setup for.
          */}
          {link === 'connected' ? <UnitBits /> : <Note>Connect to the Mac to rename anything.</Note>}
        </>
      ) : null}

      {/* ------------------------------------------------------ phone & mac */}
      {page === 'link' ? (
        <>
          {head('Phone & Mac', 'back')}

          <View style={{ gap: space.md }}>
            <Section>The link</Section>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Lamp state={lamp} />
              <Text style={{ color: color.silk, fontSize: font.body, flex: 1 }}>
                {link === 'connected'
                  ? `Connected to ${macName || 'your Mac'}${deviceName ? ` — ${deviceName}` : ''}`
                  : `${linkWord}.`}
              </Text>
            </View>

            {link === 'no-answer' ? (
              <Note tone="warn">
                Open the Fractal app on the Mac and make sure the Mac is awake. This keeps trying on
                its own.
              </Note>
            ) : null}

            <Press label="Try now" onPress={onReconnect} />
          </View>

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
        </>
      ) : null}

      {/* ----------------------------------------------------- play screen */}
      {page === 'play' ? (
        <>
          {head('Play screen', 'back')}
          <View style={{ gap: space.md }}>
            <Section>Stage tiles</Section>
            <TileSize />
          </View>

          {/*
            Gone with the AI, because hiding the ✦ Tone button is the only thing
            this switch has ever done and there is no such button in this build.
            A switch that takes away something already absent is a switch that
            reports success and changes nothing. See lib/features.js.
          */}
          {AI ? (
            <View style={{ gap: space.md }}>
              <Section>Playing</Section>
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
        </>
      ) : null}

      {/* ----------------------------------------------------------- about */}
      {page === 'about' ? (
        <>
          {head('About', 'back')}
          <Text style={{ color: color.silk, fontSize: font.body, fontFamily: face }}>
            {`Fractal Remote v${APP_VERSION}`}
          </Text>
          <View style={{ gap: space.md }}>
            <Section>What stays at the Mac</Section>
            <Note>
              Saving to a slot, backups, restores, firmware and raw SysEx are refused from a
              distance — by your Mac, not by this app. A phone on a dark stage should not be able to
              overwrite a preset you spent a week on.
            </Note>
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}

/**
 * One row of Setup: a name, one line of live status, and a way in.
 *
 * The browser's own row, in this app's materials. Each carries the one fact you
 * would have opened it to learn, so the list answers most questions without
 * anybody tapping anything.
 */
function SetupRow({ title, status, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status ? `${title}, ${status}` : title}
      onPress={() => {
        tick()
        onPress()
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: TAP + 8,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderBottomColor: color.rule,
        backgroundColor: pressed ? color.panelHi : 'transparent'
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: color.silk, fontSize: font.lead, fontWeight: '600' }}>{title}</Text>
        {status ? (
          <Text numberOfLines={1} style={{ color: color.silkDim, fontSize: font.small }}>
            {status}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: color.silkFaint, fontSize: font.lead }}>›</Text>
    </Pressable>
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
