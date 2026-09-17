import { useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * A synchronous store, over a storage that is not.
 *
 * The browser's setlists and stars are written against `localStorage`, which
 * answers immediately. Every function in them takes the storage as an argument
 * precisely so it can be handed something else — but something else still has
 * to answer immediately, and AsyncStorage does not answer at all without a
 * wait.
 *
 * WHY NOT REWRITE THEM ASYNC. Because the thing they decide is drawn. `orderFor`
 * runs while the stage screen renders, to work out what Previous and Next step
 * through; `listsFor` runs to draw the picker. Making those await turns every
 * screen into a loading state for data that is a few hundred bytes and already
 * in memory, and — worse — makes the two apps' copies diverge, which is the one
 * thing sync:rules exists to prevent. The generated copy has to be the same
 * file.
 *
 * So the shape is the browser's and the waiting happens once, up front.
 *
 * HOW IT BEHAVES BEFORE IT IS READY, which is the part that decides whether
 * this is safe. `getItem` answers null until the load lands. Null is exactly
 * what a browser with nothing saved returns, and every reader already treats it
 * as "none yet" rather than as an error — an empty setlist list, no stars,
 * source 'all'. So the first frames show the defaults and then the real thing,
 * which is the same flicker AsyncStorage forces on play mode, and is harmless
 * here: nothing on this path fires on its own or writes back what it read.
 *
 * WRITES GO BOTH WAYS AT ONCE. The value lands in memory immediately, so the
 * next synchronous read sees it, and is queued to disk. A write that never
 * reaches disk costs the next launch, not this press — the same trade the
 * browser makes when a private window refuses storage.
 *
 * AND EVERY WRITE IS ANNOUNCED. In the browser those modules fire an event on
 * the window after each write, which is how the stage screen learns that a star
 * was pressed on the picker sitting over it. There is no window here to fire it
 * on — that call is inside a try/catch and simply does nothing — so the
 * announcement happens at this end instead, where every write already passes.
 * One signal covers setlists and stars together: both are read in the same
 * breath by the screen that cares, and telling them apart would buy nothing.
 */

/** The whole of it, in memory. Empty until `hydrate` lands. */
const memory = new Map()

let loaded = false
let loading = null

/**
 * The keys worth carrying. Everything the shared modules write lives under a
 * `fractal.` prefix, and reading the rest of AsyncStorage into memory would be
 * carrying the auth session around for no reason.
 */
const MINE = (k) => typeof k === 'string' && k.startsWith('fractal.')

/**
 * Anyone waiting to be told that something stored has changed.
 *
 * A bare counter rather than the value, because the readers are `listsFor`,
 * `marksFor` and `sourceFor` — each of which goes and reads what it needs. A
 * subscriber only has to learn that reading again is worth it.
 */
const watchers = new Set()
let revision = 0

const announce = () => {
  revision += 1
  for (const fn of watchers) fn()
}

/**
 * Read what is on disk into memory. Safe to call repeatedly; the work happens
 * once and everything after it waits on the same promise.
 */
export function hydrate() {
  if (loaded) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter(MINE)
      if (keys.length) {
        for (const [k, v] of await AsyncStorage.multiGet(keys)) {
          if (typeof v === 'string') memory.set(k, v)
        }
      }
    } catch {
      /*
       * Storage that will not answer is not a reason to fail the screen it sits
       * under. Everything reads as "nothing saved", which is a state the
       * callers already handle.
       */
    } finally {
      loaded = true
      loading = null
      /*
       * The screens that drew the defaults while this was in flight are told to
       * read again. Without it, the first launch after a setlist was built
       * shows "All" between Previous and Next until something else happens to
       * cause a render.
       */
      announce()
    }
  })()
  return loading
}

/** Whether the disk has been read. Screens can wait on `hydrate` instead. */
export const ready = () => loaded

/** Be told when anything stored changes. Returns the unsubscribe. */
export const watch = (fn) => {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

/**
 * Re-render this screen whenever anything stored changes.
 *
 * The browser does this with two event subscriptions and a counter in state;
 * this is the same counter, kept here, so a screen costs one line.
 */
export const useStored = () => useSyncExternalStore(watch, () => revision, () => revision)

/**
 * The object the shared modules take.
 *
 * Deliberately only the three methods they use. A wider surface would invite
 * somebody to reach for `length` or `key(i)` here and get a shape that does not
 * match the browser's.
 */
export const sync = {
  getItem(key) {
    const v = memory.get(key)
    return v === undefined ? null : v
  },
  setItem(key, value) {
    const v = String(value)
    memory.set(key, v)
    announce()
    AsyncStorage.setItem(key, v).catch(() => {
      /* Costs the next launch, not this press. */
    })
  },
  removeItem(key) {
    memory.delete(key)
    announce()
    AsyncStorage.removeItem(key).catch(() => {})
  }
}

/** For tests, and for signing out: forget everything held in memory. */
export function forget() {
  memory.clear()
  loaded = false
  loading = null
  announce()
}
