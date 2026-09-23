-- WHO HAS PAID, written down where the relay can read it.
--
-- "Number one for the purchase check is the way to go — check on the server."
--
-- Every check on the unlock until now ran on hardware the customer owns: the
-- phone's mayDrive, and anything the computer app might do. Both can be edited
-- by somebody who wants to. The relay is the one piece that is not on their
-- machine — it is Supabase realtime, and a private channel's messages pass
-- through row-level security on realtime.messages before anybody sees them.
--
-- That security already exists: "own remote channel: read" and "own remote
-- channel: write" let an account use remote:<its own id> and nothing else. The
-- gate is one more condition on each — and this account has paid — and a
-- policy can only ask Postgres, so the answer has to live in Postgres. It lives
-- here.
--
-- WHAT KEEPS IT RIGHT, from two directions, so neither is a single point of
-- failure:
--
--   the webhook   RevenueCat calls supabase/functions/revenuecat-webhook on
--                 every purchase, refund and transfer, which re-reads the
--                 customer and writes the row. Fast, and needs nobody present.
--   the app       supabase/functions/entitlement, which the phone and the
--                 browser already call, writes the row on every definite
--                 answer. So a webhook that never arrived is healed the next
--                 time the paying customer opens the app.
--
-- Nothing reads this table yet. The relay policies that do are a separate
-- migration, applied only once this one is full — flipping them first would
-- lock every paying customer out of their own rig in the same second.

create table if not exists public.entitlements (
  account_id uuid primary key references auth.users (id) on delete cascade,
  active boolean not null,
  -- Where the answer came from: 'revenuecat' for a purchase, 'owner' for the
  -- accounts shared/owner-unlock.mjs names. Kept so a refund can never quietly
  -- revoke an owner, and an owner row can never be mistaken for a sale.
  source text not null check (source in ('revenuecat', 'owner')),
  updated_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;

-- Somebody may read their own row: the app can show what the relay believes.
-- Nobody may write one from a client. Only the two functions above, running
-- as service_role, which row-level security does not apply to.
drop policy if exists "own entitlement: read" on public.entitlements;
create policy "own entitlement: read"
  on public.entitlements for select to authenticated
  using (account_id = auth.uid());

-- THE ONE QUESTION THE RELAY ASKS.
--
-- security definer so it answers the same whoever is asking: a policy on
-- realtime.messages runs as the connecting user, and that user's own
-- row-level security must not be what decides whether their own row is
-- visible to the check that guards them.
--
-- search_path pinned, because a security definer function that resolves names
-- through the caller's path is a function the caller can redirect.
create or replace function public.is_entitled(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select active from public.entitlements where account_id = uid), false)
$$;

revoke all on function public.is_entitled(uuid) from public;
grant execute on function public.is_entitled(uuid) to authenticated, service_role;

-- HOW A ROW IS WRITTEN, in one place, so the two writers cannot disagree.
--
-- An owner row is sticky against a sale's answer: the owner list exists
-- precisely for accounts that have NOT bought the app, so RevenueCat saying
-- "not entitled" about one of them is true and irrelevant. A revenuecat write
-- therefore never touches an owner row; an owner write always wins. Taking
-- somebody off the owner list means deleting their row by hand, which is
-- rare enough to be worth the one line of SQL rather than a code path.
create or replace function public.record_entitlement(uid uuid, is_active boolean, from_source text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.entitlements as e (account_id, active, source, updated_at)
  values (uid, is_active, from_source, now())
  on conflict (account_id) do update
    set active = excluded.active, source = excluded.source, updated_at = now()
    where e.source <> 'owner' or excluded.source = 'owner'
$$;

-- service_role only. A client that could call this could unlock itself.
revoke all on function public.record_entitlement(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.record_entitlement(uuid, boolean, text) to service_role;
