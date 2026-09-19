import { useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { createMockDevice } from './mockDevice'
import { DEFAULT_UNIT, UNIT_KEYS } from './demoUnits'

const KEY = 'fractal.demo'
const UNIT_KEY = 'fractal.demoUnit'

/* Which Fractal the demo is. Held here as well as on disk so the mock can be
   rebuilt without waiting on a read. */
let unit = DEFAULT_UNIT

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

/** Which Fractal the demo is pretending to be. */
export const demoUnit = () => unit

/**
 * Become a different unit.
 *
 * The mock is rebuilt rather than adjusted: every preset name, scene list and
 * capability in it belongs to the unit it was made for, and there is no
 * sensible way to turn a simulated AM4 into a simulated FM9 in place without
 * leaving one unit's chain under another's name.
 */
export function setDemoUnit(key) {
  const want = UNIT_KEYS.includes(key) ? key : DEFAULT_UNIT
  if (want === unit) return unit
  unit = want
  if (mock) mock = createMockDevice(unit)
  announce()
  AsyncStorage.setItem(UNIT_KEY, unit).catch(() => {
    /* Costs the next launch its choice of unit, and nothing else. */
  })
  return unit
}

export function setDemo(on) {
  const want = !!on
  if (want === isDemo()) return
  mock = want ? createMockDevice(unit) : null
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
    const saved = await AsyncStorage.getItem(UNIT_KEY)
    if (UNIT_KEYS.includes(saved)) unit = saved
    if ((await AsyncStorage.getItem(KEY)) === '1' && !mock) {
      mock = createMockDevice(unit)
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
