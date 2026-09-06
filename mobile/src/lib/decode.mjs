/**
 * Unwrapping what the Mac sent, without the browser.
 *
 * The host frames a reply three ways and picks per payload: plain text for a
 * short answer, base64 for bytes, and gzip for anything over a couple of KB —
 * which is most of the interesting ones. A block list, a grid, a model roster
 * all arrive compressed.
 *
 * The web app decodes those with `atob`, `Blob` and `DecompressionStream`.
 * Hermes has none of the three, and the failure is quiet in the worst way: a
 * gzip payload throws inside the request that asked for it, so a phone shows
 * "your Mac didn't answer" for a Mac that answered perfectly. Hence two small
 * libraries and no polyfills — `base64-js` for the bytes, `fflate` for the
 * gzip, both pure JS and both a few KB.
 *
 * `.mjs` rather than `.js` so `npm test` can import it. Metro reads either —
 * see metro.config.js — and the extension is the signal that this module is
 * plain ESM with nothing React Native in it, which is what makes it checkable
 * against a real gzip frame outside a simulator.
 */
import { toByteArray } from 'base64-js'
import { gunzipSync } from 'fflate'

const utf8 = new TextDecoder('utf-8')

/**
 * Decode one relay payload into text, or into bytes when that is what it is.
 *
 * Mirrors `decode` in src/lib/remote.js: same three encodings, same order,
 * same return shapes — a string for utf8 and gzip, a Uint8Array for base64.
 * Callers upstream parse JSON out of the string and treat bytes as bytes.
 */
export async function decode(payload) {
  const { body, encoding } = payload || {}
  if (encoding === 'utf8') return body

  const bytes = toByteArray(body)
  if (encoding === 'base64') return bytes

  return utf8.decode(gunzipSync(bytes))
}
