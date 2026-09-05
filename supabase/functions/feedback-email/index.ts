/**
 * A report in the table becomes a report in an inbox.
 *
 * "Let's set up actual emails to get sent in when someone leaves feedback."
 *
 * Until now the Tell us box wrote a row into `public.feedback` and that was the
 * end of it. Nobody was told. The reports were real, they were arriving, and
 * the only way to read one was to open the database and go looking — which
 * nobody does on a day when nothing is known to be wrong. A bug report nobody
 * reads is the same as no bug report, only more disappointing for the person
 * who took the trouble.
 *
 * Called by a trigger on that table (see the migration beside this file), not
 * by the app. That matters: the app inserts the row and is finished, so a
 * failure to send mail can never lose a report or stall someone's phone on a
 * stage. The row is the record; this is a courtesy on top of it.
 *
 * WHAT HAS TO BE SET, in Supabase → Edge Functions → Secrets:
 *
 *   RESEND_API_KEY   from resend.com. The only one that is required.
 *   FEEDBACK_TO      where reports land (default: the address below)
 *   FEEDBACK_FROM    who they come from; must be a domain verified with Resend,
 *                    or their onboarding@resend.dev while testing
 *
 * There is deliberately no secret to keep in step by hand. An earlier version
 * had one — FEEDBACK_HOOK_SECRET here, the same string in Vault — and that is
 * the step that breaks: two halves typed twice, and when they disagree the
 * failure is a 401 nobody is looking at. The database generates the secret
 * instead and this reads it back through an RPC that only `service_role` may
 * call, using the key Supabase injects here on its own.
 *
 * With no RESEND_API_KEY this answers 200 and does nothing. Deliberate: the
 * trigger fires on every insert from the moment it exists, and a function that
 * threw until the day someone got round to signing up for Resend would fill the
 * logs with failures that were not failures.
 */

const RESEND = 'https://api.resend.com/emails'

/** Where reports go when nothing says otherwise. */
const DEFAULT_TO = 'justinnewbold@gmail.com'

/**
 * Resend will only send from a domain you have proved you own. `resend.dev` is
 * theirs and works immediately, which is what makes the first email arrive on
 * the day this is set up rather than after a DNS change has propagated.
 */
const DEFAULT_FROM = 'Fractal AI Builder <onboarding@resend.dev>'

/**
 * The secret the trigger sends, read from where the database keeps it.
 *
 * Held across invocations on purpose: a warm function answers without the extra
 * round trip, and a cold one pays it once. Only a successful read is cached, so
 * a blip while the secret is being rotated does not lock this out until the
 * next deploy.
 */
let cachedSecret: string | null = null

async function hookSecret(): Promise<string | null> {
  if (cachedSecret) return cachedSecret
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/rpc/feedback_hook_secret`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}'
    })
    if (!res.ok) {
      console.error('feedback-email: could not read the hook secret', res.status, await res.text())
      return null
    }
    const value = await res.json()
    if (typeof value === 'string' && value) cachedSecret = value
    return cachedSecret
  } catch (err) {
    console.error('feedback-email: could not read the hook secret', err)
    return null
  }
}

/** Nothing from a stranger's keyboard reaches an inbox as markup. */
const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  /*
   * The database is the only thing that may call this.
   *
   * `verify_jwt` is off, because the caller is Postgres rather than a signed-in
   * person — so this is the gate instead. Without it the URL is a button
   * anybody on the internet could press to put whatever they liked in an inbox.
   * Compared in full rather than with a prefix so a partial guess proves
   * nothing.
   */
  const expected = await hookSecret()
  const given = req.headers.get('x-hook-secret')
  /*
   * Both halves must exist. Without the first test an unreadable secret would
   * make `null !== null` false and wave everything through — the failure that
   * turns a closed door into an open one.
   */
  if (!expected || !given || given !== expected) {
    return new Response('No', { status: 401 })
  }

  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) {
    // Not an error. See the note at the top: the trigger runs before anyone has
    // signed up for anything, and the row is already safe in the table.
    console.log('feedback-email: no RESEND_API_KEY set, nothing sent')
    return new Response(JSON.stringify({ sent: false, why: 'not configured' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  let row: Record<string, unknown> = {}
  try {
    const body = await req.json()
    // Supabase sends `{ type, table, record, old_record }`; the migration sends
    // the record on its own. Accept either so the shape of the trigger can
    // change without this having to.
    row = (body?.record ?? body) as Record<string, unknown>
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  const kind = row.kind === 'idea' ? 'Idea' : 'Bug'
  const message = String(row.message ?? '').slice(0, 4000)
  const contact = String(row.contact ?? '').trim()
  const ctx = (row.context ?? {}) as Record<string, unknown>

  /*
   * The context is what makes a report actionable, and it is exactly what
   * nobody can be expected to type: which version, which unit, how they were
   * connected, what size screen. Laid out as a list rather than dumped as JSON
   * because this is read on a phone, in a hurry, usually while doing something
   * else.
   */
  const facts = Object.entries(ctx)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`)
    .join('')

  const subject = `${kind}: ${message.split('\n')[0].slice(0, 70) || '(no message)'}`

  const html = `
    <div style="font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1d21">
      <p style="margin:0 0 4px"><b>${esc(kind)}</b>${
        contact ? ` from ${esc(contact)}` : ' — no reply address given'
      }</p>
      <pre style="white-space:pre-wrap;word-break:break-word;font:inherit;background:#f4f2ee;border-radius:6px;padding:12px;margin:12px 0">${esc(
        message
      )}</pre>
      ${facts ? `<ul style="margin:12px 0;padding-left:18px;color:#5f6670">${facts}</ul>` : ''}
      <p style="color:#8b9099;font-size:12px;margin:16px 0 0">Row ${esc(row.id)}</p>
    </div>`

  const payload: Record<string, unknown> = {
    from: Deno.env.get('FEEDBACK_FROM') || DEFAULT_FROM,
    to: [Deno.env.get('FEEDBACK_TO') || DEFAULT_TO],
    subject,
    html
  }
  /*
   * If they left an address, hitting Reply should answer them rather than
   * writing back to a sending domain nobody reads. Only when it looks like an
   * address at all — the box invites "your email, if you want an answer", and
   * people put all sorts in it.
   */
  if (/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(contact)) payload.reply_to = contact

  const res = await fetch(RESEND, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const detail = await res.text()
    console.error('feedback-email: Resend refused', res.status, detail)
    // 200 on purpose. The row is saved and the person has been thanked; a
    // non-2xx here only makes pg_net record a failure nobody is watching.
    // The log line is the thing that gets read when mail stops arriving.
    return new Response(JSON.stringify({ sent: false, status: res.status, detail }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ sent: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
})
