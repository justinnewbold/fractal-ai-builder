/**
 * THE TOOLS ONLY JUSTIN SEES.
 *
 * "Yes, build that in and only when logged into the justinnewbold@icloud.com
 * account."
 *
 * The first is Give someone access: type a customer's email, see whether they
 * have the unlock, and give it to them — or take a hand-given one back — for
 * the day a purchase does not register.
 *
 * Hidden from everybody else, but hiding is a convenience and not the lock:
 * supabase/functions/grant-access checks the caller's signed account itself
 * and refuses anybody not on this list. A hash rather than the address, for
 * the reason shared/owner-unlock.mjs gives — no inbox in a public repository.
 */
import { fold } from './owner-unlock.mjs'

/** fold('justinnewbold@icloud.com'). Copied into the server function; a test holds them equal. */
export const ADMINS = ['672e291a']

/** Whether the account signed in here is the one the tools are for. */
export const isAdmin = (email) => {
  const at = String(email || '').trim()
  return at.includes('@') && ADMINS.includes(fold(at))
}

/**
 * Ask the server to check, grant or revoke the unlock for an email.
 *
 * `token` is the signed-in session's access token — the server reads who is
 * asking out of it. Never throws: whatever happens comes back as
 * { ok, message }, with `found` and `unlocked` when there is an answer.
 */
export async function accessAction({ url, anonKey, token, action, email, fetchImpl }) {
  if (!token) return { ok: false, message: 'Sign in first.' }
  try {
    /* Looked up when used, not as a default: some places this runs have no
       global fetch until the app sets one up. */
    const res = await (fetchImpl || globalThis.fetch)(`${url}/functions/v1/grant-access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ action, email })
    })
    const body = await res.json().catch(() => ({}))
    return {
      ok: Boolean(body?.ok),
      found: body?.found,
      unlocked: body?.unlocked,
      message: body?.message || (res.ok ? 'Done.' : `The server answered ${res.status}.`)
    }
  } catch (err) {
    return { ok: false, message: `Could not reach the server (${err?.message || err}).` }
  }
}
