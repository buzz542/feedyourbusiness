-- M3 collection (docs/PLAN.md 6.3): posts from every collect source, jobs, budgets, ingest and
-- purge. Retention by source (D4: 7 days for Reddit and X, 30 for the rest), no author handle ever
-- (D5), and the suppression list checked in the same statement that inserts a post.

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
  payload jsonb not null default '{}' check (pg_column_size(payload) <= 8192),
  attempts smallint not null default 0,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (char_length(last_error) <= 120),   -- error class only
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

-- ---------------------------------------------------------------------------
-- Functions, for the service role only
-- ---------------------------------------------------------------------------

-- Stores one post, or returns null without storing it when the author is suppressed for this
-- source. On a repeat (same source and external id) it changes nothing and returns the stored id,
-- so retention is never extended.
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
begin
  insert into public.posts
    (source, external_id, url, excerpt, posted_at, collected_at, delete_after, author_hash, community)
  select p_source, p_external_id, p_url, p_excerpt, p_posted_at, p_now,
         p_now + case when p_source in ('reddit', 'x') then interval '7 days' else interval '30 days' end,
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

-- Claims due jobs for one runner: queued or waiting jobs whose time has come, and running jobs whose
-- lease ran out (a run that crashed). Skips rows another runner holds, so two runners never take
-- the same job.
create function public.claim_jobs(p_now timestamptz, p_limit integer, p_lease_seconds integer)
returns setof public.jobs
language sql
set search_path = ''
as $$
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_until = p_now + make_interval(secs => p_lease_seconds)
   where j.id in (
     select id from public.jobs
      where run_after <= p_now
        and (status in ('queued', 'waiting') or (status = 'running' and locked_until < p_now))
        and (locked_until is null or locked_until < p_now)
      order by run_after
      limit p_limit
      for update skip locked
   )
  returning j.*;
$$;

-- Ends a job (done or failed) or reschedules it (queued or waiting, with a new run_after).
create function public.finish_job(
  p_id uuid,
  p_status text,
  p_error_class text,
  p_payload jsonb,
  p_run_after timestamptz
)
returns void
language sql
set search_path = ''
as $$
  update public.jobs
     set status = p_status,
         last_error = left(p_error_class, 120),
         payload = coalesce(p_payload, payload),
         run_after = coalesce(p_run_after, run_after),
         locked_until = null,
         finished_at = case when p_status in ('done', 'failed') then now() else null end
   where id = p_id;
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

-- After the call: gives back the units reserved but not used, and adds the actual cost.
create function public.settle_budget(
  p_product_id uuid,
  p_source text,
  p_day date,
  p_reserved integer,
  p_actual integer,
  p_cost_usd numeric
)
returns void
language sql
set search_path = ''
as $$
  update public.usage_ledger
     set reads = greatest(0, reads - greatest(0, p_reserved - p_actual)),
         cost_usd = cost_usd + greatest(0, p_cost_usd)
   where product_id = p_product_id and source = p_source and usage_date = p_day;
$$;

-- Records a source used this month across every product (the vendor's monthly cap).
create function public.vendor_usage(p_source text, p_month_start date)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(reads), 0)::integer
  from public.usage_ledger
  where source = p_source and usage_date >= p_month_start
$$;

-- Retention: posts past delete_after, posts no product links to after a day, example ids of deleted
-- posts, and housekeeping rows (finished jobs after 30 days, events after 13 months, closed removal
-- requests 12 months after they were handled, preview runs past expires_at once that table exists).
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
   where status = 'closed' and handled_at < p_now - interval '12 months';
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

revoke all on function public.ingest_post(text, text, text, text, timestamptz, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_jobs(timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_job(uuid, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_budget(uuid, text, date, integer, integer)
  from public, anon, authenticated;
revoke all on function public.settle_budget(uuid, text, date, integer, integer, numeric)
  from public, anon, authenticated;
revoke all on function public.vendor_usage(text, date) from public, anon, authenticated;
revoke all on function public.purge_expired(timestamptz) from public, anon, authenticated;

grant execute on function public.ingest_post(text, text, text, text, timestamptz, text, text, timestamptz)
  to service_role;
grant execute on function public.claim_jobs(timestamptz, integer, integer) to service_role;
grant execute on function public.finish_job(uuid, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.consume_budget(uuid, text, date, integer, integer) to service_role;
grant execute on function public.settle_budget(uuid, text, date, integer, integer, numeric)
  to service_role;
grant execute on function public.vendor_usage(text, date) to service_role;
grant execute on function public.purge_expired(timestamptz) to service_role;
