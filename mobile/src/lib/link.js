/**
 * Keeping the phone joined to the Mac, without anyone having to think about it.
 *
 * A phone is not a browser tab. It gets locked, put in a pocket, carried out of
 * range, handed from wifi to cellular and back, and backgrounded for the length
 * of a song. Every one of those closes the socket, and none of them mean the
 * player wanted to disconnect.
 *
 * So the link is a loop rather than a button: join, prove the Mac answers, and
 * keep proving it. Backs off while nothing answers so a phone in a bag is not
 * hammering a sleeping Mac, and never goes quiet for good — a Mac waking up is
 * found within half a minute of it doing so.
 *
 * The same three constants as the web app's link.js, because they were chosen
 * against the same failure: a green lamp that is lying is worse than a red one.
 */
import { AppState } from 'react-native'
import { isDemo } from './demo'
import { logDebug } from './debugLog'

import {
  censusHosts,
  hostConflict,
  hostResponds,
  lastAnswerAt,
  remoteActive,
  remoteChosenHost,
  remoteConnect,
  remoteDisconnect,
  remoteHostSeen,
  remoteHosts,
  remoteRequest,
  restoreSession,
  subscribeHostSeen,
  subscribeRemoteState
} from './relay'
import { listen, refreshAll, reset as resetRig, watchUnit, stopWatching } from './rig'

export const PROBE_FIRST = 3000
export const PROBE_CAP = 30000
/**
 * How long a connected phone goes without hearing from the Mac before it asks.
 *
 * Playing makes no traffic while nobody touches the screen, so this is the only
 * way a Mac that went to sleep shows up as red — and eight seconds plus the
 * six-second question is as long as anyone should look at a lamp that is lying.
 */
export const KEEPALIVE = 8000

export function nextDelay(previous) {
  if (!previous || previous < PROBE_FIRST) return PROBE_FIRST
  return Math.min(previous * 2, PROBE_CAP)
}

/** 'off' | 'joining' | 'no-answer' | 'connected' */
const initial = {
  link: 'off',
  macName: null,
  /*
   * What version the app on the computer is.
   *
   * "Does the Mac app need to be updated to the latest version? Or would that
   * affect how the app performs?" A fair question with an answer nobody could
   * reach: the computer has been writing its version into `host.name` beside
   * its own name all along, and this end read the name and threw the version
   * away.
   *
   * It matters. That app is the thing holding the cable to the unit and doing
   * every read this phone asks for, so an old one is slow here for reasons that
   * look, from a phone, exactly like this app being slow. Null until it says,
   * and an old enough launcher never says — which is itself an answer.
   */
  hostVersion: null,
  hosts: [],
  chosenHost: null,
  clash: null
}

let state = initial
const watchers = new Set()

const set = (patch) => {
  const next = { ...state, ...patch }
  if (
    next.link === state.link &&
    next.macName === state.macName &&
    next.clash === state.clash &&
    next.chosenHost === state.chosenHost &&
    next.hosts.length === state.hosts.length
  ) {
    return
  }
  /*
   * Every change of mind about the Mac, in the log.
   *
   * This is the spine of a bad evening: joining, connected, no-answer,
   * connected again. The screen only ever shows the latest one, and "it kept
   * dropping" is unanswerable without the sequence. Only when the STATE moved —
   * the guard above has already thrown away the no-ops.
   */
  const was = state.link
  state = next
  if (next.link !== was) {
    logDebug('link', `${was} → ${next.link}`, next.macName || undefined)
  }
  for (const fn of watchers) fn(state)
}

export const linkState = () => state

export function subscribeLink(fn) {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

/** What the app should show, given the loop's own view of things. */
function refresh() {
  if (!running) return set({ link: 'off' })
  if (!remoteActive()) return set({ link: 'joining' })
  set({ link: remoteHostSeen() ? 'connected' : 'no-answer' })
}

let running = false
let timer = null
let delay = 0
let unbind = []

/** Ask again NOW — the screen came back, the network came back, someone tapped. */
export function probeNow() {
  if (!running) return
  delay = 0
  schedule(0)
}

function schedule(ms) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(tick, ms)
}

/**
 * One turn of the loop.
 *
 *   - no channel        → join
 *   - channel, no answer → ask
 *   - answering          → a keepalive only if nothing has been heard for a
 *     while; ordinary traffic is proof enough and costs nothing extra
 */
async function tick() {
  if (!running) return
  /* A real loop has no business running under the demo. See startLink. */
  if (isDemo()) return enterDemo()

  if (!remoteActive()) {
    await join()
  } else if (!remoteHostSeen()) {
    await hostResponds()
    refresh()
    if (remoteHostSeen()) await readMacName()
  } else if (Date.now() - lastAnswerAt() > KEEPALIVE) {
    await hostResponds()
    refresh()
  }

  // A computer that was updated while this phone watched says so within a
  // couple of minutes, rather than at the next join.
  if (running && state.link === 'connected' && Date.now() - namedAt > NAME_AGAIN) await readMacName()

  /* Stopped while this turn was waiting on the network: no next turn. A turn
     that rescheduled itself after stopLink is a loop nobody can see running. */
  if (!running) return
  delay = state.link === 'connected' ? KEEPALIVE : nextDelay(delay)
  schedule(delay)
}

async function join() {
  set({ link: 'joining' })
  const began = Date.now()
  try {
    await remoteConnect()
    if (!running) return
  } catch (err) {
    // A join that failed is a Mac that isn't there yet. The loop is the retry.
    // Said in the log with why and how long, because "joining" for minutes
    // with nothing between the state lines was a log that could not be read.
    logDebug('link', `join failed after ${Math.round((Date.now() - began) / 100) / 10}s`, err?.message || String(err))
    refresh()
    return
  }
  listen()
  refresh()

  const answered = await hostResponds()
  refresh()
  if (!answered) return

  await readMacName()
  // Not awaited: the roll call costs a second and a half of listening and the
  // ordinary case has nothing to report, so it must not stand between someone
  // and their unit. Writes are refused from the moment the count lands.
  countHosts()

  try {
    await refreshAll()
  } catch {
    // The rig store keeps what it learned, including the failure.
  }

  /*
   * And from here on, keep asking.
   *
   * refreshAll is the only thing that ever established whether the unit is
   * there, and it runs once, here. "I purposefully unplugged the FM3 from
   * the computer and it still said connected" — it had, because after this
   * line nothing on a stage screen asks the unit anything: everything those
   * screens draw is already in the store. See rig.watchUnit.
   */
  watchUnit()
}

async function countHosts() {
  try {
    await censusHosts()
    set({ hosts: remoteHosts(), chosenHost: remoteChosenHost(), clash: hostConflict() })
  } catch {
    // A roll call that fails is not a reason to distrust the link.
  }
}

/**
 * How long the phone goes before asking the computer again what it is.
 *
 * The computer rewrites its name and version every five minutes (see
 * TELL_PHONES_MS in desktop/lib/host.mjs), and this end used to read it once,
 * at join, and never again. So a computer whose app was updated while the
 * phone sat connected kept answering with whatever it had said hours earlier —
 * including nothing at all, from a launcher too old to write a version.
 *
 * Asking again costs one small document read a couple of minutes, next to a
 * keepalive that already runs every eight seconds. That buys a phone that
 * notices a computer being updated while it watches.
 */
export const NAME_AGAIN = 2 * 60 * 1000

/** When the computer was last asked what it is. */
let namedAt = 0
/*
 * The last answer, so asking again every couple of minutes does not write the
 * same line into the log thirty times an hour. The log is read by being pasted
 * into a chat, and a line repeated that often buries the one that matters.
 * What is worth saying is the first answer and every time it changes.
 */
let namedSaid = null

/**
 * What the Mac calls itself, so a screen can say "Connected to Studio Mac".
 *
 * Written into the host's own document store by the launcher on that Mac, which
 * is also the read the roll call counts answers to. Since 7.205.0 the launcher
 * writes its own version beside the name, which is what the Setup screen and a
 * pasted log report as the computer app's version.
 *
 * Every outcome goes in the log, because "did not say" on the Setup screen has
 * three different causes and the pasted log could not tell them apart: a read
 * that never got an answer, a computer that has written nothing, and a computer
 * that wrote a name with no version beside it. Only the last of those is the
 * old launcher the screen blames.
 */
async function readMacName() {
  try {
    const doc = await remoteRequest('/store/config/host.name')
    const data = doc?.data && typeof doc.data === 'object' ? doc.data : doc
    namedAt = Date.now()
    const name = data?.name
    const version = data?.version
    if (!name) {
      say('the computer has not written its name yet')
      return
    }
    /*
     * Both together, and the version cleared when it is absent, the way the
     * browser has always read it. A version that is kept after the computer
     * stopped saying one is a screen reporting an app that may not be running
     * any more.
     */
    set({ macName: String(name), hostVersion: version ? String(version) : null })
    say(version ? `the computer is ${name}, v${version}` : `the computer is ${name} and did not say its version`)
  } catch (err) {
    // "your Mac" is a fine name. The log still says the asking failed.
    say(`could not read what the computer is — ${err?.message || String(err)}`)
  }
}

/** Said once, and again only when the answer is a different one. */
function say(line) {
  if (line === namedSaid) return
  namedSaid = line
  logDebug('link', line)
}

/** Start the loop. Idempotent — a second call is a probe, not a second loop. */
export function startLink() {
  /*
   * The demo has no far end, so there is nothing to find and nothing to poll.
   *
   * Said as 'connected' because that is what it is from every screen's point of
   * view: the questions get answered. Leaving it as 'no-answer' would have the
   * whole app refuse to open the preset list over a unit that is right there.
   * The name is what tells anybody it is not a real rig, and the bar shows it.
   */
  if (isDemo()) {
    enterDemo()
    return stopLink
  }
  if (running) {
    probeNow()
    return stopLink
  }
  running = true
  delay = 0

  unbind = [
    // The channel coming back under us is the app catching up rather than a
    // stale screen; realtime-js rejoins on its own and this is what notices.
    subscribeRemoteState(() => refresh()),
    subscribeHostSeen(() => refresh()),
    AppState.addEventListener('change', (status) => {
      /*
       * Said in the log, because without it a paste reads as a link that
       * keeps dropping: "connected → joining" twelve seconds after the last
       * tap, "→ connected" a second before the next. That is the phone's
       * screen going off — Android cuts the connection when the app is put
       * to sleep — and this is the app coming back. Six of those in one
       * evening's log, none of them a fault, and nothing in it said so.
       */
      logDebug('app', status === 'active' ? 'back on screen' : `put to sleep (${status})`)
      // Back from a locked screen or another app: ask now rather than waiting
      // out whatever backoff the loop had reached while nobody was looking.
      if (status === 'active') probeNow()
      /*
       * A phone in a pocket has no screen to be wrong on, so the unit check
       * stops with it — and starts again on the way back, where its first
       * answer lands before anybody has read anything. Android cuts the
       * connection on sleep anyway, so the checks that would run in there
       * would only be a column of failures in the log.
       */
      if (status === 'active') watchUnit()
      else stopWatching()
    })
  ]

  schedule(0)
  return stopLink
}

/*
 * THE DEMO IS ALWAYS CONNECTED, and nothing that finishes late may say otherwise.
 *
 * "I'm in the demo and the preset is greyed out and can't be pressed." The
 * preset list opens only while the link says connected. Entering the demo runs
 * stopLink and then startLink — and stopLink used to reset the link AFTER
 * awaiting the channel's disconnect, so its tail landed after startLink had
 * already said connected, and put 'off' back:
 *
 *   [link] no-answer → connected — the demo
 *   [link] connected → off
 *
 * So the reset now happens before the wait, and a real loop found running
 * under the demo is stopped here rather than left to join a computer the
 * demo does not use.
 */
function enterDemo() {
  running = false
  if (timer) clearTimeout(timer)
  timer = null
  set({ link: 'connected', macName: 'the demo', hostVersion: null })
}

export async function stopLink() {
  running = false
  if (timer) clearTimeout(timer)
  timer = null
  for (const off of unbind) {
    try {
      off?.remove ? off.remove() : off?.()
    } catch {
      // Unbinding twice is not a failure worth reporting.
    }
  }
  unbind = []
  namedAt = 0
  namedSaid = null
  /* Reset first, then wait: see enterDemo. */
  resetRig()
  set({ ...initial })
  await remoteDisconnect()
}

/** Whether a session was left over from last time, without joining anything. */
export const haveSession = () => restoreSession()
