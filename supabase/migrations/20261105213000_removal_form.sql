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
