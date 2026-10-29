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
--     even for the service role, so a bug cannot reset a spend cap.

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
    and l !~ '[[:cntrl:]  ᠎ -‏ -  -⁤　﻿]'
    and l !~* '([@＠]|(^|[^a-z0-9])u[/／]|://|(^|[^a-z0-9])www\.|[a-z0-9-]\.[a-z]{2,63}[/／]|(^|[/／])(user|users|in|profile)[/／]|bsky\.social)'
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
