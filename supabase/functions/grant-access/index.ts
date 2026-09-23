/**
 * GIVE SOMEBODY THE UNLOCK BY HAND, OR TAKE A HAND-GIVEN ONE BACK.
 *
 * "If for some reason there's something weird where somebody makes a purchase
 * but it's not registering, do I have an ability to manually activate an
 * account for somebody?" and "Yes, build that in and only when logged into
 * the justinnewbold@icloud.com account."
 *
 * One request, three actions, all by the customer's email:
 *
 *   check   does this email have an account, and does it have the unlock
 *   grant   give it the unlock for good (a RevenueCat granted entitlement)
 *   revoke  take back an unlock given here — a purchase is not touched
 *
 * WHO MAY CALL IT is the whole of the safety, and it is decided here, on the
 * server, from a token Supabase has signed: the caller's own email has to be
 * the one below. The app hides the page from everybody else, but the page is
 * a convenience; this check is the lock.
 *
 * WHY REVENUECAT AND NOT JUST THE TABLE. Every end asks RevenueCat whether an
 * account has paid — the phone's store library, the browser's Web Billing and
 * the entitlement function behind the relay — so an unlock only counts
 * everywhere if RevenueCat says so. A granted entitlement is RevenueCat's own
 * way of saying "this account has it, without a purchase". The relay's table
 * is written as well, so the computer link works the same second rather than
 * the next time the customer opens the app.
 */

const RC = 'https://api.revenuecat.com/v2'
const DEFAULT_PROJECT = 'proj827190e9'
/** The entitlement's lookup key in RevenueCat: the one "unlocked" means. */
const ENTITLEMENT = 'full'
/** A grant with no end: RevenueCat wants a date, so the far future. */
const FOREVER = Date.UTC(2100, 0, 1)

/*
 * The one account that may use this, as a hash — the same djb2 as
 * shared/owner-unlock.mjs, so no inbox sits in a public repository. Copied
 * from shared/admin.mjs, which is the source; test/mobile.mjs fails if the two
 * ever differ.
 */
const ADMINS = ['672e291a']

function fold(text: string): string {
  let h = 5381
  const s = String(text || '').trim().toLowerCase()
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const env = (name: string) => Deno.env.get(name) || ''

/** Who is calling, from their signed token. */
async function caller(token: string): Promise<{ id: string; email: string } | null> {
  try {
    const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey: env('SUPABASE_ANON_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return null
    const user = await res.json()
    return user?.id ? { id: String(user.id), email: String(user.email || '') } : null
  } catch {
    return null
  }
}

/** Call a database function as the service role. */
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  })
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`)
  return res.json()
}

/** RevenueCat, with the project's secret key. */
async function rc(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${RC}/projects/${env('REVENUECAT_PROJECT') || DEFAULT_PROJECT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('REVENUECAT_SECRET')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  })
}

/** RevenueCat's id for the entitlement whose lookup key is ENTITLEMENT. */
async function entitlementId(): Promise<string | null> {
  const res = await rc('/entitlements')
  if (!res.ok) return null
  const body = await res.json()
  const found = (body?.items || []).find((e: { lookup_key?: string }) => e?.lookup_key === ENTITLEMENT)
  return found?.id ? String(found.id) : null
}

/** Whether this account has the unlock right now, by RevenueCat's word. */
async function unlocked(account: string, entitlement: string): Promise<boolean> {
  const res = await rc(`/customers/${encodeURIComponent(account)}/active_entitlements`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`RevenueCat answered ${res.status} to the question`)
  const body = await res.json()
  return (body?.items || []).some((e: { entitlement_id?: string }) => e?.entitlement_id === entitlement)
}

/** The plain sentence for a RevenueCat refusal. */
async function refusal(res: Response, doing: string): Promise<string> {
  const said = await res.text().catch(() => '')
  if (res.status === 401 || res.status === 403) {
    return `RevenueCat would not let this ${doing}. In RevenueCat, open Project settings → API keys, and give the secret key "Customer information" read and write.`
  }
  return `RevenueCat could not ${doing} (${res.status}${said ? `: ${said.slice(0, 160)}` : ''}).`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, message: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization') || ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const me = token ? await caller(token) : null
  /* The lock. Anybody else gets the same answer as nobody at all. */
  if (!me || !ADMINS.includes(fold(me.email))) return json({ ok: false, message: 'Not allowed.' }, 403)

  let input: { action?: string; email?: string } = {}
  try {
    input = await req.json()
  } catch {
    /* an empty body is a missing email, said below */
  }
  const action = String(input.action || 'check')
  const email = String(input.email || '').trim().toLowerCase()
  if (!email.includes('@')) return json({ ok: false, message: 'Type the email address they signed up with.' }, 400)
  if (!['check', 'grant', 'revoke'].includes(action)) return json({ ok: false, message: 'Unknown action.' }, 400)
  if (!env('REVENUECAT_SECRET')) return json({ ok: false, message: 'The server has no RevenueCat key set.' }, 500)

  try {
    const account = (await rpc('account_for_email', { address: email })) as string | null
    if (!account) {
      return json({
        ok: true,
        found: false,
        email,
        message: `No account uses ${email}. They need to create one first (Create Account, in the app or on the website), with this same email.`
      })
    }
    const entitlement = await entitlementId()
    if (!entitlement) return json({ ok: false, message: 'Could not find the unlock in RevenueCat.' }, 502)

    if (action === 'grant') {
      /* RevenueCat only grants to a customer it knows; somebody who has never
         opened the app signed in is not one yet. Creating one that exists
         answers 409, which is fine. */
      const known = await rc(`/customers/${encodeURIComponent(account)}`)
      if (known.status === 404) {
        const made = await rc('/customers', { method: 'POST', body: JSON.stringify({ id: account }) })
        if (!made.ok && made.status !== 409) return json({ ok: false, message: await refusal(made, 'add them as a customer') }, 502)
      }
      const res = await rc(`/customers/${encodeURIComponent(account)}/actions/grant_entitlement`, {
        method: 'POST',
        body: JSON.stringify({ entitlement_id: entitlement, expires_at: FOREVER })
      })
      if (!res.ok) return json({ ok: false, message: await refusal(res, 'give them the unlock') }, 502)
      await rpc('record_entitlement', { uid: account, is_active: true, from_source: 'revenuecat' })
    }

    if (action === 'revoke') {
      const res = await rc(`/customers/${encodeURIComponent(account)}/actions/revoke_granted_entitlement`, {
        method: 'POST',
        body: JSON.stringify({ entitlement_id: entitlement })
      })
      if (!res.ok && res.status !== 404) return json({ ok: false, message: await refusal(res, 'take the unlock back') }, 502)
    }

    const has = await unlocked(account, entitlement)
    /* The relay's table follows RevenueCat's answer, whichever way it went. */
    if (action !== 'check') await rpc('record_entitlement', { uid: account, is_active: has, from_source: 'revenuecat' })
    const message =
      action === 'grant'
        ? `${email} has the unlock now. They may need to close and reopen the app, or reload the website.`
        : action === 'revoke'
          ? has
            ? `The unlock given here is taken back, but ${email} still has one — they bought it, and a purchase is not touched here.`
            : `${email} no longer has the unlock.`
          : has
            ? `${email} has the unlock.`
            : `${email} has an account but not the unlock.`
    return json({ ok: true, found: true, email, unlocked: has, message })
  } catch (err) {
    console.error(`grant-access: ${err}`)
    return json({ ok: false, message: `Something went wrong: ${String((err as Error)?.message || err).slice(0, 200)}` }, 500)
  }
})
