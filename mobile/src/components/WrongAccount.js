import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { currentAccount } from '../lib/relay'
import { isPairAccount } from '../lib/pairing'
import { useComputerElsewhere } from '../lib/useComputerElsewhere'
import { space } from '../lib/theme'
import Note from './Note'
import Press from './Press'

/**
 * The computer on this wifi is on another account, said on the stage screen.
 *
 * "When the app is signed in on the wrong account it should say so on the
 * main screen, not just in settings."
 *
 * Waking already said it — but only for the first stretch after launch. Once
 * the app had a rig to draw it moved on to the stage, and from there the one
 * place that knew was Setup: a grid of numbered scenes, an Untitled preset,
 * DISCONNECTED in the corner and nothing saying why. The same question and the
 * same sentence as Waking, asked while the link is down.
 */
export default function WrongAccount({ active, onSwitch }) {
  const elsewhere = useComputerElsewhere(active)
  const [email, setEmail] = useState(null)
  useEffect(() => {
    if (!elsewhere) return undefined
    let live = true
    currentAccount().then((a) => live && setEmail(a?.email && !isPairAccount(a.email) ? a.email : null))
    return () => {
      live = false
    }
  }, [elsewhere])
  if (!active || !elsewhere) return null
  return (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm }}>
      <Note tone="fault">
        {email
          ? `The computer on this wifi is signed into a different account. This phone is signed in as ${email}. Sign the Fractal app on the computer in with ${email}, or sign this phone into the computer’s account.`
          : 'The computer on this wifi is signed into a different account than this phone. Sign both into the same account.'}
      </Note>
      {onSwitch ? <Press label="Switch account on this phone" onPress={onSwitch} /> : null}
    </View>
  )
}
