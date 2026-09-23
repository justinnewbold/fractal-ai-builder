/**
 * RevenueCat says something changed; write down who has paid.
 *
 * The fast half of keeping public.entitlements right — the relay's policy reads
 * it, so this is what makes a purchase open the relay within seconds and a
 * refund close it. The slow half is supabase/functions/entitlement, which
 * writes the same row whenever a paying customer opens the app, so a webhook
 * that never arrives is healed the next time anybody looks.
 *
 * IT DOES NOT INTERPRET THE EVENT. There are twenty-one event types and most of
 * the ways to get this wrong are in reading them: a CANCELLATION is a refund
 * for a one-off purchase and a lapse for a subscription, a TRANSFER moves a
 * purchase between two ids, and the entitlement list on the event is what
 * changed rather than what is true. So every id the event mentions is simply
 * asked about again, and whatever RevenueCat says NOW is what gets written.
 * The event is a doorbell, not a letter.
 *
 * ONLY ACCOUNT IDS ARE WRITTEN. RevenueCat also knows anonymous handset ids
 * ($RCAnonymousID:…) — a purchase made before anybody signed in. Those name no
 * account, so there is no row to write; the purchase reaches a row when the
 * phone's logIn carries it onto one, which RevenueCat reports as its own event.
 *
 * WHAT HAS TO BE SET, in Supabase -> Edge Functions -> Secrets:
 *
 *   REVENUECAT_WEBHOOK_AUTH  a long random string. The same string goes in
 *                            RevenueCat -> Integrations -> Webhooks as the
 *                            Authorization header value. Anything calling
 *                            without it is refused.
 *   REVENUECAT_SECRET        the V2 secret key, the same one `entitlement` uses.
 *
 * Deployed with verify_jwt off: RevenueCat has no Supabase session to send.
 * The header above is what stands in for one.
 */

const RC = 'https://api.revenuecat.com/v2'
const DEFAULT_PROJECT = 'proj827190e9'
const ENTITLEMENT = 'full'

/** A Supabase account id. Anything else RevenueCat reports is a handset. */
const ACCOUNT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Equal-time comparison, so the check leaks nothing about how close a guess was. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/*
 * BOTH NAMES FOR ONE ENTITLEMENT — the same trap `entitlement` guards, and held
 * to it by test/server.mjs. RevenueCat reports `entitlement_id`, and on this
 * project that has come back as the id (entl…) rather than the lookup key
 * (`full`). Match only the key and every refund would look like nothing, and
 * every purchase too.
 */
let cachedNames: Set<string> | null = null

async function namesFor(project: string, key: string): Promise<Set<string>> {
  if (cachedNames) return cachedNames
  const names = new Set<string>([ENTITLEMENT])
  try {
    const res = await fetch(`${RC}/projects/${project}/entitlements`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
    })
    if (!res.ok) return names
    const body = await res.json()
    for (const e of body?.items || []) {
      if (e?.lookup_key === ENTITLEMENT && e?.id) names.add(String(e.id))
    }
    cachedNames = names
  } catch (err) {
    console.error(`revenuecat-webhook: could not list entitlements (${err})`)
  }
  return names
}

/** true, false, or null when the question could not be put. */
async function owns(account: string, project: string, key: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `${RC}/projects/${project}/customers/${encodeURIComponent(account)}/active_entitlements`,
      { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } }
    )
    if (res.status === 404) return false
    if (!res.ok) return null
    const body = await res.json()
    const items: Array<{ entitlement_id?: string }> = body?.items || []
    if (items.length === 0) return false
    const names = await namesFor(project, key)
    return items.some((e) => e?.entitlement_id && names.has(String(e.entitlement_id)))
  } catch {
    return null
  }
}

async function record(account: string, active: boolean): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return false
  const res = await fetch(`${url}/rest/v1/rpc/record_entitlement`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: account, is_active: active, from_source: 'revenuecat' })
  })
  if (!res.ok) console.error(`revenuecat-webhook: could not record ${account} (${res.status})`)
  return res.ok
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const expected = Deno.env.get('REVENUECAT_WEBHOOK_AUTH') || ''
  const given = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  /* No secret configured is a refusal, not an open door. */
  if (!expected || !same(given, expected.replace(/^Bearer\s+/i, '').trim())) {
    return json({ ok: false, why: 'unauthorised' }, 401)
  }

  let event: Record<string, unknown> = {}
  try {
    event = (await req.json())?.event || {}
  } catch {
    return json({ ok: false, why: 'bad request' }, 400)
  }

  /* RevenueCat's own "send test event" button. Answer it, change nothing. */
  if (event.type === 'TEST') return json({ ok: true, test: true })

  const key = Deno.env.get('REVENUECAT_SECRET')
  if (!key) {
    console.error('revenuecat-webhook: no REVENUECAT_SECRET set')
    /* 500 so RevenueCat retries once the secret is back, rather than the
       event being acknowledged and lost. */
    return json({ ok: false, why: 'not configured' }, 500)
  }
  const project = Deno.env.get('REVENUECAT_PROJECT') || DEFAULT_PROJECT

  const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map(String)
  const ids = new Set(
    [
      ...list(event.app_user_id),
      ...list(event.original_app_user_id),
      ...list(event.aliases),
      ...list(event.transferred_from),
      ...list(event.transferred_to)
    ].filter((id) => ACCOUNT.test(id))
  )

  let failed = false
  for (const id of ids) {
    const answer = await owns(id, project, key)
    /* An unanswerable question writes nothing and asks to be sent again. */
    if (answer === null) {
      failed = true
      continue
    }
    if (!(await record(id, answer))) failed = true
  }

  console.log(`revenuecat-webhook: ${event.type} for ${ids.size} account(s)${failed ? ', some to retry' : ''}`)
  /* Non-200 is how RevenueCat knows to try again (5, 10, 20, 40, 80 minutes). */
  return json({ ok: !failed, accounts: ids.size }, failed ? 500 : 200)
})
