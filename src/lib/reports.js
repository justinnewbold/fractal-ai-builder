/**
 * Sending a bug report or an idea.
 *
 * Goes into a table in the same Supabase project the phone remote already
 * uses, so there is no new service to run, nothing to pay for, and nothing new
 * to sign into. The table is insert-only: anyone can write one and nobody can
 * read them back through the public key. One person's bug report is not
 * another person's business, and a table readable with a key that ships inside
 * the app is a table that leaks whatever people paste into it.
 *
 * Deliberately usable without an account. Most people driving a unit from the
 * Mac or over their own wifi never sign in at all, and they are exactly the
 * people who hit the bugs worth hearing about. A signed-in report is stamped
 * with who sent it so a reply is possible; an anonymous one carries no user.
 *
 * Named reports rather than feedback because lib/feedback.js is already taken,
 * by the flash and the buzz under a thumb on a tap-tempo button.
 */
import { DEFAULT_PROJECT, supabaseClient } from './remote.js'
import { VERSION } from './version.js'

/** What a report can be. Two kinds, because a third would only ever be "other". */
export const KINDS = ['bug', 'idea']

/** The longest message the table will take, mirrored here so the box can say so. */
export const MAX_MESSAGE = 4000

/**
 * What was going on when they wrote it.
 *
 * The difference between a report that can be acted on and one that cannot is
 * almost always this, and it is exactly what a person cannot be expected to
 * type: which version, which unit, how they were connected.
 *
 * Nothing identifying is collected. No preset contents, no account details,
 * nothing else typed into the app — the report carries what someone chose to
 * write and what shape of setup they were on, and that is all.
 */
export function context({ device, link, platform } = {}) {
  const out = { version: VERSION }
  if (device?.model) out.unit = device.model
  if (link?.role) out.role = link.role
  if (platform) out.platform = platform
  if (typeof navigator !== 'undefined' && navigator.language) out.language = navigator.language
  if (typeof window !== 'undefined' && window.innerWidth) {
    out.screen = `${window.innerWidth}x${window.innerHeight}`
  }
  return out
}

/**
 * Post one report.
 *
 * Throws with something a person can read. The failure that matters is having
 * no network at all, which is common enough on a stage and must not lose what
 * they typed — the caller keeps the text on screen when this rejects.
 */
export async function sendReport({ kind, message, contact, context: ctx = {} }) {
  const body = (message || '').trim()
  if (!KINDS.includes(kind)) throw new Error('Say whether this is a bug or an idea.')
  if (!body) throw new Error('Write something first.')
  if (body.length > MAX_MESSAGE) throw new Error('That is longer than this box can send.')

  /*
   * The signed-in client when there is one, a bare anon client otherwise.
   * supabaseClient() only exists once a remote session has been set up, which
   * is never for a Mac or wifi user — and they must still be able to report.
   */
  let c = supabaseClient()
  let userId = null
  if (c) {
    try {
      const { data } = await c.auth.getUser()
      userId = data?.user?.id || null
    } catch {
      // No session is not a problem; it goes as an anonymous report.
    }
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    c = createClient(DEFAULT_PROJECT.url, DEFAULT_PROJECT.anonKey)
  }

  const { error } = await c.from('feedback').insert({
    kind,
    message: body,
    contact: (contact || '').trim() || null,
    context: ctx,
    user_id: userId
  })

  if (error) {
    throw new Error(
      /fetch|network/i.test(error.message || '')
        ? "Couldn't reach the internet to send that. What you wrote is still here — try again in a moment."
        : `That didn't send: ${error.message}`
    )
  }
  return true
}
