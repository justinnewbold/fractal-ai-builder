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
    case 'ready':
      return state.version
        ? `Update ${state.version} installs when you quit`
        : 'Update installs when you quit'
    case 'current':
      return 'Up to date'
    case 'trouble':
      return "Couldn't check for updates"
    default:
      return null
  }
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
export function wireUpdates({ updater, onState, log = () => {} }) {
  if (!updater) return { check: async () => {} }

  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true

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
  on('update-available', (info) => say({ kind: 'found', version: info?.version || null }))
  on('download-progress', (p) =>
    say({ kind: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p?.percent ?? 0))) })
  )
  on('update-downloaded', (info) => say({ kind: 'ready', version: info?.version || null }))
  on('error', (err) => {
    log(err)
    say({ kind: 'trouble' })
  })

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
