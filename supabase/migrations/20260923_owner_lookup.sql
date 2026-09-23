-- WHAT JUSTIN'S TOOLS NEED TO SEE, for Customer lookup and Sales at a glance.
--
-- "Do number one and five for now." Number one was: Check also shows when they
-- signed up, whether they paid or were given access, which devices they've
-- signed in on, when they were last on. Number five: purchases today, this
-- week and all time, with a count per platform.
--
-- Both answers live partly here — the account, its sessions, the relay's
-- table — and partly in RevenueCat, which supabase/functions/grant-access asks
-- for the rest. These two functions are the database's half.
--
-- service_role only, like account_for_email: the function calls them after
-- checking, from a signed token, that the caller is the one account allowed
-- to. No client can reach either.

-- ONE ACCOUNT, BY EMAIL. Null when nobody uses the address.
--
-- A device is a session's user agent, sorted into the few things it can be:
--
--   node          the computer app's device server (Mac or Windows)
--   electron      the computer app's own window
--   okhttp        the Android app
--   CFNetwork     the iPhone app ("FractalRemote/18 CFNetwork/… Darwin/…")
--   Mozilla …     the website, in whichever browser the parentheses name
create or replace function public.account_details(address text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'signed_up', u.created_at,
    'confirmed', u.email_confirmed_at,
    'last_sign_in', u.last_sign_in_at,
    'unlock', (
      select jsonb_build_object('active', e.active, 'source', e.source, 'at', e.updated_at)
      from public.entitlements e where e.account_id = u.id
    ),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'last_seen', d.last_seen) order by d.last_seen desc)
      from (
        select
          case
            when s.user_agent like 'node%' then 'computer'
            when s.user_agent ilike '%electron%' then 'computer'
            when s.user_agent ilike '%okhttp%' then 'android-app'
            when s.user_agent ilike '%cfnetwork%' or s.user_agent ilike 'fractalremote%' then 'iphone-app'
            when s.user_agent ilike '%android%' then 'web-android'
            when s.user_agent ilike '%iphone%' or s.user_agent ilike '%ipad%' then 'web-iphone'
            when s.user_agent ilike '%macintosh%' then 'web-mac'
            when s.user_agent ilike '%windows%' then 'web-windows'
            when s.user_agent ilike '%mozilla%' then 'web-other'
            else 'unknown'
          end as kind,
          max(coalesce(s.refreshed_at, s.updated_at, s.created_at)) as last_seen
        from auth.sessions s
        where s.user_id = u.id
        group by 1
      ) d
    ), '[]'::jsonb)
  )
  from auth.users u
  where lower(u.email) = lower(trim(address))
  limit 1
$$;

revoke all on function public.account_details(text) from public, anon, authenticated;
grant execute on function public.account_details(text) to service_role;

-- THE WHOLE SHOP, IN ONE ANSWER: how many accounts, and every account the
-- relay's table holds as unlocked by RevenueCat. The function asks RevenueCat
-- about each of those for what was bought, where and when — a sale is
-- RevenueCat's to report, the table only says whom to ask.
--
-- Unlocked ones only. The table also holds a "no" for everybody who opened the
-- app signed in without buying, and asking RevenueCat about every one of them
-- would be most of the calls for none of the sales. A refund drops out the
-- same way: it is no longer an unlock.
create or replace function public.owner_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'accounts_day', (select count(*) from auth.users where created_at > now() - interval '1 day'),
    'accounts_week', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'buyers', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.account_id, 'email', u.email, 'active', e.active) order by e.updated_at desc)
      from public.entitlements e
      join auth.users u on u.id = e.account_id
      where e.source = 'revenuecat' and e.active
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.owner_overview() from public, anon, authenticated;
grant execute on function public.owner_overview() to service_role;
