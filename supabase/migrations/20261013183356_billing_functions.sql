-- Atomic helpers for the Stripe webhook. Service role only.
--
-- Stripe does not guarantee event order and redelivers events. Both problems are handled here, in
-- one statement each, so they are race-free and testable (tests/db/billing-functions.test.ts).

-- Apply a billing patch to a profile unless a newer Stripe event has already been applied.
-- Only keys present in p_patch are written, so an explicit JSON null clears a column.
-- Returns false when the patch was stale or the profile does not exist.
create function public.apply_billing_patch(
  p_user_id uuid,
  p_event_at timestamptz,
  p_patch jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  rows_updated integer;
begin
  update public.profiles p
  set
    plan = case when p_patch ? 'plan'
      then p_patch ->> 'plan' else p.plan end,
    subscription_status = case when p_patch ? 'subscription_status'
      then p_patch ->> 'subscription_status' else p.subscription_status end,
    stripe_customer_id = case when p_patch ? 'stripe_customer_id'
      then p_patch ->> 'stripe_customer_id' else p.stripe_customer_id end,
    stripe_subscription_id = case when p_patch ? 'stripe_subscription_id'
      then p_patch ->> 'stripe_subscription_id' else p.stripe_subscription_id end,
    trial_end = case when p_patch ? 'trial_end'
      then (p_patch ->> 'trial_end')::timestamptz else p.trial_end end,
    current_period_end = case when p_patch ? 'current_period_end'
      then (p_patch ->> 'current_period_end')::timestamptz else p.current_period_end end,
    cancel_at_period_end = case when p_patch ? 'cancel_at_period_end'
      then (p_patch ->> 'cancel_at_period_end')::boolean else p.cancel_at_period_end end,
    -- A changed trial end means a new reminder is due.
    trial_reminder_sent_at = case
      when p_patch ? 'trial_end'
        and (p_patch ->> 'trial_end')::timestamptz is distinct from p.trial_end
      then null else p.trial_reminder_sent_at end,
    billing_event_at = p_event_at
  where p.id = p_user_id
    and (p.billing_event_at is null or p.billing_event_at <= p_event_at);

  get diagnostics rows_updated = row_count;
  return rows_updated > 0;
end;
$$;

-- Record a webhook event id. 'new' = first delivery, 'retry' = seen but not finished
-- (reprocess it), 'duplicate' = already processed (acknowledge and skip).
create function public.claim_billing_event(p_event_id text, p_type text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  rows_inserted integer;
  finished timestamptz;
begin
  insert into public.billing_events (stripe_event_id, type)
  values (p_event_id, p_type)
  on conflict (stripe_event_id) do nothing;

  get diagnostics rows_inserted = row_count;
  if rows_inserted = 1 then
    return 'new';
  end if;

  select processed_at into finished
  from public.billing_events
  where stripe_event_id = p_event_id;

  return case when finished is null then 'retry' else 'duplicate' end;
end;
$$;

revoke all on function public.apply_billing_patch(uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.claim_billing_event(text, text) from public, anon, authenticated;
grant execute on function public.apply_billing_patch(uuid, timestamptz, jsonb) to service_role;
grant execute on function public.claim_billing_event(text, text) to service_role;
