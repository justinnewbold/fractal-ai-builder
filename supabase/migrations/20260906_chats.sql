-- The conversation, kept with the account rather than with the browser.
--
-- "Also chats should persist and save across the cloud when signed in."
--
-- One row per person, not one per conversation. The app has a single running
-- transcript — the thing on the Ask screen — and what somebody wants from this
-- is for that transcript to be the same on the phone as it was on the Mac, not
-- a filing system of past chats. A table with one row per user says exactly
-- that and cannot drift into meaning anything else.
--
-- Privacy is this file's job. RLS is on and every policy is keyed to
-- auth.uid(), matching presets and scene_names, so a client asking for someone
-- else's transcript receives none — by policy, not by the query being polite.

create table if not exists public.chats (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  -- The turns as the app already shapes them: {role, text, ...}. Stored whole
  -- rather than one row per turn, because it is only ever read and written
  -- whole, and a transcript is small.
  turns jsonb not null default '[]'::jsonb,
  -- Which device wrote it last. Not used to resolve anything — the newest write
  -- wins — but it is what makes "why did my chat change?" answerable at all.
  device text,
  updated_at timestamptz not null default now()
);

alter table public.chats enable row level security;

drop policy if exists "own chat: read" on public.chats;
create policy "own chat: read" on public.chats
  for select using (user_id = auth.uid());

drop policy if exists "own chat: write" on public.chats;
create policy "own chat: write" on public.chats
  for insert with check (user_id = auth.uid());

drop policy if exists "own chat: update" on public.chats;
create policy "own chat: update" on public.chats
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Deliberately no delete policy. Clearing the chat writes an empty transcript,
-- which is a normal update; removing the row would only make the next write
-- have to decide whether to insert or update, for no gain.
