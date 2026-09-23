import { useEffect, useState } from 'react'
import { Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, mono, radius, space, TAP, MODES, getMode, setMode } from '../lib/theme'
import { APP_VERSION } from '../lib/version'
import { AFFILIATION } from '../lib/affiliation'
import { isOlder } from '../lib/versions'
import { setDemo, useDemo, useDemoUnit, setDemoUnit } from '../lib/demo'
import { UNITS as DEMO_UNITS } from '../lib/demoUnits'
import { getDebugLog } from '../lib/debugLog'
import { tick } from '../lib/feedback'
import { usePurchase } from '../lib/purchases'
import { applyNow, checkNow, describeRunning, useUpdates } from '../lib/updates'
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
import { SIZES, clampSize, loadFit, loadSize, saveFit, saveSize } from '../lib/gigSize'
import { REPLAY } from '../lib/onboarding'
import { sync, useStored } from '../lib/store'
import { isPairAccount } from '../lib/pairing'
import { mayDrive } from '../lib/unlock-rule'
import { useComputerElsewhere } from '../lib/useComputerElsewhere'
import { quitEditor } from '../lib/editors'
import { isAdmin } from '../lib/admin'
import AccessTool from '../components/AccessTool'
import Lamp from '../components/Lamp'
import Note from '../components/Note'
import PasswordBox from '../components/PasswordBox'
import Press from '../components/Press'
import { SaveButton, SaveNotes, useSaveToSlot } from '../components/SaveToSlot'
import EdgeBack from '../components/EdgeBack'
import Sheet from '../components/Sheet'

const face = Platform.select(mono)

const ofDeviceName = (s) => s.deviceName
const ofFirmware = (s) => s.firmware

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
  onUnlock,
  onOpenConnect,
  link,
  macName,
  hostVersion,
  onBack,
  onReconnect,
  onSignOut,
  onOpenGear,
  onReplay,
  onOpenLog,
  onOpenFixes,
  onOpenReport,
  onSignIn
}) {
  const deviceName = useRig(ofDeviceName)
  const firmware = useRig(ofFirmware)
  const unitState = useRig(ofUnitState)
  const [account, setAccount] = useState(null)
  /* A computer on this wifi signed into another account — the likeliest
     reason nothing answers, and until now one nothing on this page could see. */
  const elsewhere = useComputerElsewhere(link === 'no-answer')
  /*
   * Whether the account service has answered yet.
   *
   * `account` is null both before the question is asked and when nobody is
   * signed in, and those are opposite answers. Without this the line below
   * has to guess during the first frame, and the old code guessed "Signed
   * in." — which is how a demo with no session at all came to say it was
   * signed in.
   */
  const [asked, setAsked] = useState(false)
  const [hosts, setHosts] = useState(remoteHosts())
  const [chosen, setChosen] = useState(remoteChosenHost())
  /*
   * The account line opens a small sheet of the things done about once —
   * change the password, or have a reset link sent. "Change it to where the
   * box isn't just showing New password": it sat open on this page for
   * everyone who came to change the tile size.
   */
  const [accountMenu, setAccountMenu] = useState(false)
  /* The account's email, when there is a real one: a pairing code's account
     is not somebody's email and is not called one. */
  const signedInAs = account?.email && !isPairAccount(account.email) ? account.email : null
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    currentAccount()
      .then((a) => alive && setAccount(a))
      .catch(() => {})
      .finally(() => alive && setAsked(true))
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
  /* Which one, and told when it changes. Read as `demoUnit()` this never
     redrew, so the five buttons stayed lit on whichever unit the app started
     as however many times they were pressed. */
  const unit = useDemoUnit()
  const behind = !!hostVersion && isOlder(hostVersion, APP_VERSION) === true

  const [page, setPage] = useState(null)
  const purchase = usePurchase()
  const updates = useUpdates()
  /* Which bundle is running, asked once when Setup opens. It settles "did an
     update ever land" without anybody comparing numbers off two screens. */
  useEffect(() => {
    describeRunning()
  }, [])

  const linkWord =
    link === 'connected'
      ? `Connected to ${macName || 'your computer'}`
      : link === 'joining'
        ? 'Finding your computer'
        : link === 'no-answer'
          ? 'Your computer isn’t answering'
          : 'Not connected'

  /*
   * TWO WAYS OUT OF EVERY PAGE, and they go to different places on purpose.
   *
   * "Add the done button to all submenus, and if they click done, it takes
   * them directly back to the play screen, no matter how deep they are in the
   * submenus. Swiping back should always take them to the previous screen."
   *
   * Back is one step — a submenu to the list, the list to Play. Done is the
   * whole way out from any depth. A submenu had only Back, so leaving from
   * three levels in meant tapping out one level at a time; the list had only
   * Done, so there was no step back from it at all. Both now have both.
   *
   * The submenu head is two rows rather than three things crammed across one:
   * Back and Done on the top, the title under them with the width to itself.
   * "Rename presets and scenes" is four words that will not share a line with
   * two buttons on a phone.
   */
  /*
   * WHICH PAGE A BACK GOES TO, which was not a question until now.
   *
   * Every page came off the front list, so back was always the front list and
   * the button could say "‹ Settings" without thinking. Troubleshooting is
   * inside About now, and a back that walked past the page you came from
   * would be the app forgetting where you were standing.
   *
   * One entry, because there is one nested page. It is a map rather than an
   * `if` so the next one is a line rather than a branch.
   */
  const PARENT = { trouble: 'about' }
  const upFrom = (p) => PARENT[p] || null
  const upLabel = (p) => (PARENT[p] === 'about' ? '‹ About' : '‹ Settings')

  const head = (title, onDone) =>
    onDone === 'back' ? (
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
          <Press label={upLabel(page)} height={40} onPress={() => setPage(upFrom(page))} />
          <Press label="Done" height={40} onPress={onBack} />
        </View>
        <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
          {title}
        </Text>
      </View>
    ) : (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
          {title}
        </Text>
        <Press label="Done" height={40} onPress={onBack} />
      </View>
    )

  /* One step up, whatever that means from where you are standing. The swipe
     and the Back button are the same errand, so they ask the same function. */
  const goBack = () => (page === null ? onBack?.() : setPage(upFrom(page)))

  return (
    <EdgeBack onBack={goBack}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      {page === null ? (
        <>
          {head('Settings')}
          {/*
            WHICH ACCOUNT, BESIDE THE VERSION. "Can we also list the user
            account if they're signed in and if they're not signed in, have it
            say not signed in. Then clicking on it will take them to where they
            can sign in or otherwise show them their account info… where they
            can sign out or change our password."

            Signed in, it opens Phone & computer with the account's own sheet
            up — password — and Sign out on the page under it. Not signed in,
            it goes straight to the sign-in.
          */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
            <Text style={{ color: color.silkFaint, fontSize: font.small, fontFamily: face }}>
              {`v${APP_VERSION}`}
            </Text>
            {asked ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={signedInAs ? `Signed in as ${signedInAs}. Account` : 'Not signed in. Sign in'}
                hitSlop={8}
                style={{ flexShrink: 1 }}
                onPress={() => {
                  if (signedInAs) {
                    setNote(null)
                    setError(null)
                    setPage('link')
                    setAccountMenu(true)
                  } else if (onSignIn && !isPairAccount(account?.email)) {
                    onSignIn()
                  } else {
                    setPage('link')
                  }
                }}
              >
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={{ color: signedInAs ? color.silkDim : color.signal, fontSize: font.small, textAlign: 'right' }}
                >
                  {signedInAs || (isPairAccount(account?.email) ? 'Paired, no account' : 'Not signed in')}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={{ gap: 0 }}>
            {/*
              First, because it is the only row here anybody opens for the fun
              of it. "Move the amp and pedals button to the top of the list."
              Every other row is plumbing you go to when something needs
              sorting out; this one answers "what IS a Das Metall, really",
              which is a question you have while playing.
            */}
            {onOpenGear ? (
              <SetupRow
                title="Amp & pedal names"
                status="What each model on your unit really is"
                onPress={onOpenGear}
              />
            ) : null}
            {/*
              One row for the whole chain: this phone, the computer, and the
              unit plugged into it.

              It was two rows — "Unit" on top and "Phone & computer" under it
              — and neither could answer the only question anybody opens
              either of them with. "Not connected" on the Unit row might mean
              the unit is unplugged or might mean the computer is asleep, and
              you had to open the second row to find out which. One chain, one
              row, and the status says how far along it gets.
            */}
            <SetupRow
              title="Phone & computer"
              status={
                demo
                  ? /* The unit the demo actually IS, not the one it used to be
                       only able to be. This said "simulated FM3" whatever was
                       picked, so an Axe-Fx III demo described itself as an
                       FM3 one row above a bar reading Axe-Fx III — the exact
                       fault the five demo units were added to end. */
                    `Demo — simulated ${DEMO_UNITS.find((u) => u.key === unit)?.name || 'unit'}`
                  : link !== 'connected'
                    ? linkWord
                    : unitState === 'missing'
                      ? 'Computer connected · no unit'
                      : unitState === 'silent'
                        ? `Computer connected · ${deviceName || 'unit'} not answering`
                        : `${deviceName || 'Unit'} · connected`
              }
              onPress={() => setPage('link')}
            />
            {/*
              Named after the errand rather than after the thing.

              This row said "Unit", and behind it were the rename boxes and a
              line about whether the unit was answering. The line has gone up
              one row where the rest of the chain is; the boxes are the whole
              page now, so the row can say what pressing it gets you.
            */}
            <SetupRow
              title="Rename presets and scenes"
              status={
                link === 'connected'
                  ? 'Names you will know on a dark stage'
                  : 'Connect a computer first'
              }
              onPress={() => setPage('unit')}
            />
            {/*
              * THE FULL VERSION, AND THE WAY BACK TO ONE ALREADY PAID FOR.
              *
              * The top bar carries an Unlock button while the demo is on,
              * which is where somebody deciding will find it. This row is for
              * the two people that button cannot serve: somebody who wants to
              * read about it before tapping anything, and somebody who has
              * ALREADY PAID and is on a new handset.
              *
              * That second one is not a nicety. Apple requires a purchase to
              * be restorable and rejects apps that hide it, and until this row
              * existed the only Restore button in the app was on a paywall
              * you could reach by exactly one route: signing in with a pairing
              * code you had not paid for. A person who paid, changed phones
              * and opened the demo had no way back to what they owned.
              *
              * AND IT GOES ENTIRELY ONCE THEY HAVE PAID. "The unlock full
              * version needs to disappear if it has been unlocked."
              *
              * It used to stay, reading "Full version · Unlocked — thank you",
              * which is a row that can be pressed to be told a thing it has
              * already said. Nobody opens Setup to be thanked.
              *
              * The Apple rule is untouched by this, because it is about
              * somebody who CANNOT reach what they bought. `unlocked` false is
              * exactly that person — a new handset reads false until a restore
              * says otherwise — and they still get the row, still worded so
              * restoring is on it.
              */}
            {purchase.unlocked ? null : (
              <SetupRow
                title="Unlock the full version"
                status={
                  purchase.price
                    ? `Drive a real rig · ${purchase.price}`
                    : /* Never "Restore a purchase" as the only wording when the
                         store is simply not ready — that reads as though buying
                         is not on offer at all, which is how the whole thing
                         came to be invisible. */
                      'Drive a real rig, or restore a purchase'
                }
                onPress={onUnlock}
              />
            )}
            <SetupRow title="About" status={`v${APP_VERSION}`} onPress={() => setPage('about')} />
            {/* Justin's own tools, on his account only — see lib/admin.js. */}
            {isAdmin(account?.email) ? (
              <SetupRow title="Give someone access" status="Unlock an account by hand" onPress={() => setPage('access')} />
            ) : null}
          </View>

          {/*
            * THE TWO THAT ARE NOT DOORS, and they are here rather than behind one.
            *
            * "Move this to the settings screen at the bottom below all the
            * other drop-down menus — we want it quickly available just by
            * clicking settings. Don't have it via a drop-down, have it always
            * visible."
            *
            * Every row above opens something and then you come back. These two
            * are not errands: they are how the screen you play off LOOKS, and
            * the way anybody uses them is to change one and look at the result.
            * Behind a row called Play screen that is four taps a go — open
            * Settings, open the row, change it, come back out to see — and the
            * thing you are judging is not even on screen while you are judging
            * it.
            *
            * At the bottom because the rows above are what somebody opens
            * Settings FOR. These want to be reachable in one tap, not first.
            */}
          <View style={{ gap: space.md }}>
            <Section>Stage tiles</Section>
            <TileSize />
          </View>

          {/*
            Light, dark, or whatever the phone is set to.

            "I'm not seeing where the light/dark/auto theme buttons are
            anymore. Please put that back on Setup." The phone had none of
            them and was dark whatever the handset was set to, which is the
            wrong answer in a lit room.
          */}
          <View style={{ gap: space.md }}>
            <Section>Appearance</Section>
            <Appearance />
          </View>
        </>
      ) : null}

      {/* -------------------------------------------------------- renaming */}
      {page === 'unit' ? (
        <>
          {head('Rename presets and scenes', 'back')}
          {/*
            The boxes are the page now.

            "Move the rename presets and scenes button to the settings menu"
            put them behind a row called Unit, with a line above them about
            whether the unit was answering. That line has gone to Phone &
            computer, where the rest of the chain is — so what is left here is
            one errand and nothing in front of it.
          */}
          <Text style={{ color: color.silkDim, fontSize: font.small, lineHeight: 20 }}>
            The names your unit came with are numbers and abbreviations. These are the words you
            read off a phone on a dark stage.
          </Text>
          {link === 'connected' ? <UnitBits /> : <Note>Connect to the computer to rename anything.</Note>}
        </>
      ) : null}

      {/* -------------------------------------------------- troubleshooting */}
      {page === 'trouble' ? (
        <>
          {head('Troubleshooting', 'back')}
          <Text style={{ color: color.silkDim, fontSize: font.small, lineHeight: 20 }}>
            In order: try the fixes, read the log if they did not help, then tell us and the log
            goes with it.
          </Text>
          <View style={{ gap: 0 }}>
            {onOpenFixes ? (
              <SetupRow
                title="Fixes"
                status="What to try when it isn’t working"
                onPress={onOpenFixes}
              />
            ) : null}
            {/* Called Log, because that is what it opens. It said "Help &
                fixes" — the name of the row directly above it, which opens
                something else entirely. */}
            {onOpenLog ? (
              <SetupRow
                title="Log"
                status={`${getDebugLog().length} line${getDebugLog().length === 1 ? '' : 's'} in the log`}
                onPress={onOpenLog}
              />
            ) : null}
            {/* Last of the three, and the one that goes the other way: Fixes
                and the log are things to read, this is the thing to send when
                neither helped. */}
            {onOpenReport ? (
              <SetupRow
                title="Feedback"
                status="Something broken, or something you want"
                onPress={onOpenReport}
              />
            ) : null}
          </View>
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
              {/*
                The far end of the chain, in the same breath as the near end.

                "Connected to your computer" was the whole line, and it was
                true on an evening when the unit was switched off — which is
                the evening you are reading it. The unit's own state used to
                be one door away on a row called Unit; it is here, because
                this page is the chain and the unit is the end of it.
              */}
              <Text style={{ color: color.silk, fontSize: font.body, flex: 1 }}>
                {link !== 'connected'
                  ? `${linkWord}.`
                  : unitState === 'missing'
                    ? /* The usual reason besides the cable is Fractal's own
                         editor holding the unit — named, per unit where it is
                         known (lib/editors.js). */
                      `Connected to ${macName || 'your computer'} — but it has no unit. Check your unit is on and its cable is in. ${quitEditor(deviceName)} This finds the unit again by itself once it is free.`
                    : unitState === 'silent'
                      ? `Connected to ${macName || 'your computer'} — ${deviceName || 'your unit'} isn’t answering. A frozen unit looks like this; turn it off and on. ${quitEditor(deviceName)}`
                      : `Connected to ${macName || 'your computer'}${deviceName ? ` — ${deviceName}` : ''}`}
              </Text>
            </View>

            {/*
              What the unit is running, under what it is.

              "It definitely pulls the firmware version so I'm not sure why you
              can't do it." It does, and this app had simply never asked for
              it — the version lives on `/device` and both ends were reading
              only `/device/detect`. Drawn only when the unit said one: the
              demo has no firmware and neither has a host too old to report
              it, and "firmware —" under a unit's name reads as a version
              rather than as a silence.
            */}
            {firmware ? (
              <Text style={{ color: color.silkDim, fontSize: font.small, marginTop: space.xs }}>
                {`Firmware ${firmware}`}
              </Text>
            ) : null}

            {/*
              The demo says what it is and offers the way out, first, because
              everything under it is about a computer this is not talking to.
            */}
            {demo ? (
              <>
                <Note tone="warn">
                  {`This is the demo — a simulated ${
                    DEMO_UNITS.find((u) => u.key === unit)?.name || 'FM3'
                  }. Every screen works and nothing reaches hardware. It also answers instantly, so anything still slow in here is this app rather than the line to a computer.`}
                </Note>
                {/*
                  Which unit, because the demo was an FM3 and only an FM3 —
                  and an AM4 owner opening it saw eight scene tiles their unit
                  has not got. Each of these holds its own real factory bank:
                  the preset names and the scene names the unit ships with.
                */}
                <Section>Which unit</Section>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {DEMO_UNITS.map((u) => (
                    <Press
                      key={u.key}
                      label={u.name}
                      tone="signal"
                      on={u.key === unit}
                      height={44}
                      style={{ paddingHorizontal: space.md }}
                      onPress={() => setDemoUnit(u.key)}
                    />
                  ))}
                </View>
                {/*
                  THE WAY OUT IS FOR SOMEBODY WHO HAS PAID.

                  "Someone should only be able to exit a demo if they've
                  already purchased the app or paid."

                  It used to be here for everybody, and for somebody who has
                  not paid it was a door to an empty room: the live app with
                  no unlock is a screen that cannot drive anything. The demo
                  IS the app until it is bought.

                  Nobody is shut in. Heading for Sign in ends the demo too —
                  see App.js's toSignIn — and the sign-in screen offers the
                  demo again, so the way out for somebody who has not paid is
                  the one they would take anyway.

                  The same words as the bar, because it is the same errand and
                  two words for one action is how the two ends drifted apart
                  everywhere else in this app.
                */}
                {purchase.unlocked ? (
                  <Press label="Exit demo" tone="signal" onPress={() => setDemo(false)} />
                ) : null}
              </>
            ) : purchase.unlocked ? (
              /*
                THE WAY IN, FOR SOMEBODY WHO HAS PAID.

                "It would be a good idea for somebody that wants to maybe view
                what it looks like having an AxeFX 3 or another model they
                don't have yet to play around with it."

                The demo is hidden from everybody who has bought the app —
                it is not on the walkthrough they have been past, and signing
                in ends it — so this is the door he asked to keep. Here rather
                than on the front list because this page is what the phone is
                talking to, and the demo is a thing to talk to.

                ONE WORD, not the sign-in screen's three. "If they are
                already signed in and the app is unlocked, instead of saying
                try the demo, have it just say Demo."

                The two are not the same sentence because the two readers are
                not the same person. "Try the Demo" is an offer, made to
                somebody who has not paid and is deciding — try it, see what
                it does. By the time this button is on screen that decision is
                made: they are signed in, they own the app, and the demo is
                simply one of the things it has. A place, not a pitch.

                And no heading over it, which he confirmed. A heading here
                would be a sentence I wrote rather than one he did, and the
                button already says what it does.
              */
              <Press label="Demo" onPress={() => setDemo(true)} />
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

            {/* A computer on this wifi on another account is the reason, and it is
                said instead — see useComputerElsewhere. */}
            {link === 'no-answer' && elsewhere ? (
              <Note tone="fault">
                {account?.email && !isPairAccount(account.email)
                  ? `The computer on this wifi is signed into a different account. This phone is signed in as ${account.email}. Sign the Fractal app on the computer in with ${account.email}, or sign this phone out below and into the computer’s account.`
                  : 'The computer on this wifi is signed into a different account than this phone. Sign both into the same account.'}
              </Note>
            ) : link === 'no-answer' ? (
              <Note tone="warn">
                Open the Fractal app on the computer and make sure the computer is awake. This keeps trying on
                its own.
              </Note>
            ) : null}
            {/* Which account this is — his words: "make sure you're connected
                to your computer using and then show the user's email
                address". A computer signed in as somebody else is the
                likeliest reason nothing answers. */}
            {link === 'no-answer' && account?.email && !isPairAccount(account.email) ? (
              <Note>{`Make sure you’re connected to your computer using ${account.email}.`}</Note>
            ) : null}

            {/*
              The way in to getting a computer on the other end at all.

              It was a row of its own on the front of Setup, called
              "Connecting a computer", sitting between two rows about a
              computer that was already connected. It belongs here, on the
              page about the line to that computer — and it stays offered even
              once the line is up, because the second computer somebody wants
              to add is one they add on an evening when the first one works.
            */}
            {onOpenConnect ? (
              <Press label="How do I connect a computer?" onPress={onOpenConnect} />
            ) : null}

            {/*
              PLAYING WITH NO INTERNET, told to the people who paid for the app.
              
              "Let's make that some kind of option in the app or to tell people
              how to do it to connect without internet and give instructions to
              people that have already unlocked it."

              The route is real and it is the only one that works in a room with
              no signal, but it was advertised in the wrong place: the website's
              signed-out screen, headed "no account, no code", where it read as
              a way around paying. It is off that screen now. This is where it
              belongs instead — behind the unlock, told to somebody who has
              already bought the thing.

              AND IT IS NOT THIS APP THAT DOES IT, which is the part that has to
              be said plainly rather than implied. Everything here goes through
              the relay, which is on the internet; there is no code in this app
              that speaks to a computer over wifi, and pretending otherwise
              would have somebody trying it on a stage. What works is the phone's
              WEB BROWSER on the computer's own page, so that is what the
              instructions say to open.

              `mayDrive` rather than `purchase.unlocked` on purpose: it also says
              yes when the store could not be reached, and a person whose signal
              is bad is exactly the person who needs to read this.
            */}
            {mayDrive(purchase) ? (
              <View style={{ gap: space.sm }}>
                <Section>Playing with no internet</Section>
                <Text style={{ color: color.silkDim, fontSize: font.small }}>
                  This app reaches your computer over the internet, so it needs a signal. For a room
                  that has none, there is another way round and it does not use this app.
                </Text>
                <Text style={{ color: color.silkDim, fontSize: font.small }}>
                  Put the phone on the same wifi as the computer, then open the computer&rsquo;s
                  address in the phone&rsquo;s web browser. The computer shows that address in its
                  menu bar, next to the Fractal icon. You get the same screens, and no part of it
                  goes near the internet.
                </Text>
                <Note>
                  What you change there is kept by that browser rather than in your account, so it
                  does not follow you to this app or to another phone.
                </Note>
              </View>
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
              <>
                {/*
                  What is actually true, which is three different states and
                  used to be two. Paired by code is not the same as signed in
                  with an account, and NEITHER is the same as the demo, where
                  there is no session at all — and the demo is the one that
                  used to read "Signed in."
                */}
                <Text style={{ color: color.silkDim, fontSize: font.small }}>
                  {!asked
                    ? 'Checking…'
                    : isPairAccount(account?.email)
                      ? 'Paired with your computer, no account. What you save stays on this phone.'
                      : 'Not signed in on this device.'}
                </Text>
                {/*
                  AND THE WAY BACK IN.

                  "There is no way to login with user name and password after
                  you are in the app on the demo." There was not: this block
                  offered Sign out and nothing else, so somebody in the demo —
                  who has nothing to sign out OF — had no route to an account
                  they already own. Paired by code gets it too: that is how a
                  phone moves from its computer's code to a real account.
                */}
                {asked && onSignIn ? (
                  <Press label="Sign in with an email and password" onPress={onSignIn} />
                ) : null}
              </>
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

      {/* ---------------------------------------------------------- access */}
      {page === 'access' && isAdmin(account?.email) ? (
        <>
          {head('Give someone access', 'back')}
          <AccessTool />
        </>
      ) : null}

      {/* ----------------------------------------------------------- about */}
      {page === 'about' ? (
        <>
          {head('About', 'back')}
          <Text style={{ color: color.silk, fontSize: font.body, fontFamily: face }}>
            {`Fractal Remote v${APP_VERSION}`}
          </Text>

          {/*
            INSIDE ABOUT, not beside it.

            "Move walkthrough, updates and troubleshooting INSIDE of the
            'About' menu."

            They were moved under About an hour ago, which was the smaller
            version of the same instruction: they are the rows you go looking
            for on an evening when something is wrong, or once, ever. Under it
            they still cost five lines of a list somebody opens to do
            something else. In it they cost one.

            What is left on the front page is the four things Setup is opened
            FOR, and one door to everything else.
          */}
          <View style={{ gap: 0 }}>
          {/*
            * WHAT IS RUNNING, AND HOW TO GET THE NEWEST.
            *
            * "I have not yet successfully had a single over-the-air update
            * work correctly. They never come through, so I keep refreshing
            * the android app, closing it, force closing it, reopening it
            * over and over again."
            *
            * They were arriving. What was missing was any way to SEE it,
            * plus one detail that makes a working app look stuck: this app
            * never waits for a download at launch — app.json sets
            * fallbackToCacheTimeout to 0, so it starts on the bundle it
            * already has, fetches the new one in the BACKGROUND, and runs it
            * the NEXT time it opens.
            *
            * First launch downloads. Second launch shows it. Somebody
            * force-closing once, seeing the same number and concluding
            * nothing happened was one restart short, with nothing on screen
            * to say so.
            *
            * That default is right for a stage and is not what changes here.
            * This says what is going on, and offers the restart instead of
            * waiting for it to happen by accident.
            */}
          <SetupRow
            title="Updates"
            status={
              updates.phase === 'ready'
                ? 'Ready — tap to restart into it'
                : updates.phase === 'downloading'
                  ? 'Downloading…'
                  : updates.phase === 'checking'
                    ? 'Checking…'
                    : updates.phase === 'current'
                      ? 'Up to date'
                      : updates.phase === 'off'
                        ? 'Not available in this build'
                        : updates.error
                          ? 'Could not check — tap to try again'
                          : `Running ${updates.source === 'update' ? 'an update' : 'the installed build'} · tap to check`
            }
            onPress={() => (updates.phase === 'ready' ? applyNow() : checkNow())}
          />
          {/*
            Three rows became one door.

            Fixes, Log and Feedback were three rows in a column, and they
            are three stages of the same evening: read what to try, read
            what actually happened, tell somebody when neither helped. As
            separate rows each looked like a different errand, and the one
            in the middle looked like a developer's.
          */}
          {onOpenFixes || onOpenLog || onOpenReport ? (
            <SetupRow
              title="Troubleshooting"
              status="What to try, the log, and telling us"
              onPress={() => setPage('trouble')}
            />
          ) : null}
          {/* Openable again, because a tour worth showing once is worth
              finding later — and somebody who skipped it on the first
              launch has no other way back to it. */}
          {/* The way back into the walkthrough, named the way its own last
              screen promises: "Replay this anytime in Settings → Show the
              walkthrough." */}
          {onReplay ? (
            <SetupRow title={REPLAY} status="The setup, from the start" onPress={onReplay} />
          ) : null}
          </View>

          <View style={{ gap: space.md }}>
            <Section>What stays at the computer</Section>
            <Note>
              Saving to a slot, backups, restores, firmware and raw SysEx are refused from a
              distance — by your computer, not by this app. A phone on a dark stage should not be able to
              overwrite a preset you spent a week on.
            </Note>
          </View>
          {/*
            Reachable from inside the app, which is the point of writing them.
            A store requires a privacy policy at a URL and the licences we ship
            under require their notices travel with the software; neither is
            satisfied by a file nobody can open from the thing it describes.
          */}
          <View style={{ gap: space.md }}>
            <Section>The small print</Section>
            {/* Said in the app, not only in a file somebody would have to go
                looking for. Same string as the browser — shared/affiliation.mjs. */}
            <Note>{AFFILIATION}</Note>
            <Press
              label="Privacy"
              sub="What this sends, and what it never does"
              onPress={() => Linking.openURL('https://fractal.newbold.cloud/privacy.html')}
            />
            <Press
              label="Licences"
              sub="The open-source work this is built on"
              onPress={() => Linking.openURL('https://fractal.newbold.cloud/notices.txt')}
            />
          </View>
        </>
      ) : null}
    </ScrollView>
    </EdgeBack>
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
        {/* Green, like the browser's: each of these is a live answer rather
            than small print, and `ok` is already what both apps use for a
            thing said in words they are sure of. */}
        {status ? (
          <Text numberOfLines={1} style={{ color: color.ok, fontSize: font.small }}>
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
      <SaveButton s={saveTo} height={TAP} grow waiting={pending} />
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
/**
 * Stage tiles: a stepper and a tick box, the same two controls as the browser.
 *
 * "Update the mobile app's tile size screen to look like this with the +/-
 * buttons instead of the tab buttons."
 *
 * Five buttons in a wrapping row said five things at once and took two lines
 * to do it. A stepper says the one thing that matters — what it is set to
 * now — and the two ways to change it sit either side of the answer.
 *
 * FIT IS A TICK BOX UNDER IT, NOT A SIXTH STEP, because it is not a size: it
 * is the screen deciding instead of you. While it is on the stepper reads
 * "Fit to screen" and its buttons go quiet, which is the honest way to show a
 * control whose value is being overridden — greying them says "not now"
 * where hiding them would say "never".
 *
 * On out of the box. It is the right answer for everybody who has not got an
 * opinion yet, which is everybody on the first launch.
 */
function TileSize() {
  useStored()
  const now = loadSize(sync)
  const fit = loadFit(sync, true)
  const step = (by) => saveSize(clampSize(now + by), sync)
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Press
          label="−"
          accessibilityLabel="Smaller tiles"
          height={TAP}
          disabled={fit || now <= 0}
          style={{ paddingHorizontal: space.lg }}
          onPress={() => step(-1)}
        />
        <Text
          style={{
            flex: 1,
            textAlign: 'center',
            color: color.silk,
            fontSize: font.lead,
            fontWeight: '700'
          }}
        >
          {fit ? 'Fit to screen' : SIZES[now]?.name || SIZES[0].name}
        </Text>
        <Press
          label="+"
          accessibilityLabel="Bigger tiles"
          height={TAP}
          disabled={fit || now >= SIZES.length - 1}
          style={{ paddingHorizontal: space.lg }}
          onPress={() => step(1)}
        />
      </View>
      <Note>
        Bigger tiles are easier to hit without looking; smaller ones fit more of the rig on screen.
        This device remembers it.
      </Note>
      <Choice
        on={fit}
        label="Fit everything on one screen"
        sub="Sizes the scenes and effects so the whole rig is on screen at once, with no scrolling. Bigger presets get smaller buttons, never under a thumb’s width. Overrides the size above while it is on."
        onPress={() => saveFit(!fit, sync)}
      />
    </View>
  )
}

/**
 * A tick box with a sentence under it.
 *
 * The browser has a real checkbox and this end has none, so it is drawn:
 * a square that fills when it is on, the way the one on the computer does.
 * `accessibilityRole` is checkbox rather than button, because that is what it
 * is — a screen reader should say "checked", not "selected".
 */
function Choice({ on, label, sub, onPress }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!on }}
      accessibilityLabel={label}
      onPress={() => {
        tick()
        onPress?.()
      }}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.sm,
          borderWidth: on ? 0 : 1,
          borderColor: color.rule,
          backgroundColor: on ? color.signal : color.panel,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {on ? (
          <Text style={{ color: color.onSignal, fontSize: font.body, fontWeight: '700' }}>✓</Text>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ color: color.silk, fontSize: font.body }}>{label}</Text>
        <Text style={{ color: color.silkDim, fontSize: font.small, lineHeight: font.small * 1.5 }}>
          {sub}
        </Text>
      </View>
    </Pressable>
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

/**
 * Light, dark, or the handset's own setting.
 *
 * Auto first, and it is the default: a phone that already knows whether its
 * owner wants light or dark is a better guess than anything this app could
 * make, and somebody who has never thought about it gets the right answer
 * without choosing.
 */
function Appearance() {
  const [mode, setLocal] = useState(getMode())
  const LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' }
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {MODES.map((m) => (
        <Press
          key={m}
          grow
          label={LABEL[m]}
          tone="signal"
          on={m === mode}
          height={TAP}
          onPress={() => {
            setMode(m, sync)
            setLocal(m)
          }}
        />
      ))}
    </View>
  )
}
