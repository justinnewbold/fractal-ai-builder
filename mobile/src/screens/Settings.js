import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP } from '../lib/theme'
import { APP_VERSION } from '../lib/version'
import { isOlder } from '../lib/versions'
import { setDemo, useDemo } from '../lib/demo'
import { getDebugLog } from '../lib/debugLog'
import { tick } from '../lib/feedback'
import {
  changePassword,
  currentAccount,
  hostConflict,
  pickHost,
  remoteChosenHost,
  remoteHosts,
  sendPasswordReset
} from '../lib/relay'
import { notePresetName, noteSceneName, useRig } from '../lib/rig'
import { dropReadCache, sceneShape, setPresetName, setSceneName } from '../lib/device'
import { SIZES, loadSize, saveSize } from '../lib/gigSize'
import { sync, useStored } from '../lib/store'
import { isPairAccount } from '../lib/pairing'
import Lamp from '../components/Lamp'
import Note from '../components/Note'
import PasswordBox from '../components/PasswordBox'
import Press from '../components/Press'
import { SaveButton, SaveNotes, useSaveToSlot } from '../components/SaveToSlot'
import Sheet from '../components/Sheet'

const face = Platform.select(mono)

const ofDeviceName = (s) => s.deviceName
const ofUnitState = (s) => s.unit

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
  onOpenConnect,
  link,
  macName,
  hostVersion,
  onBack,
  onReconnect,
  onSignOut,
  onOpenGear,
  onOpenLog,
  onOpenFixes
}) {
  const deviceName = useRig(ofDeviceName)
  const unitState = useRig(ofUnitState)
  const [account, setAccount] = useState(null)
  const [hosts, setHosts] = useState(remoteHosts())
  const [chosen, setChosen] = useState(remoteChosenHost())
  /*
   * The account line opens a small sheet of the things done about once —
   * change the password, or have a reset link sent. "Change it to where the
   * box isn't just showing New password": it sat open on this page for
   * everyone who came to change the tile size.
   */
  const [accountMenu, setAccountMenu] = useState(false)
  const [changing, setChanging] = useState(false)
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
  const unitDown = link === 'connected' && (unitState === 'missing' || unitState === 'silent')
  const lamp = unitDown ? 'fault' : link === 'connected' ? 'live' : link === 'no-answer' ? 'fault' : 'idle'

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
  /*
   * Behind only when the computer SAID a version and it is older. A computer
   * that says nothing used to be counted as behind — "Still getting the
   * message saying the Mac version is off, but is definitely on the right
   * version" — and telling somebody to update an app that is current is worse
   * than saying nothing. A missing version is its own case, said as such:
   * the Mac app writes it every few minutes, and since 7.295.0 its own menu
   * bar line says what the phones hear.
   */
  const demo = useDemo()
  const behind = !!hostVersion && isOlder(hostVersion, APP_VERSION) === true

  const [page, setPage] = useState(null)

  const linkWord =
    link === 'connected'
      ? `Connected to ${macName || 'your computer'}`
      : link === 'joining'
        ? 'Finding your computer'
        : link === 'no-answer'
          ? 'Your computer isn’t answering'
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
              status={
                link !== 'connected'
                  ? 'Not connected'
                  : unitState === 'missing'
                    ? 'No unit found on the computer'
                    : unitState === 'silent'
                      ? `${deviceName || 'Unit'} · not answering`
                      : `${deviceName || 'Unit'} · connected`
              }
              onPress={() => setPage('unit')}
            />
            <SetupRow
              title="Phone & computer"
              status={demo ? 'Demo — simulated FM3' : linkWord}
              onPress={() => setPage('link')}
            />
            {onOpenConnect ? (
              <SetupRow
                title="Connecting a computer"
                status="Mac app, Windows, or ForgeFX by hand"
                onPress={onOpenConnect}
              />
            ) : null}
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
            {/* Above the log, because it is the one somebody is looking for
                when something is wrong; the log is what they send afterwards
                if it did not help. */}
            {onOpenFixes ? (
              <SetupRow
                title="Fixes"
                status="What to try when it isn’t working"
                onPress={onOpenFixes}
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
              {link !== 'connected'
                ? 'No unit, because the computer isn’t answering.'
                : unitState === 'missing'
                  ? 'The computer has no unit. Check the FM3 is on and its cable is in.'
                  : unitState === 'silent'
                    ? `${deviceName || 'Your unit'} — not answering the computer. A frozen unit looks like this; turn it off and on.`
                    : `${deviceName || 'Your unit'} — answering`}
            </Text>
          </View>
          {/*
            Renaming is here and not on the front page. "Move the rename presets
            and scenes button to the settings menu" put it in the browser's Unit
            page; the phone had the boxes themselves as the first thing in Setup,
            which is eight empty fields in front of everything anybody actually
            opened Setup for.
          */}
          {link === 'connected' ? <UnitBits /> : <Note>Connect to the computer to rename anything.</Note>}
        </>
      ) : null}

      {/* ------------------------------------------------------ phone & mac */}
      {page === 'link' ? (
        <>
          {head('Phone & computer', 'back')}

          <View style={{ gap: space.md }}>
            <Section>The link</Section>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Lamp state={lamp} />
              <Text style={{ color: color.silk, fontSize: font.body, flex: 1 }}>
                {link === 'connected'
                  ? `Connected to ${macName || 'your computer'}${deviceName ? ` — ${deviceName}` : ''}`
                  : `${linkWord}.`}
              </Text>
            </View>

            {/*
              The demo says what it is and offers the way out, first, because
              everything under it is about a computer this is not talking to.
            */}
            {demo ? (
              <>
                <Note tone="warn">
                  This is the demo — a simulated FM3. Every screen works and nothing reaches
                  hardware. It also answers instantly, so anything still slow in here is this app
                  rather than the line to a computer.
                </Note>
                <Press label="Leave the demo" tone="signal" onPress={() => setDemo(false)} />
              </>
            ) : null}

            {/*
              What the computer is running, and whether that is behind.

              "Does the Mac app need to be updated to the latest version? Or
              would that affect how the app performs?" It would: that app holds
              the cable to the unit and does every read this phone asks for, so
              an old one is slow here in a way that looks exactly like this app
              being slow. The number was already being sent and nobody looked at
              it.
            */}
            {link === 'connected' && !demo ? (
              <Text style={{ color: color.silkDim, fontSize: font.small }}>
                {hostVersion
                  ? `The app on the computer is v${hostVersion}. This phone is v${APP_VERSION}.`
                  : `The computer didn’t say which version it is running: its app is older than 7.205.0, or it could not write its name for the phone. This phone is v${APP_VERSION}.`}
              </Text>
            ) : null}

            {link === 'connected' && !demo && behind ? (
              <Note tone="warn">
                The app on the computer is behind this one. Update it there — it is the part that
                holds the cable to your unit, and an old one is slow here in a way that looks like
                this app being slow.
              </Note>
            ) : null}
            {link === 'connected' && !demo && !hostVersion ? (
              <Note>
                If the computer is on 7.295.0 or newer, its menu bar icon has a line saying what the
                phones hear about its version, and that line says what is wrong.
              </Note>
            ) : null}

            {link === 'no-answer' ? (
              <Note tone="warn">
                Open the Fractal app on the computer and make sure the computer is awake. This keeps trying on
                its own.
              </Note>
            ) : null}

            {/* Nothing connected is the one state where the rest of this page
                can do nothing at all, so the way in is offered right here. */}
            {onOpenConnect && link !== 'connected' ? (
              <Press label="How do I connect a computer?" onPress={onOpenConnect} />
            ) : null}

            {/*
              Only while there is something to try. "The Try now button is
              there and if you click it it does — I'm not sure why it's even
              there if we're already all connected." It looks for the computer
              again, which on a live link is a button that does nothing you
              can see. Said as what it does, too.
            */}
            {link !== 'connected' ? <Press label="Look for the computer again" onPress={onReconnect} /> : null}
          </View>

          {hosts.length > 1 ? (
            <View style={{ gap: space.md }}>
              <Section>Which computer</Section>
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
            {isPairAccount(account?.email) || !account?.email ? (
              <Text style={{ color: color.silkDim, fontSize: font.small }}>
                {isPairAccount(account?.email)
                  ? 'Paired with your computer, no account. What you save stays on this phone.'
                  : 'Signed in.'}
              </Text>
            ) : (
              /* The way in to the password: the account line itself, with a
                 gear, rather than a box sitting open on the page. */
              <Press
                label={`⚙  ${account.email}`}
                sub="Signed in · tap for password options"
                onPress={() => {
                  setNote(null)
                  setError(null)
                  setAccountMenu(true)
                }}
              />
            )}

            {note ? <Note>{note}</Note> : null}
            {error ? <Note tone="fault">{error}</Note> : null}

            <Press label="Sign out on this phone" onPress={onSignOut} />
            <Text style={{ color: color.silkFaint, fontSize: font.micro, lineHeight: 18 }}>
              The computer stays signed in — signing out here must not drop the link mid-set.
            </Text>
          </View>

          <Sheet
            open={accountMenu}
            onClose={() => setAccountMenu(false)}
            title="Your account"
            note={account?.email || ''}
          >
            <Press
              label="Change password"
              sub="Type a new one here, twice"
              onPress={() => {
                setAccountMenu(false)
                setChanging(true)
              }}
            />
            <Press
              label={busy ? 'Sending…' : 'Email me a link to reset it'}
              sub="For when the old one is forgotten"
              disabled={busy}
              onPress={async () => {
                setBusy(true)
                try {
                  await sendPasswordReset(account.email)
                  setAccountMenu(false)
                  setNote(`A link to set a new password is on its way to ${account.email}.`)
                } catch (err) {
                  setAccountMenu(false)
                  setError(err.message)
                } finally {
                  setBusy(false)
                }
              }}
            />
          </Sheet>

          <PasswordBox
            open={changing}
            onChange={async (next) => {
              await changePassword(next)
              setNote('Password changed.')
            }}
            onClose={() => setChanging(false)}
          />
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
            <Section>What stays at the computer</Section>
            <Note>
              Saving to a slot, backups, restores, firmware and raw SysEx are refused from a
              distance — by your computer, not by this app. A phone on a dark stage should not be able to
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
 * saved to a slot — which the Save button below the names asks the computer
 * to do, because a phone is not allowed to overwrite a slot and should not be.
 *
 * AND THE WRITE IS BELIEVED. "Renaming a preset doesn't work, just goes right
 * back to the original name." The rename landed; the re-read that followed
 * came back with the old name out of the computer's cache and put it back on
 * screen. So the cache is dropped and the screen is told the name it wrote,
 * rather than asked to read it back. See rig.notePresetName.
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
  const unsaved = useRig((st) => st.unsaved)
  const shape = sceneShape(caps)
  const pending = !!unsaved && unsaved.number === preset?.number

  const [said, setSaid] = useState(null)
  const [failed, setFailed] = useState(null)
  const saveTo = useSaveToSlot()

  const rename = async (name) => {
    const wanted = name.trim()
    if (!wanted || wanted === (preset?.name || '').trim()) return
    setFailed(null)
    try {
      await setPresetName(wanted)
      await dropReadCache()
      notePresetName(wanted)
      setSaid(`This preset is called ${wanted} now. Tap Save to keep it.`)
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
      await dropReadCache()
      noteSceneName(index, wanted)
      setSaid(`Scene ${index + 1} is called ${wanted} now. Tap Save to keep it.`)
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
      {pending ? (
        <Note tone="warn">
          Renamed, not saved. Tap Save to keep the new names. Changing preset drops them, on the
          unit and here.
        </Note>
      ) : null}
      <SaveNotes s={saveTo} />
      <SaveButton s={saveTo} height={TAP} grow />
      <Note>
        A new name is on the unit straight away and is lost on the next preset change unless it is
        saved. Save asks the computer to write this slot, and that keeps everything changed from this
        phone: names, knobs, blocks and the chain.
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
