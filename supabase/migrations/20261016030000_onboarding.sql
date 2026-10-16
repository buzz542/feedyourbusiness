-- M2 onboarding (docs/PLAN.md 6.2): competitors table, product fields, search-term intent, model
-- usage. Production had no products when this was written. Before applying, check
-- `select count(*) from public.products` (the move below is the only copy of the old array) and
-- `select owner_id from public.products group by 1 having count(*) > 1` (D9 needs none).

-- Every element present, trimmed non-empty and at most max_len characters. Used by checks below.
create function public.text_items_ok(items text[], max_len integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(x is not null and char_length(btrim(x)) between 1 and max_len), true)
  from unnest(items) as x
$$;
revoke all on function public.text_items_ok(text[], integer) from public, anon;
grant execute on function public.text_items_ok(text[], integer) to authenticated, service_role;

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  domain text check (domain is null or (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' and char_length(domain) <= 253)),
  aliases text[] not null default '{}'
    check (cardinality(aliases) <= 10 and public.text_items_ok(aliases, 80)),
  origin text not null default 'user' check (origin in ('user', 'draft', 'discovered')),
  created_at timestamptz not null default now(),
  unique (product_id, name)
);
-- "Ledgerly" and "ledgerly " are one rival, so counts never split across two rows.
create unique index competitors_product_name_ci on public.competitors (product_id, lower(btrim(name)));

-- Move existing values (trimmed, blanks skipped, at most 80 characters), then drop the array.
insert into public.competitors (product_id, name, origin)
  select distinct on (p.id, lower(left(btrim(c.name), 80)))
         p.id, left(btrim(c.name), 80), 'user'
  from public.products p, unnest(p.competitors) as c(name)
  where c.name is not null and btrim(c.name) <> ''
  on conflict do nothing;
alter table public.products drop column competitors;

alter table public.products
  add column one_liner text check (char_length(one_liner) <= 160),
  -- Subreddit names only (as the draft schema in 8.3 allows), never a profile (u_...). The
  -- sensitive-community list is applied in code wherever these are used (2.3.7).
  add column subreddits text[] not null default '{}' check (
    cardinality(subreddits) <= 10
    and public.text_items_ok(subreddits, 21)
    and array_to_string(subreddits, ',') ~ '^([A-Za-z0-9_]{2,21}(,|$))*$'
    and array_to_string(subreddits, ',') !~* '(^|,)u_'
  ),
  add column confirmed_at timestamptz,
  add column relevance_threshold smallint not null default 60 check (relevance_threshold between 40 and 95);
create unique index products_one_per_owner on public.products (owner_id);  -- D9
-- The unique index above serves every owner lookup the old index did.
drop index public.products_owner_id_idx;
-- Products confirmed before confirmed_at existed count as confirmed.
update public.products set confirmed_at = updated_at where status <> 'draft';

-- A term is collected when it is active (M0) and not paused by the user (4.7).
alter table public.search_terms
  add column intent text not null default 'problem'
    check (intent in ('problem', 'category', 'alternative', 'competitor')),
  add column paused boolean not null default false;

create table public.llm_usage (
  id bigint generated always as identity primary key,
  product_id uuid references public.products (id) on delete set null,
  task text not null check (task in ('draft', 'classify', 'synthesize', 'preview')),
  model text not null,
  input_tokens integer not null, output_tokens integer not null,
  cache_read_tokens integer not null default 0, cache_write_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null,
  created_at timestamptz not null default now(),
  -- Spend caps sum these, so a negative value would let calls past a cap.
  check (cost_usd >= 0 and input_tokens >= 0 and output_tokens >= 0
    and cache_read_tokens >= 0 and cache_write_tokens >= 0)
);

-- ---------------------------------------------------------------------------
-- Grants and row-level security
-- ---------------------------------------------------------------------------

-- competitors: the owner (through products.owner_id) reads, adds, edits name, domain and aliases,
-- and removes. Mirrors search_terms. A competitor never moves to another product.
revoke all on public.competitors from anon, authenticated;
alter table public.competitors enable row level security;
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

-- llm_usage: server-side accounting only (spend caps, /admin costs).
revoke all on public.llm_usage from anon, authenticated;
alter table public.llm_usage enable row level security;
create policy llm_usage_deny_all on public.llm_usage
  for all to anon, authenticated using (false) with check (false);

create index llm_usage_product_created_idx on public.llm_usage (product_id, created_at);
create index llm_usage_created_idx on public.llm_usage (created_at);
