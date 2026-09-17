import { useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { createMockDevice } from './mockDevice'

const KEY = 'fractal.demo'

/**
 * A simulated FM3, for a phone with no rig on the other end.
 *
 * "Didn't we have a demo version set up for people to check out if they don't
 * have a device connected? I'm not seeing that anymore." There was one, in the
 * browser, since long before this app existed. The phone never had it — every
 * screen here reads a real unit through a real computer, so with nothing
 * connected the whole app is one sentence saying NO COMPUTER. That is a poor
 * welcome for somebody who has just installed it and does not yet know a
 * computer was part of the arrangement.
 *
 * AND IT IS A MEASURING INSTRUMENT, which is the better reason: "It helps me
 * make sure the lag isn't just the app, also."
 *
 * The demo answers from memory. No relay, no serial port, no unit — so a screen
 * that is still slow in the demo is slow because of THIS APP and nothing else,
 * and a screen that is quick here and slow on a rig is waiting on the wire.
 * Those two have been confused more than once in this project, each time
 * costing an evening, and there has been no way to tell them apart from a
 * phone. Now there is.
 *
 * So: no artificial delay anywhere in here, deliberately. A demo that pretended
 * to be as slow as a serial port would be prettier and would answer nothing.
 */
let mock = null
const watchers = new Set()

const announce = () => {
  for (const fn of watchers) fn()
}

/** The simulated unit, or null when the app is talking to a real one. */
export const demoDevice = () => mock

/** Whether the demo is on. Read everywhere; it decides what `device.js` asks. */
export const isDemo = () => mock !== null

export function setDemo(on) {
  const want = !!on
  if (want === isDemo()) return
  mock = want ? createMockDevice() : null
  announce()
  AsyncStorage.setItem(KEY, want ? '1' : '0').catch(() => {
    /* Costs the next launch its demo, and nothing else. */
  })
}

/**
 * Pick the demo up from last time, before the first frame if we can.
 *
 * Returns whether it is on, so the app can wait for this one answer rather than
 * drawing a sign-in screen to somebody who was in the demo a second ago.
 */
export async function restoreDemo() {
  try {
    if ((await AsyncStorage.getItem(KEY)) === '1' && !mock) {
      mock = createMockDevice()
      announce()
    }
  } catch {
    /* Not in the demo, then. Which is the ordinary case anyway. */
  }
  return isDemo()
}

const subscribe = (fn) => {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

/** Re-render this screen when the demo goes on or off. */
export const useDemo = () => useSyncExternalStore(subscribe, isDemo, isDemo)
