import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'
import Note from '../components/Note'
import Press from '../components/Press'
import Sheet from '../components/Sheet'
import { buyUnlock, restorePurchase, usePurchase } from '../lib/purchases'

/**
 * The one screen that asks for money.
 *
 * It is shown at exactly one moment: somebody has a code or an account and is
 * about to point this app at a real unit for the first time. The demo never
 * reaches here, which is the whole design — a person can install this, play
 * with a simulated FM9 for an hour and never be asked for anything.
 *
 * WHAT IT DOES NOT DO is oversell. There is no countdown, no crossed-out price,
 * no list of forty features with ticks against them. Somebody who has got this
 * far owns a Fractal unit, has a pairing code on a screen in front of them and
 * knows exactly what they are buying. The honest version of this screen is
 * short, and a short one respects the person holding a guitar.
 *
 * RESTORE IS AS PROMINENT AS BUY, which Apple requires and which is right
 * anyway: the person tapping it has already paid, and hiding their way back in
 * behind the thing that charges them again would be a poor way to treat them.
 */
export default function Paywall({ onUnlocked, onDemo, onBack, asked = false }) {
  const { price, unlocked, available, why } = usePurchase()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState(null)

  if (unlocked) onUnlocked?.()

  const buy = async () => {
    setBusy(true)
    setSaid(null)
    const out = await buyUnlock()
    setBusy(false)
    if (out.ok) return onUnlocked?.()
    /* A cancel is not a fault and is not worth a sentence. */
    if (!out.cancelled) setSaid({ tone: 'fault', text: out.message })
  }

  const restore = async () => {
    setBusy(true)
    setSaid(null)
    const out = await restorePurchase()
    setBusy(false)
    if (out.ok) return onUnlocked?.()
    setSaid({ tone: 'warn', text: out.message })
  }

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: space.sm }}>
        <Text style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
          Drive your own rig
        </Text>
        <Text style={{ color: color.silkDim, fontSize: font.body, lineHeight: font.body * 1.45 }}>
          One payment, once. It unlocks this app for every Fractal you own, on
          every phone signed in to your{' '}
          {/* Apple's word on iOS, Google's on Android — said plainly either way. */}
          store account.
        </Text>
      </View>

      <View
        style={{
          backgroundColor: color.panel,
          borderRadius: radius.lg,
          padding: space.lg,
          gap: space.md
        }}
      >
        {[
          'Scenes, presets and tempo from across the room',
          'The tuner, on the unit itself',
          'Your setlists, on the phone you already carry'
        ].map((line) => (
          <Text key={line} style={{ color: color.silk, fontSize: font.body }}>
            {line}
          </Text>
        ))}
      </View>

      {said ? <Note tone={said.tone}>{said.text}</Note> : null}

      {/* A dead Unlock button is worse than an explained one. Restore still
          shows, because a purchase made elsewhere is worth trying for. */}
      {!available ? <Note tone="warn">{why || 'Purchases are not available here.'}</Note> : null}

      <View style={{ gap: space.md }}>
        <Press
          label={price ? `Unlock — ${price}` : 'Unlock'}
          tone="signal"
          disabled={busy || !available}
          onPress={buy}
        />
        <Press label="Restore a purchase" disabled={busy} onPress={restore} />
      </View>

      <View style={{ gap: space.md }}>
        {/* Somebody STOPPED on the way in needs a way past this; somebody who
            came looking is already in the demo and only needs out. */}
        {asked ? null : (
          <Press label="Keep using the demo" disabled={busy} onPress={() => onDemo?.()} />
        )}
        <Press label={asked ? 'Not now' : 'Back'} disabled={busy} onPress={() => onBack?.()} />
      </View>

      <Text style={{ color: color.silkDim, fontSize: font.small, lineHeight: font.small * 1.5 }}>
        The demo stays free for as long as you want it. It is the whole app
        against a simulated unit — nothing in it is cut short.
      </Text>
    </ScrollView>
  )

  /* Imposed, it IS the screen. Asked for, it lies over the one they were on. */
  return asked ? (
    <Sheet open onClose={() => onBack?.()} title="Unlock" note="One payment, once">
      {body}
    </Sheet>
  ) : (
    body
  )
}
