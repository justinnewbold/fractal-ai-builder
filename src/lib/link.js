/**
 * Which end of the phone remote this is, and whether the other end is there.
 *
 * The main purpose of this app is to be a phone remote for the unit on the
 * Mac, and until this file the app could not say honestly whether that was
 * working. "Connected" meant a channel had been joined — true with the Mac
 * off and nothing answering, false for a phone happily driving the rig over
 * wifi. The only honest test of a link is whether the far end answers, so
 * that is the only thing that turns the lamp green here.
 *
 * One object, one subscription, the way `subscribeRemoteState` works:
 *
 *   role    — 'mac' (the machine with the cable), 'wifi' (a phone that opened
 *             the app served from the Mac), 'remote' (a phone on the web app),
 *             'unknown' until asked.
 *   link    — 'signed-out' | 'joining' | 'no-answer' | 'connected' | 'off'
 *   account — who is signed in here, or null
 *   hostOn  — mac role: the Mac is listening for a phone
 *   macName — remote role: what the phone shows once the Mac has answered
 *   since   — when `link` last changed, so a screen can wait out a blip
 *
 * The pure parts — which role this is, what state that makes, what to say
 * about it, how long to wait before asking again — take their facts as
 * arguments and are tested in node. The effectful part, `bootLink`, is the one
 * place those facts are gathered, and it imports the device module lazily
 * because that module is not importable outside a browser.
 */
import {
  restoreSession,
  currentAccount,
  remoteConnect,
  remoteDisconnect,
  hostResponds,
  remoteActive,
  remoteHostSeen,
  subscribeRemoteState,
  subscribeHostSeen,
  lastAnswerAt,
  loadRemoteConfig,
  saveRemoteConfig,
  setAutoConnect,
  wantsAutoConnect,
  hasSavedSession,
  remoteSignIn,
  signOut
} from './remote.js'

/**
 * Which end this is.
 *
 * Order matters, and each line is a case that was wrong under the next:
 *
 *   - Demo simulates the Mac, and makes the local-helper probe answer no.
 *   - A page served from the Mac at localhost is the Mac app's own window.
 *   - A page served from the Mac at any other address is a phone that
 *     scanned the QR. The helper probe answers YES there — the page's origin
 *     is the helper — so asking it would call a wifi phone "the Mac".
 *   - The hosted app in a browser at the Mac reaches the helper at localhost.
 *   - Anything else is a phone on the web app.
 */
export function detectRole({ demo, served, hostname, helperAlive }) {
  if (demo) return 'mac'
  if (served) return hostname === 'localhost' || hostname === '127.0.0.1' ? 'mac' : 'wifi'
  return helperAlive ? 'mac' : 'remote'
}

/**
 * The one fact everything else is drawn from: does the far end answer.
 *
 * Remote: connected means the channel is up AND the Mac has answered on it.
 * A joined channel with nothing on the other end is `no-answer`, not
 * connected — that is the whole correction.
 */
export function deriveLink({ role, hasSession, wantsAuto = true, joining, channelUp, hostSeen, hostOn, cloudUser }) {
  if (role === 'wifi') return 'connected'
  if (role === 'mac') {
    if (!cloudUser) return 'signed-out'
    return hostOn ? 'connected' : 'off'
  }
  if (role === 'remote') {
    if (!hasSession) return 'signed-out'
    // Disconnect was tapped. Signed in, not connected, and not trying — a
    // different thing from a Mac that is not answering, and it must not be
    // dressed as one.
    if (wantsAuto === false) return 'off'
    if (joining) return 'joining'
    return channelUp && hostSeen ? 'connected' : 'no-answer'
  }
  return 'off'
}

/**
 * How long to wait before asking the Mac again.
 *
 * Backs off while nothing answers so a phone in a bag is not hammering a
 * Mac that is asleep, and never goes quiet for good: a Mac waking up should
 * be found within half a minute of it doing so.
 */
export const PROBE_FIRST = 3000
export const PROBE_CAP = 30000
/*
 * How long a connected phone goes without hearing from the Mac before it
 * asks. Play makes no traffic while nobody touches it, so this is the only
 * way a Mac that went to sleep shows up as red — and eight seconds plus the
 * six-second question is as long as anyone should look at a green lamp that
 * is lying.
 */
export const KEEPALIVE = 8000

export function nextDelay(previous) {
  if (!previous || previous < PROBE_FIRST) return PROBE_FIRST
  return Math.min(previous * 2, PROBE_CAP)
}

/**
 * What to say about the link, in words a person would use.
 *
 * `word` is for the bar, where there is room for one. `sentence` is the same
 * fact for a popover or a screen reader. `note` sits beside the Phone remote
 * heading in Setup. `tone` picks the colour: good, bad, busy or dim.
 */
export function describeLink(state) {
  const { role, link, account, macName } = state
  const who = macName || 'your Mac'
  const email = account?.email || ''

  if (role === 'wifi') {
    return {
      word: 'wifi',
      sentence: 'Connected to your Mac over wifi',
      note: 'Connected over wifi',
      tone: 'good'
    }
  }

  if (role === 'mac') {
    if (link === 'connected') {
      return {
        word: 'remote on',
        sentence: `Phone remote is on${email ? ` for ${email}` : ''}`,
        note: `On${email ? ` · ${email}` : ''}`,
        tone: 'good'
      }
    }
    if (link === 'signed-out') {
      return {
        word: 'set up',
        sentence: 'Phone remote is not set up yet',
        note: 'Set up once',
        tone: 'dim'
      }
    }
    return {
      word: 'remote off',
      sentence: 'Phone remote is off',
      note: `Off${email ? ` · ${email}` : ''}`,
      tone: 'dim'
    }
  }

  if (role === 'remote') {
    if (link === 'connected') {
      return { word: 'connected', sentence: `Connected to ${who}`, note: `Connected to ${who}`, tone: 'good' }
    }
    if (link === 'joining') {
      return { word: 'connecting', sentence: 'Connecting to your Mac', note: 'Connecting…', tone: 'busy' }
    }
    if (link === 'no-answer') {
      return {
        word: 'no answer',
        sentence: 'Your Mac isn’t answering',
        note: 'Your Mac isn’t answering',
        tone: 'bad'
      }
    }
    return { word: 'off', sentence: 'Not connected to your Mac', note: 'Not connected', tone: 'dim' }
  }

  return { word: '', sentence: '', note: '', tone: 'dim' }
}

/**
 * The one sentence about Safari, only where it is true.
 *
 * A page served over https cannot talk to the plain-http Fractal app on the
 * same Mac from Safari; Chrome can. That is the whole fact, and it is only a
 * fact at the Mac, in Safari, on an https page. The sentence used to be shown
 * everywhere the unit could not be read — to phones, where Chrome is Safari
 * underneath, and to Chrome itself.
 */
export function whySafari({ secure, userAgent }) {
  if (!secure) return ''
  const ua = String(userAgent || '')
  const webkit =
    /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|OPR|FxiOS|Android|iPhone|iPad|iPod/i.test(ua)
  return webkit ? 'Using Safari? Try Chrome — Safari won’t let this page talk to the Fractal app on your Mac.' : ''
}

/**
 * What to say when the unit cannot be read, by which end this is.
 *
 * The same failure means different things at different ends. At the Mac it
 * is the app not running; on a wifi phone it is the Mac gone; on a phone on
 * the web app it is the Mac answering but the unit not. Before the role is
 * known it means nothing yet, and nothing is what to say — the old notice
 * told every phone to open an app on "this Mac" and try Chrome.
 */
export function faultCopy({ role, device, secure = false, userAgent = '' }) {
  if (device && device.connected === false) {
    return {
      title: 'No unit found',
      body: 'Your Mac is connected, but no Fractal is plugged into it. Check the cable, and that nothing else is using it, then tap Try again.'
    }
  }
  if (role === 'mac') {
    const safari = whySafari({ secure, userAgent })
    return {
      title: 'Can’t find your Fractal',
      body: `Open the Fractal app on this Mac — it’s what talks to the unit.${safari ? ` ${safari}` : ''}`
    }
  }
  if (role === 'wifi') {
    return {
      title: 'Lost the Mac',
      body: 'Make sure the Fractal app is still open on the Mac and this phone is on the same wifi, then tap Try again.'
    }
  }
  if (role === 'remote') {
    return {
      title: 'Your Mac answered, but the unit didn’t',
      body: 'Check the Fractal app is open on the Mac and the unit is plugged in and switched on, then tap Try again.'
    }
  }
  return null
}

/* ------------------------------------------------------------------
   State and subscription
   ------------------------------------------------------------------ */

let state = {
  role: 'unknown',
  link: 'off',
  account: null,
  hostOn: false,
  macName: null,
  since: Date.now(),
  /** mac role: whether this ForgeFX can host at all, and who it is signed in as. */
  cloud: null
}
let joining = false
/*
 * A saved sign-in is being picked up. Until the client has loaded and asked,
 * there is no account object — but there is a session, and a phone with one
 * is connecting, not signed out. Without this the connect screen asked a
 * signed-in phone to Connect for the second the restore took.
 */
let restoring = false
const watchers = new Set()

export const linkState = () => state

export function subscribeLink(fn) {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

function set(patch) {
  const next = { ...state, ...patch }
  if (next.link !== state.link) next.since = Date.now()
  const changed = Object.keys(next).some((k) => next[k] !== state[k])
  state = next
  if (!changed) return
  for (const fn of watchers) {
    try {
      fn(state)
    } catch {
      // One bad watcher shouldn't stop the others.
    }
  }
}

/** Recompute `link` from what is currently known. */
function refresh(patch = {}) {
  const merged = { ...state, ...patch }
  const link = deriveLink({
    role: merged.role,
    hasSession: !!merged.account || restoring,
    wantsAuto: wantsAutoConnect(),
    joining: joining || restoring,
    channelUp: remoteActive(),
    hostSeen: remoteHostSeen(),
    hostOn: merged.hostOn,
    cloudUser: merged.cloud?.user || null
  })
  set({ ...patch, link })
}

/* ------------------------------------------------------------------
   The remote end: joining, probing, and the loop that keeps asking
   ------------------------------------------------------------------ */

let timer = null
let delay = 0
let booted = false

const device = () => import('./forgefx.js')

/** Join the Mac's channel and find out whether it is there. */
async function join() {
  if (joining) return
  joining = true
  refresh()
  try {
    await remoteConnect()
    await hostResponds()
  } catch {
    // The far end may simply be off. The loop below keeps asking; this is
    // not a decision to stop trying.
  } finally {
    joining = false
  }
  refresh()
  if (remoteHostSeen()) readMacName()
}

/** The name the launcher wrote on the Mac, read over the link once it answers. */
async function readMacName() {
  try {
    const { readHostDoc } = await device()
    const doc = await readHostDoc('host.name')
    if (doc?.name) set({ macName: String(doc.name) })
  } catch {
    // "your Mac" is a fine name.
  }
}

function schedule(ms) {
  clearTimeout(timer)
  timer = setTimeout(tick, ms)
}

/**
 * One turn of the loop. What it does depends on what is wrong:
 *
 *   - no channel → try to join
 *   - channel but no answer → ask
 *   - answering → a keepalive only if nothing has been heard for a while;
 *     ordinary traffic is proof enough and costs nothing extra
 */
async function tick() {
  if (state.role !== 'remote' || !state.account || wantsAutoConnect() === false) return
  if (typeof document !== 'undefined' && document.hidden) {
    schedule(PROBE_CAP)
    return
  }
  if (!remoteActive()) {
    await join()
  } else if (!remoteHostSeen()) {
    await hostResponds()
    refresh()
    if (remoteHostSeen()) readMacName()
  } else if (Date.now() - lastAnswerAt() > KEEPALIVE) {
    await hostResponds()
    refresh()
  }
  delay = state.link === 'connected' ? KEEPALIVE : nextDelay(delay)
  schedule(delay)
}

/** Ask again soon — the screen came back, the network came back, someone tapped. */
export function pokeLink() {
  delay = 0
  schedule(PROBE_FIRST)
}

/* ------------------------------------------------------------------
   The Mac end
   ------------------------------------------------------------------ */

/**
 * What the Mac knows about itself: can it host, is it signed in, is it on.
 *
 * And the re-arm. The Mac's device server forgets its host switch every time
 * it restarts. The launchers turn it back on at launch; this is the second
 * net, for a ForgeFX started by hand — on by default once signed in, and only
 * an explicit "off" recorded by the app is respected.
 */
async function readMac() {
  const { isDemo, cloudStatus, remoteStatus, remoteEnable, readHostDoc } = await device()
  if (isDemo()) {
    set({ cloud: { enabled: false, user: null, demo: true }, hostOn: false })
    refresh()
    return
  }
  let cloud = null
  let host = null
  try {
    cloud = await cloudStatus()
  } catch {
    cloud = { enabled: false, user: null }
  }
  try {
    host = await remoteStatus()
  } catch {
    host = { enabled: false, connected: false }
  }
  let hostOn = !!(host?.enabled && host?.connected)
  if (cloud?.enabled && cloud?.user && !host?.enabled) {
    const wanted = await readHostDoc('remote.host')
    if (!wanted || wanted.wanted !== false) {
      try {
        const res = await remoteEnable(true)
        hostOn = !!(res?.enabled && res?.connected && !res?.error)
      } catch {
        hostOn = false
      }
    }
  }
  const named = await readHostDoc('host.name')
  refresh({ cloud, hostOn, macName: named?.name ? String(named.name) : state.macName })
}

/* ------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------ */

/**
 * Work out which end this is, pick up the saved sign-in, and — on a phone
 * with one — connect. Called once, from the app's mount.
 *
 * Restoring the session happens for every role, unconditionally. It used to
 * happen only inside a panel that mounted after the app had already failed,
 * which is why a phone always saw an error screen first, and why "not signed
 * in" was shown over a perfectly good session.
 */
export async function bootLink() {
  if (booted) return state
  booted = true

  const { isDemo, servedLocally, localHelperAlive } = await device()
  const served = servedLocally()
  const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
  const helperAlive = isDemo() || served ? false : await localHelperAlive()
  const role = detectRole({ demo: isDemo(), served, hostname, helperAlive })

  /*
   * The role, now — before the network is asked anything. Everything that
   * decides what the screen is hangs on it, and while it was withheld until
   * the session round-trip finished, the app showed the Mac's error to every
   * phone. A phone with a saved sign-in reads as connecting from this moment.
   */
  const config = loadRemoteConfig()
  restoring = role === 'remote' && hasSavedSession({ url: config?.url }) && wantsAutoConnect() !== false
  refresh({ role })

  await restoreSession({ url: config?.url, anonKey: config?.anonKey })
  const account = await currentAccount()
  restoring = false
  set({ account })

  subscribeRemoteState(() => refresh())
  subscribeHostSeen(() => refresh())

  if (role === 'mac') {
    await readMac()
  } else if (role === 'remote') {
    if (account && wantsAutoConnect() !== false) {
      // join() announces itself as joining first, so the screen goes from
      // "connecting" to "connecting" — never through "isn't answering".
      await join()
      schedule(state.link === 'connected' ? KEEPALIVE : PROBE_FIRST)
    } else {
      refresh()
    }
  } else {
    refresh()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.role === 'remote') pokeLink()
    })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      if (state.role === 'remote') pokeLink()
    })
  }
  return state
}

/* ------------------------------------------------------------------
   Actions — what the buttons call
   ------------------------------------------------------------------ */

/** Sign in on this phone and connect. Stays signed in from here on. */
export async function connectPhone({ email, password }) {
  const config = loadRemoteConfig() || {}
  await remoteSignIn({ url: config.url, anonKey: config.anonKey, email, password })
  saveRemoteConfig({ ...config, email: email.trim(), autoConnect: true })
  const account = await currentAccount()
  set({ account })
  await join()
  schedule(state.link === 'connected' ? KEEPALIVE : PROBE_FIRST)
  return state
}

/** Connect again with the sign-in already here. */
export async function reconnectPhone() {
  setAutoConnect(true)
  if (!state.account) {
    const config = loadRemoteConfig()
    await restoreSession({ url: config?.url, anonKey: config?.anonKey })
    set({ account: await currentAccount() })
  }
  await join()
  schedule(state.link === 'connected' ? KEEPALIVE : PROBE_FIRST)
  return state
}

/**
 * Stop being a remote, and stay stopped.
 *
 * The one place auto-connect is turned off. It used to be turned off by a
 * failed rejoin as well, so a Mac that was merely asleep disarmed the phone
 * for good.
 */
export async function disconnectPhone() {
  clearTimeout(timer)
  setAutoConnect(false)
  await remoteDisconnect()
  refresh()
  return state
}

/**
 * Set the Mac up, once: sign the browser in, sign the device server in with
 * the same details, and turn the host on. One form, three things that used
 * to be three forms.
 */
export async function setUpMac({ email, password }) {
  const { cloudLogin, remoteEnable, writeHostDoc, readHostDoc } = await device()
  const config = loadRemoteConfig() || {}
  await remoteSignIn({ url: config.url, anonKey: config.anonKey, email, password })
  saveRemoteConfig({ ...config, email: email.trim() })
  const account = await currentAccount()
  set({ account })

  await cloudLogin(email, password)
  const res = await remoteEnable(true)
  if (res?.error) throw new Error("Signed in, but couldn't turn the phone remote on. Try again.")
  await writeHostDoc('remote.host', { wanted: true, at: Date.now() })
  if (!(await readHostDoc('host.name'))?.name) {
    await writeHostDoc('host.name', { name: 'your Mac' })
  }
  await readMac()
  return state
}

/** Turn the Mac's phone remote on or off, and remember which. */
export async function setMacRemote(on) {
  const { remoteEnable, writeHostDoc } = await device()
  const res = await remoteEnable(!!on)
  if (on && res?.error) throw new Error("Couldn't turn it on. Check this Mac is online, then try again.")
  await writeHostDoc('remote.host', { wanted: !!on, at: Date.now() })
  await readMac()
  return state
}

/** Sign out on this device only. Other devices stay signed in. */
export async function signOutHere() {
  if (state.role === 'remote') await disconnectPhone()
  await signOut()
  if (state.role === 'mac') {
    try {
      const { remoteEnable, cloudLogout } = await device()
      await remoteEnable(false)
      await cloudLogout()
    } catch {
      // Signed out here regardless.
    }
    set({ account: null, cloud: { ...(state.cloud || {}), user: null }, hostOn: false })
    refresh()
    return state
  }
  set({ account: null })
  refresh()
  return state
}

/** Tests only: put the module back to the state it loads in. */
export function _resetLink() {
  clearTimeout(timer)
  timer = null
  delay = 0
  joining = false
  restoring = false
  booted = false
  state = { role: 'unknown', link: 'off', account: null, hostOn: false, macName: null, since: Date.now(), cloud: null }
  watchers.clear()
}
