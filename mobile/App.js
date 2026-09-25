import { useEffect, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Alert, Appearance, BackHandler, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { color, font, space, isDark, loadMode, setSystemDark, themeVersion, watchTheme } from './src/lib/theme'
import { haveSession, linkState, probeNow, startLink, stopLink, subscribeLink } from './src/lib/link'
import { currentAccount, signOut } from './src/lib/relay'
import { useComputerElsewhere } from './src/lib/useComputerElsewhere'
import { isPairAccount } from './src/lib/pairing'
import Note from './src/components/Note'
import Press from './src/components/Press'
import TopBar from './src/components/TopBar'
import WrongAccount from './src/components/WrongAccount'
import UpdateReady from './src/components/UpdateReady'
import { watchForUpdates } from './src/lib/updates'
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
import { clearLinkFault, useRig } from './src/lib/rig'
import { keepLog } from './src/lib/logKeep'
import { installCrashCapture } from './src/lib/debugLog'
import { restoreDemo, setDemo, useDemo } from './src/lib/demo'
import { BENCH } from './src/lib/features'
import Paywall from './src/screens/Paywall'
import { checkOwner, linkAccount, startPurchases, unlinkAccount, usePurchase } from './src/lib/purchases'
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
  /*
   * Whether the walkthrough has been through on this phone. Read once, so a
   * re-render cannot put somebody back at the start of it.
   *
   * NULL UNTIL STORAGE ANSWERS, rather than a guess either way.
   *
   * It used to start `true` — "assume seen" — because the alternative puts a
   * returning player at the start of a first-run flow for a frame. But that
   * is a guess, and the guess is wrong for everybody on their first launch:
   * the two reads that decide the opening screen race each other, and if the
   * session check lands first, a brand-new install draws the SIGN-IN screen
   * for a moment before the walkthrough replaces it.
   *
   * There is a third answer — not knowing — and the spinner below already
   * exists for exactly that. Both reads are a fraction of a second, and one
   * spinner is honest where either guess is a screen somebody saw and did
   * not ask for.
   */
  const [seenWalk, setSeenWalk] = useState(null)
  /*
   * Whether the walkthrough is up because somebody ASKED to see it again.
   *
   * A first run and a replay draw the same screens and mean opposite things.
   * On a first run every button is the next step; on a replay the person is
   * already set up and every one of them is wrong, so the replay gets a way
   * out that changes nothing.
   */
  const [replaying, setReplaying] = useState(false)
  useEffect(() => {
    walkthroughSeen().then(setSeenWalk)
  }, [])
  const [screen, setScreen] = useState('stage')
  /*
   * WHICH PAGE OF SETTINGS, because Settings has pages inside it and the
   * app could only ever open it at the top.
   *
   * "This screen is supposed to pull up when you tap the unit name in the
   * top left of the screen, and it works fine on one platform, then not the
   * other." The browser opened Phone & computer from the unit name; the
   * phone opened the Settings list and left the last step to the thumb. Now
   * the name opens the page, the wrong-account warning opens it too, and
   * Settings reports the page it is on, so coming back from a screen it
   * opened (Connect a computer, the reference sheet) lands where you were.
   * The gear always opens the list. `visit` makes a fresh open start fresh
   * even when Settings is already on screen.
   */
  const [settingsAt, setSettingsAt] = useState(null)
  const [settingsVisit, setSettingsVisit] = useState(0)
  const openSettings = (at = null) => {
    setSettingsAt(at)
    setSettingsVisit((n) => n + 1)
    setScreen('settings')
  }
  /* Which fix the guide opens on, and which screen Done goes back to. */
  const [fixOpen, setFixOpen] = useState(null)
  const [fixFrom, setFixFrom] = useState('settings')
  /* Troubleshooting, open on the fix for a link that will not come up, and
     Done comes back to the stage. */
  const openConnectFix = () => {
    setFixOpen('connect')
    setFixFrom('stage')
    setScreen('fixes')
  }
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

  /*
   * ANDROID'S BACK BUTTON, AND ITS BACK GESTURE.
   *
   * "When pressing Android back button on every screen that has a Done
   * button, it exits the app. Maybe it would be advantageous to close that
   * window and go back to the previous screen." Nothing was listening, so
   * Android did its default, which is to close the app.
   *
   * Now it goes one step back, the same place the swipe from the edge goes,
   * or to Play from a screen with only Done. Settings and the amp and pedal
   * page listen for themselves first, because they have pages inside them.
   *
   * On Play itself, in the demo: "have a little pop-up that says Exit demo?
   * If yes, same action as the exit demo button." Only for somebody who has
   * the Exit demo button, which is somebody who has paid. Everywhere else on
   * Play, back does what Android always does and leaves the app.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (buying) {
        setBuying(false)
        return true
      }
      if (auth !== 'in') return false
      if (screen !== 'stage') {
        setScreen(BACK_TO[screen] || 'stage')
        return true
      }
      if (demo && purchase.unlocked) {
        Alert.alert('Exit demo?', 'Back to your own rig.', [
          { text: 'Stay', style: 'cancel' },
          { text: 'Exit demo', onPress: () => setDemo(false) }
        ])
        return true
      }
      return false
    })
    return () => sub.remove()
  })
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

  /*
   * THE BAR AND THE RED NOTE, TOLD THE SAME NEWS.
   *
   * "Says I'm not connected to the computer, but it also says I'm connected."
   *
   * Both were drawn from the truth at the time, and only one of them was kept
   * up to date. At launch the relay has not joined, the first read throws
   * "Not connected to your computer.", and the note says so — correctly. A
   * second later the channel joins, the bar turns green, the chain arrives,
   * and the note is still underneath it saying the opposite, with a "what to
   * try" button under THAT.
   *
   * refreshAll already cleared the note when a detect SUCCEEDED, which is why
   * this looked fixed. It is not the same moment: the note he photographed
   * was set by a read that failed just after one had worked, while the relay
   * was still coming up. The link arriving is the other half of that
   * evidence, and this is the only place that hears it.
   *
   * Only a complaint ABOUT the link goes; see rig.clearLinkFault. A unit that
   * refused a write is still worth reading after a reconnect.
   */
  useEffect(
    () =>
      subscribeLink((next) => {
        setLink(next)
        clearLinkFault(next.link)
      }),
    []
  )

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
   * THE DEMO IS NOT AN ACCOUNT, AND WHEN IT ENDS THE APP HAS TO ADMIT THAT.
   *
   * "Right now I'm not signed in and it's still letting me use it... the user
   * should be required to either sign in if they already have a sign in or
   * sign up right after they unlock it and they shouldn't be able to get past
   * that screen."
   *
   * He is right, and the hole is mine. `auth` goes to 'in' on startup if the
   * demo is on OR a session is found — the demo needs no account, which is
   * the whole point of it. That was honest while the only way out of the demo
   * was a button nobody pressed by accident. Then 1.56.0 made a purchase end
   * the demo, which is correct, and left 'in' standing behind it: the live
   * app, unlocked, signed in to nothing, reaching nothing, with no sign of
   * anything wrong.
   *
   * So 'in' has to keep meaning what it meant. Whenever the demo goes off,
   * the session is asked for again, and a phone that has not got one goes to
   * the sign-in screen — which is also where the purchase gets claimed, since
   * SignIn's onSignedIn calls linkAccount.
   *
   * On the demo ending rather than on the purchase, deliberately: leaving by
   * the Exit demo button has the same gap, and a check on the state cannot be
   * forgotten by a route added later.
   *
   * Nobody is stranded. The sign-in screen signs in, makes an account, resets
   * a password, and still offers the demo.
   */
  useEffect(() => {
    if (demo || auth !== 'in') return undefined
    let alive = true
    haveSession()
      .then((id) => alive && !id && setAuth('out'))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [demo, auth])

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

  /* Ask about updates in the background, and offer a downloaded one as a
     restart — see watchForUpdates and components/UpdateReady. */
  useEffect(() => watchForUpdates(), [])

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

  /*
   * THE LINK, AND IT HAS TO WATCH THE DEMO TOO.
   *
   * "This says I'm connected to an AM4 which I have not connected to in
   * weeks. I exited the demo and that's what it shows."
   *
   * It did. Leaving the demo left the whole screen dressed as a live rig: the
   * AM4's name in the bar, its 104 slots, its four scenes, its chain, and
   * CONNECTED in green beside them.
   *
   * WHY. startLink() short-circuits in the demo — there is no far end to poll,
   * so it sets `link: 'connected', macName: 'the demo'` and returns. Correct
   * while the demo is on; the bar says DEMO rather than CONNECTED because
   * TopBar asks the demo store, not the link.
   *
   * But this effect depended on `auth` alone. Turning the demo off does not
   * touch `auth` — Settings' "Leave the demo" calls setDemo(false) and nothing
   * else — so the effect never re-ran, stopLink() never happened, and that
   * made-up 'connected' stayed. The word in the bar changed from DEMO to
   * CONNECTED the moment `demo` went false, and every number under it was
   * still the simulation's.
   *
   * Depending on `demo` as well is the whole fix: the cleanup runs stopLink(),
   * which resets the rig store and the link state, and startLink() then does
   * the real work with the demo off. It is right in the other direction too —
   * entering the demo now clears a real rig's presets instead of leaving them
   * under a simulated unit's name.
   *
   * remoteDisconnect() drops the channel, not the account, so the session is
   * still there to rejoin with.
   */
  useEffect(() => {
    if (auth !== 'in') return undefined
    startLink()
    return () => {
      stopLink()
    }
  }, [auth, demo])

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
        {/* Not until BOTH answers are in: which screen opens depends on the
            two of them together, and acting on the first to arrive is what
            flashed a sign-in form at somebody's first launch. */}
        {auth === 'checking' || seenWalk === null ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={color.silkDim} />
          </View>
        ) : seenWalk === false ? (
          /*
           * NOT `auth === 'out' && !seenWalk`, WHICH IS THE BUG THIS LINE HAD.
           *
           * "The show me the walkthrough isn't working anymore from the
           * settings menu. When you click it you feel the haptic feedback, but
           * then it doesn't go to the screen."
           *
           * It used to be true for a replay only because asking to see the
           * walkthrough again ALSO set the app to signed-out — the very thing
           * that made a replay cost somebody their unlock, and which 1.15.0
           * took out. Take that away and a signed-in person setting seenWalk
           * false meets a condition that is still false: the flag flips, the
           * screen does not, and the tap is a haptic and nothing else.
           *
           * The walkthrough being up is `seenWalk`'s business alone. Who is
           * signed in decides what comes AFTER it, which is what the branches
           * below are for.
           *
           * THE WALKTHROUGH IS THE WAY IN, not a thing laid over it.
           *
           * It explains the arrangement, starts the demo, and hands over to
           * the sign-in screen for anybody joining a phone to a computer —
           * reached in the order somebody actually needs them rather than as
           * four choices on one screen.
           *
           * AND IT NO LONGER HAS AN `onDone`. That finished a walkthrough
           * which had just paired a phone with a code: marked the walkthrough
           * seen, asked whether this account is an owner, and put the app in.
           * No route through it ends that way now — signing in leaves the
           * walkthrough, and the sign-in screen's own onSignedIn does those
           * same two things. The demo has onEnterDemo.
           */
          <>
            <Onboarding
              replay={replaying}
            /*
             * Out, and nothing else. No account touched, no demo started, no
             * walkthrough state rewound — they came to look at it.
             */
            onClose={() => {
              markWalkthrough()
              setSeenWalk(true)
              setReplaying(false)
            }}
            onEnterDemo={() => {
              markWalkthrough()
              setSeenWalk(true)
              setReplaying(false)
              setAuth('in')
            }}
            /* The same, and straight on to Settings, where the walkthrough
               can be shown again: the row at the foot of the last page. */
            onSettings={() => {
              markWalkthrough()
              setSeenWalk(true)
              setReplaying(false)
              setAuth('in')
              openSettings()
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
              setReplaying(false)
              setAuth('out')
            }}
              /*
               * THE UNLOCK BUTTON BUYS THE APP, which it did not until now.
               *
               * "The unlock button and the two buttons at the bottom where it
               * says sign in and the button where it says restore purchase,
               * all take you to the other screen." Three buttons saying three
               * different things, all landing on the sign-in form — because
               * this one advanced the walkthrough rather than opening the
               * paywall, and the walkthrough's next step is sign-in.
               */
              onUnlock={() => setBuying(true)}
            />
            {/*
              AND THE PAYWALL IS DRAWN HERE TOO, or that button does nothing.

              The other one lives inside the signed-in branch, which the
              walkthrough is not, so `buying` could go true and nothing would
              appear. A button that fires a haptic and changes no pixels is
              worse than the wrong screen.

              `onUnlocked` goes to sign-in rather than just closing. A purchase
              is anonymous until an account claims it — which is exactly how
              Justin's own test purchase landed on a handset id instead of on
              him — and SignIn's linkAccount is what claims it. An account is
              needed to reach the computer anyway, so this is a step earlier,
              not a step extra.
            */}
            {buying ? (
              <Paywall
                asked
                /*
                 * Out of the walkthrough as well as into the sign-in. toSignIn
                 * alone set auth to 'out' and left the walkthrough standing —
                 * it is drawn ahead of the sign-in screen — so the sheet closed
                 * and nothing else happened: "Sign in with an email and
                 * password" did nothing at all from here.
                 */
                onSignIn={() => {
                  markWalkthrough()
                  setSeenWalk(true)
                  setReplaying(false)
                  toSignIn()
                }}
                onUnlocked={() => {
                  setBuying(false)
                  markWalkthrough()
                  setSeenWalk(true)
                  setReplaying(false)
                  setAuth('out')
                }}
                onDemo={() => {
                  setBuying(false)
                  setDemo(true)
                  markWalkthrough()
                  setSeenWalk(true)
                  setReplaying(false)
                  setAuth('in')
                }}
                onBack={() => setBuying(false)}
              />
            ) : null}
          </>
        ) : auth === 'out' ? (
          <>
          <SignIn
            onSignedIn={() => {
              /* An owner signing in is unlocked from that moment, not from
                 the next launch — the check at startup ran before there was
                 an account to read. */
              checkOwner()
              /* And so is somebody who bought this on another phone. The
                 purchase follows the account, so signing in is what tells
                 RevenueCat which account to answer for. */
              linkAccount()
              /*
               * AND THE DEMO ENDS, because signing in is heading for a real
               * rig. "When I sign in, it takes me directly to the demo."
               *
               * The way OUT to this screen already cleared it — toSignIn does
               * — but the way back IN did not, so somebody who tapped Try the
               * Demo from the sign-in form, looked around, then signed in,
               * came back to a simulated unit with their real one waiting.
               *
               * The two halves of one door now agree.
               */
              setDemo(false)
              setAuth('in')
            }}
            onDemo={() => setAuth('in')}
            /* The note on that screen says to unlock first, and this is the
               button it now has for it. */
            onUnlock={() => setBuying(true)}
          />
          {/* Drawn in this branch too, or the sign-in screen's Unlock would
              set `buying` and nothing would appear. Unlocking lands back on
              the form, which then turns into Create Account by itself. */}
          {buying ? (
            <Paywall
              asked
              onSignIn={() => setBuying(false)}
              onUnlocked={() => setBuying(false)}
              onDemo={() => {
                setBuying(false)
                setDemo(true)
                setAuth('in')
              }}
              onBack={() => setBuying(false)}
            />
          ) : null}
          </>
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
              onOpenSettings={() => openSettings()}
              onUnlock={() => setBuying(true)}
              onOpenUnit={() => (demo ? setPickUnit(true) : openSettings('link'))}
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
            {/* A downloaded update, offered as a restart — never taken on its own. */}
            <UpdateReady />
            {/* A computer on another account, said on the stage too and not
                only in Setup — Waking says it for itself while it is up. */}
            <WrongAccount
              active={auth === 'in' && !demo && !settling && screen === 'stage' && link.link !== 'connected'}
              onSwitch={() => openSettings('link')}
              onTroubleshoot={openConnectFix}
            />
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
              <Waking
                link={link}
                onRetry={probeNow}
                onSwitch={() => openSettings('link')}
                onTroubleshoot={openConnectFix}
              />
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
                key={settingsVisit}
                startPage={settingsAt}
                onPage={setSettingsAt}
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
                /*
                 * Back to the start of the walkthrough — and NOTHING ELSE.
                 *
                 * This used to set the app to signed-out on the way. It did
                 * not drop the session, but it meant the walkthrough's exits
                 * were the only way back in, and the one that looked like a
                 * way forward started the demo — which takes somebody off the
                 * rig they were driving. "Now my only option is to start the
                 * demo again, which made me re sign in again to unlock."
                 *
                 * It replaces the whole app while it is up, the same as on a
                 * first run; who is signed in is none of its business.
                 */
                onReplay={() => {
                  setScreen('stage')
                  setReplaying(true)
                  setSeenWalk(false)
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
                  /* Stop answering as that person. It never takes an unlock
                     away — see unlinkAccount — so somebody who bought on this
                     phone and signed out of an account keeps what they paid
                     for. */
                  unlinkAccount().catch(() => {})
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
                  /* The demo is its own far end: always answering. */
                  demo || link.link === 'connected' ? () => setScreen('presets') : null
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
                  BENCH && (demo || link.link === 'connected') ? () => setScreen('edit') : null
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
/* How long "Finding your computer…" stands on its own before it says more. */
const WAKING_LONG_MS = 15000

function Waking({ link, onRetry, onSwitch, onTroubleshoot }) {
  const said =
    link.link === 'connected'
      ? 'Asking your unit what it is\u2026'
      : `Finding ${link.macName || 'your computer'}\u2026`
  /*
   * WHICH ACCOUNT THIS IS, while it looks. "Shouldn't we have it say when
   * it's trying to connect, say, make sure you're connected to your computer
   * using and then show the user's email address?" — the night the browser
   * would not connect, it was signed in as a second account and nothing said
   * so. Only while it is still finding the computer: once the computer has
   * answered, the account was right.
   */
  const [email, setEmail] = useState(null)
  useEffect(() => {
    let live = true
    currentAccount().then((a) => live && setEmail(a?.email && !isPairAccount(a.email) ? a.email : null))
    return () => {
      live = false
    }
  }, [])
  /*
   * AND IT STOPS JUST SPINNING. "Been stuck on connecting screen for over a
   * minute on iOS. How long until it times out and displays troubleshooting
   * or refresh button. I usually force close." It never did: a join that
   * fails goes back to joining, so this screen could spin for as long as the
   * app was open, with nothing to press. After fifteen seconds it says what
   * to check — the phone's own sentence from Setup — and offers the same
   * button Setup has. The gear is still up top for a different account.
   *
   * That night the phone was signed in as one account and the computer as
   * another, and the line above names the one this phone is using.
   */
  const [long, setLong] = useState(false)
  useEffect(() => {
    setLong(false)
    const t = setTimeout(() => setLong(true), WAKING_LONG_MS)
    return () => clearTimeout(t)
  }, [link.link])
  /*
   * AND WHEN THE ACCOUNTS DON'T MATCH, IT SAYS SO. "I was signed into the
   * wrong account, but it didn't notify me at all… Please be clear which
   * account needs to be trying to sign into, or which one it is signing into,
   * and they don't match somehow." A computer on another account never
   * hears this phone, and until now that looked exactly like a computer that
   * was off. The account server can tell: a computer on this wifi, signed
   * into a different account, is a yes (lib/useComputerElsewhere.js).
   */
  const elsewhere = useComputerElsewhere(long && link.link !== 'connected')
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl }}
    >
      <ActivityIndicator color={color.silkDim} />
      <Text style={{ color: color.silkDim, fontSize: font.body, textAlign: 'center' }}>{said}</Text>
      {email && link.link !== 'connected' ? (
        <Text style={{ color: color.silkFaint, fontSize: font.small, textAlign: 'center' }}>
          {'Make sure you’re connected to your computer using '}
          <Text style={{ color: color.silkDim, fontWeight: '700' }}>{email}</Text>.
        </Text>
      ) : null}
      {long && link.link !== 'connected' ? (
        <View style={{ alignSelf: 'stretch', gap: space.md }}>
          {elsewhere ? (
            <Note tone="fault">
              {email
                ? `The computer on this wifi is signed into a different account. This phone is signed in as ${email}. Sign the Fractal app on the computer in with ${email}, or sign this phone into the computer’s account.`
                : 'The computer on this wifi is signed into a different account than this phone. Sign both into the same account.'}
            </Note>
          ) : (
            <Note tone="warn">
              Open the Fractal app on the computer and make sure the computer is awake. This keeps trying on
              its own.
            </Note>
          )}
          {elsewhere && onSwitch ? <Press label="Switch account on this phone" onPress={onSwitch} /> : null}
          <Press label="Look for the computer again" onPress={() => onRetry?.()} />
          {/* "Open the troubleshooting if it doesn't connect" — the browser's
              connecting screen has the same button. */}
          {onTroubleshoot ? <Press label="Troubleshooting" onPress={onTroubleshoot} /> : null}
        </View>
      ) : null}
    </View>
  )
}
