-- Migration `billing_consent` (docs/PLAN.md 6.7, 10.2): when the customer asked for the service to
-- start during the cancellation period. Written by the Stripe webhook only (service role), from the
-- time the checkout handler put in the subscription's metadata; a later consent (a new contract)
-- replaces an earlier one, never the reverse. No API
-- role but the service role may write it: `authenticated` keeps its column grants on profiles
-- (email_daily, email_weekly, terms_accepted_at) and gains nothing here.
alter table public.profiles add column service_consent_at timestamptz;
