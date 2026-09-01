/**
 * The Mac app: open it, and your phone can reach the unit.
 *
 * Deliberately thin. Everything worth getting right — where ForgeFX is, which
 * port, what the phone should scan — lives in lib/host.mjs, shared with
 * `npm run serve` and tested without a Mac. What is left here is the part that
 * genuinely needs Electron: a window, a menu-bar item, and a child process.
 *
 * It lives in the menu bar rather than the dock because it is a service with a
 * status, not a document you open. Quitting it is how you stop serving; closing
 * the window is not.
 *
 * ForgeFX runs as a child process rather than in-process. Importing it is the
 * path it documents, and Axis takes it — but it opens a serial port through
 * native modules, and a native module that crashes in-process takes the whole
 * app with it. A child can die and be reported. Worth revisiting once this has
 * run on real hardware for a while; not worth guessing at from a container.
 */
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } = require('electron')
const { spawn } = require('node:child_process')
const { join } = require('node:path')

let tray = null
let win = null
let server = null
let advert = { stop: async () => {} }
let where = null
/** What armHost found: null until it answers, then { on, email, reason }. */
let phone = null

/** The shared logic is ESM; this shell is CommonJS, so it is imported lazily. */
const host = () => import('./lib/host.mjs')

/** The built web app, bundled beside this file by electron-builder. */
const distPath = () =>
  app.isPackaged ? join(process.resourcesPath, 'dist') : join(__dirname, '..', 'dist')

async function start() {
  const {
    DEFAULT_NAME,
    DEFAULT_PORT,
    MISSING_FORGEFX,
    addresses,
    armHost,
    findForgeFX,
    lanAddress,
    publish,
    serverEnv
  } = await host()

  const port = Number(process.env.PORT || DEFAULT_PORT)
  const name = process.env.FRACTAL_MDNS_NAME || DEFAULT_NAME

  const forgefx = findForgeFX()
  if (!forgefx) {
    /*
     * Said in a dialog rather than a log, because the whole point of this app
     * is that nobody is looking at a terminal. Still the same text the script
     * prints — one explanation, not two that drift.
     */
    dialog.showErrorBox('ForgeFX is not installed', MISSING_FORGEFX)
    app.quit()
    return
  }

  where = addresses({ port, name, ip: lanAddress() })

  let Bonjour = null
  try {
    ;({ Bonjour } = require('bonjour-service'))
  } catch {
    // Without mDNS the IP still works; only the .local name is lost.
  }
  advert = publish(Bonjour, { port, name })

  server = spawn(process.execPath, [join(forgefx, 'server', 'dist', 'index.js')], {
    env: serverEnv({ port, dist: distPath() }),
    stdio: 'inherit'
  })
  server.on('exit', (code) => {
    if (code) dialog.showErrorBox('The device server stopped', `ForgeFX exited with code ${code}.`)
  })

  /*
   * Turn the phone remote on once the server is up, and say so in the menu.
   * Not awaited: the window and tray should not wait on the account service,
   * and the line in the menu updates when the answer lands.
   */
  armHost({ port })
    .then((result) => {
      phone = result
      if (tray) buildTray()
    })
    .catch(() => {})
}

function openWindow() {
  if (win) {
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 380,
    backgroundColor: '#0d0f12',
    title: 'Fractal AI Builder',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  win.loadURL(where?.local || 'about:blank')
  win.on('closed', () => {
    win = null
  })
}

function buildTray() {
  // A template image lets macOS invert it for light and dark menu bars.
  const icon = nativeImage.createFromPath(join(__dirname, 'trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Fractal AI Builder')

  /*
   * One line about the phone remote, in words a person would use. "On for
   * you@example.com" is the whole status; when it is off, the line says the
   * one thing to do about it.
   */
  const phoneLine = !phone
    ? 'Phone remote: starting…'
    : phone.on
      ? `Phone remote: on${phone.email ? ` — ${phone.email}` : ''}`
      : phone.reason === 'signed-out'
        ? 'Phone remote: off — open the app and sign in once'
        : phone.reason === 'turned-off'
          ? 'Phone remote: off — turn it on in the app'
          : 'Phone remote: off'

  const menu = Menu.buildFromTemplate([
    { label: 'Open', click: openWindow },
    { type: 'separator' },
    { label: phoneLine, enabled: false },
    { type: 'separator' },
    { label: 'On your phone — same wifi, nothing to sign into:', enabled: false },
    ...(where?.all || []).map((u) => ({
      label: u,
      click: () => shell.openExternal(u)
    })),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}

app.whenReady().then(async () => {
  // A service, not a document: no dock icon, no window until asked.
  if (app.dock) app.dock.hide()
  await start()
  if (!where) return
  buildTray()
  openWindow()
})

// The window closing is not the app closing — it is still serving.
app.on('window-all-closed', () => {})

app.on('before-quit', async (e) => {
  if (!server && !advert) return
  e.preventDefault()
  await advert.stop()
  if (server) server.kill('SIGINT')
  server = null
  advert = null
  app.quit()
})
