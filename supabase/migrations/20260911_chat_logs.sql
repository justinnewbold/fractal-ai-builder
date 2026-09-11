-- Past conversations, kept with the account.
--
-- "Can we create a way to create a fresh chat? ... Also make it so you can see
-- previous chats and that those always get saved to the cloud if signed in."
--
-- `chats` (20260906) is deliberately one row per person: the single running
-- transcript, the same on the phone as on the Mac. That is still exactly what
-- it is. This is the other thing — the conversations that have been finished
-- and put down, so starting a fresh one does not throw the last one away.
--
-- One row per conversation here, because that is what a list of past chats is.
-- The two tables do not overlap: `chats` is where the live transcript syncs,
-- this is where a closed one goes.
create table if not exists public.chat_logs (
  -- Made by the client, so the same conversation keeps one identity whether it
  -- was first written here or in browser storage before anyone signed in.
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- What the list shows: the first thing the player said, trimmed. Stored
  -- rather than derived so the list does not have to open every transcript.
  title text,
  -- The turns as the app shapes them: {role, text, ...}. Whole, like `chats` —
  -- a transcript is read and written whole and is small.
  turns jsonb not null default '[]'::jsonb,
  device text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_logs_user_updated
  on public.chat_logs (user_id, updated_at desc);

alter table public.chat_logs enable row level security;

drop policy if exists "own chat log: read" on public.chat_logs;
create policy "own chat log: read" on public.chat_logs
  for select using (user_id = auth.uid());

drop policy if exists "own chat log: write" on public.chat_logs;
create policy "own chat log: write" on public.chat_logs
  for insert with check (user_id = auth.uid());

drop policy if exists "own chat log: update" on public.chat_logs;
create policy "own chat log: update" on public.chat_logs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Unlike `chats`, this one deletes. A past conversation is a thing in a list
-- somebody browses, and a list you cannot throw anything out of fills up.
drop policy if exists "own chat log: delete" on public.chat_logs;
create policy "own chat log: delete" on public.chat_logs
  for delete using (user_id = auth.uid());
