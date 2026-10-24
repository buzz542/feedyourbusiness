-- M1 profiles_app (docs/PLAN.md 6.1): admin flag, email preferences, terms acceptance, events.
--
--   * is_admin is set by the founder in SQL (as postgres). No API role can write it, the service
--     role included, so no server path can make someone an admin by mistake (4.8).
--   * A user may change only their two email preferences and accept the terms.
--   * terms_accepted_at is a consent record. The database stamps it with its own now() the first
--     time it is set and keeps that value afterwards; it can never be cleared. This is a deliberate
--     exception to "take p_now": a consent time must not come from a client or an injected clock.
--     Accepting again is a silent no-op, so a double submit never errors.
--   * events holds first-party, cookieless analytics (12.6). Server only: deny-all for API roles.

alter table public.profiles
  add column is_admin boolean not null default false,
  add column email_daily boolean not null default true,
  add column email_weekly boolean not null default true,
  add column terms_accepted_at timestamptz;

grant update (email_daily, email_weekly, terms_accepted_at) on public.profiles to authenticated;

create function public.profiles_guard_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role')
    and new.is_admin is distinct from (case when tg_op = 'INSERT' then false else old.is_admin end)
  then
    raise exception 'is_admin is set by the founder in SQL, never through the API';
  end if;

  if tg_op = 'UPDATE' and old.terms_accepted_at is not null then
    if new.terms_accepted_at is null then
      raise exception 'terms_accepted_at is recorded once and cannot be cleared';
    end if;
    new.terms_accepted_at = old.terms_accepted_at;
  elsif new.terms_accepted_at is not null then
    -- Never trust a client-supplied time for a consent record.
    new.terms_accepted_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_guard_columns() from public, anon, authenticated;

create trigger profiles_guard_columns
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_columns();

create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (name in (
    'signed_up', 'product_confirmed', 'checkout_started', 'trial_started', 'feed_opened',
    'rivals_opened', 'build_opened', 'post_saved', 'post_replied', 'post_hidden',
    'digest_opened', 'subscription_canceled', 'account_deleted')),
  props jsonb not null default '{}'
    check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 1024),
  at timestamptz not null default now()
);

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
revoke all on sequence public.events_id_seq from anon, authenticated;

create policy events_deny_all on public.events
  for all to anon, authenticated using (false) with check (false);

create index events_name_at_idx on public.events (name, at);
-- The purge (6.3) deletes events older than 13 months by time alone.
create index events_at_idx on public.events (at);
-- Account deletion sets user_id to null; this keeps that cascade from scanning the table.
create index events_user_id_idx on public.events (user_id);
