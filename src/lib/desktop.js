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
      return 'Quit the app and open it again to finish. Nothing is interrupted until you do.'
    case 'downloading':
    case 'found':
      return 'It downloads in the background. You will be told when it is ready.'
    case 'trouble':
      return 'The check failed — usually no internet, or GitHub being slow. The app works regardless.'
    case 'current':
      return 'This is the newest version.'
    case 'checking':
      return null
    default:
      return null
  }
}
