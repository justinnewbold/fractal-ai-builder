/**
 * Where the model lives, which is not always where this page came from.
 *
 * The two AI endpoints — /api/generate and /api/command — are Vercel functions.
 * They exist on the hosted origin and nowhere else. That was invisible while
 * the app was only ever loaded from that origin, because a relative fetch found
 * them by definition.
 *
 * It stops being invisible the moment the page is served by ForgeFX on the
 * local network, which is the whole point of local mode: a phone can then reach
 * the unit without an account, because everything is same-origin over plain
 * HTTP. Same-origin is exactly what breaks these two — `/api/generate` on
 * `http://fractal.local:5056` is a 404 from a device server that has never
 * heard of the model.
 *
 * So AI calls are absolute when the page is served locally, and relative
 * otherwise. Relative is kept for the hosted case rather than always going
 * absolute: it keeps preview deployments talking to their own functions
 * instead of production's, which is what makes a preview worth having.
 */

/**
 * The origin that has the functions.
 *
 * Overridable at build time for a fork or a differently-named deployment;
 * hardcoded rather than derived because when this matters the page is being
 * served from somewhere that knows nothing about the deployment.
 */
export const AI_ORIGIN =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AI_ORIGIN) ||
  'https://fractal.newbold.cloud'

/**
 * Whether this page came from somewhere that has the API routes.
 *
 * A dev server does — vite proxies them, and `vercel dev` runs them — so the
 * test is not "is this localhost" but "is this the hosted app or a dev server,
 * versus a device serving static files".
 *
 * ForgeFX serves the built SPA on its own port, which is 5056 by default and
 * an OS-assigned one when that is taken. The reliable signal is the port the
 * device server is actually on, so this asks the device client where it is
 * pointed rather than pattern-matching a hostname.
 */
export function servedByDevice(host) {
  if (typeof window === 'undefined') return false
  const here = window.location
  if (here.protocol !== 'http:' && here.protocol !== 'https:') return false
  // Vite's dev server and the hosted app both carry the functions.
  if (import.meta.env?.DEV) return false
  try {
    const target = new URL(host)
    return target.host === here.host
  } catch {
    return false
  }
}

/**
 * The URL to call for an AI route.
 *
 * `path` is the app-relative one — '/api/generate?stream=1' — so call sites
 * read the same as they did before.
 */
export function aiUrl(path, host) {
  return servedByDevice(host) ? `${AI_ORIGIN}${path}` : path
}
