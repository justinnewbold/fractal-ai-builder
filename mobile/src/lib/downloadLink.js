import { DEFAULT_PROJECT } from './project'

/**
 * "Send me the link" — the phone half.
 *
 * Somebody is standing on a phone, in the walkthrough, being told they need
 * an app on a computer they are not sitting at. The address is on the screen
 * for anybody happy to type it; this is for everybody else.
 *
 * The work happens in the `download-link` edge function, and the reasons it
 * is shaped the way it is live there: the message is fixed, nothing typed
 * here reaches the body, and one address gets it once every few minutes. All
 * this end does is hand over an address and report what happened.
 *
 * NEVER THROWS. This is one optional convenience inside a first-run flow, and
 * a rejected promise on a screen somebody is halfway through would be a worse
 * outcome than the email not arriving. Every failure comes back as `ok: false`
 * with something a person can read.
 */

/** The page that works out which build a computer needs. Shown, not guessed. */
export const DOWNLOADS_URL = 'fractal.newbold.cloud/downloads'

/** Long enough for a cold function, short enough not to strand a first run. */
const GIVE_UP_MS = 12000

export async function sendDownloadLink(email) {
  const addr = String(email || '').trim()
  /* Asked here as well as in the function. Not as a security check — that one
     belongs at the far end, where it cannot be skipped — but so a typo is
     answered instantly rather than after a round trip. */
  if (!addr.includes('@') || addr.length < 5) {
    return { ok: false, message: 'That does not look like an email address.' }
  }

  /* The controller first. Written the other way round once, which is a
     ReferenceError on every call: the timeout closes over a const that has
     not been initialised yet. Same trap as the bar's unlock button. */
  const controller = new AbortController()
  const stop = setTimeout(() => controller.abort(), GIVE_UP_MS)

  try {
    const res = await fetch(`${DEFAULT_PROJECT.url}/functions/v1/download-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        /* The anon key, which is public by design — this endpoint is reachable
           by somebody who has not signed in and may never make an account. */
        apikey: DEFAULT_PROJECT.anonKey,
        Authorization: `Bearer ${DEFAULT_PROJECT.anonKey}`
      },
      body: JSON.stringify({ email: addr }),
      signal: controller.signal
    })

    const body = await res.json().catch(() => ({}))
    if (res.ok && body?.sent) return { ok: true }

    /*
     * "Not configured" is its own answer and worth saying plainly. It means
     * the mail service has no key yet, which is a thing to go and fix rather
     * than anything the person holding the phone did wrong.
     */
    if (body?.why === 'not configured') {
      return { ok: false, message: `Email isn’t set up yet. Open ${DOWNLOADS_URL} on your computer.` }
    }
    return {
      ok: false,
      message: body?.why
        ? `${String(body.why)[0].toUpperCase()}${String(body.why).slice(1)}.`
        : `Couldn’t send it. Open ${DOWNLOADS_URL} on your computer.`
    }
  } catch (err) {
    return {
      ok: false,
      message:
        err?.name === 'AbortError'
          ? `That took too long. Open ${DOWNLOADS_URL} on your computer.`
          : `Couldn’t reach the mail service. Open ${DOWNLOADS_URL} on your computer.`
    }
  } finally {
    clearTimeout(stop)
  }
}
