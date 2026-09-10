-- Setlists and stars, kept with the account rather than with the browser.
--
-- "This says that setlists stay in this browser. Can we set that up to save to
-- the database across the cloud if user is signed in?"
--
-- One row per person, like chats, and for the same reason: this is read and
-- written whole. `units` is keyed by the unit the app is talking to — an FM3's
-- setlists are not an AM4's — and each entry holds that unit's lists, the stars,
-- which of them Previous and Next are stepping through, and the deletes it is
-- still remembering so a setlist removed on the phone does not come back from
-- the Mac.
--
-- Deliberately NOT the recent list. Which presets this phone played tonight is
-- about this phone; syncing it would have two devices overwriting each other
-- all evening with nothing gained.
--
-- Privacy is this file's job. RLS is on and every policy is keyed to auth.uid(),
-- matching presets, scene_names and chats.

create table if not exists public.stage_lists (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  -- { "<unit>": { lists: [{id,name,presets,at}], removed: [{id,at}],
  --               favourites: [int], starredAt: ms, source: text, at: ms } }
  units jsonb not null default '{}'::jsonb,
  -- Which device wrote it last, so "picked up from your Mac" can name it.
  device text,
  updated_at timestamptz not null default now()
);

alter table public.stage_lists enable row level security;

drop policy if exists "own stage lists: read" on public.stage_lists;
create policy "own stage lists: read" on public.stage_lists
  for select using (user_id = auth.uid());

drop policy if exists "own stage lists: write" on public.stage_lists;
create policy "own stage lists: write" on public.stage_lists
  for insert with check (user_id = auth.uid());

drop policy if exists "own stage lists: update" on public.stage_lists;
create policy "own stage lists: update" on public.stage_lists
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No delete policy, for the same reason chats has none: clearing everything is
-- an update to an empty object, and removing the row would only make the next
-- write decide between insert and update for no gain.
