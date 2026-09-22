import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'
import Note from '../components/Note'
import Press from '../components/Press'
import Sheet from '../components/Sheet'
import { buyUnlock, restorePurchase, usePurchase } from '../lib/purchases'
import { UNITS } from '../lib/demoUnits'

/*
 * The units named on the offer, read off the list the app actually carries.
 *
 * Typed out by hand this is five chances to be wrong about somebody's gear,
 * and it would go stale the day a sixth is added — on the ONE screen where
 * being wrong is a person paying for a unit we do not drive.
 */
const SUPPORTED = UNITS.map((u) => u.name)
const supportedWords =
  SUPPORTED.slice(0, -1).join(', ') + ' and ' + SUPPORTED[SUPPORTED.length - 1]

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
export default function Paywall({ onUnlocked, onDemo, onBack, onSignIn, asked = false }) {
  const { price, unlocked, available, why, detail } = usePurchase()
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
          Phone Remote
        </Text>
        <Text style={{ color: color.silkDim, fontSize: font.body, lineHeight: font.body * 1.45 }}>
          {`One-time payment unlocks the full version of this app, forever, including all future updates, on all supported Fractal devices: ${supportedWords}. Sign in with the same account on another phone or tablet and it is unlocked there too.`}
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
        <Text style={{ color: color.silk, fontSize: font.body, lineHeight: font.body * 1.45 }}>
          You&rsquo;ll be able to control and switch presets, scenes, amp &amp; effects blocks,
          tuner, tap tempo, setlists, and so much more.
        </Text>
      </View>

      {said ? <Note tone={said.tone}>{said.text}</Note> : null}

      {/* A dead Unlock button is worse than an explained one. Restore still
          shows, because a purchase made elsewhere is worth trying for. */}
      {!available ? <Note tone="warn">{why || 'Purchases are not available here.'}</Note> : null}
      {/*
        And underneath it, the store's own account, when there is one.
        "The store has nothing to sell yet" is true and unactionable — it does
        not say whether the gap is in RevenueCat or in the Play Console, and
        those are fixed in different places. See purchases.detail: facts only,
        and null for anybody who can actually buy the thing, which is every
        customer who ever reaches this screen.
      */}
      {!available && detail ? (
        <Text style={{ color: color.silkFaint, fontSize: font.small, lineHeight: 18 }}>{detail}</Text>
      ) : null}

      <View style={{ gap: space.md }}>
        <Press
          label={price ? `Unlock Full Version — ${price}` : 'Unlock Full Version'}
          tone="signal"
          disabled={busy || !available}
          onPress={buy}
        />
        <Press label="Restore a purchase" disabled={busy} onPress={restore} />
        {/*
          Restore asks the STORE whether this Apple or Google account has
          bought it. That is a different question from "am I signed in as
          somebody who already has this", and only one of them had an answer
          here — which left somebody looking at a locked app, holding an
          account that unlocks it, with nothing on screen to say so.
        */}
        {onSignIn ? (
          <Press
            label="Sign in with an email and password"
            disabled={busy}
            onPress={onSignIn}
          />
        ) : null}
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
