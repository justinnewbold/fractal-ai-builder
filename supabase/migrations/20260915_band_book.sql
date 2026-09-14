-- A band's finished tone, kept so the next request for them costs nothing.
--
-- rig_lookups keeps what was LOOKED UP about a band. This keeps what was
-- DESIGNED for them: the whole checked tone — model per block, every value,
-- every scene — written by block family and control name rather than by
-- effect id, so it rebuilds onto any preset on any unit in the family. The
-- next request naming the band is built from this row with no model asked.
-- See src/lib/bandBook.js.
--
-- Per account, as every other table here is.
create table if not exists public.band_book (
  -- "<user>:<artist>:<scenes>", made by the client, so designing the same
  -- band at the same size again updates the row rather than adding one.
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- The band, as the designer named it. A later request is found by this
  -- name appearing in what somebody typed.
  artist text not null,
  -- How many scenes the design holds. A four-scene design cannot answer for
  -- eight; it can answer for three.
  songs integer not null default 0,
  -- Which unit it was designed on, for the record. Not part of the key.
  device text,
  -- The design itself, in the portable shape bandBook.js writes.
  design jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists band_book_user_artist
  on public.band_book (user_id, artist);

alter table public.band_book enable row level security;

drop policy if exists "own book: read" on public.band_book;
create policy "own book: read" on public.band_book
  for select using (user_id = auth.uid());

drop policy if exists "own book: write" on public.band_book;
create policy "own book: write" on public.band_book
  for insert with check (user_id = auth.uid());

drop policy if exists "own book: update" on public.band_book;
create policy "own book: update" on public.band_book
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own book: delete" on public.band_book;
create policy "own book: delete" on public.band_book
  for delete using (user_id = auth.uid());
