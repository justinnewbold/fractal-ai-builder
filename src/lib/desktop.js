/**
 * The Mac app, from inside the page.
 *
 * The window loads this same web app over http from the device server, so
 * nothing here can assume it is in the Mac app — on a phone, on the hosted
 * site, or in a browser at the Mac, none of this exists. Every function
 * answers honestly when it does not.
 *
 * One subject: updates. "I quit the app and restarted, I'm on 7.50.0, no
 * update notification." There was none to see: everything the updater knew was
 * written into the menu-bar menu and nowhere else, so an update could be
 * downloaded and waiting while the app said nothing at all. That was a
 * deliberate choice — an app that interrupts a set is intolerable — taken one
 * step too far, from "never interrupt" to "never mention".
 */

/** The bridge, or null anywhere that is not the Mac app. See desktop/preload.js. */
export function desktopBridge() {
  if (typeof window === 'undefined') return null
  const api = window.fractalDesktop
  return api && api.isDesktop ? api : null
}

/** Whether this page is the Mac app's own window. */
export const inDesktopApp = () => desktopBridge() !== null

/**
 * Whether an update is downloaded and waiting for the app to be quit.
 *
 * The one state worth saying out loud in the app, because it is the only one
 * where somebody's action — quitting, which they were going to do anyway —
 * finishes the job.
 */
export const updateReady = (state) => state?.kind === 'ready'

/**
 * What to say about an update in the app.
 *
 * The sentence comes from the main process, which is where the menu's own
 * wording is built — two copies of it would drift, and a menu and a window
 * disagreeing about the same download is worse than either one alone. This
 * only supplies what the app knows and the menu does not: what to do about it.
 */
export function updateAdvice(state) {
  switch (state?.kind) {
    case 'ready':
      return 'Restart to update and the app comes back on the new version in a few seconds. Or leave it: it installs the next time you quit.'
    case 'downloading':
    case 'found':
      return 'It downloads in the background. You will be told when it is ready.'
    case 'staging':
      return 'Downloaded. macOS is checking it over; Restart to update appears when it is done.'
    case 'trouble':
      return state.message
        ? 'Something went wrong with the update. The app works regardless; try Check for updates again.'
        : 'The check failed — usually no internet, or GitHub being slow. The app works regardless.'
    case 'stuck':
      return 'The app restarted but macOS did not swap it. This nearly always means the app is not in your Applications folder. Move it there and try again — or download the new version from GitHub and drag it into Applications.'
    case 'misplaced':
      return 'Fractal Remote is not in your Applications folder, and macOS only replaces an app that is. Move it there and updates install themselves again.'
    case 'current':
      return 'This is the newest version.'
    case 'checking':
      return null
    default:
      return null
  }
}
