-- What the agent knows about the person, kept with the account.
--
-- Two text fields per user, and nothing cleverer: `profile` is durable facts
-- they stated (name, role, people, ongoing projects) and `preferences` is how
-- they want the agent to behave (tone, length, format). Both travel with every
-- request and are prepended to the model's instructions — see api/_memory.js —
-- and both are editable in Setup, so the agent works on day one without
-- having to be told anything twice.
--
-- One row per person, like `chats`: read and written whole. The row is created
-- empty the first time a signed-in user appears (src/lib/memory.js), so there
-- is always a record to update.
create table if not exists public.user_memory (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  profile text not null default '',
  preferences text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.user_memory enable row level security;

drop policy if exists "own memory: read" on public.user_memory;
create policy "own memory: read" on public.user_memory
  for select using (user_id = auth.uid());

drop policy if exists "own memory: write" on public.user_memory;
create policy "own memory: write" on public.user_memory
  for insert with check (user_id = auth.uid());

drop policy if exists "own memory: update" on public.user_memory;
create policy "own memory: update" on public.user_memory
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own memory: delete" on public.user_memory;
create policy "own memory: delete" on public.user_memory
  for delete using (user_id = auth.uid());
