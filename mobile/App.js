import { useEffect, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Appearance, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { color, font, space, isDark, loadMode, setSystemDark, themeVersion, watchTheme } from './src/lib/theme'
import { haveSession, linkState, probeNow, startLink, stopLink, subscribeLink } from './src/lib/link'
import { signOut } from './src/lib/relay'
import Note from './src/components/Note'
import TopBar from './src/components/TopBar'
import DemoUnit from './src/components/DemoUnit'
import Settings from './src/screens/Settings'
import EdgeBack from './src/components/EdgeBack'
import SignIn from './src/screens/SignIn'
import Onboarding from './src/screens/Onboarding'
import { walkthroughSeen, markWalkthrough } from './src/lib/walkthrough'
import Edit from './src/screens/Edit'
import Connect from './src/screens/Connect'
import Fixes from './src/screens/Fixes'
import Gear from './src/screens/Gear'
import Log from './src/screens/Log'
import Report from './src/screens/Report'
import Presets from './src/screens/Presets'
import Setlists from './src/screens/Setlists'
import Stage from './src/screens/Stage'
import { hydrate, sync } from './src/lib/store'
import { keepSetlistsInStep } from './src/lib/cloudSetlists'
import { useRig } from './src/lib/rig'
import { keepLog } from './src/lib/logKeep'
import { installCrashCapture } from './src/lib/debugLog'
import { restoreDemo, setDemo, useDemo } from './src/lib/demo'
import { BENCH } from './src/lib/features'
import Paywall from './src/screens/Paywall'
import { checkOwner, startPurchases, usePurchase } from './src/lib/purchases'
import { shouldAskToPay } from './src/lib/unlock-rule'

/**
 * Fractal Remote.
 *
 * A handful of states and no navigator. Signed out, playing, looking at the
 * preset list, fixing the running order, fixing a chain, or looking at setup —
 * that is the whole of the app, and a routing library for it would be more
 * moving parts than the thing being routed.
 *
 * The status bar at the top is the one thing on every screen: what the link is
 * doing, said in words rather than an icon, because "connected" and "connected
 * to a Mac that stopped answering four minutes ago" look identical as a dot.
 */
export default function App() {
  /*
   * Light, dark, or whatever the phone is set to.
   *
   * "I'm not seeing where the light/dark/auto theme buttons are anymore.
   * Please put that back on Setup." The browser has had all three for a long
   * time; the phone had none and was dark whatever the handset was set to.
   *
   * Subscribed HERE, at the root, and nowhere else. lib/theme swaps the values
   * on the one exported `color` object rather than handing out a new one, so
   * every screen's inline styles pick the new palette up on their next render
   * — and one re-render at the top is every screen's next render. See the note
   * on `color` for why that works and what it depends on.
   */
  useSyncExternalStore(watchTheme, themeVersion, themeVersion)
  useEffect(() => {
    setSystemDark(Appearance.getColorScheme() !== 'light')
    const off = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemDark(colorScheme !== 'light')
    })
    return () => off?.remove?.()
  }, [])

  /** 'checking' | 'out' | 'in' */
  const [auth, setAuth] = useState('checking')
  /* Whether the walkthrough has been through on this phone. Read once, so a
     re-render cannot put somebody back at the start of it. */
  const [seenWalk, setSeenWalk] = useState(true)
  useEffect(() => {
    walkthroughSeen().then(setSeenWalk)
  }, [])
  const [screen, setScreen] = useState('stage')
  /* Which fix the guide opens on, and which screen Done goes back to. */
  const [fixOpen, setFixOpen] = useState(null)
  const [fixFrom, setFixFrom] = useState('settings')
  /* Where Done goes back to, for the same reason `fixFrom` exists: this screen
     is reached from Setup and from the log, and returning somebody to Setup
     from the log they were reading is the wrong room. */
  const [reportFrom, setReportFrom] = useState('settings')
  const [link, setLink] = useState(linkState())

  /*
   * Where a left-edge swipe goes from the screen you are on.
   *
   * The same targets the Done buttons already use, named in one place so the
   * gesture and the button cannot drift into disagreeing. Two of them are not
   * constants — the guide and the feedback form are reached from Setup AND
   * from the log, and returning somebody to Setup from the log they were
   * reading is the wrong room.
   *
   * Nothing for `stage`: it is the bottom of the stack. Nothing for
   * `settings` either — it wraps itself, because it is the one screen with
   * pages inside it and only it knows whether back means its own list or the
   * way out.
   */
  const BACK_TO = {
    presets: 'stage',
    setlists: 'stage',
    edit: 'stage',
    connect: 'settings',
    gear: 'settings',
    log: 'settings',
    report: reportFrom,
    fixes: fixFrom
  }
  const backFrom = BACK_TO[screen] ? () => setScreen(BACK_TO[screen]) : null
  /** The last "picked up 2 setlists from your Mac", until it has been read. */
  const [picked, setPicked] = useState(null)
  /** Whether the five units are up, from the name in the corner. */
  const [pickUnit, setPickUnit] = useState(false)

  /*
   * Whether there is a rig to draw yet.
   *
   * "This is the screen that pops up for about 5 seconds after force closing
   * and reopening the app. Maybe we need a splash screen while it's loading?"
   *
   * What he was looking at was the play screen with nothing in it: SLOT —,
   * Untitled, eight blank scene tiles, an empty chain, Previous and Next both
   * dead. Not a bug — every one of those is the honest answer to a question
   * nobody has got an answer to yet — but it reads as a rig that has lost
   * everything, which is a bad five seconds to hand somebody who is plugging in
   * before a set.
   *
   * So the screen is not drawn until there is something to draw. `capabilities`
   * is the first thing the unit answers with and the thing every other answer's
   * shape depends on, which makes it the honest gate: before it, this app knows
   * nothing about the rig at all.
   *
   * BOUNDED ON BOTH SIDES, because a waiting screen that can wait forever is
   * worse than the empty one it replaced. Joining ends by itself — the relay
   * gives up after twelve seconds and says so — and a read that fails sets an
   * error, which is a thing worth showing rather than waiting through. Either
   * way this falls through to the ordinary screen, where the top bar says NO
   * MAC and the gear is a tap away.
   */
  /*
   * The demo, picked up before anything decides whether to ask for a sign-in.
   *
   * Somebody who was in the demo a second ago has no account and does not want
   * one; asking them to sign in on the way back would be the app forgetting
   * what it was doing.
   */
  const demo = useDemo()

  /*
   * And whether this person has paid to point the app at a real unit.
   *
   * The demo above is the free half of the same question, which is why the two
   * are read together: `demo` says nothing is being driven, `purchase` says
   * whether anything MAY be. Neither is allowed to be a guess — see the effect
   * further down, which is the only thing that raises the paywall.
   */
  const purchase = usePurchase()
  /*
   * ASKED FOR, as opposed to imposed.
   *
   * `auth === 'paywall'` is the gate: somebody with a real rig who has not
   * paid, stopped on the way in. This is the other direction — somebody in
   * the DEMO who has decided they want the thing, or anybody looking for the
   * purchase they already made. It opens over whatever is on screen and closes
   * back to it, because nothing is being withheld: they came looking.
   */
  const [buying, setBuying] = useState(false)

  /*
   * THE WAY BACK TO AN ACCOUNT, FROM ANYWHERE INSIDE THE APP.
   *
   * "I am logged in and it shows this screen and says I still need to unlock.
   * There is no way to login with user name and password after you are in the
   * app on the demo."
   *
   * Both halves of that were true. The demo is a session-less state, so the
   * unlock it is offered is the right one for somebody with no account — and
   * there was no way from there to say "I have one". Setup offered Sign out
   * and nothing else, which is no use to somebody with nothing to sign out of.
   *
   * IT DOES NOT SIGN ANYTHING OUT ON THE WAY. A phone paired by code has a
   * real session, and throwing it away to show a form somebody might back out
   * of would cost them their pairing for nothing. Signing in replaces the
   * session; backing out leaves it exactly as it was, and the demo button on
   * that screen is the way back in.
   *
   * The demo ends here, though: somebody heading for an account is heading for
   * a real rig, and the simulated unit would otherwise still be answering.
   */
  const toSignIn = () => {
    setBuying(false)
    setScreen('stage')
    setDemo(false)
    setAuth('out')
  }
  /*
   * THE TOUR, WHICH THIS END NEVER HAD. "First issue is demo has no
   * tutorial. Very important."
   *
   * Starts hidden and appears only once disk has answered, so somebody who
   * read it last week never sees it flash. It waits for the app to be past
   * the door — there is nothing to tour from a sign-in screen, and a tutorial
   * arriving on top of a real problem is noise over the one message that
   * mattered.
   */

  const caps = useRig(ofCaps)
  const readFailed = useRig(ofError)
  const settling =
    auth === 'in' &&
    !demo &&
    (link.link === 'joining' || (link.link === 'connected' && !caps && !readFailed))

  useEffect(() => subscribeLink(setLink), [])

  /*
   * Setlists and stars, off disk and into memory, once.
   *
   * They are read while a screen renders — what Previous and Next step through
   * is decided during the stage screen's draw — and AsyncStorage cannot be read
   * that way. So the waiting happens here, at launch, and every read after it is
   * immediate. Nothing waits on it: a store that has not landed yet reads as
   * "nothing saved", which is what a fresh install is anyway, and the screens
   * re-draw when it does. See lib/store.
   */
  useEffect(() => {
    /* And the theme, from the same store, as soon as it has landed. Before
       that it is Auto, which follows the handset — the right answer to show
       somebody on their first launch anyway. */
    hydrate().then(() => loadMode(sync))
  }, [])

  /* Ask the store what this person owns. Never throws, never blocks a frame,
     and answers "not locked" to anything it cannot find out. */
  useEffect(() => {
    startPurchases()
  }, [])

  /*
   * THE ONE PLACE THE PAYWALL IS RAISED, and it waits to be sure.
   *
   * Both ways in land on `auth === 'in'` — a code typed just now, and a
   * session left over from last time — so gating either one of them at the
   * door would have meant gating both, in two places, differently. This is
   * after the door instead: whatever let somebody in, the question of whether
   * they may drive a REAL unit is asked here and only here.
   *
   * Every one of the four conditions below is a reason NOT to charge, and
   * three of them are reasons not to be certain:
   *
   *   demo               — free for ever, and the whole point of the free half
   *   purchase.checking  — no answer yet; an unanswered question is not a "no"
   *   !purchase.available— no module, no key, or the store is unreachable
   *   purchase.unlocked  — they paid
   *
   * Which means a cold start on a dead network shows the app, not a paywall.
   * That is deliberate and it is the rule the purchase module is built around:
   * the people most likely to be on bad wifi are the ones standing on a stage,
   * and an app that locks itself there is worse than one that occasionally
   * lets an unpaid launch through.
   */
  useEffect(() => {
    if (shouldAskToPay({ inApp: auth === 'in', demo, ...purchase })) setAuth('paywall')
  }, [auth, demo, purchase.checking, purchase.available, purchase.unlocked])

  /*
   * Keep the end of this run on disk from the first frame.
   *
   * "It crashes within a few minutes and is virtually unusable. I can't get to
   * the log before it crashes." A log that only lives in memory is a log you
   * cannot read about the run that ended — which is every run worth reading.
   */
  useEffect(() => keepLog(), [])

  /*
   * And tell that log when the app falls over.
   *
   * Every crash so far has left a log that ends mid-evening with nothing
   * wrong in it — because the browser installs this and the phone never did.
   * An uncaught error on a phone goes to React Native's own handler, which
   * ends the app in silence; from here it writes a line first, with the
   * message and where it came from, and the line is on disk before the app
   * goes. See installCrashCapture in lib/debugLog.
   */
  useEffect(() => installCrashCapture(), [])

  // A session left over from last time is the ordinary case: a phone that
  // signed in once is a remote, and it should say "Connecting…" from its first
  // frame rather than showing a sign-in form for the second it takes to find
  // out otherwise.
  useEffect(() => {
    let alive = true
    restoreDemo()
      .then((on) => (on ? true : haveSession()))
      .then((id) => alive && setAuth(id ? 'in' : 'out'))
      .catch(() => alive && setAuth('out'))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (auth !== 'in') return undefined
    startLink()
    return () => {
      stopLink()
    }
  }, [auth])

  /*
   * Setlists and stars, kept in step with the Mac.
   *
   * This is the point of them. A night's running order is built at the bench,
   * with a keyboard, and then played from the phone on the stand — so it has to
   * be the same list in both places. lib/cloudSetlists pulls once when the app
   * opens and pushes a couple of seconds after anything changes here.
   *
   * Not tied to the Mac being reachable: this is the account's copy, and fixing
   * tomorrow's running order on the sofa is a thing somebody does with the rig
   * switched off.
   */
  useEffect(() => {
    if (auth !== 'in') return undefined
    /*
     * NOT IN THE DEMO, and this one was costing something real.
     *
     * The demo signs itself in as far as this screen is concerned, so the
     * account sync ran under it — pushing setlists at a database the demo has
     * no business touching, on an account the person looking around may not
     * even have. It is also the opposite of what the demo is for: the point of
     * it is that nothing leaves the phone, so a screen that is slow in the demo
     * is slow for its own reasons.
     */
    if (demo) return undefined
    let alive = true
    let stop = null
    hydrate().then(() => {
      if (alive) stop = keepSetlistsInStep(setPicked)
    })
    return () => {
      alive = false
      stop?.()
    }
  }, [auth, demo])

  /*
   * And what arrived is said out loud.
   *
   * A setlist appearing under Previous and Next without a word would look like
   * the app changing its mind — so it says where it came from, once, and then
   * gets out of the way. Eight seconds: long enough to read between songs,
   * short enough not to be sitting on the stage screen at the next one.
   */
  useEffect(() => {
    if (!picked) return undefined
    const t = setTimeout(() => setPicked(null), 8000)
    return () => clearTimeout(t)
  }, [picked])

  return (
    <SafeAreaProvider>
      {/* The clock and the battery, which have to be readable against whatever
          is behind them: light ink on the dark palette, dark on the light one. */}
      <StatusBar style={isDark() ? 'light' : 'dark'} />
      <SafeAreaView style={{ flex: 1, backgroundColor: color.chassis }} edges={['top', 'bottom']}>
        {auth === 'checking' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={color.silkDim} />
          </View>
        ) : auth === 'out' && !seenWalk ? (
          /*
           * THE WALKTHROUGH IS THE WAY IN, not a thing laid over it.
           *
           * Everything the sign-in screen offers is inside it — the demo, a
           * pairing code, the scanner, the purchase — reached in the order
           * somebody actually needs them rather than as four choices on one
           * screen. Sign-in is still there behind "I already have a pairing
           * code" for anybody who has done this before, and is what they get
           * once this has been through.
           */
          <Onboarding
            onDone={() => {
              markWalkthrough()
              setSeenWalk(true)
              checkOwner()
              setAuth('in')
            }}
            onEnterDemo={() => {
              markWalkthrough()
              setSeenWalk(true)
              setAuth('in')
            }}
            /*
             * Out of the walkthrough and onto the sign-in screen.
             *
             * The walkthrough's way in is a code off a running computer, and
             * somebody already signed in elsewhere has no such code. This is
             * their door: `out` is the state that draws SignIn, which signs
             * in, makes an account and resets a password — all of it already
             * written and tested, rather than a second form here.
             *
             * The walkthrough is marked seen on the way past, the same as
             * every other exit from it. Sending somebody back to the start of
             * a first-run flow they have just walked out of would read as the
             * app forgetting what they did.
             */
            onAccount={() => {
              markWalkthrough()
              setSeenWalk(true)
              setAuth('out')
            }}
          />
        ) : auth === 'out' ? (
          <SignIn
            onSignedIn={() => {
              /* An owner signing in is unlocked from that moment, not from
                 the next launch — the check at startup ran before there was
                 an account to read. */
              checkOwner()
              setAuth('in')
            }}
            onDemo={() => setAuth('in')}
          />
        ) : auth === 'paywall' ? (
          <Paywall
            onSignIn={toSignIn}
            onUnlocked={() => setAuth('in')}
            onDemo={() => {
              /* Out of the paid path entirely: the demo needs no account and
                 no unit, so the leftover session goes with it. */
              setDemo(true)
              signOut().catch(() => {})
              setAuth('in')
            }}
            onBack={() => {
              signOut().catch(() => {})
              setAuth('out')
            }}
          />
        ) : (
          <>
            {/*
              The name in the corner means two things, so it goes two places.
              In the demo it is a CHOICE — five units, and the sheet is one tap
              — and outside it it is a FACT, so it opens Setup where the facts
              are. It used to do the second thing in both cases, which sent
              somebody after the demo picker on a walk through Setup and into
              a page named after pairing a phone.
            */}
            <TopBar
              link={link}
              onOpenSettings={() => setScreen('settings')}
              onUnlock={() => setBuying(true)}
              onOpenUnit={() => (demo ? setPickUnit(true) : setScreen('settings'))}
            />
            <DemoUnit open={pickUnit} onClose={() => setPickUnit(false)} />
            {/* Over the top of whatever is on screen, and gone again on a
                tap. Nothing behind it is being withheld — they came looking
                for this, so Back means back, not out. */}
            {buying ? (
              <Paywall
                asked
                onSignIn={toSignIn}
                onUnlocked={() => setBuying(false)}
                onDemo={() => setBuying(false)}
                onBack={() => setBuying(false)}
              />
            ) : null}
            {picked ? <Arrived picked={picked} /> : null}
            {/*
              The bar stays up while this waits, which is what makes the wait
              safe: whatever happens, Setup is one tap away in the corner.
            */}
            {/*
              SWIPE IN FROM THE LEFT TO GO BACK ONE STEP, on every screen that
              has a way back.

              "Swiping back should always take them to the previous screen."

              One wrapper rather than one per screen, because the thing it
              needs to know — where back IS from here — already lives here, in
              the same `onBack` each screen is handed a line below. Settings
              is the exception and carries its own: it is the only screen with
              pages INSIDE it, so only it can say whether back means its own
              list or the stage.

              `null` on the stage screen itself: there is nowhere behind it,
              and a gesture that does nothing is worse than none at all.
            */}
            <EdgeBack onBack={backFrom}>
            {settling && screen === 'stage' ? (
              <Waking link={link} />
            ) : screen === 'presets' ? (
              <Presets onBack={() => setScreen('stage')} />
            ) : screen === 'setlists' ? (
              <Setlists onBack={() => setScreen('stage')} />
            ) : BENCH && screen === 'edit' ? (
              <Edit onBack={() => setScreen('stage')} />
            ) : screen === 'connect' ? (
              <Connect onBack={() => setScreen('settings')} />
            ) : screen === 'gear' ? (
              <Gear onBack={() => setScreen('settings')} />
            ) : screen === 'log' ? (
              /* And a way to send it from the one screen where somebody is
                 already looking at the thing worth sending. Copying the log
                 and pasting it into a message later, from another device,
                 after the gig, was the only route there had ever been. */
              <Log
                onBack={() => setScreen('settings')}
                onReport={() => {
                  setReportFrom('log')
                  setScreen('report')
                }}
              />
            ) : screen === 'report' ? (
              <Report onBack={() => setScreen(reportFrom)} />
            ) : screen === 'fixes' ? (
              /* Works with the computer off, which is exactly when it is
                 wanted. The version it can check is the one the computer last
                 told us; with nothing there it says so.

                 `back` is where Done returns to, because this screen is
                 reached two ways: from Setup, and from an error on the stage
                 screen. Coming back to Setup from an error you hit while
                 playing would be the wrong room. */
              <Fixes
                onBack={() => setScreen(fixFrom)}
                open={fixOpen}
                hostVersion={link.hostVersion}
              />
            ) : screen === 'settings' ? (
              <Settings
                onUnlock={() => setBuying(true)}
                onSignIn={toSignIn}
                link={link.link}
                macName={link.macName}
                hostVersion={link.hostVersion}
                onBack={() => setScreen('stage')}
                /* Works with the Mac off: it is a reference sheet, not a
                   question for the unit. */
                onOpenGear={() => setScreen('gear')}
                /* Back to the start of the walkthrough. It replaces the
                   whole app while it is up, the same as on a first run. */
                onReplay={() => {
                  setScreen('stage')
                  setSeenWalk(false)
                  setAuth('out')
                }}
                /* The screen somebody needs most when nothing is connected,
                   which is exactly when the rest of Setup can do nothing. */
                onOpenConnect={() => setScreen('connect')}
                /* Works with the Mac off, and is most wanted when it is off. */
                onOpenLog={() => setScreen('log')}
                /* Works signed out and with the Mac off, which is when most of
                   what people want to complain about happens. */
                onOpenReport={() => {
                  setReportFrom('settings')
                  setScreen('report')
                }}
                /* Same, and more so: a guide to what to try is the one screen
                   that has to work when nothing else does. */
                onOpenFixes={() => {
                  setFixOpen(null)
                  setFixFrom('settings')
                  setScreen('fixes')
                }}
                onReconnect={probeNow}
                onSignOut={async () => {
                  /*
                   * The loop stops before the session goes, not after. Left
                   * running, its next turn tries to rejoin an account that is
                   * on its way out and lands on the sign-in screen as an error
                   * about not being signed in — which is true, and is not
                   * something anyone needs telling after tapping Sign out.
                   */
                  await stopLink()
                  await signOut()
                  setScreen('stage')
                  setAuth('out')
                }}
              />
            ) : (
              <Stage
                /* An error on the stage screen can name the fix for it, and
                   Done comes back here rather than to Setup. */
                onOpenFix={(id) => {
                  setFixOpen(id)
                  setFixFrom('stage')
                  setScreen('fixes')
                }}
                /* Only once the Mac is answering: a list of slot numbers with
                   no names behind them is a screen that cannot do its one job. */
                onOpenPresets={
                  link.link === 'connected' ? () => setScreen('presets') : null
                }
                /*
                 * The setlist, unlike the preset list, works with the Mac off.
                 * It is storage and nothing else — the running order for
                 * tonight is a thing you fix on the sofa, and refusing to open
                 * it because the rig is not plugged in would be refusing the
                 * one screen in this app that never needed the rig.
                 */
                onOpenSetlists={() => setScreen('setlists')}
                /*
                 * The bench, behind the switch in lib/features for this release.
                 * Only once the Mac is answering either way: every control on
                 * that screen is read off the unit, so with nothing on the other
                 * end it is a screen of empty knobs.
                 */
                onOpenEdit={
                  BENCH && link.link === 'connected' ? () => setScreen('edit') : null
                }
                onUnlock={() => setBuying(true)}
              />
            )}
            </EdgeBack>
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

/**
 * What the account just handed this phone, in a sentence.
 *
 * Only ever drawn when something actually arrived — `gained` counts the
 * setlists and stars this phone did not already have, so a sync that changed
 * nothing says nothing.
 */
function Arrived({ picked }) {
  const parts = []
  if (picked.gained?.lists) {
    parts.push(`${picked.gained.lists} setlist${picked.gained.lists === 1 ? '' : 's'}`)
  }
  if (picked.gained?.stars) {
    parts.push(`${picked.gained.stars} star${picked.gained.stars === 1 ? '' : 's'}`)
  }
  if (!parts.length) return null
  return (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
      <Note>{`Picked up ${parts.join(' and ')} from ${picked.from || 'your other device'}.`}</Note>
    </View>
  )
}

const ofCaps = (s) => s.capabilities
const ofError = (s) => s.error

/**
 * The few seconds before there is a rig to show, said out loud.
 *
 * One line, in the words of the thing actually happening, because "Loading…"
 * over a spinner tells somebody standing in front of a silent rig nothing they
 * can act on — and what they can act on is usually the Mac.
 */
function Waking({ link }) {
  const said =
    link.link === 'connected'
      ? 'Asking your unit what it is\u2026'
      : `Finding ${link.macName || 'your computer'}\u2026`
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl }}
    >
      <ActivityIndicator color={color.silkDim} />
      <Text style={{ color: color.silkDim, fontSize: font.body, textAlign: 'center' }}>{said}</Text>
    </View>
  )
}
