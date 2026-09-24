import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

import { logDebug } from './debugLog'

/**
 * Whether this app is running the newest code, and a way to make it so.
 *
 * "I have not yet successfully had a single over-the-air update work
 * correctly. They never come through, so I keep refreshing the android app,
 * closing it, force closing it, reopening it over and over again."
 *
 * THE UPDATES WERE ARRIVING. What was missing was any way to know it, and one
 * detail of how expo-updates works that makes the app look stuck when it is
 * merely being careful:
 *
 *   app.json sets `fallbackToCacheTimeout: 0`, which means the app NEVER waits
 *   for a download at launch. It starts instantly on the bundle it already
 *   has, fetches any new one in the background, and runs it THE NEXT TIME the
 *   app is opened.
 *
 * So the first launch downloads and the second launch shows it. Somebody
 * force-closing and reopening once, seeing the same version, and concluding
 * nothing happened is reading the situation exactly as the app presented it.
 * They were one restart short, with nothing on screen to say so.
 *
 * That default is right for a stage — an app that pauses on a dark stage to
 * download something is a worse app — so the fix is not to change it. The fix
 * is to say what is going on, and to offer the restart rather than wait for it
 * to happen by accident.
 *
 * Nothing here is allowed to throw. expo-updates is not available in every
 * context it can be imported from — a development build, an emulator, a bundle
 * running with updates switched off — and a Setup screen that crashes because
 * it asked about updates would be a poor trade for the answer.
 */

let state = {
  /** 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'off' */
  phase: 'idle',
  /** What went wrong, in words, or null. */
  error: null,
  /** Which bundle is running: 'embedded' (as built) or 'update'. */
  source: null,
  /** When the running bundle was published, if it was. */
  publishedAt: null,
  /** The ready banner was put away with its ✕ — until the next launch. */
  dismissed: false
}

const watchers = new Set()
const announce = () => {
  for (const fn of watchers) fn()
}
const set = (next) => {
  state = { ...state, ...next }
  announce()
}

let Updates = null

/** Load it once, and never let its absence take a screen down. */
const load = async () => {
  if (Updates) return Updates
  try {
    const mod = await import('expo-updates')
    Updates = mod?.default && mod.default.checkForUpdateAsync ? mod.default : mod
  } catch (err) {
    Updates = null
    logDebug(`updates: no module (${err?.message || err})`)
  }
  return Updates
}

/**
 * What this app is running, read once at startup.
 *
 * `isEmbeddedLaunch` is the honest answer to "did an update ever land": true
 * means this is the bundle that came with the build, false means an update is
 * running. It is the one fact that settles the question without anybody
 * comparing version numbers off two screens.
 */
export const describeRunning = async () => {
  const api = await load()
  if (!api) return set({ source: null, phase: 'off' })
  try {
    set({
      source: api.isEmbeddedLaunch ? 'embedded' : 'update',
      publishedAt: api.createdAt ? new Date(api.createdAt).getTime() : null
    })
  } catch (err) {
    logDebug(`updates: cannot describe (${err?.message || err})`)
  }
}

/**
 * Ask now, download now, and say so at every step.
 *
 * Answers rather than throws, because every caller wants the same thing on
 * screen and an exception here is not a fault a person can act on.
 */
export const checkNow = async () => {
  const api = await load()
  if (!api) {
    set({ phase: 'off', error: 'This build cannot take updates.' })
    return 'off'
  }
  set({ phase: 'checking', error: null })
  try {
    const found = await api.checkForUpdateAsync()
    if (!found?.isAvailable) {
      set({ phase: 'current' })
      return 'current'
    }
    set({ phase: 'downloading' })
    await api.fetchUpdateAsync()
    set({ phase: 'ready' })
    return 'ready'
  } catch (err) {
    /*
     * The ordinary case here is not a bug: a development build, or a bundle
     * whose fingerprint has no update published for it, both land in this
     * branch. Say what happened and leave the app alone.
     */
    const message = String(err?.message || err)
    logDebug(`updates: check failed (${message})`)
    set({ phase: 'idle', error: message })
    return 'error'
  }
}

/** Restart into the update that has been downloaded. */
export const applyNow = async () => {
  const api = await load()
  if (!api) return false
  try {
    await api.reloadAsync()
    return true
  } catch (err) {
    logDebug(`updates: reload failed (${err?.message || err})`)
    set({ error: 'Could not restart. Close the app fully and open it again.' })
    return false
  }
}

/** Put the ready banner away. The Updates row in Settings still offers the restart. */
export const dismissReady = () => set({ dismissed: true })

/*
 * ASKED WITHOUT BEING ASKED, AND OFFERED RATHER THAN FORCED.
 *
 * "On the web app it actually will pop up a banner at the top of the screen
 * that says update available. Is it possible to do that once the phone
 * actually downloads an update so that they could just click that to restart
 * it?" — and, the answer before, "I don't want it to pause for a few seconds
 * every time they open the app."
 *
 * So nothing waits. A few seconds after the app is up it asks in the
 * background, and again whenever it comes back from the background after a
 * while — the case of somebody who never closes an app, who would otherwise
 * carry an old version for as long as the phone keeps it alive. A download
 * that lands turns the phase to 'ready', and the banner (UpdateReady) offers
 * the restart. It never restarts on its own: a reload mid-song is the one
 * thing worse than an old version.
 */
const FIRST_ASK_MS = 5000
const ASK_AGAIN_MS = 30 * 60 * 1000
let lastAsked = 0

const askQuietly = () => {
  if (['checking', 'downloading', 'ready', 'off'].includes(state.phase)) return
  lastAsked = Date.now()
  checkNow().catch(() => {})
}

/** Start asking. Returns the stop, for the effect that calls it. */
export function watchForUpdates() {
  const first = setTimeout(askQuietly, FIRST_ASK_MS)
  const sub = AppState.addEventListener?.('change', (status) => {
    if (status === 'active' && Date.now() - lastAsked > ASK_AGAIN_MS) askQuietly()
  })
  return () => {
    clearTimeout(first)
    sub?.remove?.()
  }
}

export const updateState = () => state

const subscribe = (fn) => {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

export const useUpdates = () => useSyncExternalStore(subscribe, updateState, updateState)
