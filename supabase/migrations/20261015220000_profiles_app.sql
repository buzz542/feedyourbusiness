-- M1 profiles_app (docs/PLAN.md 6.1): profile preferences and the first-party events table.
--
-- is_admin is set by the founder in SQL; no API role can write it. Users may write only their
-- email preferences and the time they accepted the terms. events holds first-party, cookieless
-- analytics written server-side (docs/PLAN.md 12.6): no IPs, no user agents, small props.

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

revoke all on public.events from anon, authenticated;
alter table public.events enable row level security;
create policy events_deny_all on public.events
  for all to anon, authenticated using (false) with check (false);

create index events_name_at_idx on public.events (name, at);
create index events_user_id_idx on public.events (user_id);

-- No API role, the service role included, may grant or remove admin. The founder sets it in the SQL
-- editor (role postgres). terms_accepted_at is the record of the 18+ and terms confirmations: when an
-- API role sets it, the database stamps it with the server time, and no API role can change it
-- afterwards. The founder (postgres) can still correct it, for example after a material terms change.
create function public.guard_profile_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role') then
    if tg_op = 'INSERT' then
      if new.is_admin then
        raise exception 'is_admin is set by the founder only' using errcode = '42501';
      end if;
    elsif new.is_admin is distinct from old.is_admin then
      raise exception 'is_admin is set by the founder only' using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and old.terms_accepted_at is not null then
      new.terms_accepted_at := old.terms_accepted_at;
    elsif new.terms_accepted_at is not null then
      new.terms_accepted_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_profile_fields() from public, anon, authenticated;

create trigger profiles_guard_fields
  before insert or update on public.profiles
  for each row execute function public.guard_profile_fields();
