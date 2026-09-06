import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { color, font, space } from './src/lib/theme'
import { haveSession, linkState, probeNow, startLink, stopLink, subscribeLink } from './src/lib/link'
import { signOut } from './src/lib/relay'
import Lamp from './src/components/Lamp'
import Settings from './src/screens/Settings'
import SignIn from './src/screens/SignIn'
import Stage from './src/screens/Stage'

/**
 * Fractal Remote.
 *
 * Three states and no navigator. Signed out, playing, or looking at setup —
 * that is the whole of the app, and a routing library for it would be more
 * moving parts than the thing being routed.
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

  useEffect(() => subscribeLink(setLink), [])

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
            {screen === 'settings' ? (
              <Settings
                link={link.link}
                macName={link.macName}
                onBack={() => setScreen('stage')}
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
              <Stage onOpenSettings={() => setScreen('settings')} />
            )}
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
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
