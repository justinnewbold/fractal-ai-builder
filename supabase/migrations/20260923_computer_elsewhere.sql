-- WHEN THE COMPUTER IS SIGNED INTO A DIFFERENT ACCOUNT, SAY SO.
--
-- "The issue it wasn't connecting is because I was signed into the wrong
-- account, but it didn't notify me at all, and that's why it wasn't
-- connecting. Please be clear which account needs to be trying to sign into,
-- or which one it is signing into, and they don't match somehow."
--
-- The phone and the computer meet on a channel named for the account, so a
-- phone on one account and a computer on another never hear each other at all
-- — and to the phone that silence looks exactly like a computer that is off.
-- Nothing on the relay can tell the two apart.
--
-- The account server can. The computer's device server keeps a session of its
-- own (user agent "node", refreshed about hourly while it runs), and every
-- session records the address it was made from. So: is there a device server,
-- active lately, at the same address as the caller — the same wifi — signed
-- into an account that is not the caller's?
--
-- YES OR NO, AND NOTHING ELSE. Not which account, not even part of its email:
-- a caller learns only that some computer behind their own address is on
-- another account, which is all the phone needs to say "they don't match".
-- The phone already names its own account; the computer's own screen names
-- the computer's.
--
-- THE ADDRESS is taken two ways and either will do: the one this request came
-- from, and the one the caller's own session was last refreshed from — the
-- second is recorded by the same service, in the same form, as the computer's.
--
-- Checked against the live sessions when it went in, as the phone that night
-- (the icloud account at home: yes), the phone once switched to the computer's
-- account (no), and the icloud phone away from home (no).

drop function if exists public.computer_elsewhere();

create or replace function public.computer_elsewhere()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select
      auth.uid() as uid,
      nullif(trim(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1)), '') as asked_from,
      (select host(s.ip) from auth.sessions s
         where s.id = nullif(auth.jwt()->>'session_id', '')::uuid) as session_from
  ),
  mine as (
    -- The caller's own computer on this network, when it was last heard from.
    select max(coalesce(s.refreshed_at, s.updated_at)) as at
    from auth.sessions s, me
    where s.user_id = me.uid
      and s.user_agent like 'node%'
      and host(s.ip) in (me.asked_from, me.session_from)
  )
  select exists (
    select 1
    from auth.sessions s, me, mine
    where me.uid is not null
      and s.user_id <> me.uid
      and s.user_agent like 'node%'
      and host(s.ip) in (me.asked_from, me.session_from)
      -- A running device server refreshes about hourly; a Mac asleep since
      -- yesterday is not the reason for tonight's silence.
      and coalesce(s.refreshed_at, s.updated_at) > now() - interval '90 minutes'
      -- And newer than the caller's own computer here, which would otherwise
      -- be the better explanation.
      and (mine.at is null or coalesce(s.refreshed_at, s.updated_at) > mine.at)
  )
$$;

revoke all on function public.computer_elsewhere() from public, anon;
grant execute on function public.computer_elsewhere() to authenticated;
