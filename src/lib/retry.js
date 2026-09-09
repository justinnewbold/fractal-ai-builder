/**
 * A garbled preset dump is asked for again, not shown.
 *
 * "PRESET_DUMP_HEADER: expected func 0x77 at offset 0, got 0x78" — on
 * switching presets, from the Play screen, twice before the server carried
 * a fix for it and once after. The unit answers a dump as a header frame
 * (0x77) followed by body chunks (0x78); a read that lands while the unit is
 * still loading the preset it was just sent can find a body chunk where the
 * header should be, and the codec refuses it in those words. Nothing is
 * wrong with the unit, the cable or the preset. The read simply came too
 * early, and asking again a moment later gets the dump.
 *
 * Every read the app makes after a preset change wants that dump — the
 * block list, the scene names, the volume slider's level — so the retry
 * lives at the one place all of them pass through, rather than in each one.
 *
 * Only for what can be asked twice without doing anything twice: any GET,
 * and the two POSTs that select something rather than change it. A write
 * that garbled on the way back is not re-sent from here.
 */

/** The codec refusing a dump whose frames arrived out of order. */
export const GARBLED_DUMP = /PRESET_DUMP_HEADER|expected func 0x[0-9a-f]+ at offset/i

export const isGarbledDump = (message) => GARBLED_DUMP.test(String(message || ''))

/** Selecting is idempotent; anything else that POSTs or PUTs is not. */
const IDEMPOTENT_POSTS = new Set(['/preset/select', '/scene'])

export function canAskAgain(method, path) {
  const m = String(method || 'GET').toUpperCase()
  const clean = String(path || '').split('?')[0]
  if (m === 'GET') return true
  if (m === 'POST') return IDEMPOTENT_POSTS.has(clean)
  return false
}

/** How many more times, and how long between: the unit is loading, so the waits grow. */
export const RETRIES = 2
export const RETRY_MS = [400, 800]

/**
 * Run a request, and run it again on a garbled dump if it may be run again.
 * `wait` is injectable so the tests do not sleep.
 */
export async function withRetry(fn, { method, path, wait = sleep, retries = RETRIES } = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await fn(attempt)
    } catch (err) {
      const again = attempt < retries && canAskAgain(method, path) && isGarbledDump(err?.message)
      if (!again) throw err
      await wait(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)])
      attempt++
    }
  }
}

const sleep = (ms) => new Promise((go) => setTimeout(go, ms))
