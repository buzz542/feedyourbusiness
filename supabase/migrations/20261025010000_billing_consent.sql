-- M8 billing_consent (docs/PLAN.md 6.7, 10.2): when the customer asked for the service to start
-- during the cancellation period. Written by the webhook (service role) from the subscription's
-- metadata, once; no API role can write it (the profiles column grant does not include it).

alter table public.profiles add column service_consent_at timestamptz;

-- Stores the consent time; a later consent (a new subscription) moves it forward, never back.
-- Returns true when this call stored it.
create function public.record_service_consent(p_user_id uuid, p_at timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  rows_updated integer;
begin
  update public.profiles
  set service_consent_at = p_at
  where id = p_user_id
    and p_at is not null
    and (service_consent_at is null or service_consent_at < p_at);
  get diagnostics rows_updated = row_count;
  return rows_updated > 0;
end;
$$;

revoke all on function public.record_service_consent(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_service_consent(uuid, timestamptz) to service_role;
