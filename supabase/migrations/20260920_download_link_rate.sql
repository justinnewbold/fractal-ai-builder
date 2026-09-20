-- One download-link email per address per window.
--
-- "Give them the website... and the option to email the link to them."
--
-- The function beside this (supabase/functions/download-link) is called by a
-- phone that has not signed in and may never make an account, so it cannot
-- demand a secret the way feedback-email does. Its protection is that the
-- message is fixed — nothing the caller types reaches the body — plus this:
-- an address can be sent that message once every few minutes and no more.
--
-- WHY THE COUNTER IS HERE AND NOT IN THE FUNCTION. Edge functions are many,
-- short-lived and independent. A counter held in one process is reset whenever
-- the platform recycles it and is invisible to every other copy, which is not
-- a rate limit, it is the appearance of one.
--
-- The address is stored hashed. This table is a list of people who asked for a
-- download link, which is worth nothing to us and something to somebody else;
-- the digest answers "have we seen this one lately" without keeping the
-- address itself. There is no feature that needs to read them back.

create table if not exists public.download_link_sends (
  -- sha256 of the lowercased address. Not the address.
  addr_hash text primary key,
  last_sent_at timestamptz not null default now(),
  -- How many times, ever. Only so a pattern is visible if this is ever abused.
  times integer not null default 1
);

alter table public.download_link_sends enable row level security;

-- No policies on purpose: with RLS on and no policy, nothing but `service_role`
-- returns a row.
--
-- The revoke below is the second lock, and it is not redundant. Supabase grants
-- anon and authenticated their usual privileges on a new table in `public`, so
-- the only thing standing between the public anon key and this list was "there
-- happens to be no policy yet". One permissive policy added later for some
-- other reason and the list is readable. Taking the grant away means a policy
-- alone cannot open it.
revoke all on table public.download_link_sends from anon, authenticated;

comment on table public.download_link_sends is
  'Rate limiting for the download-link edge function. Hashed addresses only.';

-- Claim a send, or refuse it.
--
-- Returns true when the caller may send, false when the address has had one
-- inside the window. It WRITES on the allowed path, so asking is claiming:
-- two requests arriving together cannot both be told yes, which a
-- read-then-write pair in the function would allow.
create or replace function public.note_download_link(addr text, every_minutes integer default 10)
returns boolean
language plpgsql
security definer
-- Empty, and every name qualified below. A security-definer function that
-- inherits the caller's search_path can be pointed at a different `digest` or
-- a different table; the neighbouring feedback trigger is written the same way
-- and for the same reason. pgcrypto lives in `extensions` on Supabase, not in
-- public, so the digest call has to say so.
set search_path = ''
as $$
declare
  key text;
  allowed boolean;
begin
  if addr is null or length(addr) = 0 then
    return false;
  end if;

  key := encode(extensions.digest(lower(trim(addr)), 'sha256'), 'hex');

  insert into public.download_link_sends as d (addr_hash)
  values (key)
  on conflict (addr_hash) do update
    -- Only moves the clock when the window has passed. The `where` is what
    -- makes this atomic: a conflicting row inside the window updates nothing.
    set last_sent_at = now(),
        times = d.times + 1
    where d.last_sent_at < now() - make_interval(mins => greatest(1, every_minutes))
  returning true into allowed;

  -- No row came back means the update was skipped, which means too soon.
  return coalesce(allowed, false);
end;
$$;

revoke all on function public.note_download_link(text, integer) from public, anon, authenticated;
grant execute on function public.note_download_link(text, integer) to service_role;
