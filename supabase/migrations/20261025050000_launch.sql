-- M9 launch (docs/PLAN.md 6.8): the instant preview's results (24 hours at most, no author fields),
-- the removal form's extra fields, and sign-in attempts for the IP-hash rate limit the launch switch
-- needs (docs/TASKS.md M9). All stay deny-all for API roles: the server reaches them with the service
-- role only. purge_expired already deletes expired previews; sign-in attempts are cleared by the
-- server after 2 days.

create table public.preview_runs (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,                      -- HMAC of IP and UTC day; never the IP
  url_host text not null check (char_length(url_host) <= 253),
  result jsonb not null check (pg_column_size(result) <= 20000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (expires_at <= created_at + interval '24 hours')
);
create index preview_runs_ip_idx on public.preview_runs (ip_hash, created_at);
create index preview_runs_created_idx on public.preview_runs (created_at);

alter table public.preview_runs enable row level security;
revoke all on public.preview_runs from anon, authenticated;
create policy preview_runs_deny_all on public.preview_runs
  for all to anon, authenticated using (false) with check (false);

alter table public.removal_requests
  add column source text check (source in ('hackernews', 'bluesky', 'reddit', 'x')),
  add column details text check (char_length(details) <= 1000),
  add column ip_hash text;
create index removal_requests_ip_idx on public.removal_requests (ip_hash, created_at);
create index removal_requests_due_idx on public.removal_requests (status, due_at);

create table public.sign_in_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,                      -- HMAC of IP and UTC day; never the IP
  created_at timestamptz not null default now()
);
create index sign_in_attempts_ip_idx on public.sign_in_attempts (ip_hash, created_at);
create index sign_in_attempts_created_idx on public.sign_in_attempts (created_at);

alter table public.sign_in_attempts enable row level security;
revoke all on public.sign_in_attempts from anon, authenticated;
create policy sign_in_attempts_deny_all on public.sign_in_attempts
  for all to anon, authenticated using (false) with check (false);
