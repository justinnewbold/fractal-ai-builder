import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'

import { logDebug } from './debugLog'
import { mayDrive } from './unlock-rule'

/**
 * The one purchase: paying to point this app at a real rig.
 *
 * "The app is gonna be a free download and then they can access the demo for
 * free and then we need to do an in app purchase to unlock it and we'll do the
 * app purchase at 9.99 that will unlock the full version."
 *
 * So the line is drawn exactly where the app stops being a toy: the DEMO is
 * free and complete, for ever, and driving the unit at your computer is what
 * costs. Nothing is time-limited and nothing expires — it is one payment for
 * one thing, which is what a non-consumable is.
 *
 * RevenueCat holds the receipts. Apple and Google each hand back their own
 * shape of proof-of-purchase, both of which have to be checked against the
 * right server and then remembered; RevenueCat does that and answers one
 * question instead — does this person have the entitlement. It also carries
 * the restore, which is not optional: Apple rejects an app that cannot give a
 * purchase back on a new handset.
 *
 * NOTHING HERE MAY EVER LOCK SOMEBODY OUT BY ACCIDENT, and that is the rule
 * this file is built around rather than an afterthought. Three things can go
 * wrong and all three fail OPEN:
 *
 *   - the native module is missing — a build made before this existed, or a
 *     bundle running without it
 *   - no API key has been configured yet
 *   - the check itself fails: no signal, RevenueCat unreachable, a timeout
 *
 * In every one of those the answer is "not locked". The alternative is an app
 * that bricks itself in a room with bad wifi, and the people most likely to be
 * in that room are the ones on a stage about to play — which is the entire
 * audience for this app. A paywall that cannot take money must never be a
 * paywall that blocks the app.
 *
 * And the last-known answer is kept on disk, so somebody who HAS paid stays
 * unlocked through a flight, a basement, a dead hotspot and a reinstall-shaped
 * afternoon without RevenueCat being reachable at all.
 */

/** What the entitlement is called in the RevenueCat dashboard. */
export const ENTITLEMENT = 'full'

/** The product to sell, if no offering is configured to name one. */
export const PRODUCT_ID = 'cloud.newbold.fractalremote.full'

/** Where the remembered answer lives between launches. */
const KEY = 'fractal.unlocked'

/*
 * The publishable keys, which are not secret.
 *
 * RevenueCat's SDK keys are public by design — they are compiled into every
 * copy of the app and can be read out of any of them. They identify the app to
 * RevenueCat; they do not authorise anything a person could not already do by
 * buying the thing. (The SECRET keys, which can refund and grant, are a
 * different pair of strings and belong nowhere near this repository.)
 *
 * They live in app.json under `extra` so that setting them is a one-line edit
 * rather than a code change, and so a build made before they exist still runs.
 */
const keyFor = () => {
  const extra = Constants.expoConfig?.extra?.revenuecat || {}
  return Platform.select({ ios: extra.ios, android: extra.android, default: null }) || null
}

let state = {
  /** Whether purchasing can happen at all here. */
  available: false,
  /** Whether this person may drive a real unit. */
  unlocked: false,
  /** True until the first answer, from disk or from RevenueCat. */
  checking: true,
  /** What it costs, as the store says it locally — "$9.99", "£8.99". */
  price: null,
  /** Why purchasing is off, when it is. */
  why: null
}

const watchers = new Set()
const announce = () => {
  for (const fn of watchers) fn()
}
const set = (next) => {
  state = { ...state, ...next }
  announce()
}

/** The native module, or null where there isn't one. */
let Purchases = null
let pkg = null

/**
 * Load the SDK without letting a missing one take the app down.
 *
 * `react-native-purchases` is native. In a JS bundle running on a build that
 * predates it — which is every build of this app that exists today — the
 * import throws, and an import that throws at the top of a module takes the
 * whole app with it. So it is required lazily, inside a try, and its absence
 * is an ordinary answer rather than a crash.
 */
const load = async () => {
  if (Purchases) return Purchases
  try {
    /* A DYNAMIC import, not a static one, and not require().
       Static would be uncatchable: a throw at the top of a module takes the
       whole app down, and this module is imported by App.js before a frame is
       drawn. require() would work under Metro but is not a name this app has
       anywhere else, and test/mobile.mjs is right to refuse it. `import()` is
       syntax rather than a global, it is what Metro wants, and a failure comes
       back as a rejected promise this can catch. */
    const mod = await import('react-native-purchases')
    Purchases = mod?.default || mod || null
  } catch (err) {
    Purchases = null
    logDebug(`purchases: no native module (${err?.message || err})`)
  }
  return Purchases
}

/** What we last knew, from disk. Read before the network is asked anything. */
const remembered = async () => {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'yes'
  } catch {
    return false
  }
}

const remember = async (yes) => {
  try {
    await AsyncStorage.setItem(KEY, yes ? 'yes' : 'no')
  } catch {
    /* A phone that cannot write this still runs; it just re-asks next launch. */
  }
}

/** Read the entitlement out of whatever shape RevenueCat handed back. */
const entitled = (info) => Boolean(info?.entitlements?.active?.[ENTITLEMENT])

/**
 * Start up, once, as early as the app can manage it.
 *
 * Never throws and never rejects: every failure inside becomes `available:
 * false`, which reads everywhere as "not locked".
 */
export const startPurchases = async () => {
  const known = await remembered()
  if (known) set({ unlocked: true })

  const api = await load()
  if (!api) {
    set({ available: false, checking: false, why: 'This build cannot take payments.' })
    return
  }

  const key = keyFor()
  if (!key) {
    set({ available: false, checking: false, why: 'Payments are not set up yet.' })
    logDebug('purchases: no API key in app.json extra.revenuecat')
    return
  }

  try {
    await api.configure({ apiKey: key })
    const info = await api.getCustomerInfo()
    const yes = entitled(info)
    await remember(yes)

    /*
     * AND WHETHER THIS PHONE CAN PAY AT ALL, which is not the same question as
     * whether RevenueCat answered.
     *
     * The APK on the Releases page is installed from a link rather than from
     * the Play Store, and an app installed outside Play has no Play Billing —
     * so the store would say "no purchase" for ever and every sideloaded copy
     * would be locked behind a button that cannot take money. That is the
     * exact trap this whole file exists to avoid, arriving through a door I
     * had not thought of: the developer's own test phone.
     *
     * The same covers a device with purchases switched off in parental
     * controls, and a corporate handset with billing disabled.
     *
     * A person who HAS paid is unlocked either way — entitlement is read
     * above, and it does not care whether this handset can buy anything.
     */
    let canPay = true
    try {
      canPay = (await api.canMakePayments?.()) !== false
    } catch (err) {
      /* Could not find out. Assume it can, and let the rule below fail open. */
      logDebug(`purchases: canMakePayments unknown (${err?.message || err})`)
    }

    set({
      available: canPay,
      unlocked: yes,
      checking: false,
      why: canPay ? null : 'This copy of the app cannot take payments.'
    })
    if (!canPay) logDebug('purchases: this install cannot pay — nothing is locked')
    api.addCustomerInfoUpdateListener?.((next) => {
      const now = entitled(next)
      remember(now)
      set({ unlocked: now })
    })
    loadPrice()
  } catch (err) {
    /*
     * FAILS OPEN, and deliberately. A check that could not be made is not a
     * "no" — see the rule at the top of this file. The remembered answer, if
     * there is one, stands.
     */
    set({ available: false, checking: false, why: 'Could not reach the store.' })
    logDebug(`purchases: start failed (${err?.message || err})`)
  }
}

/** Ask the store what it charges here, so the button can say so. */
const loadPrice = async () => {
  const api = await load()
  if (!api) return
  try {
    const offerings = await api.getOfferings()
    const found =
      offerings?.current?.availablePackages?.[0] ||
      Object.values(offerings?.all || {})[0]?.availablePackages?.[0] ||
      null
    if (found) {
      pkg = found
      set({ price: found.product?.priceString || null })
      return
    }
    const products = await api.getProducts([PRODUCT_ID])
    if (products?.[0]) set({ price: products[0].priceString || null })
  } catch (err) {
    logDebug(`purchases: no price (${err?.message || err})`)
  }
}

/**
 * Buy it.
 *
 * Answers `{ ok, cancelled, message }` rather than throwing, because every
 * caller wants the same three outcomes and a cancel is not an error — somebody
 * closing Apple's sheet has done nothing wrong and must not be shown a fault.
 */
export const buyUnlock = async () => {
  const api = await load()
  if (!api) return { ok: false, cancelled: false, message: 'This build cannot take payments.' }
  try {
    const bought = pkg
      ? await api.purchasePackage(pkg)
      : await api.purchaseProduct(PRODUCT_ID)
    const yes = entitled(bought?.customerInfo)
    await remember(yes)
    set({ unlocked: yes })
    return yes
      ? { ok: true, cancelled: false, message: null }
      : { ok: false, cancelled: false, message: 'The store did not confirm the purchase.' }
  } catch (err) {
    if (err?.userCancelled) return { ok: false, cancelled: true, message: null }
    logDebug(`purchases: buy failed (${err?.message || err})`)
    return { ok: false, cancelled: false, message: err?.message || 'The purchase did not go through.' }
  }
}

/**
 * Give a purchase back.
 *
 * Apple requires this and will reject the app without it, but it earns its
 * place anyway: a new phone, a reinstall, or a second handset on the same
 * Apple ID all arrive here, and none of them should be asked to pay twice.
 */
export const restorePurchase = async () => {
  const api = await load()
  if (!api) return { ok: false, message: 'This build cannot take payments.' }
  try {
    const info = await api.restorePurchases()
    const yes = entitled(info)
    await remember(yes)
    set({ unlocked: yes })
    return yes
      ? { ok: true, message: null }
      : { ok: false, message: 'No previous purchase was found on this account.' }
  } catch (err) {
    logDebug(`purchases: restore failed (${err?.message || err})`)
    return { ok: false, message: err?.message || 'Could not reach the store.' }
  }
}

/**
 * Whether a real rig may be driven.
 *
 * The demo never asks this. Note what counts as yes: paid, OR purchasing is
 * unavailable for any reason at all. See the rule at the top.
 */
export const mayConnect = () => mayDrive(state)

export const purchaseState = () => state

const subscribe = (fn) => {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

/** The same, for a screen that should repaint when it changes. */
export const usePurchase = () => useSyncExternalStore(subscribe, purchaseState, purchaseState)

/** Test seam: put the module back as it was between cases. */
export const __reset = () => {
  Purchases = null
  pkg = null
  state = { available: false, unlocked: false, checking: true, price: null, why: null }
}
