-- M3 collection (docs/PLAN.md 6.3, 7.2, 7.3, 7.7): posts from every collect source, jobs, budgets,
-- ingest, term stats, term rotation, the Reddit deletion re-check lists and purge.
--
--   * Retention by source (D4: 7 days for Reddit and X, 30 for the rest), enforced by a check; it is
--     never extended (a trigger refuses a later delete_after or a changed collected_at), and reads
--     exclude rows past delete_after before the purge removes them (2.3.4).
--   * No author handle, ever (D5), and no Reddit post from a user's profile (2.3.7).
--   * The suppression list is checked in the same statement that inserts (ingest_post, 2.3.5).
--   * Jobs: claimed with skip locked; the purge and deletion sync first (7.7: re-checks run before
--     new collection); an abandoned lease counts as a failure and the third one ends the job.
--   * Budgets: reserved and settled once per job, inside the job's own row lock, so a crash and a
--     re-run never charge twice; the vendor's monthly cap is checked under one lock per source.
--   * Term stats are recorded once per job; terms rotate least recently collected first.
--
-- Every function here is for the service role only. Nothing here deletes existing data.
-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------

alter table public.posts drop constraint posts_source_check;
alter table public.posts add constraint posts_source_check
  check (source in ('hackernews', 'bluesky', 'reddit', 'x'));
alter table public.posts add constraint posts_retention_by_source check (
  delete_after <= collected_at + case when source in ('reddit', 'x')
    then interval '7 days' else interval '30 days' end);   -- D4
alter table public.posts add column community text check (char_length(community) <= 100);
-- D5, enforced: no handle is ever stored.
alter table public.posts add constraint posts_no_author_handle check (author_handle is null);
-- Customers see a post's content, never its author hash (which would link one author's posts).
revoke select on public.posts from authenticated;
grant select (id, source, url, excerpt, posted_at, collected_at, community)
  on public.posts to authenticated;


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
  or (community ~ '^r/[A-Za-z0-9_]{2,21}$'
      and community !~* '^r/u_'
      and url !~* '^https://[^/]+/(user|u)/'
      and url !~* '^https://[^/]+/r/u_')
);

create index posts_source_collected_idx on public.posts (source, collected_at);

-- ---------------------------------------------------------------------------
-- jobs and term stats
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('collect', 'deletion_sync', 'purge', 'synthesize',
    'digest_daily', 'digest_weekly', 'first_run')),
  product_id uuid references public.products (id) on delete cascade,
  source text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting', 'done', 'failed')),
  payload jsonb not null default '{}'
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192),
  attempts smallint not null default 0,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  -- An error class name only (TypeError, LeaseExpired, monthly_cap), never a message (2.3.10).
  last_error text check (last_error ~ '^[A-Za-z][A-Za-z0-9_]{0,119}$'),
  dedupe_key text unique,                                   -- e.g. collect:<product>:<source>:<utc day>
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_due_idx on public.jobs (status, run_after);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create table public.term_stats (
  term_id uuid not null references public.search_terms (id) on delete cascade,
  source text not null,
  day date not null,
  fetched integer not null default 0 check (fetched >= 0),
  relevant integer not null default 0 check (relevant >= 0),
  primary key (term_id, source, day)
);

revoke all on public.jobs from anon, authenticated;
alter table public.jobs enable row level security;
create policy jobs_deny_all on public.jobs
  for all to anon, authenticated using (false) with check (false);

revoke all on public.term_stats from anon, authenticated;
alter table public.term_stats enable row level security;
grant select on public.term_stats to authenticated;
create policy term_stats_select_own on public.term_stats
  for select to authenticated
  using (
    exists (
      select 1 from public.search_terms t
      join public.products p on p.id = t.product_id
      where t.id = term_stats.term_id and p.owner_id = (select auth.uid())
    )
  );

create index jobs_product_id_idx on public.jobs (product_id);
create index usage_ledger_source_date_idx on public.usage_ledger (source, usage_date);

-- ---------------------------------------------------------------------------
-- Functions, for the service role only
-- ---------------------------------------------------------------------------

-- Stores one post, or returns null without storing it when the author is suppressed for this
-- source. On a repeat (same source and external id) it changes nothing and returns the stored id,
-- so retention is never extended. Collection is never dated later than the database clock, so
-- retention cannot start late whatever the caller passes.
create function public.ingest_post(
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
  -- An existing post past its retention is never linked again (2.3.4): the purge will remove it.
  select id into stored from public.posts
   where source = p_source and external_id = p_external_id and delete_after > collected;
  return stored;
end;
$$;

-- Claims due jobs for one runner: queued or waiting jobs whose time has come, and running jobs whose
-- lease ran out (a run that crashed). Skips rows another runner holds, so two runners never take
-- the same job. An abandoned lease counts as a failure in the same `failures` counter the runner
-- keeps; the third ends the job. Returned in claim order: the purge, then deletion sync, then the
-- rest.
create function public.claim_jobs(p_now timestamptz, p_limit integer, p_lease_seconds integer)
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

  -- Returned in claim order, which the runner works through: the purge first.
  return query
  with claimed as (
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
  returning j.*
  )
  select * from claimed
   order by case claimed.kind when 'purge' then 0 when 'deletion_sync' then 1 else 2 end,
            claimed.run_after;
end;
$$;

-- Ends a job (done or failed) or reschedules it (queued or waiting, with a new run_after). The
-- payload is merged, never replaced, so a checkpoint the job wrote while running (its budget
-- reservation) survives a runner that only knew the payload it claimed.
create function public.finish_job(
  p_id uuid,
  p_status text,
  p_error_class text default null,
  p_payload jsonb default null,
  p_run_after timestamptz default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- 'running' would leave a job no claim can take; only a running job can be finished, so a runner
  -- whose lease ran out cannot finish or revive a job another runner reclaimed or the sweep failed.
  if p_status is null or p_status not in ('queued', 'waiting', 'done', 'failed') then
    raise exception 'finish_job: status must be queued, waiting, done or failed' using errcode = '22023';
  end if;
  update public.jobs
     set status = p_status,
         last_error = p_error_class,
         payload = payload || coalesce(p_payload, '{}'::jsonb),
         run_after = coalesce(p_run_after, run_after),
         locked_until = null,
         finished_at = case when p_status in ('done', 'failed') then now() else null end
   where id = p_id and status = 'running';
end;
$$;

-- Reserves units against a per-product daily limit, atomically: true only when the reservation
-- fits. The row lock taken by the upsert serializes concurrent reservations.
create function public.consume_budget(
  p_product_id uuid,
  p_source text,
  p_day date,
  p_units integer,
  p_limit integer
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  reserved integer;
begin
  if p_units < 0 then
    raise exception 'units must not be negative' using errcode = '22023';
  end if;
  insert into public.usage_ledger (product_id, source, usage_date, reads)
  values (p_product_id, p_source, p_day, 0)
  on conflict (product_id, source, usage_date) do nothing;

  update public.usage_ledger
     set reads = reads + p_units
   where product_id = p_product_id and source = p_source and usage_date = p_day
     and reads + p_units <= p_limit
  returning reads into reserved;
  return reserved is not null;
end;
$$;

-- After the call: gives back the units reserved but not used and adds the actual cost. An overrun
-- (records used beyond the reservation) is added, so the monthly cap sees every record billed.
create function public.settle_budget(
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
  if p_reserved is null or p_actual is null or p_reserved < 0 or p_actual < 0 then
    raise exception 'units must be given and not negative' using errcode = '22023';
  end if;
  update public.usage_ledger
     set reads = greatest(0, reads - p_reserved + p_actual),
         cost_usd = cost_usd + greatest(0, p_cost_usd)
   where product_id = p_product_id and source = p_source and usage_date = p_day;
end;
$$;

-- Records a source used this month across every product (the vendor's monthly cap).
create function public.vendor_usage(p_source text, p_month_start date)
returns integer
language sql
stable
strict
set search_path = ''
as $$
  select coalesce(sum(reads), 0)::integer
  from public.usage_ledger
  where source = p_source and usage_date >= p_month_start
$$;

-- A collect job's budget, reserved exactly once per job: the reservation is written into the job's
-- payload in the same transaction that consumes the budget, so a job that crashes and runs again
-- finds it already reserved. Returns 'reserved', 'already', 'refused' (over the product's daily
-- limit) or 'monthly_cap' (over the vendor's monthly records across all products, when
-- p_monthly_cap is set, counted over the calendar month of p_day; checked under one lock per source
-- so two products cannot both slip under).
create function public.reserve_job_budget(
  p_job_id uuid,
  p_product_id uuid,
  p_source text,
  p_day date,
  p_units integer,
  p_limit integer,
  p_monthly_cap integer default null
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
  if p_day is null or p_units is null or p_limit is null then
    raise exception 'day, units and limit are required' using errcode = '22023';
  end if;
  if current ? 'reserved' then
    return 'already';
  end if;
  if p_monthly_cap is not null then
    perform pg_advisory_xact_lock(hashtext('vendor_monthly_cap:' || p_source));
    if public.vendor_usage(p_source, date_trunc('month', p_day)::date) + p_units > p_monthly_cap then
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

-- Gives back what the job reserved but did not use, and adds the cost, once. False when there is
-- nothing to settle (no reservation, or already settled).
create function public.settle_job_budget(p_job_id uuid, p_actual integer, p_cost_usd numeric)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  current jsonb;
begin
  select payload into current from public.jobs where id = p_job_id for update;
  if current is null or not (current ? 'reserved') or current ? 'settled' then
    return false;
  end if;
  perform public.settle_budget(
    (current ->> 'budget_product')::uuid,
    current ->> 'budget_source',
    (current ->> 'day')::date,
    (current ->> 'reserved')::integer,
    p_actual,
    p_cost_usd
  );
  update public.jobs set payload = payload || jsonb_build_object('settled', true) where id = p_job_id;
  return true;
end;
$$;

-- Products the daily collect runs for: confirmed, active (not paused) and owned by an entitled
-- account (trialing or active, as ENTITLED_STATUSES in src/server/billing/constants.ts). The
-- pre-launch allowlist (12.10) is applied by the caller, which holds SIGNUP_ALLOWLIST.
create function public.collectable_products()
returns table (id uuid, owner_id uuid)
language sql
stable
set search_path = ''
as $$
  select p.id, p.owner_id
  from public.products p
  join public.profiles pr on pr.id = p.owner_id
  where p.status = 'active'
    and p.confirmed_at is not null
    and pr.subscription_status in ('trialing', 'active')
$$;

-- A collect job adds its per-term counts to term_stats exactly once (7.3 step 9). The job's own
-- row records that it did, in the same statement, so a re-run never counts twice. Counts from
-- different jobs add up.
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
  select (e ->> 'term_id')::uuid, p_source, p_day, sum((e ->> 'fetched')::integer),
         sum((e ->> 'relevant')::integer)
    from jsonb_array_elements(p_stats) as e
   -- A term the owner deleted since the run started is skipped.
   where exists (select 1 from public.search_terms t where t.id = (e ->> 'term_id')::uuid)
   -- A term listed twice is added once, summed.
   group by (e ->> 'term_id')::uuid
  on conflict (term_id, source, day) do update
     set fetched = ts.fetched + excluded.fetched,
         relevant = ts.relevant + excluded.relevant;
  return true;
end;
$$;

-- Term rotation (7.3 step 2): a product's active terms for one source, least recently collected
-- for that source first (never collected first of all), then in the order they were added. Reddit
-- takes 12 a day; free sources take them all. search_terms.active is the pause switch.
create function public.collect_terms(p_product_id uuid, p_source text, p_limit integer)
returns table (id uuid, term text)
language sql
stable
set search_path = ''
as $$
  select t.id, t.term
    from public.search_terms t
    left join lateral (
      select max(ts.day) as last_day
        from public.term_stats ts
       where ts.term_id = t.id and ts.source = p_source
    ) s on true
   where t.product_id = p_product_id
     and t.active
   order by s.last_day asc nulls first, t.created_at, t.id
   limit greatest(p_limit, 0)
$$;

-- Reddit deletion re-check (2.3.6, 7.7): about 72 hours after collection each stored Reddit post
-- is re-collected once through the vendor and deleted here if it is gone. Each post is attributed
-- to the product that linked it first, which pays for its re-check, so a shared post is re-checked
-- once.
create function public.first_linked_product(p_post_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select pp.product_id
    from public.product_posts pp
   where pp.post_id = p_post_id
   order by pp.created_at, pp.product_id
   limit 1
$$;

create function public.reddit_recheck_products(p_from timestamptz, p_to timestamptz)
returns table (id uuid)
language sql
stable
set search_path = ''
as $$
  select distinct public.first_linked_product(p.id)
    from public.posts p
   where p.source = 'reddit'
     and p.collected_at >= p_from and p.collected_at < p_to
     and p.delete_after > now()
     and public.first_linked_product(p.id) is not null
$$;

create function public.reddit_recheck_posts(
  p_product_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer
)
returns table (external_id text, url text)
language sql
stable
set search_path = ''
as $$
  select p.external_id, p.url
    from public.posts p
   where p.source = 'reddit'
     and p.collected_at >= p_from and p.collected_at < p_to
     and p.delete_after > now()
     and public.first_linked_product(p.id) = p_product_id
   order by p.collected_at, p.id
   limit greatest(p_limit, 0)
$$;

-- Deletion sync (2.3.6): removes the posts a source reports gone. One source at a time, so an id
-- shared by two sources is never deleted for the wrong one.
create function public.delete_posts_at_source(p_source text, p_external_ids text[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.posts where source = p_source and external_id = any (p_external_ids);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- Retention (2.3.4): posts past delete_after, posts no product links to after a day, example ids
-- of deleted posts, and housekeeping rows (finished jobs after 30 days, events after 13 months,
-- handled removal requests 12 months after, preview runs past expires_at once that table exists).
create function public.purge_expired(p_now timestamptz)
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
  if p_now is null then
    raise exception 'purge_expired needs a time' using errcode = '22023';
  end if;
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

revoke all on function public.posts_keep_retention() from public, anon, authenticated;
revoke all on function public.ingest_post(text, text, text, text, timestamptz, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_jobs(timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_job(uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_budget(uuid, text, date, integer, integer) from public, anon, authenticated;
revoke all on function public.settle_budget(uuid, text, date, integer, integer, numeric) from public, anon, authenticated;
revoke all on function public.vendor_usage(text, date) from public, anon, authenticated;
revoke all on function public.reserve_job_budget(uuid, uuid, text, date, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.settle_job_budget(uuid, integer, numeric) from public, anon, authenticated;
revoke all on function public.collectable_products() from public, anon, authenticated;
revoke all on function public.record_term_stats(uuid, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.collect_terms(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.first_linked_product(uuid) from public, anon, authenticated;
revoke all on function public.reddit_recheck_products(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reddit_recheck_posts(uuid, timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.delete_posts_at_source(text, text[]) from public, anon, authenticated;
revoke all on function public.purge_expired(timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_post(text, text, text, text, timestamptz, text, text, timestamptz) to service_role;
grant execute on function public.claim_jobs(timestamptz, integer, integer) to service_role;
grant execute on function public.finish_job(uuid, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.consume_budget(uuid, text, date, integer, integer) to service_role;
grant execute on function public.settle_budget(uuid, text, date, integer, integer, numeric) to service_role;
grant execute on function public.vendor_usage(text, date) to service_role;
grant execute on function public.reserve_job_budget(uuid, uuid, text, date, integer, integer, integer) to service_role;
grant execute on function public.settle_job_budget(uuid, integer, numeric) to service_role;
grant execute on function public.collectable_products() to service_role;
grant execute on function public.record_term_stats(uuid, date, text, jsonb) to service_role;
grant execute on function public.collect_terms(uuid, text, integer) to service_role;
grant execute on function public.first_linked_product(uuid) to service_role;
grant execute on function public.reddit_recheck_products(timestamptz, timestamptz) to service_role;
grant execute on function public.reddit_recheck_posts(uuid, timestamptz, timestamptz, integer) to service_role;
grant execute on function public.delete_posts_at_source(text, text[]) to service_role;
grant execute on function public.purge_expired(timestamptz) to service_role;
