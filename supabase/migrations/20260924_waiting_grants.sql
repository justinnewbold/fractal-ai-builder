-- GIVE ACCESS TO SOMEBODY WHO HAS NOT SIGNED UP YET.
--
-- "So I can't give access to someone until after they have created an account
-- themselves?" He could not: an unlock is attached to an account, and Give
-- access answered "no account uses that address" and did nothing. A tester is
-- somebody he invites BEFORE they have the app, so the order was backwards.
--
-- Now an address with no account goes on this list instead. The first time
-- that person signs in, the app asks the entitlement function whether they are
-- unlocked — it already does, on every sign-in, on the phone and the computer —
-- and that function sees the address waiting and has grant-access unlock it.
--
-- WHY THE SIGN-IN AND NOT A TRIGGER ON SIGN-UP. The signed-in person's own
-- token is the proof of which address they own, verified by Supabase, so the
-- claim needs no shared secret and nothing runs inside the sign-up itself. And
-- a sign-up is not yet a confirmed address; a sign-in is.
--
-- Service role only, like everything else behind Give access: no client reads
-- or writes the list.

create table if not exists public.waiting_grants (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  added_at timestamptz not null default now()
);

alter table public.waiting_grants enable row level security;
revoke all on table public.waiting_grants from public, anon, authenticated;
grant all on table public.waiting_grants to service_role;

-- Put an address on the list. Adding it twice keeps the first date.
create or replace function public.wait_for_grant(address text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.waiting_grants (email) values (lower(btrim(address)))
  on conflict (email) do nothing
$$;

-- Whether an address is waiting.
create or replace function public.is_waiting_grant(address text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.waiting_grants where email = lower(btrim(address)))
$$;

-- Take an address off the list. True when it was on it.
create or replace function public.drop_waiting_grant(address text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.waiting_grants where email = lower(btrim(address));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.wait_for_grant(text) from public, anon, authenticated;
revoke all on function public.is_waiting_grant(text) from public, anon, authenticated;
revoke all on function public.drop_waiting_grant(text) from public, anon, authenticated;
grant execute on function public.wait_for_grant(text) to service_role;
grant execute on function public.is_waiting_grant(text) to service_role;
grant execute on function public.drop_waiting_grant(text) to service_role;
