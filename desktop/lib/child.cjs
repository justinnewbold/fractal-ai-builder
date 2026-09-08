/**
 * Run the device server, and die with the app that started it.
 *
 * ForgeFX is a child process of the Mac app. When the app quits properly the
 * child is asked to stop and, failing that, killed — see shutdown() in
 * host.mjs. But Force Quit is SIGKILL: the app is gone in an instant, no quit
 * handler runs, and the child never hears about it. It keeps the serial port
 * and port 5056, and the next launch finds "ForgeFX is already running" and
 * refuses to start. "The only way to get around it was to restart the Mac."
 *
 * A child cannot be told about a parent that was killed. It can notice: the
 * parent's process id stops being its parent. So the server runs inside this
 * thin wrapper, which looks once a second and leaves the moment the app has.
 *
 * CommonJS on purpose: it is started with Electron's binary run as Node, with
 * no package.json of its own to say what `.js` means, so the extension has to.
 * The server itself is ESM and is imported, which works for either kind.
 */
const { pathToFileURL } = require('node:url')

const entry = process.argv[2]
if (!entry) {
  console.error('child.cjs: no server entry given')
  process.exit(2)
}

const parent = process.ppid
setInterval(() => {
  // On macOS and Linux an orphan is re-parented to launchd or init (pid 1);
  // either way it is no longer the app that started this.
  if (process.ppid !== parent) process.exit(0)
}, 1000).unref?.()

import(pathToFileURL(entry).href).catch((err) => {
  console.error('child.cjs: the device server failed to start', err?.stack || err)
  process.exit(1)
})
