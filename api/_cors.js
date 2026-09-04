/**
 * Letting the app call these functions from somewhere else.
 *
 * The two AI routes used to be reachable only from the origin that served the
 * page, which was fine while that was the only way the app ran. Local mode
 * breaks that on purpose: ForgeFX serves the UI over plain HTTP on the network
 * so a phone can reach the unit without an account, and the page is then a
 * cross-origin caller to the model.
 *
 * Deliberately not `*`. These functions spend money on every call, and the key
 * lives on the server precisely so a browser never holds it — a wildcard would
 * let any page on the internet spend it. The allowance is exactly the shapes
 * the app can legitimately be served from:
 *
 *   - the hosted origin and its Vercel previews
 *   - a private-network address over http, which is what ForgeFX serves
 *
 * Private-network ranges are matched rather than listed because the address is
 * whatever DHCP handed the player's Mac this morning, and `.local` because that
 * is what mDNS answers to. Public hosts get nothing.
 */

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)$/i

/** Whether a browser Origin header is one this app can legitimately be served from. */
export function allowedOrigin(origin) {
  if (!origin) return null
  let url
  try {
    url = new URL(origin)
  } catch {
    return null
  }

  // The hosted app and its previews.
  if (url.protocol === 'https:') {
    if (url.hostname === 'fractal.newbold.cloud') return origin
    if (url.hostname.endsWith('.vercel.app')) return origin
    return null
  }

  /*
   * The phone app.
   *
   * A Capacitor shell ships this bundle rather than fetching it, and serves it
   * to its own WebView from a scheme of its own — `capacitor://localhost` on
   * iOS. There is no host on the internet behind that, which is the point: the
   * only page that can ever carry this origin is one running inside an app
   * signed by us and installed from a store.
   *
   * Android's shell serves over `http://localhost`, which the private-network
   * rule below already covers, so it needs nothing here.
   */
  if (url.protocol === 'capacitor:' && url.hostname === 'localhost') return origin

  // A device on the player's own network, serving the UI itself.
  if (url.protocol === 'http:' && PRIVATE_HOST.test(url.hostname)) return origin

  return null
}

/**
 * Apply CORS, and answer the preflight.
 *
 * Returns true when the request was a preflight and has been answered — the
 * caller must then return without doing any work.
 */
export function cors(req, res) {
  const allow = allowedOrigin(req.headers?.origin)
  if (allow) {
    res.setHeader('Access-Control-Allow-Origin', allow)
    // The allowance varies by origin, so anything caching this must key on it.
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-stream')
    res.setHeader('Access-Control-Max-Age', '86400')
  }

  if (req.method === 'OPTIONS') {
    res.status(allow ? 204 : 403).end()
    return true
  }
  return false
}
