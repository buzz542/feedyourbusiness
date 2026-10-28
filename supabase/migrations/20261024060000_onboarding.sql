-- M2 onboarding (docs/PLAN.md 6.2): competitors as a table, product and search-term fields, one
-- product per owner (D9), and llm_usage for model spend.
--
-- Destructive: drops products.competitors after copying its values into public.competitors.
-- Production had no products when this was written; count them before applying.

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  domain text check (domain is null or (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' and char_length(domain) <= 253)),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 10),
  origin text not null default 'user' check (origin in ('user', 'draft', 'discovered')),
  created_at timestamptz not null default now(),
  unique (product_id, name)
);

-- Move existing values, then drop the array. A name the new table cannot hold stops the migration
-- rather than vanish (production had no products when this was written; count them first).
insert into public.competitors (product_id, name, origin)
  select p.id, c.name, 'user' from public.products p, unnest(p.competitors) as c(name)
  on conflict do nothing;
alter table public.products drop column competitors;

-- Every subreddit is a bare name, the shape the draft schema allows (8.3), because an owner can
-- write this column directly and search links and Reddit terms are built from it.
create function public.subreddit_names_valid(p_names text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(n ~ '^[A-Za-z0-9_]{2,21}$'), true) from unnest(p_names) as n;
$$;
-- The check runs as the role that writes the row.
revoke all on function public.subreddit_names_valid(text[]) from public, anon;
grant execute on function public.subreddit_names_valid(text[]) to authenticated, service_role;

alter table public.products
  add column one_liner text check (char_length(one_liner) <= 160),
  add column subreddits text[] not null default '{}'
    check (cardinality(subreddits) <= 10 and public.subreddit_names_valid(subreddits)),
  add column confirmed_at timestamptz,
  add column relevance_threshold smallint not null default 60 check (relevance_threshold between 40 and 95);

-- D9: one product per account in v1. The schema allows more; this index enforces one. It also
-- serves every owner lookup, so the plain owner index from the core schema goes.
create unique index products_one_per_owner on public.products (owner_id);
drop index public.products_owner_id_idx;

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
  created_at timestamptz not null default now()
);
-- Spend caps sum per product per month and globally per day (8.1).
create index llm_usage_product_created_idx on public.llm_usage (product_id, created_at);
create index llm_usage_created_idx on public.llm_usage (created_at);

-- The sum behind the spend caps, in the database: summing rows in the app would stop at the API's
-- row limit and let a cap leak. No product (null) means every product.
create function public.llm_spend_usd(p_since timestamptz, p_product_id uuid default null)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(u.cost_usd), 0)
  from public.llm_usage u
  where u.created_at >= p_since
    and (p_product_id is null or u.product_id = p_product_id);
$$;
revoke all on function public.llm_spend_usd(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.llm_spend_usd(timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.competitors enable row level security;
revoke all on public.competitors from anon, authenticated;
grant select, insert, delete on public.competitors to authenticated;
-- An owner edits a competitor's words, never which product it belongs to or where it came from.
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

alter table public.llm_usage enable row level security;
revoke all on public.llm_usage from anon, authenticated;
revoke all on sequence public.llm_usage_id_seq from anon, authenticated;

create policy llm_usage_deny_all on public.llm_usage
  for all to anon, authenticated using (false) with check (false);
