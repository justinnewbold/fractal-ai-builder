import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { color, font, radius, space } from '../lib/theme'
import { tick } from '../lib/feedback'
import { shouldOffer, usePurchase } from '../lib/purchases'
import { useDemo } from '../lib/demo'

/**
 * The offer, on the screen somebody is actually looking at.
 *
 * "There's nothing that says unlock... I'm building this app and I don't know
 * where to unlock it."
 *
 * There WERE routes — a pill in the bar, a row in Setup — and both were
 * invisible on his handset, because both were gated on the store being ready
 * and it is not. That bug is fixed in lib/purchases. But being findable is
 * not the same as being OFFERED, and this is the difference: the bar says
 * where to go if you are already looking, and this says there is somewhere
 * to go if you are not.
 *
 * WHO THIS IS FOR, which decides how hard it pushes. Nobody installs a remote
 * for a Fractal on a whim: they own the unit, they came looking for this, and
 * by the time they have driven the demo for five minutes they have already
 * decided. This is not persuasion. It is a person who has made up their mind
 * being shown the till.
 *
 * SO IT GOES AWAY. One tap on the cross and it never comes back — the bar
 * keeps the pill, and Setup keeps the row, so nothing is lost by dismissing
 * it. An offer that cannot be dismissed is an advertisement, and this app is
 * open on a dark stage between songs.
 */
const KEY = 'fractal.offerDismissed'

export default function UnlockOffer({ onUnlock }) {
  const demo = useDemo()
  const purchase = usePurchase()
  const [gone, setGone] = useState(true)

  /* Start hidden and appear once disk has answered, rather than flashing on
     and then vanishing for somebody who put it away weeks ago. */
  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(KEY)
      .then((v) => alive && setGone(v === 'yes'))
      .catch(() => alive && setGone(false))
    return () => {
      alive = false
    }
  }, [])

  if (gone || !onUnlock || !shouldOffer({ demo })) return null

  const put = () => {
    tick()
    setGone(true)
    AsyncStorage.setItem(KEY, 'yes').catch(() => {})
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.signal,
        backgroundColor: color.signalWash
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: color.silk, fontSize: font.body, fontWeight: '600' }}>
          This is the demo
        </Text>
        <Text style={{ color: color.silkDim, fontSize: font.small, marginTop: 2 }}>
          Unlock to drive your own rig from this phone.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Unlock the full version"
        onPress={() => {
          tick()
          onUnlock()
        }}
        style={({ pressed }) => ({
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.pill,
          backgroundColor: pressed ? color.silkFaint : color.signal
        })}
      >
        <Text style={{ color: color.onSignal, fontSize: font.small, fontWeight: '700' }}>
          {/* The price, where there is one. Asking somebody to tap to find out
              what it costs is asking for the tap most people will not make. */}
          {purchase.price ? `Unlock ${purchase.price}` : 'Unlock'}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Put this away"
        onPress={put}
        hitSlop={10}
        style={{ paddingHorizontal: space.xs }}
      >
        <Text style={{ color: color.silkDim, fontSize: font.lead }}>×</Text>
      </Pressable>
    </View>
  )
}
