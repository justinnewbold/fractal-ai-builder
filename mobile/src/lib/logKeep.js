import AsyncStorage from '@react-native-async-storage/async-storage'

import { formatLine, getDebugLog, onDebugLog } from './debugLog'

const KEY = 'fractal.log.lastrun'

/*
 * How many lines of the last run to keep, and how often to write them.
 *
 * The whole log is four hundred lines and most of them are the ordinary
 * business of a working evening. What a crash needs is the end of it, so this
 * keeps the tail — enough to see the shape of what led up to it, small enough
 * that writing it is not itself a cost.
 *
 * Written on a timer rather than per line, for the reason the app is in this
 * state to begin with: a write per line is a write per request, and this phone
 * has already been made unusable once by work done more often than it needed to
 * be. Two seconds is long enough to be free and short enough that a crash loses
 * at most the last couple of lines — which are rarely the interesting ones,
 * because the interesting one is what happened before.
 */
const TAIL = 120
const EVERY_MS = 2000

/**
 * Keep the end of this run on disk, so the next one can show what killed it.
 *
 * "It crashes within a few minutes and is virtually unusable. I can't get to
 * the log before it crashes."
 *
 * That is the whole problem with a log that lives in memory: the run that
 * needed reading is the run that ended. Every crash so far has had to be
 * reconstructed from screenshots and a guess, and a guess is what this project
 * keeps paying for.
 *
 * NOT A CRASH HANDLER, deliberately. A handler that tries to write while the
 * process is going down is a handler that usually does not finish — and the
 * kind of death that matters most here, iOS killing an app it thinks is wedged,
 * does not run JavaScript on the way out at all. Writing as it goes survives
 * anything, including the power going.
 */
let stop = null
let timer = null
let dirty = false

export function keepLog() {
  if (stop) return stop
  const write = async () => {
    timer = null
    if (!dirty) return
    dirty = false
    try {
      const tail = getDebugLog().slice(-TAIL).map(formatLine)
      await AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), lines: tail }))
    } catch {
      /* A log that cannot be written down is not worth failing a launch over.
         It is a diagnostic, and the app still runs without one. */
    }
  }
  const off = onDebugLog(() => {
    dirty = true
    if (timer) return
    timer = setTimeout(write, EVERY_MS)
  })
  stop = () => {
    off()
    if (timer) clearTimeout(timer)
    timer = null
    stop = null
  }
  return stop
}

/**
 * What the last run had to say before it stopped, or null.
 *
 * Read once at launch and shown on the log screen under its own heading. It is
 * kept rather than cleared: a crash that happens twice is two runs worth
 * comparing, and the next launch overwrites it anyway.
 */
export async function lastRun() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return null
    const held = JSON.parse(raw)
    if (!Array.isArray(held?.lines) || !held.lines.length) return null
    return { at: Number(held.at) || null, lines: held.lines }
  } catch {
    return null
  }
}

export async function forgetLastRun() {
  try {
    await AsyncStorage.removeItem(KEY)
  } catch {
    /* Nothing to do about it, and nothing depends on it. */
  }
}
