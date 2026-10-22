-- M1 profiles_app (docs/PLAN.md 6.1): profile preferences, the admin flag, and first-party events.
--
-- is_admin is set by the founder in SQL; no API role can write it. Users may write only their email
-- preferences and the moment they accepted the terms. events holds server-side analytics with no
-- cookies, IPs or user agents (docs/PLAN.md 12.6) and is deny-all for API roles.

alter table public.profiles
  add column is_admin boolean not null default false,
  add column email_daily boolean not null default true,
  add column email_weekly boolean not null default true,
  add column terms_accepted_at timestamptz;

grant update (email_daily, email_weekly, terms_accepted_at) on public.profiles to authenticated;

create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (name in (
    'signed_up', 'product_confirmed', 'checkout_started', 'trial_started', 'feed_opened',
    'rivals_opened', 'build_opened', 'post_saved', 'post_replied', 'post_hidden',
    'digest_opened', 'subscription_canceled', 'account_deleted')),
  props jsonb not null default '{}' check (pg_column_size(props) <= 1024),
  at timestamptz not null default now()
);

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
create policy events_deny_all on public.events
  for all to anon, authenticated using (false) with check (false);

create index events_name_at_idx on public.events (name, at);
create index events_user_id_idx on public.events (user_id);
