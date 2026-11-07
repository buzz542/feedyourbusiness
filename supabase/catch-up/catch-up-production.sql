-- AskedFor catch-up for PRODUCTION: project askedfor (hoqbflkszzoojdswbrgy).
-- Paste the whole file into that project's SQL Editor once and press Run.
--
-- It adds the six migrations production is missing, exactly as they are in
-- supabase/migrations (onboarding, collection, classification, reply_feed, billing_consent,
-- removal_form), and records them in the migration history. It also records profiles_app
-- under its file's version (20261024043500) instead of 20261102193628, as approved on 5 Nov,
-- and puts back a comment the earlier apply dropped from apply_billing_patch (same behavior).
-- History rows record version and name only.
--
-- Drops and narrowing of things that exist today, called out (production has no rows):
--   onboarding: drops the column products.competitors (moved to the competitors table);
--     drops not null on products.url (a product may have no website yet);
--     drops the index products_owner_id_idx (replaced by the unique products_one_per_owner);
--     drops the policy products_delete_own and revokes insert, update and delete on products
--     from signed-in users, who get column grants instead and can no longer delete (D9).
--   collection: drops the check posts_source_check (replaced by one that adds reddit and x);
--     revokes select on posts from signed-in users, who get the columns id, source, url,
--     excerpt, posted_at, collected_at and community only (never the author hash), and narrows
--     the policy posts_select_matched to posts that have not expired.
-- Nothing else that exists is dropped or narrowed, and no row is deleted.
--
-- It runs in one transaction: if any statement fails, nothing changes. The first statement
-- stops it unless this is production as it stood on 7 Nov 2026, so it is safe to paste into
-- the wrong project or twice, and the last one stops it unless the history comes out as the
-- repo's ten migrations. Checked on PGlite: it lands exactly on the repo's schema.

begin;

do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations
                  where version = '20261102193628' and name = 'profiles_app')
     or to_regclass('public.competitors') is not null
     or to_regclass('public.jobs') is not null
     or (select count(*) from supabase_migrations.schema_migrations) <> 4 then
    raise exception 'This is not the production database as it stood on 7 Nov 2026 (askedfor, four migrations, profiles_app as 20261102193628). Nothing was changed.';
  end if;
end;
$$;

-- ================================================================================================
-- billing_functions: apply_billing_patch as in its file (the earlier apply dropped a comment from its body; same behavior)
-- ================================================================================================

create or replace function public.apply_billing_patch(
  p_user_id uuid,
  p_event_at timestamptz,
  p_patch jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  rows_updated integer;
begin
  update public.profiles p
  set
    plan = case when p_patch ? 'plan'
      then p_patch ->> 'plan' else p.plan end,
    subscription_status = case when p_patch ? 'subscription_status'
      then p_patch ->> 'subscription_status' else p.subscription_status end,
    stripe_customer_id = case when p_patch ? 'stripe_customer_id'
      then p_patch ->> 'stripe_customer_id' else p.stripe_customer_id end,
    stripe_subscription_id = case when p_patch ? 'stripe_subscription_id'
      then p_patch ->> 'stripe_subscription_id' else p.stripe_subscription_id end,
    trial_end = case when p_patch ? 'trial_end'
      then (p_patch ->> 'trial_end')::timestamptz else p.trial_end end,
    current_period_end = case when p_patch ? 'current_period_end'
      then (p_patch ->> 'current_period_end')::timestamptz else p.current_period_end end,
    cancel_at_period_end = case when p_patch ? 'cancel_at_period_end'
      then (p_patch ->> 'cancel_at_period_end')::boolean else p.cancel_at_period_end end,
    -- A changed trial end means a new reminder is due.
    trial_reminder_sent_at = case
      when p_patch ? 'trial_end'
        and (p_patch ->> 'trial_end')::timestamptz is distinct from p.trial_end
      then null else p.trial_reminder_sent_at end,
    billing_event_at = p_event_at
  where p.id = p_user_id
    and (p.billing_event_at is null or p.billing_event_at <= p_event_at);

  get diagnostics rows_updated = row_count;
  return rows_updated > 0;
end;
$$;

-- ================================================================================================
-- onboarding (supabase/migrations/20261029060821_onboarding.sql)
-- ================================================================================================

-- M2 onboarding (docs/PLAN.md 6.2): competitors table, product fields, one product per owner,
-- search term intent, and the server-only llm_usage table.
--
--   * competitors replaces products.competitors. Existing names move over as origin 'user' before
--     the array is dropped, and the move is counted: if any name would be lost, or a product would
--     have more than 20, the migration stops. Production has no products yet; this keeps it safe.
--   * Competitor names and aliases, and search terms, are product, company or topic words. The
--     database refuses handles (@name, u/name), email addresses, URLs and profile links in them
--     whoever writes them, because a person's handle tracked as a rival or searched for daily would
--     profile them (docs/PLAN.md 2.2, 4.5). Domains are labels for the Rivals tab; nothing fetches
--     them.
--   * The checks live in the `private` schema, which the API does not expose, so nobody can call
--     them over PostgREST; writers get USAGE and EXECUTE because check constraints run as the
--     writing role.
--   * The owner adds, edits (name, domain, aliases) and removes competitors through RLS on the
--     product. product_id and origin cannot change after insert. origin only records where a row
--     came from (the user, the onboarding draft, or Track on a discovered tool); it grants nothing.
--     Names are unique per product ignoring case through the generated `name_key`, so writers
--     insert with `on conflict (product_id, name_key) do nothing` (supabase-js: upsert with
--     onConflict "product_id,name_key" and ignoreDuplicates), never a merge.
--   * Products: the owner writes only the profile columns and status (column grants). url may be
--     null: a product described in a sentence has no website yet (4.3); the https check still
--     applies to any value. One product per owner (D9), and the owner can no longer delete it, so
--     usage limits and budgets, which count per product, never reset; "Not my product?" drafts
--     again into the same row. Account deletion (service role) still cascades.
--   * confirmed_at is stamped by the database the first time the product leaves 'draft' and kept
--     afterwards; a confirmed product cannot go back to draft. So `status <> 'draft'` and
--     `confirmed_at is not null` always agree, and no client can backdate either.
--   * search_terms.active is the pause switch (false = paused); intent is new.
--   * Per product: at most 20 competitors and 40 search terms, whoever inserts them. The trigger
--     locks the product row first, so parallel inserts cannot both pass the count, and a duplicate
--     at the cap still does nothing instead of failing.
--   * llm_usage records every model call with tokens and cost (8.1). Server only, and append-only
--     even for the service role, so a bug cannot reset a spend cap. llm_usage_since() counts and
--     sums it for the caps and the drafting limit.

do $$
begin
  if exists (select 1 from public.products group by owner_id having count(*) > 1) then
    raise exception 'onboarding: an owner has more than one product. Resolve that before one product per owner (D9).';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- True when every label is a product, company or topic phrase of 1 to p_max characters, without
-- surrounding or invisible whitespace, control characters or case-insensitive duplicates, and with
-- no handle, email address, URL, or profile link without a scheme (x.com/name,
-- linkedin.com/in/name, name.bsky.social). Fullwidth @ and / count as the real ones.
create function private.are_product_labels(p_labels text[], p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(
    l is not null
    and char_length(l) between 1 and p_max
    and l = btrim(l)
    and l !~ '[[:cntrl:]\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]'
    and l !~* '([@\uff20]|(^|[^a-z0-9])u[/\uff0f]|://|(^|[^a-z0-9])www\.|[a-z0-9-]\.[a-z]{2,63}[/\uff0f]|(^|[/\uff0f])(user|users|in|profile)[/\uff0f]|bsky\.social)'
  ), true) and count(distinct lower(l)) = count(*)
  from unnest(p_labels) as l
$$;

-- True when every entry is a subreddit name, none is a user's profile (u_<name>, 2.3.7), and no
-- name repeats ignoring case.
create function private.are_subreddit_names(p_names text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(n is not null and n ~ '^[A-Za-z0-9_]{2,21}$' and n !~* '^u_'), true)
    and count(distinct lower(n)) = count(*)
  from unnest(p_names) as n
$$;

revoke all on function private.are_product_labels(text[], integer) from public, anon;
revoke all on function private.are_subreddit_names(text[]) from public, anon;
grant execute on function private.are_product_labels(text[], integer) to authenticated, service_role;
grant execute on function private.are_subreddit_names(text[]) to authenticated, service_role;

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (private.are_product_labels(array[name], 80)),
  name_key text generated always as (lower(name)) stored,
  domain text check (
    domain is null
    or (
      domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'
      and char_length(domain) <= 253
      and domain !~ '(^|\.)bsky\.social$'
    )
  ),
  aliases text[] not null default '{}' check (
    cardinality(aliases) <= 10 and private.are_product_labels(aliases, 80)
  ),
  origin text not null default 'user' check (origin in ('user', 'draft', 'discovered')),
  created_at timestamptz not null default now(),
  constraint competitors_product_name_key unique (product_id, name_key)
);

-- Names that differ only in case are one competitor; the first spelling in the array wins.
insert into public.competitors (product_id, name, origin)
  select distinct on (p.id, lower(left(btrim(c.name), 80))) p.id, left(btrim(c.name), 80), 'user'
    from public.products p, unnest(p.competitors) with ordinality as c(name, position)
   where c.name is not null and btrim(c.name) <> ''
     and private.are_product_labels(array[left(btrim(c.name), 80)], 80)
   order by p.id, lower(left(btrim(c.name), 80)), c.position
  on conflict do nothing;

do $$
declare
  expected integer;
  moved integer;
begin
  select count(distinct (p.id, lower(left(btrim(c.name), 80)))) into expected
    from public.products p, unnest(p.competitors) as c(name)
   where c.name is not null and btrim(c.name) <> '';
  select count(*) into moved from public.competitors;
  if moved <> expected then
    raise exception 'onboarding: % of % existing competitor names could not be moved (a handle, email or URL). Fix them first.',
      expected - moved, expected;
  end if;
  if exists (select 1 from public.competitors group by product_id having count(*) > 20) then
    raise exception 'onboarding: a product has more than 20 competitors. Trim them first.';
  end if;
end;
$$;

alter table public.products drop column competitors;

alter table public.competitors enable row level security;
revoke all on public.competitors from anon, authenticated;
grant select, delete on public.competitors to authenticated;
grant insert (product_id, name, domain, aliases, origin) on public.competitors to authenticated;
grant update (name, domain, aliases) on public.competitors to authenticated;

create policy competitors_select_own on public.competitors
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = competitors.product_id and p.owner_id = (select auth.uid())
    )
  );

create policy competitors_insert_own on public.competitors
  for insert to authenticated
  with check (
    exists (
      select 1 from public.products p
      where p.id = competitors.product_id and p.owner_id = (select auth.uid())
    )
  );

create policy competitors_update_own on public.competitors
  for update to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = competitors.product_id and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = competitors.product_id and p.owner_id = (select auth.uid())
    )
  );

create policy competitors_delete_own on public.competitors
  for delete to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = competitors.product_id and p.owner_id = (select auth.uid())
    )
  );

alter table public.products
  add column one_liner text check (char_length(one_liner) <= 160),
  add column subreddits text[] not null default '{}' check (
    cardinality(subreddits) <= 10 and private.are_subreddit_names(subreddits)
  ),
  add column confirmed_at timestamptz,
  add column relevance_threshold smallint not null default 60
    check (relevance_threshold between 40 and 95);

-- A product someone confirmed by hand before this migration counts as confirmed when it last changed.
update public.products set confirmed_at = updated_at where status <> 'draft';

alter table public.products
  add constraint products_confirmed_iff_not_draft
    check ((status = 'draft') = (confirmed_at is null));

alter table public.products alter column url drop not null;

create unique index products_one_per_owner on public.products (owner_id);
drop index public.products_owner_id_idx;

-- The owner writes the profile and its status, nothing else, and never deletes the product.
revoke insert, update, delete on public.products from authenticated;
drop policy products_delete_own on public.products;
grant insert (owner_id, url, name, description, audience, one_liner, subreddits,
  relevance_threshold, status) on public.products to authenticated;
grant update (url, name, description, audience, one_liner, subreddits, relevance_threshold, status)
  on public.products to authenticated;

create function public.products_stamp_confirmed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.confirmed_at is not null then
    if new.status = 'draft' then
      raise exception 'a confirmed product cannot go back to draft' using errcode = 'check_violation';
    end if;
    new.confirmed_at = old.confirmed_at;
  elsif new.status = 'draft' then
    new.confirmed_at = null;
  else
    new.confirmed_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.products_stamp_confirmed() from public, anon, authenticated;

create trigger products_stamp_confirmed
  before insert or update on public.products
  for each row execute function public.products_stamp_confirmed();

alter table public.search_terms
  add column intent text not null default 'problem'
    check (intent in ('problem', 'category', 'alternative', 'competitor')),
  add constraint search_terms_term_is_a_phrase
    check (private.are_product_labels(array[term], 120));

-- At most TG_ARGV[0] rows per product in competitors or search_terms.
create function public.enforce_rows_per_product()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  existing integer;
  duplicate boolean;
begin
  -- Serialize cap checks per product; key-share locks from foreign keys are not blocked.
  perform 1 from public.products where id = new.product_id for no key update;
  if tg_table_name = 'competitors' then
    select count(*), coalesce(bool_or(name_key = lower(new.name)), false)
      into existing, duplicate
      from public.competitors where product_id = new.product_id;
  elsif tg_table_name = 'search_terms' then
    select count(*), coalesce(bool_or(term = new.term), false)
      into existing, duplicate
      from public.search_terms where product_id = new.product_id;
  else
    raise exception 'enforce_rows_per_product does not cover %', tg_table_name;
  end if;
  -- A duplicate is left to the unique constraint, so `on conflict do nothing` still does nothing.
  if not duplicate and existing >= tg_argv[0]::integer then
    raise exception 'a product has at most % %', tg_argv[0], replace(tg_table_name, '_', ' ')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_rows_per_product() from public, anon, authenticated;

create trigger competitors_per_product
  before insert on public.competitors
  for each row execute function public.enforce_rows_per_product('20');

create trigger search_terms_per_product
  before insert on public.search_terms
  for each row execute function public.enforce_rows_per_product('40');

create table public.llm_usage (
  id bigint generated always as identity primary key,
  product_id uuid references public.products (id) on delete set null,
  task text not null check (task in ('draft', 'classify', 'synthesize', 'preview')),
  model text not null check (char_length(model) <= 60),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(10, 6) not null check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

alter table public.llm_usage enable row level security;
revoke all on public.llm_usage from anon, authenticated, service_role;
revoke all on sequence public.llm_usage_id_seq from anon, authenticated;
grant select, insert on public.llm_usage to service_role;

create policy llm_usage_deny_all on public.llm_usage
  for all to anon, authenticated using (false) with check (false);

-- Spend caps (8.1) and the drafting limit (8.3) sum by product and time, and globally by day.
create index llm_usage_product_created_idx on public.llm_usage (product_id, created_at);
create index llm_usage_created_idx on public.llm_usage (created_at);

-- Calls and dollars since p_since, for one product or (p_product_id null) all of them, for one
-- task or (p_task null) all of them. The spend caps (8.1) and the drafting limit (8.3) call it
-- before every model call. Service role only.
create function public.llm_usage_since(
  p_product_id uuid,
  p_since timestamptz,
  p_task text default null
)
returns table (calls integer, cost_usd numeric)
language sql
stable
set search_path = ''
as $$
  select count(*)::integer, coalesce(sum(u.cost_usd), 0)
    from public.llm_usage u
   where u.created_at >= p_since
     and (p_product_id is null or u.product_id = p_product_id)
     and (p_task is null or u.task = p_task)
$$;

revoke all on function public.llm_usage_since(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.llm_usage_since(uuid, timestamptz, text) to service_role;

-- The onboarding draft (8.3), written as the service role after the server has checked the session.
-- start_product_draft makes or reuses the owner's one draft product before any model call, so the
-- drafting limit counts from the first run; it refuses once the product is confirmed.
create function public.start_product_draft(p_owner_id uuid, p_url text, p_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  existing public.products;
begin
  -- A double-click on the first paste: both requests insert, one does nothing (D9's unique index).
  insert into public.products (owner_id, url, name) values (p_owner_id, p_url, p_name)
    on conflict (owner_id) do nothing;
  select * into existing from public.products where owner_id = p_owner_id for update;
  if existing.status <> 'draft' then
    raise exception 'the product is already confirmed' using errcode = 'check_violation';
  end if;
  -- An existing draft keeps its url and name until a new draft is saved, so a redraft that fails
  -- never leaves one site's url next to another site's terms.
  return existing.id;
end;
$$;

-- save_product_draft replaces a draft product's profile, search terms and competitors in one
-- transaction. Every table constraint applies (labels, caps, subreddit names).
create function public.save_product_draft(
  p_product_id uuid,
  p_owner_id uuid,
  p_profile jsonb,
  p_terms jsonb,
  p_competitors jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  current_status text;
begin
  select status into current_status from public.products
   where id = p_product_id and owner_id = p_owner_id
   for update;
  if not found then
    raise exception 'no such product for this owner' using errcode = 'no_data_found';
  end if;
  if current_status <> 'draft' then
    raise exception 'the product is already confirmed' using errcode = 'check_violation';
  end if;

  update public.products set
    url = p_profile ->> 'url',
    name = p_profile ->> 'name',
    one_liner = p_profile ->> 'one_liner',
    description = p_profile ->> 'description',
    audience = p_profile ->> 'audience',
    subreddits = coalesce(
      (select array_agg(value) from jsonb_array_elements_text(p_profile -> 'subreddits')), '{}')
  where id = p_product_id;

  delete from public.search_terms where product_id = p_product_id;
  insert into public.search_terms (product_id, term, intent)
    select p_product_id, t.term, t.intent
      from jsonb_to_recordset(p_terms) as t(term text, intent text);

  delete from public.competitors where product_id = p_product_id;
  insert into public.competitors (product_id, name, domain, aliases, origin)
    select p_product_id, c.name, c.domain, coalesce(c.aliases, '{}'), 'draft'
      from jsonb_to_recordset(p_competitors) as c(name text, domain text, aliases text[]);
end;
$$;

revoke all on function public.start_product_draft(uuid, text, text) from public, anon, authenticated;
revoke all on function public.save_product_draft(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_product_draft(uuid, text, text) to service_role;
grant execute on function public.save_product_draft(uuid, uuid, jsonb, jsonb, jsonb) to service_role;

-- Model call reservations (8.1, 8.3). Usage is written when a call ends, 20 to 60 seconds after it
-- starts, so a check on llm_usage alone lets parallel requests all pass the drafting limit and the
-- spend caps. Every call therefore reserves its place first, under one lock: llm_begin_call counts
-- today's calls and this month's and today's spend plus the open reservations, refuses at a limit,
-- and records the reservation; llm_finish_call writes the usage row and drops the reservation in
-- one statement. A reservation left by a crashed call lapses when its lease ends. Server only.
create table public.llm_reservations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete cascade,
  task text not null check (task in ('draft', 'classify', 'synthesize', 'preview')),
  reserve_usd numeric(10, 6) not null check (reserve_usd >= 0),
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > created_at)
);
create index llm_reservations_expires_idx on public.llm_reservations (expires_at);
revoke all on public.llm_reservations from anon, authenticated;
alter table public.llm_reservations enable row level security;
create policy llm_reservations_deny_all on public.llm_reservations
  for all to anon, authenticated using (false) with check (false);

-- Status 'ok' with the reservation id, or the limit that refused: 'task_daily' (p_task_daily_calls
-- calls of this task for this product in the UTC day, null for no limit), 'product_monthly' or
-- 'global_daily'. A cap refuses once what is spent plus what is reserved reaches it.
create function public.llm_begin_call(
  p_product_id uuid,
  p_task text,
  p_now timestamptz,
  p_task_daily_calls integer,
  p_product_monthly_usd numeric,
  p_global_daily_usd numeric,
  p_reserve_usd numeric,
  p_lease_seconds integer
)
returns table (status text, reservation_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  day_start timestamptz := date_trunc('day', p_now at time zone 'utc') at time zone 'utc';
  month_start timestamptz := date_trunc('month', p_now at time zone 'utc') at time zone 'utc';
  used numeric;
  calls integer;
  id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('llm_spend'));

  if p_product_id is not null and p_task_daily_calls is not null then
    select (select count(*) from public.llm_usage u
             where u.product_id = p_product_id and u.task = p_task and u.created_at >= day_start)
         + (select count(*) from public.llm_reservations r
             where r.product_id = p_product_id and r.task = p_task and r.expires_at > p_now)
      into calls;
    if calls >= p_task_daily_calls then
      return query select 'task_daily'::text, null::uuid;
      return;
    end if;
  end if;

  if p_product_id is not null then
    select (select coalesce(sum(u.cost_usd), 0) from public.llm_usage u
             where u.product_id = p_product_id and u.created_at >= month_start)
         + (select coalesce(sum(r.reserve_usd), 0) from public.llm_reservations r
             where r.product_id = p_product_id and r.expires_at > p_now)
      into used;
    if used >= p_product_monthly_usd then
      return query select 'product_monthly'::text, null::uuid;
      return;
    end if;
  end if;

  select (select coalesce(sum(u.cost_usd), 0) from public.llm_usage u where u.created_at >= day_start)
       + (select coalesce(sum(r.reserve_usd), 0) from public.llm_reservations r
           where r.expires_at > p_now)
    into used;
  if used >= p_global_daily_usd then
    return query select 'global_daily'::text, null::uuid;
    return;
  end if;

  insert into public.llm_reservations (product_id, task, reserve_usd, created_at, expires_at)
  values (p_product_id, p_task, greatest(p_reserve_usd, 0), p_now,
          p_now + make_interval(secs => greatest(p_lease_seconds, 1)))
  returning llm_reservations.id into id;
  return query select 'ok'::text, id;
end;
$$;

create function public.llm_finish_call(
  p_reservation_id uuid,
  p_product_id uuid,
  p_task text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_read_tokens integer,
  p_cache_write_tokens integer,
  p_cost_usd numeric,
  p_now timestamptz
)
returns void
language sql
set search_path = ''
as $$
  with dropped as (
    delete from public.llm_reservations where id = p_reservation_id
  )
  insert into public.llm_usage (product_id, task, model, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, cost_usd, created_at)
  values (p_product_id, p_task, p_model, p_input_tokens, p_output_tokens, p_cache_read_tokens,
    p_cache_write_tokens, p_cost_usd, p_now);
$$;

revoke all on function public.llm_begin_call(uuid, text, timestamptz, integer, numeric, numeric, numeric, integer)
  from public, anon, authenticated;
revoke all on function public.llm_finish_call(uuid, uuid, text, text, integer, integer, integer, integer, numeric, timestamptz)
  from public, anon, authenticated;
grant execute on function public.llm_begin_call(uuid, text, timestamptz, integer, numeric, numeric, numeric, integer)
  to service_role;
grant execute on function public.llm_finish_call(uuid, uuid, text, text, integer, integer, integer, integer, numeric, timestamptz)
  to service_role;

-- "Change something" (4.3 step 4): every edit in one transaction, so a value the database refuses
-- (a Bluesky handle as a domain, a handle in a term) or a lost connection never leaves half an
-- edit behind for the user to confirm unseen. SECURITY INVOKER: it runs as the signed-in owner, so
-- RLS and the column grants above still decide what may be written. Terms and competitors are
-- matched ignoring case; a case-only change updates the row, and a competitor keeps its aliases.
create function public.apply_onboarding_edits(
  p_product_id uuid,
  p_profile jsonb,
  p_terms text[],
  p_competitors jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated integer;
begin
  update public.products set
    name = p_profile ->> 'name',
    one_liner = p_profile ->> 'one_liner',
    description = p_profile ->> 'description',
    audience = p_profile ->> 'audience',
    relevance_threshold = (p_profile ->> 'relevance_threshold')::smallint,
    subreddits = coalesce(
      (select array_agg(value) from jsonb_array_elements_text(p_profile -> 'subreddits')), '{}')
  where id = p_product_id and status = 'draft';
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'no draft product to edit' using errcode = 'P0002';
  end if;

  -- Removals first, so the caps (40 terms, 20 competitors) never block a swap.
  delete from public.search_terms t
   where t.product_id = p_product_id
     and lower(t.term) <> all (select lower(x) from unnest(p_terms) as x);
  update public.search_terms t set term = x.term
    from unnest(p_terms) as x (term)
   where t.product_id = p_product_id and lower(t.term) = lower(x.term) and t.term <> x.term;
  insert into public.search_terms (product_id, term)
    select p_product_id, x.term from unnest(p_terms) as x (term)
     where not exists (select 1 from public.search_terms t
                        where t.product_id = p_product_id and lower(t.term) = lower(x.term));

  delete from public.competitors c
   where c.product_id = p_product_id
     and c.name_key <> all (select lower(e ->> 'name') from jsonb_array_elements(p_competitors) as e);
  update public.competitors c
     set name = e ->> 'name', domain = nullif(e ->> 'domain', '')
    from jsonb_array_elements(p_competitors) as e
   where c.product_id = p_product_id and c.name_key = lower(e ->> 'name')
     and (c.name <> e ->> 'name' or c.domain is distinct from nullif(e ->> 'domain', ''));
  insert into public.competitors (product_id, name, domain)
    select p_product_id, e ->> 'name', nullif(e ->> 'domain', '')
      from jsonb_array_elements(p_competitors) as e
     where not exists (select 1 from public.competitors c
                        where c.product_id = p_product_id and c.name_key = lower(e ->> 'name'));
end;
$$;

revoke all on function public.apply_onboarding_edits(uuid, jsonb, text[], jsonb) from public, anon;
grant execute on function public.apply_onboarding_edits(uuid, jsonb, text[], jsonb) to authenticated;

-- ================================================================================================
-- collection (supabase/migrations/20261031090000_collection.sql)
-- ================================================================================================

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

-- Records a source used this month across every product (the vendor's monthly cap), its deletion
-- re-checks included: they reserve under "<source>_recheck", so they never use a product's daily
-- room for collection (7.7) but always count toward the vendor's monthly records.
create function public.vendor_usage(p_source text, p_month_start date)
returns integer
language sql
stable
strict
set search_path = ''
as $$
  select coalesce(sum(reads), 0)::integer
  from public.usage_ledger
  where source in (p_source, p_source || '_recheck') and usage_date >= p_month_start
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
    -- One lock and one count per vendor source, its re-checks included.
    perform pg_advisory_xact_lock(
      hashtext('vendor_monthly_cap:' || regexp_replace(p_source, '_recheck$', '')));
    if public.vendor_usage(regexp_replace(p_source, '_recheck$', ''), date_trunc('month', p_day)::date)
       + p_units > p_monthly_cap then
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

-- ================================================================================================
-- classification (supabase/migrations/20261102090000_classification.sql)
-- ================================================================================================

-- Migration `classification` (docs/PLAN.md 6.4): the classifier's labels on product_posts.
--
--   * Rival labels: the competitor or the tool a post names (a product or company, never a person),
--     the issue, the sentiment, switching intent and our own one-line paraphrase (never a quote).
--   * Highlight offsets into the excerpt (code points, as char_length counts), from an exact match
--     only; both or neither, and the end after the start.
--   * The search term that found the post, for the per-term view.
--   * A competitor or term from another product can never be attached (a trigger checks it).
--   * Customers still update only `state` (the column grant from rls_and_grants is unchanged), and
--     the new columns hold no author data, so `compliance:schema` still passes.

alter table public.product_posts
  add column competitor_id uuid references public.competitors (id) on delete set null,
  add column tool_mentioned text check (char_length(tool_mentioned) between 1 and 60),
  add column rival_issue text check (rival_issue in ('pricing', 'reliability', 'missing_feature',
    'support', 'usability', 'performance', 'integration', 'other')),
  add column rival_sentiment text check (rival_sentiment in ('negative', 'mixed', 'positive')),
  add column switching boolean not null default false,
  add column rival_summary text check (char_length(rival_summary) between 1 and 200),
  add column highlight_start smallint check (highlight_start between 0 and 280),
  add column highlight_end smallint check (highlight_end between 1 and 280),
  add column term_id uuid references public.search_terms (id) on delete set null,
  add constraint product_posts_highlight_range check (
    (highlight_start is null) = (highlight_end is null)
    and (highlight_end is null or highlight_end > highlight_start)),
  -- A rival label is whole or absent: issue, sentiment and summary together.
  add constraint product_posts_rival_whole check (
    (rival_issue is null) = (rival_sentiment is null)
    and (rival_issue is null) = (rival_summary is null)),
  -- Switching intent is part of a rival label.
  add constraint product_posts_switching_needs_rival check (not switching or rival_issue is not null);

create index product_posts_today_idx on public.product_posts (product_id, created_at desc)
  where state in ('new', 'saved');
create index product_posts_rival_idx on public.product_posts (product_id, competitor_id, created_at desc)
  where competitor_id is not null;
-- Foreign keys used by on delete set null.
create index product_posts_competitor_id_idx on public.product_posts (competitor_id)
  where competitor_id is not null;
create index product_posts_term_id_idx on public.product_posts (term_id) where term_id is not null;

-- A label points only at the product's own competitor and term. One deleted since the run started
-- (a term removed while a vendor run was pending, a competitor removed during a cron run) is left
-- off the label instead of failing the job; one of another product is refused. Runs as the writer
-- (security invoker); only the service role writes these columns.
create function private.product_posts_same_product() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_product uuid;
begin
  if new.competitor_id is not null then
    select c.product_id into v_product from public.competitors c where c.id = new.competitor_id;
    if not found then
      new.competitor_id := null;
    elsif v_product <> new.product_id then
      raise exception 'label: competitor of another product' using errcode = '23514';
    end if;
  end if;
  if new.term_id is not null then
    select t.product_id into v_product from public.search_terms t where t.id = new.term_id;
    if not found then
      new.term_id := null;
    elsif v_product <> new.product_id then
      raise exception 'label: term of another product' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.product_posts_same_product() from public, anon;
grant execute on function private.product_posts_same_product() to service_role;

create trigger product_posts_same_product
  before insert or update of product_id, competitor_id, term_id on public.product_posts
  for each row execute function private.product_posts_same_product();

-- ================================================================================================
-- reply_feed (supabase/migrations/20261102100000_reply_feed.sql)
-- ================================================================================================

-- Migration `reply_feed` (docs/PLAN.md 4.4, 5.2): one view the Reply tab reads, joining a product's
-- labels to the post's content. security_invoker, so the reader's own RLS applies to both tables:
-- an owner sees only their products' links, and only posts still inside retention (2.3.4). The
-- service role bypasses RLS, so its readers (the daily email) filter delete_after themselves. It
-- exposes no author column (D5), and no function is added.

create view public.feed_items with (security_invoker = true) as
select
  pp.id,
  pp.product_id,
  pp.state,
  pp.relevance,
  pp.category,
  pp.reason,
  pp.created_at,
  pp.highlight_start,
  pp.highlight_end,
  pp.competitor_id,
  pp.tool_mentioned,
  pp.switching,
  pp.rival_issue,
  pp.rival_sentiment,
  p.source,
  p.url,
  p.excerpt,
  p.posted_at,
  p.community
from public.product_posts pp
join public.posts p on p.id = pp.post_id;

revoke all on public.feed_items from public, anon, authenticated, service_role;
grant select on public.feed_items to authenticated, service_role;

-- ================================================================================================
-- billing_consent (supabase/migrations/20261102110000_billing_consent.sql)
-- ================================================================================================

-- Migration `billing_consent` (docs/PLAN.md 6.7, 10.2): when the customer asked for the service to
-- start during the cancellation period. Written by the Stripe webhook only (service role), from the
-- time the checkout handler put in the subscription's metadata; a later consent (a new contract)
-- replaces an earlier one, never the reverse. No API
-- role but the service role may write it: `authenticated` keeps its column grants on profiles
-- (email_daily, email_weekly, terms_accepted_at) and gains nothing here.
alter table public.profiles add column service_consent_at timestamptz;

-- ================================================================================================
-- removal_form (supabase/migrations/20261105213000_removal_form.sql)
-- ================================================================================================

-- Migration `removal_form` (docs/PLAN.md 4.8, 6.8 removal part, 12.5, 12.7): the removal form and
-- the admin queue. The `launch` migration of 6.8 is split: its removal_requests columns are here,
-- and preview_runs stays with the instant preview. removal_requests stays deny-all for API roles;
-- every function is service role only.
--
--   * submit_removal_request: at most p_daily_limit requests per IP hash per UTC day, checked and
--     inserted under one lock. The IP hash is HMAC(APP_HMAC_SECRET, "<UTC day>:<ip>") and is
--     cleared when the request is handled.
--   * remove_and_suppress: one admin click. Deletes the author's posts (and the linked post),
--     suppresses the author hash so ingest_post never stores them again, closes the request and
--     writes the audit log, in one transaction.
--   * close_removal_request: closes or rejects without a match, with an audit row.

alter table public.removal_requests
  add column source text check (source in ('hackernews', 'bluesky', 'reddit', 'x')),
  add column details text check (char_length(details) <= 1000),
  add column ip_hash text check (char_length(ip_hash) <= 128);

create index removal_requests_ip_idx on public.removal_requests (ip_hash, created_at);
create index removal_requests_open_idx on public.removal_requests (status, due_at);

create function public.submit_removal_request(
  p_link_or_handle text,
  p_source text,
  p_contact_email text,
  p_details text,
  p_ip_hash text,
  p_now timestamptz,
  p_daily_limit integer
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  day_start timestamptz := date_trunc('day', p_now at time zone 'utc') at time zone 'utc';
  today integer;
  id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('removal_form:' || p_ip_hash));
  select count(*) into today from public.removal_requests r
   where r.ip_hash = p_ip_hash and r.created_at >= day_start;
  if today >= p_daily_limit then
    return null;
  end if;
  insert into public.removal_requests (link_or_handle, source, contact_email, details, ip_hash,
    created_at, target_at, due_at)
  values (p_link_or_handle, p_source, p_contact_email, nullif(p_details, ''), p_ip_hash, p_now,
    p_now + interval '72 hours', p_now + interval '30 days')
  returning removal_requests.id into id;
  return id;
end;
$$;

-- p_external_id comes last with a default: PostgREST matches functions by argument names, and a
-- request by username has no post to name.
create function public.remove_and_suppress(
  p_request_id uuid,
  p_source text,
  p_author_hash text,
  p_actor text,
  p_now timestamptz,
  p_external_id text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted integer;
begin
  if p_author_hash is null or p_author_hash = '' then
    raise exception 'an author hash is required' using errcode = 'check_violation';
  end if;
  update public.removal_requests
     set status = 'removed', handled_at = p_now, ip_hash = null
   where id = p_request_id and status in ('received', 'verified');
  if not found then
    raise exception 'the request is not open' using errcode = 'P0002';
  end if;
  delete from public.posts p
   where p.source = p_source
     and (p.author_hash = p_author_hash or (p_external_id is not null and p.external_id = p_external_id));
  get diagnostics deleted = row_count;
  insert into public.suppression (author_hash, source, reason)
  values (p_author_hash, p_source, 'removal request')
  on conflict (author_hash, source) do nothing;
  insert into public.audit_log (actor, action, target, at)
  values (p_actor, 'removal_deleted_and_suppressed', p_request_id::text, p_now);
  return deleted;
end;
$$;

create function public.close_removal_request(
  p_request_id uuid,
  p_status text,
  p_actor text,
  p_now timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_status not in ('closed', 'rejected') then
    raise exception 'status must be closed or rejected' using errcode = 'check_violation';
  end if;
  update public.removal_requests
     set status = p_status, handled_at = p_now, ip_hash = null
   where id = p_request_id and status in ('received', 'verified');
  if not found then
    raise exception 'the request is not open' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor, action, target, at)
  values (p_actor, 'removal_' || p_status, p_request_id::text, p_now);
end;
$$;

revoke all on function public.submit_removal_request(text, text, text, text, text, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.remove_and_suppress(uuid, text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.close_removal_request(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.submit_removal_request(text, text, text, text, text, timestamptz, integer)
  to service_role;
grant execute on function public.remove_and_suppress(uuid, text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.close_removal_request(uuid, text, text, timestamptz)
  to service_role;

-- ================================================================================================
-- Migration history
-- ================================================================================================

update supabase_migrations.schema_migrations set version = '20261024043500'
 where version = '20261102193628' and name = 'profiles_app';
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261029060821', 'onboarding'),
  ('20261031090000', 'collection'),
  ('20261102090000', 'classification'),
  ('20261102100000', 'reply_feed'),
  ('20261102110000', 'billing_consent'),
  ('20261105213000', 'removal_form');

-- Stop, changing nothing, unless the history is now exactly the repo's migrations.
do $$
begin
  if (select array_agg(version || ' ' || name order by version)
        from supabase_migrations.schema_migrations) is distinct from array[
    '20261013183103 core_schema',
    '20261013183117 rls_and_grants',
    '20261013183356 billing_functions',
    '20261024043500 profiles_app',
    '20261029060821 onboarding',
    '20261031090000 collection',
    '20261102090000 classification',
    '20261102100000 reply_feed',
    '20261102110000 billing_consent',
    '20261105213000 removal_form'
  ] then
    raise exception 'The migration history did not come out as the repo''s ten migrations. Nothing was changed.';
  end if;
end;
$$;

commit;

-- Done. This should list the ten migrations, versions matching the files in supabase/migrations:
select version, name from supabase_migrations.schema_migrations order by version;
