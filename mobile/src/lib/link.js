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
import { listen, refreshAll, reset as resetRig } from './rig'

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
const initial = { link: 'off', macName: null, hosts: [], chosenHost: null, clash: null }

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
  state = next
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

  delay = state.link === 'connected' ? KEEPALIVE : nextDelay(delay)
  schedule(delay)
}

async function join() {
  set({ link: 'joining' })
  try {
    await remoteConnect()
  } catch {
    // A join that failed is a Mac that isn't there yet. The loop is the retry.
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
 * What the Mac calls itself, so a screen can say "Connected to Studio Mac".
 *
 * Written into the host's own document store by the launcher on that Mac, which
 * is also the read the roll call counts answers to.
 */
async function readMacName() {
  try {
    const doc = await remoteRequest('/store/config/host.name')
    const name = doc?.data?.name || doc?.name
    if (name) set({ macName: String(name) })
  } catch {
    // "your Mac" is a fine name.
  }
}

/** Start the loop. Idempotent — a second call is a probe, not a second loop. */
export function startLink() {
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
      // Back from a locked screen or another app: ask now rather than waiting
      // out whatever backoff the loop had reached while nobody was looking.
      if (status === 'active') probeNow()
    })
  ]

  schedule(0)
  return stopLink
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
  await remoteDisconnect()
  resetRig()
  set({ ...initial })
}

/** Whether a session was left over from last time, without joining anything. */
export const haveSession = () => restoreSession()
