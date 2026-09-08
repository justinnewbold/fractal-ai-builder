/**
 * Keeping the Mac app up to date without ever interrupting a set.
 *
 * Everything here is the decision-making, with the updater injected, so it can
 * be tested from anywhere — the same reason `host.mjs` is shaped this way. The
 * only thing main.js adds is the real updater and a tray to draw on.
 *
 * The rule that shapes all of it: an app that restarts itself is intolerable
 * here. This runs on a machine with a guitar plugged into it, and the moment a
 * restart is worst is exactly the moment someone is using it. So the update
 * downloads quietly and is installed when the person quits — which they do
 * when they are finished, by definition.
 *
 * Nothing here ever opens a dialog. A failed update check is not news: the
 * network was down, or GitHub was slow, and the app works regardless. It shows
 * as a line in the menu that says so and nothing more.
 */

/**
 * What the menu says, from the state below.
 *
 * One line, in words about the app rather than about updating: nobody needs to
 * be told a percentage of a download they did not ask for, but they do need to
 * know why the app is about to be a different version next time they open it.
 */
export function updateLine(state = { kind: 'idle' }) {
  switch (state.kind) {
    case 'checking':
      return 'Checking for updates…'
    case 'found':
      return state.version ? `Downloading ${state.version}…` : 'Downloading an update…'
    case 'downloading':
      return `Downloading an update… ${state.percent}%`
    case 'staging':
      // Downloaded by us; macOS is taking its copy. Not ready until it has.
      return state.version ? `Preparing ${state.version}…` : 'Preparing the update…'
    case 'ready':
      return state.version
        ? `Update ${state.version} installs when you quit`
        : 'Update installs when you quit'
    case 'current':
      return 'Up to date'
    case 'trouble':
      return state.message ? `Update problem: ${state.message}` : "Couldn't check for updates"
    case 'stuck':
      return state.version ? `Update ${state.version} didn’t install` : 'The update didn’t install'
    case 'misplaced':
      return 'Move Fractal Remote to Applications to get updates'
    default:
      return null
  }
}

/**
 * Whether the last install actually happened.
 *
 * Before the app hands itself to macOS to be replaced it writes down which
 * version it expected to come back as. On the next launch this compares that
 * note with the version actually running. The same version again means macOS
 * relaunched the old app without swapping it — which, until this, the app
 * reported as "an update is available", for ever, with no word about why.
 *
 *   'installed' — the note names a version no newer than this one
 *   'stuck'     — the note names a newer version than this one
 *   null        — no note, or a note that cannot be read
 */
export function installOutcome({ marker, version }) {
  const wanted = marker?.version
  if (!wanted || !version) return null
  return compareVersions(version, wanted) >= 0 ? 'installed' : 'stuck'
}

/** Plain dotted versions, numerically. Anything else compares as text. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10))
  const pb = String(b).split('.').map((n) => parseInt(n, 10))
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return String(a).localeCompare(String(b))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * Whether macOS will let this app be replaced where it sits.
 *
 * An app opened from the folder it was downloaded into is run by macOS from a
 * hidden, read-only copy — "app translocation" — and an app run from there
 * cannot be updated in place: the installer swaps the copy, the copy is thrown
 * away, and the original in Downloads is untouched. The update downloads,
 * "installs", relaunches, and the same update is offered again. Only moving
 * the app into Applications ends that, so that is what the app asks for.
 *
 *   { ok: true }
 *   { ok: false, reason: 'translocated' | 'not-applications' }
 */
export function installPlace({ exePath = '', inApplications = true }) {
  if (/\/AppTranslocation\//.test(String(exePath))) return { ok: false, reason: 'translocated' }
  if (!inApplications) return { ok: false, reason: 'not-applications' }
  return { ok: true }
}

/**
 * The first line of an error, for a menu that has room for one.
 *
 * Not the stack, not the URL of the feed: the sentence macOS or the library
 * gave, which is the one thing that says what actually went wrong.
 */
export function shortReason(err) {
  const text = String(err?.message || err || '').split('\n')[0].trim()
  return text ? text.slice(0, 160) : null
}

/**
 * Point the updater at a callback that redraws the menu.
 *
 * `autoInstallOnAppQuit` is what makes the promise above true: electron-updater
 * stages the download and swaps it in during quit, so there is no restart and
 * no prompt. Downloading is automatic because the decision a person actually
 * has is when to quit, not whether to accept a few megabytes.
 *
 * Returns `check`, which never rejects — a check that fails is a state, not an
 * error anyone has to handle.
 */
export function wireUpdates({ updater, native = null, onState, log = () => {} }) {
  if (!updater) return { check: async () => {} }

  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  let version = null

  const say = (state) => {
    try {
      onState(state)
    } catch {
      // Drawing a menu must never take the app down.
    }
  }

  const on = (event, handler) => {
    if (typeof updater.on === 'function') updater.on(event, handler)
  }

  on('checking-for-update', () => say({ kind: 'checking' }))
  on('update-not-available', () => say({ kind: 'current' }))
  on('update-available', (info) => {
    version = info?.version || null
    say({ kind: 'found', version })
  })
  on('download-progress', (p) =>
    say({ kind: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p?.percent ?? 0))) })
  )
  /*
   * "Downloaded" is two things on a Mac, and the app used to call the first
   * one ready. The updater library fetches the file itself, says so, and then
   * hands it to macOS's own updater, which takes a copy and checks its
   * signature. Only after THAT does anything install — and a person who
   * pressed Restart in between waited on nothing and got the old app back. So
   * with the native updater in hand, the library's word is "preparing" and
   * macOS's word is "ready"; without it (tests, other platforms) the library's
   * word is the only one there is.
   */
  on('update-downloaded', (info) => {
    version = info?.version || version
    say({ kind: native ? 'staging' : 'ready', version })
  })
  // The library's own failures are the network, nearly always; "couldn't
  // check" is the whole truth and getaddrinfo is not a word for a menu.
  on('error', (err) => {
    log(err)
    say({ kind: 'trouble' })
  })
  if (native && typeof native.on === 'function') {
    native.on('update-downloaded', () => say({ kind: 'ready', version }))
    // macOS refusing the file — a signature it does not trust, a place it
    // cannot write — is the reason an install never happened, said out loud.
    native.on('error', (err) => {
      log(err)
      say({ kind: 'trouble', message: shortReason(err) })
    })
  }

  return {
    /**
     * Install it now and come back on the new version.
     *
     * Not the default and not automatic: installing on quit is what keeps a
     * restart from ever landing mid-set. This is the other way out, for the
     * case where quitting itself is what is broken — an update that installs on
     * quit and a quit that never finishes is a loop with no exit, and the fix
     * for the quit is inside the version that cannot be installed.
     *
     * Never called by anything but a person pressing a button.
     */
    install: () => {
      try {
        updater.quitAndInstall()
      } catch {
        // Nothing to fall back to: the caller has already stopped serving and
        // the app is on its way out either way.
      }
    },

    check: async () => {
      try {
        await updater.checkForUpdates()
      } catch (err) {
        // Reported through the state above by the 'error' event; if the call
        // itself threw before emitting, say it here so the menu is not stuck
        // on "Checking…" for the life of the app.
        log(err)
        say({ kind: 'trouble' })
      }
    }
  }
}
