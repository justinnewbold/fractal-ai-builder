import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { color, font, space } from './src/lib/theme'
import { haveSession, linkState, probeNow, startLink, stopLink, subscribeLink } from './src/lib/link'
import { signOut } from './src/lib/relay'
import Note from './src/components/Note'
import TopBar from './src/components/TopBar'
import Settings from './src/screens/Settings'
import SignIn from './src/screens/SignIn'
import Edit from './src/screens/Edit'
import Connect from './src/screens/Connect'
import Gear from './src/screens/Gear'
import Log from './src/screens/Log'
import Presets from './src/screens/Presets'
import Setlists from './src/screens/Setlists'
import Stage from './src/screens/Stage'
import Tone from './src/screens/Tone'
import { loadPlayMode, toneWayIn } from './src/lib/playMode'
import { hydrate } from './src/lib/store'
import { keepSetlistsInStep } from './src/lib/cloudSetlists'
import { useRig } from './src/lib/rig'
import { keepLog } from './src/lib/logKeep'
import { restoreDemo, useDemo } from './src/lib/demo'
import { AI, BENCH } from './src/lib/features'

/**
 * Fractal Remote.
 *
 * A handful of states and no navigator. Signed out, playing, looking at the
 * preset list, fixing the running order, looking at setup, or asking for a
 * tone — that is the whole of the app, and a routing library for it would be
 * more moving parts than the thing being routed.
 *
 * All but the last of those in a shipping build: the tone screen is behind the
 * AI switch in lib/features.js, which is off for the first release. The route
 * is still written here rather than removed, because it goes back on in a later
 * update and the difference is one word.
 *
 * The status bar at the top is the one thing on every screen: what the link is
 * doing, said in words rather than an icon, because "connected" and "connected
 * to a Mac that stopped answering four minutes ago" look identical as a dot.
 */
export default function App() {
  /** 'checking' | 'out' | 'in' */
  const [auth, setAuth] = useState('checking')
  const [screen, setScreen] = useState('stage')
  const [link, setLink] = useState(linkState())
  /*
   * null until the setting has been read back — which is not the same as "not
   * playing", and is why the tone button stays away rather than appearing and
   * then being taken back. AsyncStorage cannot be read synchronously the way
   * the browser reads localStorage.
   */
  const [playing, setPlaying] = useState(null)
  /** The last "picked up 2 setlists from your Mac", until it has been read. */
  const [picked, setPicked] = useState(null)

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
    hydrate()
  }, [])

  /*
   * Keep the end of this run on disk from the first frame.
   *
   * "It crashes within a few minutes and is virtually unusable. I can't get to
   * the log before it crashes." A log that only lives in memory is a log you
   * cannot read about the run that ended — which is every run worth reading.
   */
  useEffect(() => keepLog(), [])

  useEffect(() => {
    /* Nothing to hide with the AI off, and asking costs a read of storage on
       every launch to answer a question nobody can act on. See lib/features.js. */
    if (!AI) return undefined
    let alive = true
    loadPlayMode().then((on) => alive && setPlaying(on))
    return () => {
      alive = false
    }
  }, [])

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
    let alive = true
    let stop = null
    hydrate().then(() => {
      if (alive) stop = keepSetlistsInStep(setPicked)
    })
    return () => {
      alive = false
      stop?.()
    }
  }, [auth])

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
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1, backgroundColor: color.chassis }} edges={['top', 'bottom']}>
        {auth === 'checking' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={color.silkDim} />
          </View>
        ) : auth === 'out' ? (
          <SignIn onSignedIn={() => setAuth('in')} onDemo={() => setAuth('in')} />
        ) : (
          <>
            <TopBar link={link} onOpenSettings={() => setScreen('settings')} />
            {picked ? <Arrived picked={picked} /> : null}
            {/*
              The bar stays up while this waits, which is what makes the wait
              safe: whatever happens, Setup is one tap away in the corner.
            */}
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
              <Log onBack={() => setScreen('settings')} />
            ) : AI && screen === 'tone' ? (
              <Tone onBack={() => setScreen('stage')} />
            ) : screen === 'settings' ? (
              <Settings
                link={link.link}
                macName={link.macName}
                hostVersion={link.hostVersion}
                playing={playing}
                onPlayMode={setPlaying}
                onBack={() => setScreen('stage')}
                /* Works with the Mac off: it is a reference sheet, not a
                   question for the unit. */
                onOpenGear={() => setScreen('gear')}
                /* The screen somebody needs most when nothing is connected,
                   which is exactly when the rest of Setup can do nothing. */
                onOpenConnect={() => setScreen('connect')}
                /* Works with the Mac off, and is most wanted when it is off. */
                onOpenLog={() => setScreen('log')}
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
                /* Absent rather than disabled when play mode is on, so the row
                   closes up instead of keeping a dead button. */
                onOpenTone={
                  AI && toneWayIn({ connected: link.link === 'connected', playing })
                    ? () => setScreen('tone')
                    : null
                }
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
              />
            )}
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
