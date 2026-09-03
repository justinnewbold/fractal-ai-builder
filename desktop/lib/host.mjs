/**
 * The mechanics of serving this app from the machine with the cable.
 *
 * Two things do this now — `npm run serve` for a terminal, and the desktop app
 * for everyone else — and they must not drift, because the ways they could
 * disagree are all invisible until a phone is in someone's hand: a different
 * port, a different mDNS name, a different idea of where ForgeFX lives.
 *
 * So the decisions live here, in a module that imports neither Electron nor
 * mDNS. Both are handed in, the same way `deviceState` takes its driver — which
 * is also what makes any of this testable without a Mac, a unit, or a network.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { networkInterfaces, hostname as osHostname } from 'node:os'
import { DEFAULT_PROJECT } from './project.mjs'

export const DEFAULT_PORT = 5056
export const DEFAULT_NAME = 'fractal'

/**
 * Where ForgeFX is.
 *
 * It is a separate project — we do not own it and cannot vendor it — so its
 * location is configuration with sensible guesses. A path only counts if it
 * actually holds the server, because a half-finished clone that answers
 * `existsSync` is worse than no match: it fails later, further from the cause.
 */
export function findForgeFX({ env = process.env, exists = existsSync, extra = [] } = {}) {
  const home = env.HOME || env.USERPROFILE || ''
  const candidates = [env.FORGEFX_PATH, ...extra, join(home, 'src/forgefx'), join(home, 'src/ForgeFX')]
  for (const path of candidates) {
    if (path && exists(join(path, 'server', 'package.json'))) return path
  }
  return null
}

/**
 * The address a phone on the same wifi can actually reach.
 *
 * Loopback is useless here by definition: the whole point is a second device.
 * Returns null rather than falling back to 127.0.0.1, so a caller shows "no
 * network" instead of printing an address that cannot work.
 */
export function lanAddress(interfaces = networkInterfaces) {
  for (const addrs of Object.values(interfaces() || {})) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
}

/**
 * Every way in, most useful first.
 *
 * The QR code carries the IP rather than the .local name on purpose. iOS
 * resolves .local natively — it is the same mechanism that answers for a
 * HeadRush — but Android's support is patchy enough that a scanned code
 * failing would be the worst possible first impression. The name is still
 * offered for typing, where a human can retry.
 */
export function addresses({ port = DEFAULT_PORT, name = DEFAULT_NAME, ip } = {}) {
  const local = `http://localhost:${port}`
  const mdns = `http://${name}.local:${port}`
  const lan = ip ? `http://${ip}:${port}` : null
  return {
    local,
    mdns,
    lan,
    /** What to put in front of a camera. Null when there is no network at all. */
    forPhone: lan || null,
    all: [local, lan, mdns].filter(Boolean)
  }
}

/**
 * The environment ForgeFX is started with.
 *
 * `FORGEFX_STATIC` is the whole of local mode in one variable: it makes the
 * device server serve this app, so the page and the device API are the same
 * origin and a phone needs no account to bridge them.
 *
 * The three account variables are the whole of phone-remote mode. ForgeFX
 * will only host a phone when they are set, and until now that meant a person
 * opening its `.env` in an editor — the single step that stopped anyone who
 * was not already a developer. Set here, every launch, they are simply true.
 * An operator's own values still win, for a second project or a rotated key;
 * and ForgeFX's own `.env` cannot override these, because Node's loader does
 * not replace a variable that is already in the environment.
 */
export function serverEnv({
  env = process.env,
  port = DEFAULT_PORT,
  dist,
  project = DEFAULT_PROJECT,
  asNode = false
}) {
  return {
    ...env,
    /*
     * Electron, told to be Node.
     *
     * The desktop app starts the server with `process.execPath`, which in a
     * packaged app is the Electron binary — so without this it launches a
     * second copy of the app rather than running the server, and the unit is
     * never reachable. It reads as "run this script with the binary I am", and
     * that is only true of a binary that is already Node. The terminal
     * launcher is already Node and passes nothing.
     */
    ...(asNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    PORT: String(port),
    FORGEFX_STATIC: dist,
    AXIS_CLOUD: env.AXIS_CLOUD ?? '1',
    SUPABASE_URL: env.SUPABASE_URL ?? project.url,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY ?? project.anonKey
  }
}

/**
 * "Justins-MacBook-Pro.local" as a person would say it.
 *
 * The phone shows this — "Connected to Justins MacBook Pro" — so it is worth
 * the two lines. The `.local` is the network's business, and the hyphens are
 * a rule about hostnames, not about the machine's name.
 */
export function prettyHostname(name = osHostname()) {
  return String(name || '')
    .replace(/\.local$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'your Mac'
}

/**
 * Turn the phone remote on, every launch, with nobody touching anything.
 *
 * ForgeFX remembers being signed in across restarts — that lives in its own
 * store — but it forgets the host switch every time, and nothing in it turns
 * the switch back on at startup. Until now the only thing that did was a
 * browser tab at the Mac, and only if someone opened the settings there. So
 * the phone found a Mac that was signed in, listening for nothing.
 *
 * This runs after the launchers start ForgeFX. Its rules, in order:
 *
 *   - Wait for ForgeFX to answer at all. `npm run dev` compiles first.
 *   - Write this Mac's name where the phone can read it, always. The launcher
 *     is the one thing that reliably knows it.
 *   - No account support in this ForgeFX → nothing to do, say so.
 *   - Not signed in → nothing to do, say so. Signing in happens once, in the
 *     app; it is the only step a person ever takes.
 *   - Already on → done.
 *   - Someone turned it off on purpose → respect that. "Off" is a decision
 *     the app records; the absence of a record means on.
 *   - Otherwise turn it on, and try a few times: the first call after boot
 *     has to reach the account service, and a Mac waking up is sometimes a
 *     few seconds ahead of its wifi.
 *
 * Never throws. A launcher must not fall over because a network was slow —
 * the unit still works at the Mac either way, and the browser at the Mac
 * makes the same attempt when it opens.
 *
 * Everything with a side effect is injected, which is what lets the sequence
 * be tested without a Mac, a ForgeFX, or a network.
 */
export async function armHost({
  port = DEFAULT_PORT,
  fetch = globalThis.fetch,
  hostname = prettyHostname(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  attempts = 90,
  log = () => {}
} = {}) {
  const base = `http://localhost:${port}`
  const call = async (path, init) => {
    const res = await fetch(base + path, init)
    let body = null
    try {
      body = await res.json()
    } catch {
      // Not every reply is JSON, and a body we cannot read is not the point.
    }
    return { ok: res.ok, status: res.status, body }
  }
  const json = (method, path, data) =>
    call(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data)
    })

  try {
    // 1. Wait for it to be there.
    let up = false
    for (let i = 0; i < attempts && !up; i++) {
      try {
        up = (await call('/healthz')).ok
      } catch {
        up = false
      }
      if (!up) await sleep(1000)
    }
    if (!up) {
      log('Phone remote: the device server never answered, so it was left alone.')
      return { on: false, reason: 'no-server' }
    }

    // 2. The name the phone will show.
    try {
      await json('PUT', '/store/config/host.name', { data: { name: hostname }, origin: 'fractal' })
    } catch {
      // A name is a nicety; the phone says "your Mac" without one.
    }

    // 3. Can this ForgeFX host at all, and is anyone signed in?
    const cloud = (await call('/cloud/status')).body || {}
    if (!cloud.enabled) {
      log('Phone remote: this device server has no account support, so it stays off.')
      return { on: false, reason: 'no-cloud' }
    }
    if (!cloud.user) {
      log('Phone remote: sign in once in the app to turn it on.')
      return { on: false, reason: 'signed-out' }
    }
    const email = cloud.user.email || null

    // 4. Already on.
    const status = (await call('/remote/status')).body || {}
    if (status.enabled) {
      log(`Phone remote: on for ${email || 'this account'}.`)
      return { on: true, email }
    }

    // 5. Turned off on purpose.
    const wanted = (await call('/store/config/remote.host')).body?.data
    if (wanted && wanted.wanted === false) {
      log('Phone remote: off — it was turned off in the app.')
      return { on: false, reason: 'turned-off', email }
    }

    // 6. Turn it on.
    let last = null
    for (let i = 0; i < 3; i++) {
      try {
        const res = await json('POST', '/remote/enable', { on: true })
        if (res.ok && !res.body?.error) {
          log(`Phone remote: on for ${email || 'this account'}.`)
          return { on: true, email }
        }
        last = res.body?.error || `HTTP ${res.status}`
      } catch (err) {
        last = err.message
      }
      if (i < 2) await sleep(5000)
    }
    log(`Phone remote: couldn't turn it on (${last}). Open the app on this Mac to try again.`)
    return { on: false, reason: 'failed', email, error: last }
  } catch (err) {
    log(`Phone remote: left alone (${err.message}).`)
    return { on: false, reason: 'failed', error: err.message }
  }
}

/**
 * Wait until the device server is actually answering.
 *
 * Spawning it is not starting it: the process exists long before Fastify is
 * listening, and a window opened in that gap gets a refused connection and
 * shows nothing at all, for ever, because nothing retries a page that failed.
 *
 * That is what the first working install did — a blank window, no error, and
 * an app that had in fact started correctly. It only looked fine before
 * because another ForgeFX was already listening and answered instantly.
 *
 * Half a second between tries, a minute in total: a cold start compiling on a
 * slow morning is still a start, and the alternative is telling someone their
 * unit is missing when the server simply had not finished waking up.
 */
export async function waitForServer({
  port = DEFAULT_PORT,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  attempts = 120
} = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/healthz`)).ok) return true
    } catch {
      // Not up yet. That is the normal case for the first second or two.
    }
    await sleep(500)
  }
  return false
}

/**
 * Who, if anyone, already has the port.
 *
 * ForgeFX allocates its own port when the one it is given is taken: it catches
 * EADDRINUSE and re-listens on 0, letting the OS choose. That is sensible for a
 * server started by hand and quietly wrong for one started by an app, because
 * the app goes on believing the port it asked for is the port it got — it opens
 * a window on 5056, and whatever was already there answers.
 *
 * That is not hypothetical: it is what the first person to run this app saw. A
 * ForgeFX they already had running answered, knew nothing about serving the
 * page, and returned a bare 404 into the app's own window.
 *
 * So the launcher asks first, and asks specifically: is anything there, and is
 * it a ForgeFX? Two instances must not both open the same serial port, so the
 * answer decides between carrying on, standing aside, and moving.
 */
export async function whoHasPort({ port = DEFAULT_PORT, fetch = globalThis.fetch, connect } = {}) {
  const listening = await new Promise((done) => {
    // Injected so this is testable without binding anything.
    if (!connect) return done(null)
    connect(port, done)
  })
  if (!listening) return { free: true }
  try {
    const res = await fetch(`http://localhost:${port}/healthz`)
    if (res.ok) return { free: false, forgefx: true }
  } catch {
    // Something is there and it is not answering as ForgeFX does.
  }
  return { free: false, forgefx: false }
}

/** What to say when the port is held by a ForgeFX we did not start. */
export const PORT_TAKEN = (port = DEFAULT_PORT) =>
  `ForgeFX is already running on this Mac, on port ${port}.\n\n` +
  'This app carries its own copy and cannot share the unit with another one — two of\n' +
  'them cannot both hold the serial port. Quit the ForgeFX you have running (a Terminal\n' +
  'window, a Docker container, or another copy of this app) and open this again.'

/**
 * Publish the name, and hand back the way to stop.
 *
 * `Bonjour` is injected because this module has to stay importable without it
 * — the tests run in a container with no network worth advertising on, and the
 * two callers install it in different places.
 */
export function publish(Bonjour, { port = DEFAULT_PORT, name = DEFAULT_NAME } = {}) {
  if (!Bonjour) return { stop: async () => {} }
  const bonjour = new Bonjour()
  const ad = bonjour.publish({ name, type: 'http', port })
  return {
    ad,
    stop: () =>
      new Promise((done) => {
        try {
          ad.stop(() => {
            bonjour.destroy()
            done()
          })
        } catch {
          try {
            bonjour.destroy()
          } catch {
            // Nothing left to clean up.
          }
          done()
        }
      })
  }
}

/** What to tell someone when ForgeFX cannot be found. One place, both callers. */
export const MISSING_FORGEFX =
  'Cannot find ForgeFX.\n\n' +
  'It is a separate project — the device server this app talks to — and it has to be\n' +
  'checked out somewhere. Clone it next to this one, or set FORGEFX_PATH:\n\n' +
  '  git clone https://github.com/sKuhLight/forgefx ~/src/forgefx\n' +
  '  git clone https://github.com/sKuhLight/forgefx-midi ~/src/forgefx-midi\n' +
  '  cd ~/src/forgefx-midi && npm install && npm run build\n' +
  '  cd ~/src/forgefx/server && npm install\n'
