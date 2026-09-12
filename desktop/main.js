/**
 * The Mac app: open it, and your phone can reach the unit.
 *
 * Deliberately thin. Everything worth getting right — where ForgeFX is, which
 * port, what the phone should scan — lives in lib/host.mjs, shared with
 * `npm run serve` and tested without a Mac. What is left here is the part that
 * genuinely needs Electron: a window, a menu-bar item, and a child process.
 *
 * It lives in the menu bar as well as the dock because it is a service with a
 * status. Closing its window quits it — "the app does not close out all the
 * way when you click the close button" was the report, and an app that looks
 * closed while still holding the unit is worse than one you have to reopen.
 *
 * ForgeFX runs as a child process rather than in-process. Importing it is the
 * path it documents, and Axis takes it — but it opens a serial port through
 * native modules, and a native module that crashes in-process takes the whole
 * app with it. A child can die and be reported. Worth revisiting once this has
 * run on real hardware for a while; not worth guessing at from a container.
 */
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, ipcMain } = require('electron')
const { spawn, execFile, execFileSync } = require('node:child_process')
const { join, sep } = require('node:path')
const { existsSync, readFileSync, writeFileSync, unlinkSync } = require('node:fs')
const net = require('node:net')

/** Where the new version can always be fetched by hand. */
const RELEASES_URL = 'https://github.com/justinnewbold/fractal-ai-builder/releases/latest'

let tray = null
let win = null
let server = null
let advert = { stop: async () => {} }
let where = null
/** What armHost found: null until it answers, then { on, email, reason }. */
let phone = null
/** Whether macOS is likely stopping a phone from reaching us. Best effort. */
let firewall = { known: false }
/** How the update is going: null until anything has happened. See lib/updates.mjs. */
let update = null
/** `check` from wireUpdates, so the menu item can ask again by hand. */
let updates = null
/**
 * Whether the app is on its way out. See the quit handler at the foot of this
 * file — it lives up here because three other things have to know: the dock
 * must not be touched, a dying server is not news, and a second quit must not
 * be cancelled by the handler that asked for it.
 */
let quitting = false

/** The shared logic is ESM; this shell is CommonJS, so it is imported lazily. */
const host = () => import('./lib/host.mjs')

/**
 * The update wording, needed synchronously while building the menu.
 *
 * Filled in by beginUpdates once the ESM module has loaded; until then there
 * is nothing to say anyway, which is exactly what the null it returns means.
 */
let updateLine = () => null

/**
 * The watchdog the server runs inside, as a real file on disk.
 *
 * This shell is packed into app.asar; a script the Electron binary is asked to
 * run as Node has to be readable as a plain path, so electron-builder leaves
 * lib/child.cjs unpacked beside the archive and this points there.
 */
const wrapperPath = () => join(__dirname, 'lib', 'child.cjs').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)

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
    mdnsName,
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
  // Per machine, not a constant: two Macs both asking for `fractal.local`
  // means one of them silently has no name while still offering it. See
  // mdnsName in lib/host.mjs.
  const name = process.env.FRACTAL_MDNS_NAME || mdnsName()

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
    /*
     * Ours, left behind by a Force Quit? Then it is nobody's, and it goes.
     * Force Quit is SIGKILL: no quit handler, no chance to stop the server we
     * started, and the next launch used to find it holding the port, say so,
     * and quit — "the only way to get around it was to restart the Mac."
     * Somebody's own ForgeFX in a Terminal still gets the message below.
     */
    const { reclaimPort } = await host()
    const took = await reclaimPort({
      port,
      run: (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000 })
    })
    if (took !== 'reclaimed') {
      dialog.showErrorBox('ForgeFX is already running', PORT_TAKEN(port))
      app.quit()
      return
    }
  } else if (!held.free) {
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
  advert = publish(Bonjour, {
    port,
    name,
    onError: (err) => console.error('[mdns]', err?.message || err)
  })

  /*
   * Through lib/child.cjs rather than directly, so the server leaves when this
   * process does — however this process goes. See that file.
   */
  server = spawn(process.execPath, [wrapperPath(), join(forgefx, 'server', 'dist', 'index.js')], {
    env: serverEnv({ port, dist: distPath(), asNode: true }),
    stdio: 'inherit'
  })
  server.on('exit', (code) => {
    /*
     * Not while quitting. Stopping the server is the first thing the quit does,
     * and a ForgeFX that exits non-zero on SIGINT would then put a modal box on
     * screen mid-quit — one belonging to an app whose window has gone and whose
     * dock icon is on its way out, so it can land behind everything with no
     * obvious way to reach it. The app looks like it is refusing to close, and
     * the only way out is the one nobody should need.
     */
    if (code && !quitting) {
      dialog.showErrorBox('The device server stopped', `ForgeFX exited with code ${code}.`)
    }
  })

  /*
   * Turn the phone remote on once the server is up, and say so in the menu.
   * Not awaited: the window and tray should not wait on the account service,
   * and the line in the menu updates when the answer lands.
   */
  armHost({ port, version: app.getVersion() })
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

/*
 * Whether this app appears in the dock, the app switcher, and Force Quit.
 *
 * Hiding the dock icon is what makes this a menu-bar service rather than a
 * document app, and that part is right. What it also does — and this is not
 * obvious — is take the app out of Force Quit Applications entirely, because
 * macOS leaves accessory apps out of that list. "The Fractal AI Builder isn't
 * showing up in the active programs running, so no option to force close if
 * it's having issues."
 *
 * Which is worst exactly when it matters: a window that has stopped
 * responding, and no way to reach for the one tool everybody knows.
 *
 * So the icon follows the window. Open a window and the app becomes an
 * ordinary one — in the dock, in cmd-tab, in Force Quit. Close it and it goes
 * back to being a menu-bar service. The state that can hang is the state you
 * can force quit, and the quiet state stays quiet.
 */
function showInDock(yes) {
  // On the way out, the dock icon is the operating system's business.
  if (quitting || !app.dock) return
  try {
    if (yes) app.dock.show()
    else app.dock.hide()
  } catch {
    // Not fatal: the app still runs, it is only listed differently.
  }
}

function openWindow() {
  showInDock(true)
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
    title: 'Fractal Remote',
    /*
     * The preload is the page's only channel to the app, and it carries one
     * subject: updates. Context isolation stays on and node stays out — the
     * bridge exposes three functions and nothing else. See preload.js.
     */
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.js')
    }
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
    showInDock(false)
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
    tray.setToolTip('Fractal Remote')
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
    /*
     * How the update is going, said in one line and only once there is
     * something to say. Never a dialog: a failed check means the network was
     * down, and the app works regardless.
     */
    { type: 'separator' },
    ...(updateLine(update) ? [{ label: updateLine(update), enabled: false }] : []),
    {
      label: 'Check for updates…',
      enabled: Boolean(updates) && update?.kind !== 'checking',
      click: () => updates?.check()
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}

/*
 * Start looking for a new version, quietly.
 *
 * Only in a packaged app: electron-updater has nothing to compare against in a
 * checkout, and would report an error on every launch during development for
 * no reason. Everything else — downloading in the background, installing on
 * quit, never restarting on its own — lives in lib/updates.mjs, where it can
 * be tested without a Mac.
 *
 * Failure here is not fatal and not reported: an app that cannot reach GitHub
 * still serves the unit, which is the whole job.
 */
/*
 * What the page may ask, and the only two things it may ask for.
 *
 * Registered once, whether or not the updater ever loads — a page asking in a
 * development build should get "nothing to say" rather than an error nobody
 * can act on.
 */
function wireUpdateChannel() {
  ipcMain.handle('updates:state', () =>
    update ? { ...update, line: updateLine(update) } : { kind: 'idle', line: null }
  )
  ipcMain.handle('updates:check', async () => {
    if (!updates) return { ok: false, reason: 'no-updater' }
    await updates.check()
    return { ok: true }
  })

  /*
   * Install it now, because somebody asked.
   *
   * Installing on quit is the right default and it stays the default — nothing
   * restarts itself on a machine with a guitar plugged into it. But it is only
   * a good default while quitting works, and when it did not it took the update
   * down with it: the update installs on quit, the quit never finished, so the
   * only way out was Force Quit, which is a hard kill and installs nothing. The
   * same version was offered again at every launch, for ever, and the fix for
   * it was inside the version that could not be installed.
   *
   * A loop like that cannot be allowed to depend on one path working. So there
   * is a second one, and it is a button a person presses: not the app deciding
   * to interrupt anybody, which is the thing the whole design is against.
   *
   * The teardown runs here rather than being left to the quit handler, so that
   * by the time electron-updater asks the app to quit there is nothing left to
   * wait for and the quit is a formality.
   */
  ipcMain.handle('updates:releases', async () => {
    await shell.openExternal(RELEASES_URL)
    return { ok: true }
  })
  ipcMain.handle('updates:move', async () => ({ ok: moveToApplications() }))

  ipcMain.handle('updates:install', async () => {
    if (!updates?.install) return { ok: false, reason: 'no-updater' }
    if (update?.kind !== 'ready') return { ok: false, reason: 'nothing-ready' }
    /*
     * Written before anything else, so that whatever happens next the next
     * launch can tell whether it worked. See installOutcome in lib/updates.mjs.
     */
    writeMarker({ version: update.version || null, from: app.getVersion(), at: Date.now() })
    await stopServing()
    /*
     * If the install has not taken the process by now it is not going to, and
     * an app with no window and no server is worse than a closed one. The
     * download is staged either way, so reopening tries again.
     */
    setTimeout(() => app.exit(0), INSTALL_DEADLINE_MS)
    updates.install()
    return { ok: true }
  })
}

/*
 * The note the app leaves itself before an install: which version it expected
 * to be on when it came back. See installOutcome in lib/updates.mjs.
 */
const markerPath = () => join(app.getPath('userData'), 'pending-update.json')
function writeMarker(marker) {
  try {
    writeFileSync(markerPath(), JSON.stringify(marker))
  } catch (err) {
    console.error('[updates] could not note the pending install', err?.message || err)
  }
}
function readMarker() {
  try {
    return existsSync(markerPath()) ? JSON.parse(readFileSync(markerPath(), 'utf8')) : null
  } catch {
    return null
  }
}
function clearMarker() {
  try {
    if (existsSync(markerPath())) unlinkSync(markerPath())
  } catch {
    // A note that will not go is read again next launch and found stale then.
  }
}

/**
 * What macOS's installer wrote while it tried. The only record of WHY an
 * install did not take, and until now there was no way to see it from the app.
 * Best effort with a deadline; an empty answer is an answer.
 */
function shipItLog() {
  if (process.platform !== 'darwin') return Promise.resolve('')
  return new Promise((resolve) => {
    execFile(
      'log',
      [
        'show',
        '--style',
        'compact',
        '--last',
        '30m',
        '--predicate',
        'process == "ShipIt" OR (process == "Fractal Remote" AND (eventMessage CONTAINS "Squirrel" OR eventMessage CONTAINS "update"))'
      ],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
      (err, out) => {
        if (err || !out) return resolve('')
        const lines = out.split('\n').filter((l) => l.trim() && !/^Filtering|^Timestamp/.test(l))
        resolve(lines.slice(-40).join('\n'))
      }
    )
  })
}

function publish(state) {
  update = state
  if (tray) buildTray()
  if (win && !win.isDestroyed()) {
    win.webContents.send('updates:state', { ...state, line: updateLine(state) })
  }
}

async function beginUpdates() {
  if (!app.isPackaged) return
  try {
    const { autoUpdater } = require('electron-updater')
    const { autoUpdater: native } = require('electron')
    const mod = await import('./lib/updates.mjs')
    const { wireUpdates, installOutcome } = mod
    updateLine = mod.updateLine

    /*
     * Where the app is decides whether there is any point. An app macOS will
     * not replace in place gets one line saying what to do, and no download
     * that would only come back as the same offer.
     */
    if (misplaced) {
      publish({ kind: 'misplaced' })
      return
    }

    /*
     * Did the last install take? A note left before it says what was expected;
     * the version running says what happened. When they disagree the app says
     * so, with whatever macOS wrote about it, instead of offering the same
     * update again as if nothing had been tried.
     */
    const marker = readMarker()
    const outcome = installOutcome({ marker, version: app.getVersion() })
    if (marker) clearMarker()

    updates = wireUpdates({
      updater: autoUpdater,
      native,
      onState: (state) => {
        update = state
        if (tray) buildTray()
        /*
         * And the window, which until now was never told anything. The line is
         * built here rather than in the page so the menu and the window cannot
         * drift into saying different things about the same download.
         */
        if (win && !win.isDestroyed()) {
          win.webContents.send('updates:state', { ...state, line: updateLine(state) })
        }
      },
      log: (err) => console.error('[updates]', err?.message || err)
    })
    if (outcome === 'stuck') {
      // Said at once; the reason follows when macOS's log has been read, which
      // can take a few seconds and must not hold the window up.
      publish({ kind: 'stuck', version: marker.version, detail: '' })
      shipItLog().then((detail) => {
        if (update?.kind === 'stuck') publish({ ...update, detail })
      })
      // Not checked again on its own this launch: a fresh download would only
      // paper over the reason. Check for updates still works by hand.
      return
    }
    await updates.check()
  } catch (err) {
    console.error('[updates] not available', err?.message || err)
  }
}

/**
 * Whether the app sits where macOS will let it be replaced.
 *
 * An app opened from Downloads is run from a hidden read-only copy, and an
 * update installed there is thrown away with the copy — the app relaunches, on
 * the old version, and offers the same update again. Reported as "it closes
 * the app and restarts and then it still says the same update is available".
 * Moving it into Applications is the only cure, so the app offers to, once,
 * on the way in. Declining is remembered for this launch only.
 */
let misplaced = false
async function settleInPlace() {
  if (!app.isPackaged || process.platform !== 'darwin') return true
  const { installPlace } = await import('./lib/updates.mjs')
  let inApplications = true
  try {
    inApplications = app.isInApplicationsFolder()
  } catch {
    return true
  }
  const place = installPlace({ exePath: app.getPath('exe'), inApplications })
  if (place.ok) return true
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Move to Applications', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move Fractal Remote to your Applications folder?',
    detail:
      'It is running from somewhere macOS will not update it in place, so new versions would download and never install. ' +
      'Moving it takes a moment and the app reopens on its own.'
  })
  if (choice === 0 && moveToApplications()) return false
  misplaced = true
  return true
}

/** Move the app and reopen it from Applications. True when that is under way. */
function moveToApplications() {
  try {
    // Replaces an older copy already there; that copy is what we are updating.
    return app.moveToApplicationsFolder({ conflictHandler: () => true })
  } catch (err) {
    console.error('[place] could not move to Applications', err?.message || err)
    return false
  }
}

app.whenReady().then(async () => {
  // A service, not a document: no dock icon, no window until asked.
  showInDock(false)
  if (!(await settleInPlace())) return // reopening from Applications
  const answering = await start()
  if (!where) return
  buildTray()
  wireUpdateChannel()
  await beginUpdates()
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
        'Console.app under "Fractal Remote".'
    )
    return
  }
  openWindow()
})

/*
 * Closing the window closes the app.
 *
 * It did not, by design: the app was a menu-bar service, still serving the
 * phone with its window gone. What that felt like was an app that would not
 * close — no window, no dock icon, still running, and "the only way to close
 * it out all the way is Force Quit". Force Quit is the one thing that must not
 * happen to this app, because it skips the quit that installs updates and
 * leaves the device server holding the port. So the close button quits, the
 * ordinary way, through the same shutdown as ⌘Q.
 */
app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})

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
 * The work itself lives in host.mjs, where it can be tested, and it now has a
 * deadline on every step of it. What is left here is the promise that outranks
 * all of them: however that goes, this app closes.
 *
 * Because the cost of it not closing is no longer just an annoyance. An update
 * is installed when the app quits — that is the whole design, so that nothing
 * ever restarts itself mid-set — and an app that can only be force quit is an
 * app that can never finish an update. Force Quit is SIGKILL: no quit event, no
 * install, and the same "an update is ready" line waiting the next time.
 */
const QUIT_DEADLINE_MS = 6000
/*
 * Longer than the quit's, because this one waits on Squirrel handing the app
 * over to its installer rather than on anything in this file.
 */
const INSTALL_DEADLINE_MS = 20000

app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()

  /*
   * The backstop, and it is deliberately never cleared.
   *
   * Everything below has a deadline of its own, so in the ordinary case this
   * timer is still counting when the process is already gone and it simply
   * never runs. It exists for the case nobody predicted — the next thing that
   * turns out to wait forever — because the one outcome that must not be
   * possible is an app a person cannot close.
   */
  setTimeout(() => app.exit(0), QUIT_DEADLINE_MS)

  const done = () => app.quit()
  stopServing().then(done, done)
})

/**
 * Stop being a server, and stop being one only once.
 *
 * Shared by the two ways this app stops: somebody quitting it, and somebody
 * asking for an update to be installed now. Both have to put the device server
 * down before the process goes, or a ForgeFX left holding port 5056 stops the
 * next launch dead.
 *
 * `quitting` is set first and never cleared. It is what stops the quit handler
 * cancelling the very quit it asked for, and it is why installing an update can
 * simply call app.quit() afterwards and be let through.
 */
async function stopServing() {
  if (quitting) return
  quitting = true

  /*
   * Say so on screen straight away. Tearing down can take a couple of seconds
   * in the worst case, and a window still sitting there after ⌘Q reads as an
   * app that ignored you — which is exactly when a person reaches for Force
   * Quit and loses the update that was about to install.
   */
  if (win && !win.isDestroyed()) win.hide()

  try {
    const { shutdown } = await host()
    await shutdown({ server, advert })
  } catch {
    // Nothing here is a reason to stay open. See QUIT_DEADLINE_MS.
  }
  server = null
  advert = null
}
