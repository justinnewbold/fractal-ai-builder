/**
 * "Send me the link" — the computer app's download page, in an inbox.
 *
 * "We can just list the website... and the option to email the link to them.
 * Because we do have that service. So I guess you'll need to get that wired
 * up."
 *
 * Somebody is standing on a phone, in the onboarding, being told they need an
 * app on a computer they are not sitting at. The address is on screen for
 * anyone happy to type it. This is for everyone else: one field, one button,
 * and the link is waiting for them when they get to the desk.
 *
 * Called by the PHONE, which is the whole difficulty. feedback-email beside
 * this is called by Postgres and can therefore demand a shared secret; this
 * has to answer somebody who has not signed in, has no account and may never
 * make one. So the protections are different, and they are these:
 *
 *   NOTHING THE CALLER TYPES REACHES THE MESSAGE. The subject, the body and
 *   the link are fixed in this file. The address is the only input, it is used
 *   only as a recipient, and it is validated before use. That is what stops
 *   this being a machine for putting a stranger's words in somebody's inbox —
 *   the worst it can send is this exact email, which is a download link for
 *   free software.
 *
 *   ONE PER ADDRESS, THEN A WAIT. A fixed message still mail-bombs somebody if
 *   it can be sent a thousand times, so a row is kept per recipient and a
 *   second request inside the window is answered 200 and does nothing. Silent
 *   rather than "you already asked", because telling a caller whether an
 *   address has been used here is telling them something about that address.
 *
 * WHAT HAS TO BE SET, in Supabase → Edge Functions → Secrets:
 *
 *   RESEND_API_KEY   from resend.com. Same key feedback-email uses, and the
 *                    only one that has to be set.
 *   DOWNLOAD_FROM    who it comes from. Optional: with nothing set this sends
 *                    from noreply@newbold.cloud, which is verified.
 *
 * With no RESEND_API_KEY this answers "not configured" rather than throwing,
 * the same as its neighbour: the button exists before the key does.
 */

const RESEND = 'https://api.resend.com/emails'

/** The page that decides which build somebody needs. Not a caller's URL. */
const LINK = 'https://fractal.newbold.cloud/downloads'

/*
 * THE DOMAIN IS VERIFIED NOW, so this is the real one.
 *
 * It used to be `onboarding@resend.dev` — Resend's own address, which works
 * the day you sign up and is why it was written that way. What the comment
 * did not say is the catch: that address may only send to the ONE address
 * that owns the Resend account. Every other recipient is refused outright.
 *
 * Which is exactly what happened. "Send link" to an address that was not his
 * gmail came back "The mail service refused it", and the reason was not the
 * app or the key — it was this line, plus a newbold.cloud that had been
 * sitting unverified since December with none of its three DNS records ever
 * added. The records are in now and the domain is proved, so the fallback is
 * the domain rather than the practice address.
 */
const DEFAULT_FROM = 'Fractal Remote <noreply@newbold.cloud>'

/** How long an address waits before it can be sent this again. */
const EVERY_MINUTES = 10

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

/*
 * Deliberately strict, and deliberately not RFC 5322.
 *
 * The full grammar accepts things no mail server here will ever be handed, and
 * every extra shape it permits is another string reaching Resend. One local
 * part, one domain with a dot, no spaces, no commas or semicolons — the last
 * of those is what stops one field becoming a list of recipients.
 */
const LOOKS_LIKE_EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>".]+\.[^@\s,;<>"]{2,}$/

/**
 * Whether this address has been sent the link lately.
 *
 * Kept in the database rather than in memory: edge functions are many and
 * short-lived, so a counter in this process is a counter that resets whenever
 * the platform feels like it — which is no limit at all.
 */
async function askedRecently(email: string): Promise<boolean | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/rpc/note_download_link`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ addr: email, every_minutes: EVERY_MINUTES })
    })
    if (!res.ok) {
      console.error('download-link: rate check failed', res.status, await res.text())
      return null
    }
    /* The function returns true when this send is allowed. */
    return (await res.json()) === false
  } catch (err) {
    console.error('download-link: rate check failed', err)
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  let email = ''
  try {
    const body = await req.json()
    email = String(body?.email ?? '').trim()
  } catch {
    return json({ sent: false, why: 'bad request' }, 400)
  }

  /* Length first: a 40KB "address" is not one, and it should not reach a
     regular expression or a log line. */
  if (email.length > 254 || !LOOKS_LIKE_EMAIL.test(email)) {
    return json({ sent: false, why: 'that does not look like an email address' }, 400)
  }

  const recently = await askedRecently(email)
  /*
   * A rate check that cannot answer refuses the send. The alternative — carry
   * on when the database is unreachable — turns one outage into an open relay,
   * and the cost of being wrong the other way is somebody typing an address
   * again in a minute.
   */
  if (recently !== false) {
    if (recently === null) console.error('download-link: refusing, the rate check could not answer')
    return json({ sent: true })
  }

  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) {
    console.log('download-link: no RESEND_API_KEY set, nothing sent')
    return json({ sent: false, why: 'not configured' })
  }

  /*
   * Fixed, every word of it. Nothing here is interpolated from the request,
   * which is what makes an unauthenticated endpoint safe to expose at all.
   */
  const html = `
    <div style="font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1d21">
      <p style="margin:0 0 16px">Here is the download for the Fractal Remote computer app.</p>
      <p style="margin:0 0 20px">
        <a href="${LINK}" style="background:#7c5cff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Download Fractal Remote</a>
      </p>
      <p style="margin:0 0 16px;color:#5f6670">Or open this on the computer:<br><a href="${LINK}">${LINK}</a></p>
      <p style="margin:0;color:#8b9099;font-size:13px">
        The computer app is free. It holds the USB cable to your Fractal unit, and your phone
        connects to it.
      </p>
    </div>`

  const res = await fetch(RESEND, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('DOWNLOAD_FROM') || DEFAULT_FROM,
      to: [email],
      subject: 'Your Fractal Remote download link',
      html
    })
  })

  if (!res.ok) {
    const detail = await res.text()
    console.error('download-link: Resend refused', res.status, detail)
    return json({ sent: false, why: 'the mail service refused it' })
  }

  return json({ sent: true })
})
