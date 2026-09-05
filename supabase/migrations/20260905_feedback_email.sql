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
-- pg_net is asynchronous. `net.http_post` queues the request and the extension's
-- background worker sends it, so the INSERT is not waiting on Resend, on the
-- function, or on the internet. (The queue row is written inside the caller's
-- transaction, so a rolled-back insert sends nothing — which is correct, and
-- worth knowing when testing this by hand.)

create extension if not exists pg_net with schema extensions;

-- The shared secret, generated here rather than by a person.
--
-- An earlier version asked for one to be invented and typed into two places:
-- the function's environment and Vault. That is exactly the step that breaks,
-- and it breaks silently — two halves that disagree are a 401 nobody is looking
-- at. The database makes it instead, and the function reads the same value back
-- through feedback_hook_secret() below.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'feedback_hook_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'feedback_hook_secret',
      'Shared between the feedback trigger and the feedback-email function.'
    );
  end if;
end $$;

-- How the function reads that secret.
--
-- Supabase injects SUPABASE_SERVICE_ROLE_KEY into every edge function, so this
-- needs nothing configured. security definer because vault is not reachable
-- through the API, and execute is granted to service_role alone — the anon key
-- ships inside the app, and a secret the app could fetch would not be one.
create or replace function public.feedback_hook_secret()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text;
begin
  select decrypted_secret into s
  from vault.decrypted_secrets
  where name = 'feedback_hook_secret'
  limit 1;
  return s;
end;
$$;

revoke all on function public.feedback_hook_secret() from public, anon, authenticated;
grant execute on function public.feedback_hook_secret() to service_role;

-- Empty search_path: this runs as the definer on every insert into a table
-- anyone on the internet can write to, so nothing about which schema a name
-- resolves to is left to the caller. Every reference below is qualified.
--
-- `net.http_post`, NOT `extensions.net.http_post`. pg_net's functions live in
-- schema `net` whatever schema the extension itself was created with, and the
-- three-part name parses as database.schema.function: "cross-database
-- references are not implemented". That was not cosmetic — the trigger raises
-- inside the caller's transaction, so every insert into public.feedback was
-- rolled back. The Tell us box refusing every report is the exact failure this
-- whole design exists to make impossible, and it survived one round of testing
-- because the no-secret path returns before it ever reaches this line.
--
-- Hence the exception block as well. Being right once is not the same as being
-- safe: nothing that goes wrong on the way to an inbox may cost somebody the
-- report they took the trouble to write.
create or replace function public.notify_feedback()
returns trigger
language plpgsql
security definer
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

  if hook_secret is null then
    raise log 'notify_feedback: no feedback_hook_secret in vault, nothing sent';
    return new;
  end if;

  begin
    perform net.http_post(
      url := fn_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', hook_secret
      ),
      body := to_jsonb(new),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise log 'notify_feedback: could not queue the email: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists feedback_email on public.feedback;

-- AFTER, so a failure here can never roll back somebody's report.
create trigger feedback_email
  after insert on public.feedback
  for each row
  execute function public.notify_feedback();

revoke all on function public.notify_feedback() from public, anon, authenticated;
