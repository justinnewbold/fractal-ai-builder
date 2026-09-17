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

/*
 * THE PREVIOUS RUN, TAKEN BEFORE ANYTHING IS ALLOWED TO OVERWRITE IT.
 *
 * The first version of this read it when the log screen opened, by which time
 * this run had been writing over it for minutes — so the "run before this one"
 * was this one, printed twice. It went out and Justin pasted it back:
 *
 *   07:57:34.857 [tap] press Just looking? Try the demo — 1993ms
 *   THE RUN BEFORE THIS ONE — 12 lines
 *   07:57:34.857 [tap] press Just looking? Try the demo — 1993ms
 *
 * Same timestamps, both halves. Useless, and worse than useless: it looks like
 * evidence. So the read happens once, at launch, and nothing may write until it
 * has finished.
 */
let held = null
let taken = null

export function keepLog() {
  if (stop) return stop
  /* Started at launch, which is the fix: the read is asked for before this run
     has written a word. The wait on it below is only insurance. */
  taken = readHeld()
  const write = async () => {
    timer = null
    if (!dirty) return
    dirty = false
    try {
      /* Storage hands back what it held when it was ASKED, so the read above is
         already safe. This wait costs an already-started promise and removes
         the question entirely, which is worth it for the one bug this file has
         had. */
      await taken
      const tail = getDebugLog().slice(-TAIL).map(formatLine)
      await AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), lines: tail }))
    } catch {
      /* A log that cannot be written down is not worth failing a launch over.
         It is a diagnostic, and the app still runs without one. */
    }
  }
  const off = onDebugLog((entry) => {
    dirty = true
    /* The one line that cannot wait its two seconds. A fatal error ends the
       app a quarter of a second after it is logged (CRASH_FLUSH_MS, in
       debugLog), so the crash line goes now. This is still not a crash
       handler: it is the same write the timer would have made, made sooner,
       and it carries the run that led up to the crash along with it. */
    if (entry?.source === 'crash') {
      if (timer) clearTimeout(timer)
      write()
      return
    }
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

/** Take what is on disk into memory. Started at launch, and only then. */
async function readHeld() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return
    const was = JSON.parse(raw)
    if (Array.isArray(was?.lines) && was.lines.length) {
      held = { at: Number(was.at) || null, lines: was.lines }
    }
  } catch {
    /* Nothing kept, then — which is the ordinary first launch. */
  }
}

/**
 * What the last run had to say before it stopped, or null.
 *
 * Shown on the log screen under its own heading, and kept rather than cleared:
 * a crash that happens twice is two runs worth comparing, and the next launch
 * overwrites it anyway.
 */
export async function lastRun() {
  /* Whatever was on disk when this run started, never what is on disk now. */
  if (taken) await taken
  return held
}

export async function forgetLastRun() {
  held = null
  try {
    await AsyncStorage.removeItem(KEY)
  } catch {
    /* Nothing to do about it, and nothing depends on it. */
  }
}
