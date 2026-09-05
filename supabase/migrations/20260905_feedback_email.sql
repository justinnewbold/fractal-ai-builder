-- A report in the table becomes a report in an inbox.
--
-- "Let's set up actual emails to get sent in when someone leaves feedback."
--
-- The Tell us box writes a row into public.feedback and finishes. Nothing told
-- anybody. This trigger hands each new row to the `feedback-email` edge
-- function beside this file, which sends it on through Resend.
--
-- Why a trigger and not a call from the app: the app must not depend on mail
-- going out. Someone reporting a bug is already having a bad time, often on a
-- stage, often on a phone with two bars — the insert is the promise this app
-- makes, and it is kept whether or not an email ever leaves. It also cannot be
-- bypassed: every row gets its notification, including ones written by hand.
--
-- pg_net is asynchronous. `net.http_post` queues the request and returns
-- immediately, so the INSERT is not waiting on Resend, on the function, or on
-- the internet. A person taps Send and the box says thank you at the same speed
-- it always did.

create extension if not exists pg_net with schema extensions;

-- The shared secret the function checks, kept out of the trigger body.
--
-- The function has `verify_jwt` off (its caller is Postgres, not a signed-in
-- person), so this header is the only thing standing between the URL and
-- anybody who finds it. Read from Vault rather than written here, because a
-- migration is a file in a repository and this is not.
--
-- Set it once, in the SQL editor, to the same string as the function's
-- FEEDBACK_HOOK_SECRET:
--   select vault.create_secret('<your random string>', 'feedback_hook_secret');
create or replace function public.notify_feedback()
returns trigger
language plpgsql
security definer
-- Empty search_path: this runs as the definer on every insert into a table
-- anyone on the internet can write to, so nothing about which schema a name
-- resolves to is left to the caller. Every reference below is qualified.
set search_path = ''
as $$
declare
  hook_secret text;
  fn_url text := 'https://biznwrqeckviawjuhvyg.supabase.co/functions/v1/feedback-email';
begin
  select decrypted_secret into hook_secret
  from vault.decrypted_secrets
  where name = 'feedback_hook_secret'
  limit 1;

  -- No secret set yet means this has not been finished being wired up. Say so
  -- in the log and let the insert through: a report that reaches the table and
  -- no inbox is worth far more than one that was refused.
  if hook_secret is null then
    raise log 'notify_feedback: no feedback_hook_secret in vault, nothing sent';
    return new;
  end if;

  perform extensions.net.http_post(
    url := fn_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', hook_secret
    ),
    body := to_jsonb(new),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists feedback_email on public.feedback;

-- AFTER, so a failure here can never roll back somebody's report.
create trigger feedback_email
  after insert on public.feedback
  for each row
  execute function public.notify_feedback();

-- The function is owned by the definer and must not be callable by the public
-- roles in its own right; the trigger is the only thing that should reach it.
revoke all on function public.notify_feedback() from public, anon, authenticated;
