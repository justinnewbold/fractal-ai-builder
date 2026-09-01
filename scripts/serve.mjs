#!/usr/bin/env node
/**
 * Serve the app from the machine with the cable in it.
 *
 * This is local mode from a terminal. The desktop app does the same thing
 * without one — both go through desktop/lib/host.mjs, so they cannot disagree
 * about the port, the name on the network, or where ForgeFX lives. Every way
 * they could differ only shows up with a phone in someone's hand.
 *
 * Why it exists at all is one browser rule: a page loaded over HTTPS may call
 * http://localhost — a deliberate exemption, and the reason the hosted app
 * works on the Mac — but that exemption stops at loopback and does not reach
 * http://10.0.0.x. So a phone loading the hosted app can never reach the unit.
 * Serve the page from ForgeFX instead and everything is same-origin over plain
 * HTTP, which is why local mode needs no account and no relay.
 *
 *   npm run serve
 */
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bonjour } from 'bonjour-service'
import QRCode from 'qrcode'
import {
  DEFAULT_NAME,
  DEFAULT_PORT,
  MISSING_FORGEFX,
  addresses,
  findForgeFX,
  lanAddress,
  publish,
  serverEnv
} from '../desktop/lib/host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT || DEFAULT_PORT)
const name = process.env.FRACTAL_MDNS_NAME || DEFAULT_NAME

const run = (cmd, args, opts) =>
  new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts })
    child.on('error', fail)
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))))
  })

const forgefx = findForgeFX({ extra: [resolve(root, '../forgefx')] })
if (!forgefx) {
  console.error(`\n${MISSING_FORGEFX}`)
  process.exit(1)
}

console.log('Building the app…')
await run('npm', ['run', 'build'], { cwd: root })

const where = addresses({ port, name, ip: lanAddress() })
const ad = publish(Bonjour, { port, name })

if (where.forPhone) {
  console.log('\n  Open this on your phone — same wifi, nothing to sign into:\n')
  console.log(await QRCode.toString(where.forPhone, { type: 'terminal', small: true }))
} else {
  console.log('\n  No network address found, so nothing to scan — this machine only.\n')
}
for (const u of where.all) console.log(`    ${u}`)
console.log('\n  Ctrl-C to stop.\n')

const server = spawn('npm', ['run', 'dev'], {
  cwd: join(forgefx, 'server'),
  stdio: 'inherit',
  env: serverEnv({ port, dist: join(root, 'dist') })
})

const shutdown = async (code = 0) => {
  await ad.stop()
  server.kill('SIGINT')
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
server.on('exit', (code) => ad.stop().then(() => process.exit(code ?? 0)))
