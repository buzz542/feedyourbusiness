-- AskedFor core schema (M0). Source of truth: docs/BRIEF.md, "Core tables".
--
-- Privacy by construction (see .claude/rules/privacy.md):
--   * posts.excerpt is capped at 280 characters.
--   * posts.delete_after can never be later than 30 days after collection.
--   * No avatar, bio, follower or email columns on post tables (CI: compliance:schema).
--
-- Billing columns on profiles are an addition to the brief's profiles table. They hold the
-- minimum needed to run a Stripe subscription. See docs/PHASE0-FINDINGS.md.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'none' check (plan in ('none', 'pro')),
  trial_end timestamptz,
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  -- Billing (written only by the Stripe webhook, via the service role).
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text check (
    subscription_status in (
      'incomplete', 'incomplete_expired', 'trialing', 'active',
      'past_due', 'canceled', 'unpaid', 'paused'
    )
  ),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_reminder_sent_at timestamptz,
  -- Created time of the newest Stripe event applied; older events are ignored.
  billing_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile row for every new auth user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- products and search terms
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  url text not null check (url ~ '^https://' and char_length(url) <= 2048),
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 2000),
  audience text check (char_length(audience) <= 1000),
  competitors text[] not null default '{}',
  -- Nothing is collected until the owner confirms the profile (status = 'active').
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_owner_id_idx on public.products (owner_id);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create table public.search_terms (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  term text not null check (char_length(term) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, term)
);

-- ---------------------------------------------------------------------------
-- posts: the only table that holds third-party content
-- ---------------------------------------------------------------------------

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('bluesky', 'hackernews')),
  external_id text not null,
  url text not null check (url ~ '^https://'),
  excerpt text not null check (char_length(excerpt) <= 280),
  posted_at timestamptz not null,
  collected_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '30 days'),
  -- Hash of the author handle, kept for the suppression list.
  author_hash text not null,
  -- Only where the Reply tab needs it. Null otherwise.
  author_handle text,
  unique (source, external_id),
  constraint posts_retention_max_30_days
    check (delete_after <= collected_at + interval '30 days')
);

create index posts_delete_after_idx on public.posts (delete_after);
create index posts_author_hash_idx on public.posts (author_hash);

create table public.product_posts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  relevance smallint not null check (relevance between 0 and 100),
  category text not null check (
    category in ('looking_for_tool', 'pain_point', 'mentions_you', 'mentions_competitor', 'wish')
  ),
  reason text not null check (char_length(reason) <= 200),
  state text not null default 'new' check (state in ('new', 'saved', 'replied', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, post_id)
);

create index product_posts_feed_idx on public.product_posts (product_id, state, created_at desc);
create index product_posts_post_id_idx on public.product_posts (post_id);

create trigger product_posts_set_updated_at
  before update on public.product_posts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- themes: what the Build tab keeps after raw posts expire. No names, no quotes.
-- ---------------------------------------------------------------------------

create table public.themes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  week date not null,
  title text not null check (char_length(title) <= 160),
  summary text not null check (char_length(summary) <= 1000),
  count integer not null check (count >= 0),
  trend text not null default 'flat' check (trend in ('up', 'down', 'flat', 'new')),
  -- Cleared when the referenced posts expire.
  example_post_ids uuid[] not null default '{}' check (cardinality(example_post_ids) <= 3),
  created_at timestamptz not null default now(),
  unique (product_id, week, title)
);

-- ---------------------------------------------------------------------------
-- compliance tables: server-side only
-- ---------------------------------------------------------------------------

create table public.suppression (
  id uuid primary key default gen_random_uuid(),
  author_hash text not null,
  source text not null,
  reason text not null check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  unique (author_hash, source)
);

create table public.removal_requests (
  id uuid primary key default gen_random_uuid(),
  link_or_handle text not null check (char_length(link_or_handle) <= 500),
  contact_email text not null check (char_length(contact_email) <= 320),
  status text not null default 'received'
    check (status in ('received', 'verified', 'removed', 'rejected', 'closed')),
  -- Brief: handled within 30 days (statutory), target 72 hours.
  target_at timestamptz not null default (now() + interval '72 hours'),
  due_at timestamptz not null default (now() + interval '30 days'),
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger removal_requests_set_updated_at
  before update on public.removal_requests
  for each row execute function public.set_updated_at();

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  source text not null,
  usage_date date not null default ((now() at time zone 'utc')::date),
  reads integer not null default 0 check (reads >= 0),
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  unique (product_id, source, usage_date)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  target text,
  at timestamptz not null default now()
);

-- The audit log is append-only for every role.
create function public.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update_or_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();

-- Stripe webhook idempotency: one row per event id.
create table public.billing_events (
  stripe_event_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
