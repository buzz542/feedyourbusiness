-- M3 hardening from the second review (docs/PLAN.md 2.3, 6.3, 7.2). Nothing here deletes data.

-- ---------------------------------------------------------------------------
-- Jobs: an abandoned lease is a failure; the purge and deletion sync go first
-- ---------------------------------------------------------------------------

-- A job still 'running' after its lease ran out was abandoned: the function running it crashed or
-- was killed. That counts as a failure in the same `failures` counter the runner keeps, and the
-- third failure ends the job, so one job that always crashes cannot take every run. The purge and
-- deletion sync are claimed before collect jobs (7.7: re-checks run before new collection).
create or replace function public.claim_jobs(p_now timestamptz, p_limit integer, p_lease_seconds integer)
returns setof public.jobs
language plpgsql
set search_path = ''
as $$
begin
  update public.jobs
     set status = 'failed',
         last_error = 'LeaseExpired',
         locked_until = null,
         finished_at = p_now,
         payload = payload || jsonb_build_object(
           'failures', coalesce((payload ->> 'failures')::integer, 0) + 1)
   where status = 'running'
     and locked_until < p_now
     and coalesce((payload ->> 'failures')::integer, 0) + 1 >= 3;

  return query
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_until = p_now + make_interval(secs => p_lease_seconds),
         payload = case
           when j.status = 'running' then j.payload || jsonb_build_object(
             'failures', coalesce((j.payload ->> 'failures')::integer, 0) + 1)
           else j.payload
         end
   where j.id in (
     select id from public.jobs
      where run_after <= p_now
        and (status in ('queued', 'waiting') or (status = 'running' and locked_until < p_now))
        and (locked_until is null or locked_until < p_now)
      order by case kind when 'purge' then 0 when 'deletion_sync' then 1 else 2 end, run_after
      limit p_limit
      for update skip locked
   )
  returning j.*;
end;
$$;

-- The monthly vendor cap is checked and consumed under one lock per source, so two products
-- reserving at once cannot both slip under it.
create or replace function public.reserve_job_budget(
  p_job_id uuid,
  p_product_id uuid,
  p_source text,
  p_day date,
  p_units integer,
  p_limit integer,
  p_monthly_cap integer default null,
  p_month_start date default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  current jsonb;
begin
  select payload into current from public.jobs where id = p_job_id for update;
  if current is null then
    raise exception 'no such job' using errcode = 'P0002';
  end if;
  if current ? 'reserved' then
    return 'already';
  end if;
  if p_monthly_cap is not null then
    perform pg_advisory_xact_lock(hashtext('vendor_monthly_cap:' || p_source));
    if public.vendor_usage(p_source, p_month_start) + p_units > p_monthly_cap then
      return 'monthly_cap';
    end if;
  end if;
  if not public.consume_budget(p_product_id, p_source, p_day, p_units, p_limit) then
    return 'refused';
  end if;
  update public.jobs
     set payload = payload || jsonb_build_object(
       'reserved', p_units, 'day', p_day, 'budget_product', p_product_id, 'budget_source', p_source)
   where id = p_job_id;
  return 'reserved';
end;
$$;

-- Settling refuses negative units, and adds an overrun (records used beyond the reservation) so
-- the monthly cap sees every record the vendor billed.
create or replace function public.settle_budget(
  p_product_id uuid,
  p_source text,
  p_day date,
  p_reserved integer,
  p_actual integer,
  p_cost_usd numeric
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_reserved < 0 or p_actual < 0 then
    raise exception 'units must not be negative' using errcode = '22023';
  end if;
  update public.usage_ledger
     set reads = greatest(0, reads - p_reserved + p_actual),
         cost_usd = cost_usd + greatest(0, p_cost_usd)
   where product_id = p_product_id and source = p_source and usage_date = p_day;
end;
$$;

create index jobs_product_id_idx on public.jobs (product_id);
create index usage_ledger_source_date_idx on public.usage_ledger (source, usage_date);

-- ---------------------------------------------------------------------------
-- Posts: reads exclude expired rows; retention cannot be extended; no Reddit profile posts
-- ---------------------------------------------------------------------------

-- 2.3.4: a post past delete_after is never readable, even before the daily purge removes it. RLS
-- conditions need no column privilege, so authenticated still cannot select delete_after.
alter policy posts_select_matched on public.posts
  using (
    posts.delete_after > now()
    and exists (
      select 1
      from public.product_posts pp
      join public.products p on p.id = pp.product_id
      where pp.post_id = posts.id and p.owner_id = (select auth.uid())
    )
  );

create function public.posts_keep_retention()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.collected_at is distinct from old.collected_at then
    raise exception 'retention: collected_at never changes' using errcode = '23514';
  end if;
  if new.delete_after > old.delete_after then
    raise exception 'retention: delete_after can only move earlier' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger posts_keep_retention
  before update on public.posts
  for each row execute function public.posts_keep_retention();

-- 2.3.7 and D5, enforced: a Reddit post from a user's profile carries the username.
alter table public.posts add constraint posts_reddit_no_profile check (
  source <> 'reddit'
  or ((community is null or community !~* '^r/u_') and url !~* '^https?://[^/]+/(user|u)/')
);

-- A post's collection is never dated in the future, whatever the caller passes, so retention
-- cannot start late.
create or replace function public.ingest_post(
  p_source text,
  p_external_id text,
  p_url text,
  p_excerpt text,
  p_posted_at timestamptz,
  p_author_hash text,
  p_community text,
  p_now timestamptz
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  stored uuid;
  collected timestamptz := least(p_now, now());
begin
  insert into public.posts
    (source, external_id, url, excerpt, posted_at, collected_at, delete_after, author_hash, community)
  select p_source, p_external_id, p_url, p_excerpt, p_posted_at, collected,
         collected + case when p_source in ('reddit', 'x') then interval '7 days' else interval '30 days' end,
         p_author_hash, p_community
  where not exists (
    select 1 from public.suppression s where s.author_hash = p_author_hash and s.source = p_source
  )
  on conflict (source, external_id) do nothing
  returning id into stored;
  if stored is not null then
    return stored;
  end if;
  -- Either the author is suppressed (null) or the post is already stored (its id).
  if exists (
    select 1 from public.suppression s where s.author_hash = p_author_hash and s.source = p_source
  ) then
    return null;
  end if;
  select id into stored from public.posts where source = p_source and external_id = p_external_id;
  return stored;
end;
$$;

-- ---------------------------------------------------------------------------
-- Purge: every closed removal request, 12 months after it was handled
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired(p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  expired integer;
  orphaned integer;
  old_jobs integer;
  old_events integer;
  old_removals integer;
  old_previews integer := 0;
begin
  delete from public.posts where delete_after <= p_now;
  get diagnostics expired = row_count;

  delete from public.posts p
   where p.collected_at < p_now - interval '1 day'
     and not exists (select 1 from public.product_posts pp where pp.post_id = p.id);
  get diagnostics orphaned = row_count;

  update public.themes t
     set example_post_ids = array(
       select e from unnest(t.example_post_ids) as e
       where exists (select 1 from public.posts p where p.id = e)
     )
   where exists (
     select 1 from unnest(t.example_post_ids) as e
     where not exists (select 1 from public.posts p where p.id = e)
   );
  if to_regclass('public.rival_insights') is not null then
    execute $q$
      update public.rival_insights r
         set example_post_ids = array(
           select e from unnest(r.example_post_ids) as e
           where exists (select 1 from public.posts p where p.id = e)
         )
       where exists (
         select 1 from unnest(r.example_post_ids) as e
         where not exists (select 1 from public.posts p where p.id = e)
       )
    $q$;
  end if;

  delete from public.jobs
   where status in ('done', 'failed') and finished_at < p_now - interval '30 days';
  get diagnostics old_jobs = row_count;

  delete from public.events where at < p_now - interval '13 months';
  get diagnostics old_events = row_count;

  delete from public.removal_requests
   where status in ('removed', 'rejected', 'closed') and handled_at < p_now - interval '12 months';
  get diagnostics old_removals = row_count;

  if to_regclass('public.preview_runs') is not null then
    execute 'delete from public.preview_runs where expires_at <= $1' using p_now;
    get diagnostics old_previews = row_count;
  end if;

  return jsonb_build_object(
    'posts_expired', expired,
    'posts_orphaned', orphaned,
    'jobs', old_jobs,
    'events', old_events,
    'removal_requests', old_removals,
    'preview_runs', old_previews
  );
end;
$$;

-- Replacing a function keeps its grants, and a new function starts with none for these roles.
revoke all on function public.posts_keep_retention() from public, anon, authenticated;
