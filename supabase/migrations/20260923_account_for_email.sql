-- WHICH ACCOUNT AN EMAIL BELONGS TO, for the one tool that needs to ask.
--
-- supabase/functions/grant-access gives somebody the unlock by hand, and it is
-- told an email — which is what a customer writing in knows — while RevenueCat
-- knows the account by its id. This is the bridge.
--
-- service_role only: the function calls it after checking, from a signed
-- token, that the caller is the one account allowed to. No client can reach
-- it, so it cannot be used to find out whether an address has an account.

create or replace function public.account_for_email(address text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(address)) limit 1
$$;

revoke all on function public.account_for_email(text) from public, anon, authenticated;
grant execute on function public.account_for_email(text) to service_role;
