-- What a band plays, kept once it has been found out.
--
-- "Isn't there a band database we can download and have in the app to look up
-- most of the info and save some tokens?"
--
-- There isn't one, and that is worth writing down because it sounds like the
-- kind of thing that must exist. MusicBrainz, Discogs and Wikidata are
-- enormous and carry releases, credits and personnel — none of them carry what
-- amp anybody played. Equipboard really is that database and publishes no API
-- and no export. So the fact has to be found out each time, and the only thing
-- the app can do about it is find it out ONCE.
--
-- Which turns out to be most of what a download would have bought. A band's
-- rig does not change between Tuesday and Wednesday. The second request for
-- them costs no searching, no tokens and no waiting — and by the tenth band
-- this table IS the downloadable database, built out of answers the app
-- actually used.
--
-- Per account rather than shared, which is the same rule every other table
-- here follows. It is knowledge rather than anybody's work, so sharing it
-- would cost nothing and save a little; keeping it per account costs one
-- lookup per band per person and needs no rules about who may write what.
create table if not exists public.rig_lookups (
  -- "<user>:<artist>:<songs>", made by the client, so writing the same band
  -- again updates the row rather than laying down a second copy of it.
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- The band, as the lookup itself named it on its first line. This is the key
  -- a later request is found by: the name appearing in what somebody typed is
  -- what counts as asking about them again.
  artist text not null,
  -- How many songs were researched. Part of the key because a briefing built
  -- for four songs cannot answer a request for eight — the other four were
  -- never looked up — while four can answer three.
  songs integer not null default 0,
  -- The briefing itself, as it went to the designer.
  rig text not null,
  updated_at timestamptz not null default now()
);

create index if not exists rig_lookups_user_artist
  on public.rig_lookups (user_id, artist);

alter table public.rig_lookups enable row level security;

drop policy if exists "own rigs: read" on public.rig_lookups;
create policy "own rigs: read" on public.rig_lookups
  for select using (user_id = auth.uid());

drop policy if exists "own rigs: write" on public.rig_lookups;
create policy "own rigs: write" on public.rig_lookups
  for insert with check (user_id = auth.uid());

drop policy if exists "own rigs: update" on public.rig_lookups;
create policy "own rigs: update" on public.rig_lookups
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A band really can change rig, and a briefing that has gone stale is worse
-- than none — so it has to be possible to throw one out.
drop policy if exists "own rigs: delete" on public.rig_lookups;
create policy "own rigs: delete" on public.rig_lookups
  for delete using (user_id = auth.uid());
