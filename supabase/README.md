# The database side

Two things live here, both about the same problem: a bug report that reaches the
table and nobody's attention.

- `functions/feedback-email/` — turns a row in `public.feedback` into an email.
- `migrations/20260905_feedback_email.sql` — the trigger that calls it.

Both are deployed. The one thing they need that a repository must never hold is
an API key, so until the four settings below are filled in, the trigger runs,
logs that it has nothing to send with, and lets the report through untouched.
Nothing breaks in the meantime; the reports simply keep arriving silently, the
way they did before.

## Finishing the wiring

**1. Get a Resend key.** [resend.com](https://resend.com) → sign up (GitHub works)
→ **API Keys** → **Create API Key** → copy it. The free tier is 3,000 emails a
month, which is several orders of magnitude more than this will ever send.

**2. Put it in Supabase.** Supabase dashboard → the `fractal-ai-builder` project
→ **Edge Functions** → **Secrets** → add:

| name | value |
|---|---|
| `RESEND_API_KEY` | the key from step 1 |
| `FEEDBACK_TO` | where reports should land |
| `FEEDBACK_FROM` | `Fractal AI Builder <onboarding@resend.dev>` to start with |
| `FEEDBACK_HOOK_SECRET` | any long random string you invent |

**3. Tell the database the same secret.** Supabase → **SQL Editor**, and run this
with the *same* string you used for `FEEDBACK_HOOK_SECRET`:

```sql
select vault.create_secret('<the same random string>', 'feedback_hook_secret');
```

That is the whole of it. The next report sends an email.

### Sending from your own domain

`onboarding@resend.dev` is Resend's shared sender. It works on the day you sign
up, which is the point of starting there, but mail from it is more likely to be
filtered and it is obviously not yours.

To send as `feedback@newbold.cloud`: Resend → **Domains** → **Add Domain** →
`newbold.cloud`, add the DNS records it gives you, wait for it to verify, then
change `FEEDBACK_FROM` to `Fractal AI Builder <feedback@newbold.cloud>`. Nothing
else changes.

## How it is put together, and why

**The app does not send the email.** It inserts a row and is finished. Someone
reporting a bug is already having a bad time, often on a stage, often on a phone
with two bars — the insert is the promise this app makes to them, and it is kept
whether or not any mail ever leaves. A trigger also cannot be bypassed: every
row gets its notification, including ones written by hand in the dashboard.

**`pg_net` is asynchronous.** `net.http_post` queues the request and returns, so
the INSERT never waits on Resend, on the function, or on the internet.

**The function authenticates itself.** `verify_jwt` is off, because the caller is
Postgres rather than a signed-in person. Anyone who has the app has the anon key,
so a JWT check would not have distinguished the database from a stranger anyway —
the `x-hook-secret` header does. Without it the function's URL would be a button
anybody could press to put whatever they liked in an inbox.

**Failures are logged, not raised.** A missing key, a refusal from Resend, a
malformed row — all of them answer 200 and write a line to the function log. The
row is already saved and the person has already been thanked; a non-2xx would
only record a failure in `net._http_response` that nobody is watching. When mail
stops arriving, the function log is the place to look.

## Checking it

```sql
-- the plumbing
select
  (select count(*) from pg_trigger where tgname = 'feedback_email' and not tgisinternal) as trigger_installed,
  (select count(*) from pg_extension where extname = 'pg_net') as pg_net_installed,
  (select count(*) from vault.decrypted_secrets where name = 'feedback_hook_secret') as hook_secret_set;

-- what the last few calls actually did
select id, status_code, created
from net._http_response
order by created desc
limit 5;
```

A `status_code` of 200 with no email means the function ran and chose not to
send; its log says why. A 401 means the two halves of the hook secret do not
match.
