import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { color, font, space } from './src/lib/theme'
import { haveSession, linkState, probeNow, startLink, stopLink, subscribeLink } from './src/lib/link'
import { signOut } from './src/lib/relay'
import Lamp from './src/components/Lamp'
import Note from './src/components/Note'
import Settings from './src/screens/Settings'
import SignIn from './src/screens/SignIn'
import Edit from './src/screens/Edit'
import Gear from './src/screens/Gear'
import Log from './src/screens/Log'
import Presets from './src/screens/Presets'
import Setlists from './src/screens/Setlists'
import Stage from './src/screens/Stage'
import Tone from './src/screens/Tone'
import { loadPlayMode, toneWayIn } from './src/lib/playMode'
import { hydrate } from './src/lib/store'
import { keepSetlistsInStep } from './src/lib/cloudSetlists'
import { AI } from './src/lib/features'

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
    haveSession().then((id) => alive && setAuth(id ? 'in' : 'out'))
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
          <SignIn onSignedIn={() => setAuth('in')} />
        ) : (
          <>
            <LinkBar link={link} />
            {picked ? <Arrived picked={picked} /> : null}
            {screen === 'presets' ? (
              <Presets onBack={() => setScreen('stage')} />
            ) : screen === 'setlists' ? (
              <Setlists onBack={() => setScreen('stage')} />
            ) : screen === 'edit' ? (
              <Edit onBack={() => setScreen('stage')} />
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
                playing={playing}
                onPlayMode={setPlaying}
                onBack={() => setScreen('stage')}
                /* Works with the Mac off: it is a reference sheet, not a
                   question for the unit. */
                onOpenGear={() => setScreen('gear')}
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
                onOpenSettings={() => setScreen('settings')}
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
                 * The bench. Only once the Mac is answering: every control on
                 * that screen is read off the unit, so with nothing on the
                 * other end it is a screen of empty knobs.
                 */
                onOpenEdit={link.link === 'connected' ? () => setScreen('edit') : null}
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

/**
 * One line, always in the same place, saying whether what you are looking at is
 * still true.
 *
 * Nothing here says channel, relay, or the name of the account service. The
 * question a player has is "is this thing still driving my rig", and these are
 * the four honest answers to it.
 */
function LinkBar({ link }) {
  const said =
    link.link === 'connected'
      ? `Connected to ${link.macName || 'your Mac'}`
      : link.link === 'joining'
        ? 'Finding your Mac…'
        : link.link === 'no-answer'
          ? 'Your Mac isn’t answering'
          : 'Not connected'

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderBottomWidth: 1,
        borderBottomColor: color.rule,
        backgroundColor: color.panel
      }}
    >
      <Lamp
        state={link.link === 'connected' ? 'live' : link.link === 'no-answer' ? 'fault' : 'idle'}
      />
      <Text numberOfLines={1} style={{ color: color.silkDim, fontSize: font.small, flex: 1 }}>
        {said}
      </Text>
    </View>
  )
}
