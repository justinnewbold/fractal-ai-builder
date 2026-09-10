/**
 * The unit's block list, kept once it has been read.
 *
 * GET /blocks is the palette — every block the attached unit can place, with
 * the type code each one needs. It is a fixed list on the server, computed
 * from the driver's roster, and it cannot be empty on any unit this app
 * drives. Yet the chat was handed an empty one on a phone and told the player
 * "this preset's placeable-block list is coming through empty", so a Pitch
 * block the FM3 plainly has could not be added.
 *
 * What happened was a read that failed over the relay and a catch that turned
 * the failure into an empty list. Two things fix that for good. The list is
 * remembered per unit, in this browser, the first time it is read — so the
 * phone's tenth request does not depend on the phone's tenth read. And a read
 * that fails with nothing remembered is reported as a failure, with the
 * reason, rather than as a unit with no blocks.
 *
 * Pure where it decides, storage-taking where it remembers, like the marks.
 */

const KEY = 'fractal.palette'

const store = (given) => {
  try {
    return given ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  } catch {
    return null
  }
}

/** The list however the host shaped it: an array, or an object carrying one. */
export function normalizePalette(res) {
  const list = Array.isArray(res) ? res : Array.isArray(res?.blocks) ? res.blocks : []
  return list.filter((b) => b && typeof b.slug === 'string' && b.slug)
}

function readAll(storage) {
  try {
    const raw = store(storage)?.getItem(KEY)
    const all = raw ? JSON.parse(raw) : null
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
  } catch {
    return {}
  }
}

/** The list last read for this unit, or null. */
export function cachedPalette(device, storage) {
  const list = readAll(storage)[device || 'unknown']
  return Array.isArray(list) && list.length ? normalizePalette(list) : null
}

/** Keep a list that was just read. An empty one is not kept — it is not a list. */
export function rememberPalette(device, list, storage) {
  const clean = normalizePalette(list)
  if (!clean.length) return false
  try {
    const all = readAll(storage)
    all[device || 'unknown'] = clean
    store(storage)?.setItem(KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

/**
 * Read the list, remembering a good answer and falling back to the last one.
 *
 * `read` is the request. A read that comes back empty is treated like a read
 * that failed: the server never answers an empty list for a unit it knows, so
 * an empty answer is a unit it does not know yet — a reconnect mid-read — and
 * the remembered list is the truer one. When there is nothing remembered the
 * error is thrown, with the reason, for the caller to say.
 */
export async function paletteFor(device, read, storage) {
  try {
    const fresh = normalizePalette(await read())
    if (fresh.length) {
      rememberPalette(device, fresh, storage)
      return { list: fresh, fromCache: false }
    }
    const kept = cachedPalette(device, storage)
    if (kept) return { list: kept, fromCache: true }
    throw new Error('The unit answered with an empty block list.')
  } catch (err) {
    const kept = cachedPalette(device, storage)
    if (kept) return { list: kept, fromCache: true, error: err?.message || String(err) }
    throw err
  }
}
