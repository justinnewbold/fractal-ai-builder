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
const { spawn, execFileSync } = require('node:child_process')
const { join } = require('node:path')
const net = require('node:net')

let tray = null
let win = null
let server = null
let advert = { stop: async () => {} }
let where = null
/** What armHost found: null until it answers, then { on, email, reason }. */
let phone = null
/** Whether macOS is likely stopping a phone from reaching us. Best effort. */
let firewall = { known: false }

/** The shared logic is ESM; this shell is CommonJS, so it is imported lazily. */
const host = () => import('./lib/host.mjs')

/** The built web app, bundled beside this file by electron-builder. */
const distPath = () =>
  app.isPackaged ? join(process.resourcesPath, 'dist') : join(__dirname, '..', 'dist')

/*
 * The device server the app carries.
 *
 * `vendor` holds ForgeFX and its codec as siblings, because the server depends
 * on the codec by relative path. Offered to findForgeFX ahead of the developer
 * locations so an installed app uses what it shipped with, while FORGEFX_PATH
 * still wins for anyone deliberately pointing it at a checkout.
 */
const vendored = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'vendor', 'forgefx')
    : join(__dirname, 'vendor', 'forgefx')

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
    readFirewall,
    serverEnv,
    waitForServer,
    whoHasPort,
    PORT_TAKEN
  } = await host()

  const port = Number(process.env.PORT || DEFAULT_PORT)
  const name = process.env.FRACTAL_MDNS_NAME || DEFAULT_NAME

  /*
   * Nothing else may already be on the port. ForgeFX moves itself when the port
   * is taken — quietly, by design — and an app that then opens a window on the
   * port it asked for is showing whatever else is there. Better to say so.
   */
  const held = await whoHasPort({
    port,
    connect: (p, done) => {
      const socket = net.connect({ port: p, host: '127.0.0.1' })
      const settle = (answer) => {
        socket.destroy()
        done(answer)
      }
      socket.once('connect', () => settle(true))
      socket.once('error', () => settle(false))
      socket.setTimeout(1000, () => settle(false))
    }
  })
  if (held.forgefx) {
    dialog.showErrorBox('ForgeFX is already running', PORT_TAKEN(port))
    app.quit()
    return
  }
  if (!held.free) {
    dialog.showErrorBox(
      'Something else is using this port',
      `Port ${port} is in use by another program, so the app cannot serve from it.\n\n` +
        'Quit whatever is using it and open this again.'
    )
    app.quit()
    return
  }

  const forgefx = findForgeFX({ extra: [vendored()] })
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
    env: serverEnv({ port, dist: distPath(), asNode: true }),
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

  /*
   * The address in the menu works here and fails from a phone when macOS has
   * not been told to accept connections from other machines. Asked once, and
   * quietly: it only adds a line to a menu.
   */
  firewall = readFirewall({
    appPath: app.getPath('exe'),
    run: (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000 })
  })

  /*
   * Spawning the server is not starting it. Fastify is listening a second or
   * two after the process exists, and a window opened into that gap gets a
   * refused connection and shows nothing — for ever, because a page that
   * failed to load is not retried. Wait for it to answer before opening
   * anything.
   */
  return waitForServer({ port })
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
  /*
   * Belt and braces for the same failure: if the page does not load, retry it
   * rather than sitting on an empty window. Once, after a second — enough for
   * a server that was a moment slower than the wait above allowed for.
   */
  win.webContents.on('did-fail-load', (_e, code, description) => {
    console.error(`the page did not load (${code} ${description}); retrying once`)
    setTimeout(() => {
      if (win && where?.local) win.loadURL(where.local)
    }, 1000)
  })
  win.on('closed', () => {
    win = null
  })
}

/*
 * Clicking the app when it is already running.
 *
 * A menu-bar app has no dock icon, so closing its window leaves nothing on
 * screen at all. macOS does not start a second copy when you click the app
 * again — it activates the one that is running and sends this — and with
 * nothing listening for it, the click did nothing, the app looked dead, and
 * the only way out was Force Quit. Reported exactly that way.
 */
app.on('activate', () => {
  if (where) openWindow()
})

/*
 * Draw the menu, and make the icon the first time only.
 *
 * This runs twice — once at launch and again when armHost answers, because the
 * phone line is the whole point of drawing it again — and it used to construct
 * a second Tray on that second call. Two icons in the menu bar, one of them
 * permanently stale, and no way to tell them apart.
 */
function buildTray() {
  if (!tray) {
    // A template image lets macOS invert it for light and dark menu bars.
    const icon = nativeImage.createFromPath(join(__dirname, 'trayTemplate.png'))
    icon.setTemplateImage(true)
    tray = new Tray(icon)
    tray.setToolTip('Fractal AI Builder')
    // The menu is where everything is, but the obvious thing to do with an
    // icon is click it, and the obvious thing to want is the window.
    tray.on('click', openWindow)
    tray.on('double-click', openWindow)
  }

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
    /*
     * Said only when there is something to say. A phone that cannot reach this
     * Mac over wifi is nearly always this, and nearly nobody thinks of it —
     * the address plainly works when you try it here.
     */
    ...(firewall.known && firewall.on && firewall.blocked !== false
      ? [
          {
            label: "…not working? macOS's firewall has to allow this app",
            click: () =>
              shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Firewall')
          }
        ]
      : []),
    /*
     * The other way in, offered only once it actually works. It needs an
     * account on both ends, and in exchange it does not care which network the
     * phone is on.
     */
    ...(phone?.on
      ? [
          { type: 'separator' },
          { label: 'Or from anywhere, signed in on both:', enabled: false },
          {
            label: 'fractal.newbold.cloud',
            click: () => shell.openExternal('https://fractal.newbold.cloud')
          }
        ]
      : []),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}

app.whenReady().then(async () => {
  // A service, not a document: no dock icon, no window until asked.
  if (app.dock) app.dock.hide()
  const answering = await start()
  if (!where) return
  buildTray()
  if (!answering) {
    /*
     * A minute is long enough that this is not slowness. Said out loud,
     * because the alternative is a window showing nothing and a person with no
     * idea whether the app is broken or their unit is.
     */
    dialog.showErrorBox(
      'The device server did not start',
      'It was started but never answered, so there is nothing to show yet.\n\n' +
        'Quit and open the app again. If it keeps happening, the log is in\n' +
        'Console.app under "Fractal AI Builder".'
    )
    return
  }
  openWindow()
})

// The window closing is not the app closing — it is still serving.
app.on('window-all-closed', () => {})

/*
 * Quitting, in a way that always finishes.
 *
 * This cancelled the quit, awaited the mDNS teardown and then asked to quit
 * again — so anything thrown in between left the app refusing to close. And the
 * server was sent SIGINT and abandoned, which on a child that ignores it means
 * a process still holding port 5056 after the app is gone: the next launch
 * finds a ForgeFX it did not start, says so, and quits. Between them that is
 * "it won't let you reopen it, you have to force close then restart".
 *
 * The work itself lives in host.mjs, where it can be tested. Here there is only
 * the flag that stops this handler from cancelling its own second quit.
 */
let quitting = false

app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  const done = () => {
    server = null
    advert = null
    app.quit()
  }
  host()
    .then(({ shutdown }) => shutdown({ server, advert }))
    .then(done, done)
})
