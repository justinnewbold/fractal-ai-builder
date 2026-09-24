/**
 * Has this account paid?
 *
 * "Can we add the ability to purchase the license to unlock in the mac app and
 * web version now also?"
 *
 * The phone can answer that question by itself: RevenueCat's SDK is compiled
 * into it, and the store it talks to is the one that took the money. The
 * browser has neither. There is no App Store on a Mac running a downloaded
 * app and no Play Store in Chrome, so the computer has to ASK — and the only
 * key that can ask is a secret one, which cannot be put in a page anybody can
 * read the source of.
 *
 * So the question is asked here, on a server, and the answer comes back as a
 * single boolean.
 *
 * WHO IS ASKING IS NOT UP TO THE CALLER. The account id comes out of the
 * Supabase token the caller presents, verified against Supabase, never out of
 * the request body. A browser that could name its own account id would be a
 * browser that could unlock itself by typing somebody else's, and the whole
 * point of a server-side check is that it is not the client's word.
 *
 * WHY THE ACCOUNT ID IS THE RIGHT KEY. The phone calls RevenueCat's logIn with
 * exactly this id the moment somebody signs in — see mobile/src/lib/purchases
 * — so a purchase made on a handset lands on a RevenueCat customer named after
 * the Supabase account. Asking RevenueCat about that same id from here is
 * asking about the same person. It is the reason a purchase follows somebody
 * between a phone and a laptop at all.
 *
 * WHAT HAS TO BE SET, in Supabase -> Edge Functions -> Secrets:
 *
 *   REVENUECAT_SECRET   a V2 secret key from RevenueCat -> Project settings ->
 *                       API keys. V1 keys are a different API and will 401.
 *   REVENUECAT_PROJECT  the project id, proj... . Optional: it defaults to the
 *                       one below, which is this app's.
 *
 * With no key set this answers `unknown` rather than `no`, for the reason
 * given on the failure path further down.
 */

const RC = 'https://api.revenuecat.com/v2'

/** This app's RevenueCat project, unless a secret says otherwise. */
const DEFAULT_PROJECT = 'proj827190e9'

/** What the entitlement is called there. The phone checks the same word. */
const ENTITLEMENT = 'full'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })

/**
 * The account id inside a Supabase access token, or null.
 *
 * Verified by Supabase rather than decoded here. A JWT's payload is base64,
 * not a secret — anybody can write one that SAYS they are anybody — so the
 * signature is the only part that means anything, and checking it is what
 * `auth.getUser` does. Reading `sub` out of the middle segment would be
 * reading the attacker's own claim about themselves.
 */
async function accountFrom(token: string): Promise<{ id: string; email: string } | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return null
    const user = await res.json()
    const id = String(user?.id || '')
    return id ? { id, email: String(user?.email || '') } : null
  } catch (err) {
    console.error(`entitlement: could not verify the token (${err})`)
    return null
  }
}

/**
 * What RevenueCat calls this entitlement, in both of the names it has.
 *
 * An entitlement carries an `id` (entl...) and a `lookup_key` (`full`), and
 * the active-entitlements list reports one field, `entitlement_id`. Which of
 * the two names lands in it is not something this could be sure of from a
 * customer who has bought nothing — the list comes back empty either way, and
 * an empty list proves nothing about the shape of a full one.
 *
 * Guessing wrong here is the worst failure this file has: the gate would tell
 * somebody who HAS paid that they have not, for ever, and nothing would look
 * broken. So it does not guess. The project's entitlements are read once and
 * both names are accepted.
 *
 * Held across invocations because it changes about once a year, and a warm
 * function should not pay for it. Only a good answer is cached, so a blip does
 * not pin the wrong list until the next deploy.
 */
let cachedNames: Set<string> | null = null

async function namesFor(project: string, key: string): Promise<Set<string>> {
  if (cachedNames) return cachedNames
  /* Both literals, whatever happens below: if the list cannot be read, the
     lookup key is still the likelier of the two and is worth matching. */
  const names = new Set<string>([ENTITLEMENT])
  try {
    const res = await fetch(`${RC}/projects/${project}/entitlements`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
    })
    if (!res.ok) {
      console.error(`entitlement: could not list entitlements (${res.status})`)
      return names
    }
    const body = await res.json()
    for (const e of body?.items || []) {
      if (e?.lookup_key === ENTITLEMENT && e?.id) names.add(String(e.id))
    }
    cachedNames = names
  } catch (err) {
    console.error(`entitlement: could not list entitlements (${err})`)
  }
  return names
}

/**
 * Whether RevenueCat says this customer holds the entitlement.
 *
 * Three answers, not two. `true` and `false` are RevenueCat's; `null` means
 * the question could not be put — no key, a bad key, RevenueCat down, the
 * network gone — and the caller is told that rather than being told no.
 *
 * A customer RevenueCat has never heard of is a real `false`, not a failure:
 * it is somebody who has never bought anything on any device, which is the
 * ordinary state of almost everybody.
 */
async function owns(account: string): Promise<boolean | null> {
  const key = Deno.env.get('REVENUECAT_SECRET')
  if (!key) {
    console.log('entitlement: no REVENUECAT_SECRET set')
    return null
  }
  const project = Deno.env.get('REVENUECAT_PROJECT') || DEFAULT_PROJECT
  try {
    const res = await fetch(
      `${RC}/projects/${project}/customers/${encodeURIComponent(account)}/active_entitlements`,
      { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } }
    )
    if (res.status === 404) return false
    if (!res.ok) {
      console.error(`entitlement: RevenueCat answered ${res.status}`)
      return null
    }
    const body = await res.json()
    const items: Array<{ entitlement_id?: string }> = body?.items || []
    if (items.length === 0) return false
    const names = await namesFor(project, key)
    return items.some((e) => e?.entitlement_id && names.has(String(e.entitlement_id)))
  } catch (err) {
    console.error(`entitlement: could not reach RevenueCat (${err})`)
    return null
  }
}

/*
 * THE ACCOUNTS UNLOCKED WITHOUT PAYING, the same list the phone reads.
 *
 * shared/owner-unlock.mjs is the source. It cannot be imported here — this
 * runs in Deno on Supabase and that file lives in the app's repository — so it
 * is copied, and test/server.mjs fails if the two ever differ. Hashes rather
 * than addresses for the reason that file gives: nobody's inbox in a public
 * repository. It grants nothing on its own; the caller has already proved,
 * with a signed token, which account they are.
 */
const OWNERS = ['8a9f8fc4']

/** djb2, as the phone computes it. Must match shared/owner-unlock.mjs exactly. */
function fold(text: string): string {
  let h = 5381
  const s = String(text || '').trim().toLowerCase()
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

/**
 * Write down what was learned, so the relay can read it.
 *
 * The relay's policy asks public.is_entitled, which reads public.entitlements
 * — see the migration of the same date. This is the self-healing half of
 * keeping that table right: whenever a paying customer opens the app, the row
 * is written from a definite answer, so a webhook that never arrived costs
 * them nothing.
 *
 * Through record_entitlement rather than a plain upsert, because that is where
 * the one rule lives: a sale's "no" never overwrites an owner. A failure here
 * is logged and swallowed — the caller still gets the answer they asked for,
 * and the next open tries again.
 */
async function record(account: string, active: boolean, source: 'revenuecat' | 'owner'): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return
  try {
    const res = await fetch(`${url}/rest/v1/rpc/record_entitlement`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: account, is_active: active, from_source: source })
    })
    if (!res.ok) console.error(`entitlement: could not record (${res.status} ${await res.text()})`)
  } catch (err) {
    console.error(`entitlement: could not record (${err})`)
  }
}

/** Whether this address is on Justin's waiting list. False when unsure. */
async function waiting(email: string): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return false
  try {
    const res = await fetch(`${url}/rest/v1/rpc/is_waiting_grant`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: email })
    })
    return res.ok && (await res.json()) === true
  } catch (err) {
    console.error(`entitlement: could not read the waiting list (${err})`)
    return false
  }
}

/** Ask grant-access to unlock a waiting address. True when it did. */
async function claim(email: string): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return false
  try {
    const res = await fetch(`${url}/functions/v1/grant-access`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim', email })
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body?.unlocked) console.error(`entitlement: the claim did not unlock (${res.status} ${JSON.stringify(body).slice(0, 200)})`)
    return Boolean(res.ok && body?.unlocked)
  } catch (err) {
    console.error(`entitlement: could not claim (${err})`)
    return false
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  const auth = req.headers.get('Authorization') || ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) return json({ unlocked: false, why: 'signed out' }, 401)

  const who = await accountFrom(token)
  if (!who) return json({ unlocked: false, why: 'signed out' }, 401)
  const account = who.id

  /* An owner is unlocked whatever RevenueCat says, and is written down as one
     so the relay agrees. Checked first: RevenueCat's honest "never bought
     it" about an owner must not be the answer anybody records. */
  if (OWNERS.includes(fold(who.email))) {
    await record(account, true, 'owner')
    return json({ unlocked: true })
  }

  let answer = await owns(account)

  /*
   * SOMEBODY JUSTIN GAVE ACCESS TO BEFORE THEY HAD AN ACCOUNT.
   *
   * Give access puts an address with no account on a waiting list. This is the
   * first thing every app asks after a sign-in, on the phone and the computer,
   * so it is where the list is claimed: the token above has already proved
   * which address this is, which is all a claim needs. grant-access does the
   * unlocking, the recording and the email, so there is one copy of each.
   * Only on a definite "no", and never fatal: a failed claim is tried again at
   * the next sign-in, and the person's answer is whatever RevenueCat says.
   */
  if (answer === false && who.email && (await waiting(who.email))) {
    if (await claim(who.email)) answer = await owns(account)
  }

  /*
   * A QUESTION THAT COULD NOT BE ASKED IS NOT A NO, and this is the same rule
   * the phone follows — see mobile/src/lib/unlock-rule.
   *
   * The people most likely to be on a bad line are the ones on a stage about
   * to play, and a gate that locks them out of a rig they already paid for,
   * because a server in another country was having a minute, is worse than a
   * gate that occasionally lets somebody through. The money is already taken
   * or it is not; nothing here can change that either way.
   *
   * `unknown` is the word rather than a bare true, so the caller can decide
   * with its eyes open and say something honest on screen if it wants to.
   */
  if (answer === null) return json({ unlocked: true, unknown: true })
  /*
   * Only a DEFINITE answer is written down. The fail-open above is right for
   * the screen and would be wrong for the table: writing "active" because
   * RevenueCat was unreachable would hand the relay to anybody who happened to
   * ask during an outage, for ever.
   */
  await record(account, answer, 'revenuecat')
  return json({ unlocked: answer })
})
