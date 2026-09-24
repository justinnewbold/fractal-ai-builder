/**
 * GIVE SOMEBODY THE UNLOCK BY HAND, OR TAKE A HAND-GIVEN ONE BACK.
 *
 * "If for some reason there's something weird where somebody makes a purchase
 * but it's not registering, do I have an ability to manually activate an
 * account for somebody?" and "Yes, build that in and only when logged into
 * the justinnewbold@icloud.com account."
 *
 * One request, four actions, the first three by the customer's email:
 *
 *   check   does this email have an account, and does it have the unlock
 *   grant   give it the unlock for good (a RevenueCat granted entitlement)
 *   revoke  take back an unlock given here — a purchase is not touched
 *   sales   every sale so far, for Sales at a glance
 *
 * All three by email also answer with the Customer lookup: when they signed
 * up, whether they confirmed, what they paid for and where, which devices
 * they have signed in on, and the app version they were last on. "Do number
 * one and five for now."
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
  /*
   * A function that returns nothing (record_entitlement) answers 204 with an
   * empty body, and reading that as JSON threw "Unexpected end of JSON input"
   * AFTER the unlock had already been given — so the page said it failed
   * when it had worked. Nothing back is null, not an error.
   */
  const text = await res.text()
  return text ? JSON.parse(text) : null
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

/** A RevenueCat answer as JSON, or null for anything but a yes. */
async function rcJson(path: string): Promise<any> {
  try {
    const res = await rc(path)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

type Sale = { store: string; at: number | null; sandbox: boolean; refunded: boolean; product: string; gross: number | null }

/**
 * What this account has bought, by RevenueCat's word. A hand-given unlock is
 * not in here: RevenueCat keeps a grant as a promotional subscription, not a
 * purchase, which is exactly what lets the lookup tell the two apart.
 */
async function purchasesOf(account: string): Promise<Sale[] | null> {
  const body = await rcJson(`/customers/${encodeURIComponent(account)}/purchases?limit=100`)
  if (!body) return null
  return (body?.items || []).map((p: any) => ({
    store: String(p?.store || 'unknown'),
    at: typeof p?.purchased_at === 'number' ? p.purchased_at : null,
    sandbox: p?.environment === 'sandbox' || p?.store === 'test_store',
    refunded: p?.status === 'refunded',
    product: String(p?.product_id || ''),
    gross: typeof p?.revenue_in_usd?.gross === 'number' ? p.revenue_in_usd.gross : null
  }))
}

/** Where and on what RevenueCat last saw them, for "which app version". */
async function lastSeen(account: string) {
  const c = await rcJson(`/customers/${encodeURIComponent(account)}`)
  if (!c) return null
  return {
    first: c.first_seen_at ?? null,
    last: c.last_seen_at ?? null,
    version: c.last_seen_app_version ?? null,
    platform: c.last_seen_platform ?? null,
    platformVersion: c.last_seen_platform_version ?? null,
    country: c.last_seen_country ?? null
  }
}

/** Run `job` over `items`, a few at a time, so a long list does not trip RevenueCat's rate limit. */
async function eachFew<T, R>(items: T[], few: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(few, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await job(items[i])
      }
    })
  )
  return out
}

/*
 * SALES AT A GLANCE. Every account the relay's table holds as bought, asked
 * about in turn. The totals are counted by the app, in Justin's own time zone:
 * "today" is his today, not the server's.
 */
const MOST_BUYERS = 500

async function sales() {
  const overview = ((await rpc('owner_overview', {})) || {}) as {
    accounts?: number
    accounts_day?: number
    accounts_week?: number
    buyers?: { id: string; email: string }[]
  }
  const buyers = (overview.buyers || []).slice(0, MOST_BUYERS)
  let unanswered = 0
  let givenByHand = 0
  const sold: (Sale & { email: string })[] = []
  const answers = await eachFew(buyers, 5, async (b) => ({ b, bought: await purchasesOf(b.id) }))
  for (const { b, bought } of answers) {
    if (!bought) {
      unanswered += 1
      continue
    }
    const real = bought.filter((p) => p.store !== 'promotional')
    if (!real.some((p) => !p.refunded)) givenByHand += 1
    for (const p of real) sold.push({ ...p, email: b.email })
  }
  sold.sort((a, b) => (b.at || 0) - (a.at || 0))
  return {
    ok: true,
    accounts: overview.accounts ?? 0,
    accountsDay: overview.accounts_day ?? 0,
    accountsWeek: overview.accounts_week ?? 0,
    unlocked: buyers.length,
    more: Math.max(0, (overview.buyers || []).length - buyers.length),
    givenByHand,
    unanswered,
    sales: sold
  }
}

/*
 * "Is there any way we can send an email to them when I grant access to
 * somebody?"
 *
 * The unlock lands without the person knowing, and a tester who is never told
 * goes on seeing a paywall in an app they already closed. So a grant that
 * CHANGED something sends one email, from the same verified address the
 * download link uses. A grant to somebody who already had it sends nothing:
 * pressing Give twice must not mean two emails.
 *
 * Every word is fixed here. The only thing from outside is the recipient, and
 * that is the address on the account itself (account_details), not what was
 * typed into the box: a typo in the box finds no account and never gets here.
 */
const FROM = 'Fractal Remote <noreply@newbold.cloud>'
const SITE = 'https://fractal.newbold.cloud'

const escape = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

async function tellThem(to: string): Promise<boolean> {
  const key = env('RESEND_API_KEY')
  if (!key || !to) return false
  const shown = escape(to)
  const html = `
    <div style="font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1d21">
      <p style="margin:0 0 16px;font-size:18px;font-weight:700">You have full access to Fractal Remote.</p>
      <p style="margin:0 0 16px">Everything in the app is unlocked for this account, for good. There is nothing to pay.</p>
      <p style="margin:0 0 20px">Sign in with this email address, <b>${shown}</b>, in the Fractal Remote app on your phone, or on the website:</p>
      <p style="margin:0 0 20px">
        <a href="${SITE}" style="background:#7c5cff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Open Fractal Remote</a>
      </p>
      <p style="margin:0 0 16px">To control your Fractal unit, you also need the free computer app, which holds the USB cable:<br><a href="${SITE}/downloads">${SITE}/downloads</a></p>
      <p style="margin:0;color:#8b9099;font-size:13px">If the app was already open, close it and open it again to see the unlock.</p>
    </div>`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject: 'You have full access to Fractal Remote', html })
    })
    if (!res.ok) console.error('grant-access: the email was refused', res.status, await res.text())
    return res.ok
  } catch (err) {
    console.error('grant-access: the email did not go', err)
    return false
  }
}

/* One address, one domain with a dot, no spaces or separators: the same rule
   as download-link's, because this is typed into a box too. */
const LOOKS_LIKE_EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>".]+\.[^@\s,;<>"]{2,}$/

/*
 * An address nobody has signed up with yet.
 *
 * "So I can't give access to someone until after they have created an account
 * themselves?" Now he can: Give access puts it on the waiting list
 * (supabase/migrations/20260924_waiting_grants.sql), and the first time that
 * person signs in, the entitlement function claims it through here. Check says
 * whether it is waiting; Take it back takes it off.
 */
async function noAccountYet(action: string, email: string): Promise<Record<string, unknown>> {
  const waiting = Boolean(await rpc('is_waiting_grant', { address: email }))
  if (action === 'grant') {
    if (email.length > 254 || !LOOKS_LIKE_EMAIL.test(email)) {
      return { ok: false, found: false, email, message: `${email} does not look like an email address, so nothing was added.` }
    }
    await rpc('wait_for_grant', { address: email })
    return {
      ok: true,
      found: false,
      waiting: true,
      email,
      message: `${email} hasn't signed up yet, so they're on the waiting list. The first time they sign in with this email, they'll be unlocked and emailed to say so.`
    }
  }
  if (action === 'revoke') {
    const dropped = Boolean(await rpc('drop_waiting_grant', { address: email }))
    return {
      ok: true,
      found: false,
      waiting: false,
      email,
      message: dropped ? `${email} is off the waiting list.` : `No account uses ${email}, and they weren't on the waiting list.`
    }
  }
  if (action === 'claim') return { ok: false, found: false, email, message: 'No account.' }
  return {
    ok: true,
    found: false,
    waiting,
    email,
    message: waiting
      ? `${email} hasn't signed up yet. They're on the waiting list, and will be unlocked the first time they sign in.`
      : `No account uses ${email} yet. Give access puts them on the waiting list, and they're unlocked the first time they sign in.`
  }
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
  /*
   * Two callers, and only two. Justin, proved by his signed token. And the
   * entitlement function beside this one, proved by the service role key that
   * Supabase gives every function here and nothing outside it: that is how a
   * waiting address is claimed when its owner first signs in, and 'claim' is
   * the only thing it may ask for.
   */
  const service = env('SUPABASE_SERVICE_ROLE_KEY')
  const internal = Boolean(token && service && token === service)
  const me = token && !internal ? await caller(token) : null
  /* The lock. Anybody else gets the same answer as nobody at all. */
  if (!internal && (!me || !ADMINS.includes(fold(me.email)))) return json({ ok: false, message: 'Not allowed.' }, 403)

  let input: { action?: string; email?: string } = {}
  try {
    input = await req.json()
  } catch {
    /* an empty body is a missing email, said below */
  }
  const action = String(input.action || 'check')
  const email = String(input.email || '').trim().toLowerCase()
  if (internal ? action !== 'claim' : !['check', 'grant', 'revoke', 'sales', 'accounts'].includes(action)) {
    return json({ ok: false, message: 'Unknown action.' }, 400)
  }
  if (action !== 'sales' && action !== 'accounts' && !email.includes('@')) return json({ ok: false, message: 'Type the email address they signed up with.' }, 400)
  if (!env('REVENUECAT_SECRET')) return json({ ok: false, message: 'The server has no RevenueCat key set.' }, 500)

  try {
    if (action === 'sales') return json(await sales())
    /* "How do I see a list of who has set up an account?" */
    if (action === 'accounts') return json({ ok: true, ...((await rpc('owner_accounts', {})) as Record<string, unknown>) })

    const found = (await rpc('account_details', { address: email })) as Record<string, any> | null
    const account = found?.id ? String(found.id) : null
    if (!account) return json(await noAccountYet(action, email))

    /* A claim is only ever for an address Justin put on the list. */
    if (action === 'claim' && !(await rpc('is_waiting_grant', { address: email }))) {
      return json({ ok: false, message: 'Not waiting.' }, 404)
    }
    const entitlement = await entitlementId()
    if (!entitlement) return json({ ok: false, message: 'Could not find the unlock in RevenueCat.' }, 502)

    /* Whether this grant is news to them, which is when they are told. */
    const giving = action === 'grant' || action === 'claim'
    const before = giving ? await unlocked(account, entitlement) : false

    if (giving) {
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
      /* Given, so no longer waiting — whichever way it was given. */
      await rpc('drop_waiting_grant', { address: email })
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

    const told = giving && has && !before ? await tellThem(String(found?.email || email)) : null
    if (action === 'claim') return json({ ok: true, unlocked: has, emailed: told === true })

    /* The Customer lookup. Asked after the change, so it shows the result. */
    const [bought, seen] = await Promise.all([purchasesOf(account), lastSeen(account)])
    const details = {
      signedUp: found?.signed_up ?? null,
      confirmed: found?.confirmed ?? null,
      lastSignIn: found?.last_sign_in ?? null,
      devices: found?.devices || [],
      /* One of the accounts shared/owner-unlock.mjs unlocks without a purchase. */
      owner: found?.unlock?.source === 'owner',
      purchases: bought,
      seen
    }
    const message =
      action === 'grant'
        ? before
          ? `${email} already had the unlock, so no email was sent.`
          : told
            ? `${email} has the unlock now, and they've been emailed to say so.`
            : `${email} has the unlock now. The email to tell them did not go out, so let them know yourself. They may need to close and reopen the app.`
        : action === 'revoke'
          ? has
            ? `The unlock given here is taken back, but ${email} still has one — they bought it, and a purchase is not touched here.`
            : `${email} no longer has the unlock.`
          : has
            ? `${email} has the unlock.`
            : `${email} has an account but not the unlock.`
    return json({ ok: true, found: true, email, unlocked: has, emailed: told === true, message, details })
  } catch (err) {
    console.error(`grant-access: ${err}`)
    return json({ ok: false, message: `Something went wrong: ${String((err as Error)?.message || err).slice(0, 200)}` }, 500)
  }
})
