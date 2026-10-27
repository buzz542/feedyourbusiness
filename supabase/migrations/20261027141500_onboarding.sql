-- M2 onboarding (docs/PLAN.md 6.2): the competitors table, the product fields onboarding drafts,
-- one product per owner (D9), search term intent, and model usage for spend caps.
--
-- A signed-in user can write their own products, terms and competitors through the API
-- directly, not only through the app, so every rule that matters is enforced here:
--
--   * products.competitors (text[]) becomes the competitors table. Existing names move first.
--     DESTRUCTIVE: the column is dropped. Production had no products when this was written; the
--     check below aborts the migration if any owner has two products, before D9's unique index.
--   * Users insert products as drafts only and write named columns only. confirmed_at is
--     stamped by the database the first time a product leaves draft, and kept afterwards, so
--     status and confirmed_at always agree. A client-supplied time is never used (like
--     terms_accepted_at in profiles_app), and a confirmed product never goes back to draft.
--   * Subreddit names follow the draft schema (8.3) and are never user profiles ("u_<name>",
--     2.3.7). Aliases are 1 to 80 characters each and not blank. Names, aliases and search terms
--     hold no control characters (they go into model prompts). No nulls or nested arrays.
--   * At most 40 search terms (4.3) and 20 competitors per product. The cap is an AFTER INSERT
--     trigger, so an upsert that adds nothing is never refused, and it locks the product row
--     first, so concurrent inserts are counted one after another (PGlite has one connection, so
--     the tests cover the rule, not the concurrency).
--   * llm_usage records every model call (8.1) and is server only. llm_spend() sums it for the
--     spend caps; it takes the period starts as parameters instead of calling now(). The check
--     happens before a call, so concurrent calls can pass it together and go over by at most
--     their own cost.
--   * products_owner_id_idx is dropped because products_one_per_owner covers every lookup by
--     owner (not destructive to data).

-- ---------------------------------------------------------------------------
-- competitors
-- ---------------------------------------------------------------------------

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (
    char_length(name) between 1 and 80 and name ~ '[^[:space:]]' and name !~ '[[:cntrl:]]'
  ),
  domain text check (domain is null or (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' and char_length(domain) <= 253)),
  -- 1 to 80 characters each, at most 10, no nulls, none blank: checked on the list joined with a
  -- unit separator (chr(31)), because a check constraint cannot look inside an array otherwise.
  -- No entry may hold a control character, so none can hold the separator and pass as two.
  aliases text[] not null default '{}' check (
    cardinality(aliases) <= 10
    and coalesce(array_ndims(aliases), 1) = 1
    and array_position(aliases, null) is null
    and array_to_string(aliases, '') !~ '[[:cntrl:]]'
    and array_to_string(aliases, chr(31))
      ~ ('^([^' || chr(31) || ']{1,80}(' || chr(31) || '[^' || chr(31) || ']{1,80})*)?$')
    and (cardinality(aliases) = 0
      or (chr(31) || array_to_string(aliases, chr(31)) || chr(31))
        !~ (chr(31) || '[[:space:]]*' || chr(31)))
  ),
  origin text not null default 'user' check (origin in ('user', 'draft', 'discovered')),
  created_at timestamptz not null default now(),
  unique (product_id, name)
);

-- Move existing values, then drop the array. Control characters become spaces, names are
-- trimmed, blanks are skipped and anything over 80 characters is cut to fit, so every moved name
-- meets the new checks and the move cannot fail halfway.
insert into public.competitors (product_id, name, origin)
  select p.id,
    regexp_replace(left(regexp_replace(regexp_replace(c.name, '[[:cntrl:]]', ' ', 'g'),
      '^[[:space:]]+|[[:space:]]+$', '', 'g'), 80), '[[:space:]]+$', ''),
    'user'
  from public.products p, unnest(p.competitors) as c(name)
  where regexp_replace(c.name, '[[:cntrl:]]', ' ', 'g') ~ '[^[:space:]]'
  on conflict do nothing;
alter table public.products drop column competitors;

alter table public.competitors enable row level security;
revoke all on public.competitors from anon, authenticated;
grant select, delete on public.competitors to authenticated;
-- origin is set when a row is created (by the draft, the user, or Track on the Rivals tab) and
-- never rewritten; product_id is never moved; ids and times come from the database. A client
-- upsert (merge-duplicates) would need update on those columns, so the app saves competitors as
-- inserts, updates and deletes.
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

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

alter table public.products
  add column one_liner text check (char_length(one_liner) <= 160),
  add column subreddits text[] not null default '{}' check (
    cardinality(subreddits) <= 10
    and coalesce(array_ndims(subreddits), 1) = 1
    and array_position(subreddits, null) is null
    -- No entry may hold the separator itself, or "SaaS,startups" would pass as two names.
    and strpos(array_to_string(subreddits, ''), ',') = 0
    and array_to_string(subreddits, ',') ~ '^([A-Za-z0-9_]{2,21}(,[A-Za-z0-9_]{2,21})*)?$'
    and (',' || array_to_string(subreddits, ',')) !~* ',u_'
  ),
  add column confirmed_at timestamptz,
  add column relevance_threshold smallint not null default 60 check (relevance_threshold between 40 and 95);

-- D9: one product per owner. Abort with a clear message rather than half-way through.
do $$
begin
  if exists (select 1 from public.products group by owner_id having count(*) > 1) then
    raise exception 'onboarding: an owner has more than one product; resolve that before D9';
  end if;
end;
$$;

-- The unique index also serves every lookup by owner, so the old one goes.
create unique index products_one_per_owner on public.products (owner_id);
drop index public.products_owner_id_idx;

-- Users write named columns only. Inserts are always drafts (status takes its default), and
-- confirmed_at, ids and times are the database's. owner_id is insertable but never updatable, so
-- a client upsert of a product fails by design: the app inserts the draft, then updates it.
revoke insert, update on public.products from authenticated;
grant insert (owner_id, url, name, description, audience, one_liner, subreddits, relevance_threshold)
  on public.products to authenticated;
grant update (url, name, description, audience, one_liner, subreddits, relevance_threshold, status)
  on public.products to authenticated;

-- Products confirmed before this migration (status already past draft) count as confirmed then.
update public.products set confirmed_at = updated_at where status <> 'draft';
alter table public.products
  add constraint products_confirmed_unless_draft check (status = 'draft' or confirmed_at is not null);

create function public.products_guard_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.confirmed_at is not null then
    if new.status = 'draft' then
      raise exception using
        errcode = 'check_violation',
        message = 'a confirmed product cannot go back to draft',
        hint = 'product_confirmed';
    end if;
    new.confirmed_at = old.confirmed_at;
  elsif new.status = 'draft' then
    new.confirmed_at = null;
  else
    -- Never trust a client-supplied confirmation time.
    new.confirmed_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.products_guard_confirmation() from public, anon, authenticated;

create trigger products_guard_confirmation
  before insert or update on public.products
  for each row execute function public.products_guard_confirmation();

-- ---------------------------------------------------------------------------
-- search_terms
-- ---------------------------------------------------------------------------

alter table public.search_terms
  add column intent text not null default 'problem'
    check (intent in ('problem', 'category', 'alternative', 'competitor')),
  add column paused boolean not null default false,
  add constraint search_terms_term_clean check (term ~ '[^[:space:]]' and term !~ '[[:cntrl:]]');

-- Users write named columns only, like products and competitors: a term never moves to another
-- product (which would also step around that product's cap), and ids and times are the
-- database's. M3 note: term selection must honor both active (M0) and paused.
revoke insert, update on public.search_terms from authenticated;
grant insert (product_id, term, active, intent, paused) on public.search_terms to authenticated;
grant update (term, active, intent, paused) on public.search_terms to authenticated;

-- ---------------------------------------------------------------------------
-- Per-product caps on terms and competitors
-- ---------------------------------------------------------------------------

create function public.enforce_per_product_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cap integer := tg_argv[0]::integer;
  n integer;
begin
  -- Serialize inserts for one product, so the count below cannot race. NO KEY UPDATE does not
  -- conflict with the KEY SHARE lock that foreign keys to the product take.
  perform 1 from public.products where id = new.product_id for no key update;
  if tg_table_name = 'search_terms' then
    select count(*) into n from public.search_terms where product_id = new.product_id;
  elsif tg_table_name = 'competitors' then
    select count(*) into n from public.competitors where product_id = new.product_id;
  else
    raise exception 'enforce_per_product_cap is not set up for %', tg_table_name;
  end if;
  if n > cap then
    raise exception using
      errcode = 'check_violation',
      message = format('a product holds at most %s %s', cap,
        case when tg_table_name = 'search_terms' then 'search terms' else 'competitors' end),
      hint = tg_table_name || '_cap';
  end if;
  return null;
end;
$$;

revoke all on function public.enforce_per_product_cap() from public, anon, authenticated;

-- AFTER INSERT fires only for rows actually inserted, so an upsert that conflicts is not counted.
create trigger search_terms_cap
  after insert on public.search_terms
  for each row execute function public.enforce_per_product_cap('40');

create trigger competitors_cap
  after insert on public.competitors
  for each row execute function public.enforce_per_product_cap('20');

-- ---------------------------------------------------------------------------
-- llm_usage: one row per model call. Server only.
-- ---------------------------------------------------------------------------

create table public.llm_usage (
  id bigint generated always as identity primary key,
  product_id uuid references public.products (id) on delete set null,
  task text not null check (task in ('draft', 'classify', 'synthesize', 'preview')),
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(10, 6) not null check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

alter table public.llm_usage enable row level security;
revoke all on public.llm_usage from anon, authenticated;
revoke all on sequence public.llm_usage_id_seq from anon, authenticated;

create policy llm_usage_deny_all on public.llm_usage
  for all to anon, authenticated using (false) with check (false);

-- The per-product monthly cap, and the product delete that sets product_id to null.
create index llm_usage_product_created_idx on public.llm_usage (product_id, created_at);
-- The global daily cap.
create index llm_usage_created_idx on public.llm_usage (created_at);

create function public.llm_spend(
  p_month_start timestamptz,
  p_day_start timestamptz,
  p_product_id uuid default null
)
returns table (product_month_usd numeric, global_day_usd numeric)
language sql
stable
set search_path = ''
as $$
  select
    coalesce((select sum(u.cost_usd) from public.llm_usage u
              where p_product_id is not null and u.product_id = p_product_id
                and u.created_at >= p_month_start), 0),
    coalesce((select sum(u.cost_usd) from public.llm_usage u
              where u.created_at >= p_day_start), 0);
$$;

revoke all on function public.llm_spend(timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.llm_spend(timestamptz, timestamptz, uuid) to service_role;
