#!/usr/bin/env node
/**
 * Serve the app from the machine with the cable in it.
 *
 * This is the whole of local mode, and it exists because of one browser rule.
 * A page loaded over HTTPS may call `http://localhost` — a deliberate
 * exemption, and the reason the hosted app works on the Mac — but that
 * exemption stops at localhost. It does not extend to `http://10.0.0.x`. So a
 * phone loading the hosted app can never reach the unit, no matter what is
 * running on the network.
 *
 * Everything else followed from routing around that: a Supabase project, an
 * account, a sign-in on both ends, a host switch, and an env file the player
 * had to write by hand on every machine they own.
 *
 * None of it is needed if the page comes from ForgeFX instead. Then the page
 * and the device server are the same origin over plain HTTP, and the phone
 * simply works. ForgeFX already serves a built SPA (FORGEFX_STATIC) and
 * already listens on every interface — this script is the wiring, plus a
 * name on the network and a code to scan.
 *
 *   npm run serve
 *
 * The relay is not deleted. It stays for reaching the rig from a different
 * network, which local mode genuinely cannot do.
 */
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bonjour } from 'bonjour-service'
import QRCode from 'qrcode'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const PORT = Number(process.env.PORT || 5056)
const NAME = process.env.FRACTAL_MDNS_NAME || 'fractal'

/**
 * Where ForgeFX is checked out.
 *
 * We do not own that repository and cannot vendor it, so its location is
 * configuration. The default is where the setup instructions put it.
 */
function findForgeFX() {
  const candidates = [
    process.env.FORGEFX_PATH,
    join(process.env.HOME || '', 'src/forgefx'),
    join(process.env.HOME || '', 'src/ForgeFX'),
    resolve(root, '../forgefx')
  ].filter(Boolean)

  for (const path of candidates) {
    if (existsSync(join(path, 'server', 'package.json'))) return path
  }
  return null
}

/** The address a phone on the same wifi can actually reach. */
function lanAddress() {
  for (const [, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
}

const run = (cmd, args, opts) =>
  new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts })
    child.on('error', fail)
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))))
  })

const forgefx = findForgeFX()
if (!forgefx) {
  console.error(
    '\nCannot find ForgeFX.\n\n' +
      'It is a separate project — the device server this app talks to — and it has to be\n' +
      'checked out somewhere. Clone it next to this one, or set FORGEFX_PATH:\n\n' +
      '  git clone https://github.com/sKuhLight/forgefx ~/src/forgefx\n' +
      '  cd ~/src/forgefx-midi && npm install && npm run build\n' +
      '  cd ~/src/forgefx/server && npm install\n'
  )
  process.exit(1)
}

console.log('Building the app…')
await run('npm', ['run', 'build'], { cwd: root })

const ip = lanAddress()
const urls = [`http://localhost:${PORT}`]
if (ip) urls.push(`http://${ip}:${PORT}`)
urls.push(`http://${NAME}.local:${PORT}`)
const phoneUrl = ip ? `http://${ip}:${PORT}` : `http://${NAME}.local:${PORT}`

/*
 * A name on the network, so the address is sayable.
 *
 * The IP works and changes; `fractal.local` does not. iOS resolves .local
 * natively — this is the same mechanism that makes a HeadRush answer to
 * headrushprime.local. Android's support is patchier, which is why the QR
 * code carries the IP rather than the name.
 */
const bonjour = new Bonjour()
const ad = bonjour.publish({ name: NAME, type: 'http', port: PORT })
const stopAd = () =>
  new Promise((done) => {
    try {
      ad.stop(done)
    } catch {
      done()
    }
  })

console.log('\n  Open this on your phone — same wifi, nothing to sign into:\n')
console.log(await QRCode.toString(phoneUrl, { type: 'terminal', small: true }))
for (const u of urls) console.log(`    ${u}`)
console.log('\n  Ctrl-C to stop.\n')

const server = spawn('npm', ['run', 'dev'], {
  cwd: join(forgefx, 'server'),
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(PORT),
    // The one line that makes the phone work: ForgeFX serves the built app,
    // so the page and the device API are the same origin.
    FORGEFX_STATIC: join(root, 'dist')
  }
})

const shutdown = async () => {
  await stopAd()
  bonjour.destroy()
  server.kill('SIGINT')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
server.on('exit', (code) => {
  stopAd().then(() => {
    bonjour.destroy()
    process.exit(code ?? 0)
  })
})
