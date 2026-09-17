import { useEffect, useSyncExternalStore } from 'react'

import { presetName } from './device'

/**
 * What every slot on the unit is called, learned a few at a time.
 *
 * WHY THIS IS A MODULE AND NOT A PIECE OF THE PICKER. Two screens need these
 * names now — the preset list, and the setlist sheet that shows tonight's
 * running order by name rather than by number — and asking the unit what slot
 * 412 is called is not cheap. `relay-rules` counts `/presets/{n}` among the
 * slow reads because the unit reads that preset off its own hardware to answer.
 * Two screens with their own caches would ask for the same name twice, down the
 * one serial port everything else is queued behind.
 *
 * ONE READ AT A TIME, for the same reason. Firing twenty at the relay does not
 * make the unit answer faster; it makes the queue longer and the tuner, the
 * scene change and the preset load wait behind them.
 *
 * AND ONLY WHILE SOMEBODY IS LOOKING. `useNames` counts the screens mounted,
 * and the queue drains only while that count is above zero. Without it, closing
 * the picker after a scroll would leave the unit reading presets for the next
 * half-minute while somebody is playing — work nobody can see the result of.
 * What has already been read is kept: names do not go stale, and coming back to
 * the list should not mean reading them again.
 */

/** number → name, where '' means the unit says the slot is empty. */
const names = new Map()
/** Slots already asked for, so a row scrolled past twice is not read twice. */
const asked = new Set()
const queue = []
let draining = false
let failed = false

/** How many mounted screens are waiting on these. Zero stops the drain. */
let interest = 0

let revision = 0
const watchers = new Set()

const announce = () => {
  revision += 1
  for (const fn of watchers) fn()
}

const subscribe = (fn) => {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

async function drain() {
  if (draining) return
  draining = true
  try {
    while (queue.length && interest > 0) {
      const n = queue.shift()
      try {
        const got = await presetName(n)
        names.set(n, got.empty ? '' : got.name)
        announce()
      } catch {
        /*
         * One slot failing is one slot. A unit that has gone will fail every
         * one of them, and the screens say so once rather than per row — but
         * the list keeps working for the slots already named.
         */
        if (!failed) {
          failed = true
          announce()
        }
      }
    }
  } finally {
    draining = false
  }
}

/** Ask for a slot's name, if it has not been asked for already. */
export function want(n) {
  if (!Number.isInteger(n) || n < 0 || asked.has(n)) return
  asked.add(n)
  queue.push(n)
  drain()
}

/** The name, or undefined when it has not been read yet. '' means empty. */
export const nameOf = (n) => names.get(n)

/** Whether the unit stopped answering while names were being read. */
export const readFailed = () => failed

/**
 * Every slot whose name is known, in the shape the setlist sheet wants.
 *
 * Only the named ones, deliberately: this feeds "add another song", and a slot
 * with no name read yet is a row saying nothing that you could add by mistake.
 */
export const namedSlots = () =>
  [...names.entries()]
    .filter(([, name]) => name)
    .map(([number, name]) => ({ number, name }))
    .sort((a, b) => a.number - b.number)

/**
 * Re-render while names arrive, and keep the queue running while mounted.
 *
 * The effect is the whole point: a screen that only read `revision` would get
 * the names some other screen happened to be asking for, and its own would sit
 * in the queue with nothing draining them.
 */
export function useNames() {
  useEffect(() => {
    interest += 1
    drain()
    return () => {
      interest -= 1
      /* Nobody is looking, so nothing is worth asking the unit for. What has
         been read stays; what was merely queued is dropped, and `asked` gives
         it up too so the next screen that wants it can ask again. */
      if (interest === 0) {
        for (const n of queue.splice(0)) asked.delete(n)
      }
    }
  }, [])
  return useSyncExternalStore(subscribe, () => revision, () => revision)
}

/**
 * Forget everything — a different unit is on the other end.
 *
 * Slot 45 on an FM3 and slot 45 on an AM4 are different presets, and showing
 * one unit's names over another's slots is worse than showing no names at all.
 */
export function forget() {
  names.clear()
  asked.clear()
  queue.length = 0
  failed = false
  announce()
}
