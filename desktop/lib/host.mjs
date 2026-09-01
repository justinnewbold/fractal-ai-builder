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
import { networkInterfaces } from 'node:os'

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
 */
export function serverEnv({ env = process.env, port = DEFAULT_PORT, dist }) {
  return { ...env, PORT: String(port), FORGEFX_STATIC: dist }
}

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
