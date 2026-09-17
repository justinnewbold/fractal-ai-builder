-- The account row tidies its own delete-marks, whatever writes it.
--
-- WHAT THIS IS FOR. One setlist deleted once became 109,508 delete-marks and
-- five megabytes of JSON, read and written back by every device every few
-- seconds, which spent the project's disk allowance and took the database
-- down (7.271.0 says how). The app was fixed the same day — and the row was
-- back to 131,072 marks within hours, written by a phone still on 7.268.0.
-- Every device that has not been updated carries the pile and pushes it
-- straight back up, and nothing the fixed app does can stop it: the phone
-- writes last.
--
-- So the row defends itself. Before every insert and update, each unit's
-- `removed` list is reduced to ONE mark per setlist id — the latest delete
-- wins, exactly as the app's cleanGoneList decides — and marks older than the
-- sixty days the app remembers a delete for are dropped. Sorted the way the
-- app sorts them (newest first, then id), so a fixed device reading the row
-- back finds it equal to what it would have written and writes nothing.
--
-- NEVER REFUSES A WRITE. A row this trigger could not tidy is written as it
-- came: the app treats a failed sync as "try again later", silently, and a
-- guard that turned the sync off would be worse than the pile.

create or replace function public.stage_lists_tidy_removed(units jsonb)
returns jsonb
language sql
stable
as $$
  select case
    when jsonb_typeof(units) = 'object' then coalesce((
      select jsonb_object_agg(k,
        case when jsonb_typeof(v) = 'object' and jsonb_typeof(v->'removed') = 'array' then
          jsonb_set(v, '{removed}', coalesce((
            select jsonb_agg(jsonb_build_object('id', d.id, 'at', d.at) order by d.at desc, d.id)
            from (
              select g->>'id' as id, max((g->>'at')::numeric) as at
              from jsonb_array_elements(v->'removed') g
              where jsonb_typeof(g->'id') = 'string'
                and jsonb_typeof(g->'at') = 'number'
                and (g->>'at')::numeric > extract(epoch from now()) * 1000 - 60.0 * 24 * 60 * 60 * 1000
              group by g->>'id'
            ) d
          ), '[]'::jsonb))
        else v end)
      from jsonb_each(units) as e(k, v)
    ), '{}'::jsonb)
    else units
  end
$$;

create or replace function public.stage_lists_tidy()
returns trigger
language plpgsql
as $$
begin
  begin
    new.units := public.stage_lists_tidy_removed(new.units);
  exception when others then
    -- Written as it came. See the note at the top.
    null;
  end;
  return new;
end
$$;

drop trigger if exists stage_lists_tidy on public.stage_lists;
create trigger stage_lists_tidy
  before insert or update on public.stage_lists
  for each row execute function public.stage_lists_tidy();
