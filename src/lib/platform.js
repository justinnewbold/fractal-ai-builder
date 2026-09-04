/**
 * Where this copy of the app is running.
 *
 * One bundle has always played three roles depending on which machine served
 * it — the Mac, a page on the wifi, or the hosted site over the relay. A phone
 * app adds a fourth: the same bundle again, this time inside a native shell
 * that ships it rather than fetching it.
 *
 * That shell can do things a browser cannot — ask for permission to talk to
 * the local network, keep the screen awake, stay signed in — and it must NOT
 * do some things a browser does, chiefly the service worker, because there is
 * no server to update from and a cached shell inside an app is just a stale
 * app nobody can fix.
 *
 * So every one of those decisions asks here rather than sniffing the user
 * agent at the point of use. Guessing the device from its user agent is
 * forbidden elsewhere in this codebase for good reasons — an iPhone lies about
 * being a Mac, and every browser lies about being every other browser — and
 * the point of this module is that nothing has to guess: the shell announces
 * itself, and the origin says the rest.
 *
 * Everything here is safe to call on a server or in a test, where there is no
 * window at all.
 */

/** The hosted site. The one origin that is genuinely on the internet. */
export const HOSTED = 'fractal.newbold.cloud'

/** A window, or nothing — so every reader below can be written the same way. */
const win = () => (typeof window === 'undefined' ? null : window)

/**
 * Whether this is running inside the phone app.
 *
 * Capacitor puts a global on the window and answers `isNativePlatform()` from
 * it. Asked through optional chaining rather than a `typeof` dance because the
 * global is absent in every browser and that is the common case, not an error.
 */
export function isCapacitor(w = win()) {
  try {
    return w?.Capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

/**
 * 'ios', 'android', or null when this is not the phone app at all.
 *
 * Read from the shell, which knows, rather than from the user agent, which on
 * an iPad claims to be a Mac and on every WebView claims to be Safari.
 */
export function nativePlatform(w = win()) {
  if (!isCapacitor(w)) return null
  const named = w?.Capacitor?.getPlatform?.()
  return named === 'ios' || named === 'android' ? named : null
}

/**
 * Whether the page was added to the home screen and opened from there.
 *
 * Two different answers because the two platforms answer differently: iOS sets
 * a flag on navigator that nobody else has, everyone else reports it as a
 * display mode. The phone app is standalone by definition — there is no
 * browser chrome around it — so it is included rather than treated apart.
 */
export function isStandalone(w = win()) {
  if (!w) return false
  if (isCapacitor(w)) return true
  if (w.navigator?.standalone === true) return true
  try {
    return w.matchMedia?.('(display-mode: standalone)')?.matches === true
  } catch {
    return false
  }
}

/**
 * Whether this page came from the hosted site.
 *
 * The distinction that matters for the service worker and for the "add this to
 * your home screen" nudge: both belong to the site and to nothing else. The
 * Mac serves this bundle too, and so does the phone app, and neither should be
 * offering to install itself.
 */
export function isHostedOrigin(w = win()) {
  return w?.location?.hostname === HOSTED
}

/**
 * One word for where this is, for logs and for the diagnostics screen.
 *
 * Deliberately not used to make decisions — the named questions above are, so
 * that each decision says which property it actually depends on rather than
 * comparing against a label that means several things at once.
 */
export function platform(w = win()) {
  const native = nativePlatform(w)
  if (native) return native
  if (!w) return 'server'
  if (isHostedOrigin(w)) return 'web'
  return 'served'
}
