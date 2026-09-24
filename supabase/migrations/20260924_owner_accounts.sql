-- EVERYONE WITH AN ACCOUNT, for Justin's owner tools.
--
-- "How do I see a list of who has set up an account?" The answer was the
-- Supabase dashboard, which is the wrong place to send him. This is the list
-- the Everyone with an account page reads, through grant-access, behind the
-- same lock as the rest of those tools.
--
-- The newest 500, which is every account there is today many times over; the
-- page says when there are more. Plus the waiting list, so an address he gave
-- access to before its owner signed up is on the same screen.
--
-- service_role only, like owner_overview: no client can call it.
create or replace function public.owner_accounts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from auth.users),
    'accounts', coalesce((
      select jsonb_agg(a order by a->>'signed_up' desc)
      from (
        select jsonb_build_object(
          'email', u.email,
          'signed_up', u.created_at,
          'confirmed', u.email_confirmed_at is not null,
          'last_sign_in', u.last_sign_in_at,
          'unlocked', coalesce(e.active, false),
          'source', case when coalesce(e.active, false) then e.source end
        ) as a
        from auth.users u
        left join public.entitlements e on e.account_id = u.id
        order by u.created_at desc
        limit 500
      ) newest
    ), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object('email', w.email, 'added', w.added_at) order by w.added_at desc)
      from public.waiting_grants w
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.owner_accounts() from public, anon, authenticated;
grant execute on function public.owner_accounts() to service_role;
