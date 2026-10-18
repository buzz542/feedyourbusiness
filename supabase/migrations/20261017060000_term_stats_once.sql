-- M3 collect step (docs/PLAN.md 7.3 step 9): a collect job adds its per-term counts to term_stats
-- exactly once. The job's own row records that it did, in the same statement, so a job that crashes
-- after writing them and runs again never counts twice. Counts from different jobs add up.

create function public.record_term_stats(
  p_job_id uuid,
  p_day date,
  p_source text,
  p_stats jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  marked uuid;
begin
  update public.jobs
     set payload = payload || '{"stats_recorded": true}'::jsonb
   where id = p_job_id
     and coalesce((payload ->> 'stats_recorded')::boolean, false) = false
  returning id into marked;
  if marked is null then
    return false;
  end if;

  insert into public.term_stats as ts (term_id, source, day, fetched, relevant)
  select (e ->> 'term_id')::uuid, p_source, p_day, (e ->> 'fetched')::integer,
         (e ->> 'relevant')::integer
    from jsonb_array_elements(p_stats) as e
   -- A term the owner deleted since the run started is skipped.
   where exists (select 1 from public.search_terms t where t.id = (e ->> 'term_id')::uuid)
  on conflict (term_id, source, day) do update
     set fetched = ts.fetched + excluded.fetched,
         relevant = ts.relevant + excluded.relevant;
  return true;
end;
$$;

revoke all on function public.record_term_stats(uuid, date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_term_stats(uuid, date, text, jsonb) to service_role;
