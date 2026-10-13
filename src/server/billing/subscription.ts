import { ENTITLED_STATUSES, LIVE_SUBSCRIPTION_STATUSES } from "./constants";
import type { BillingPatch, SubscriptionStatus } from "./ports";

/** The parts of a Stripe subscription we read. stripe.Subscription satisfies this structurally. */
export interface SubscriptionLike {
  id: string;
  customer: string | { id: string };
  status: string;
  trial_end: number | null;
  cancel_at_period_end: boolean;
  metadata: Record<string, string>;
  items: { data: Array<{ current_period_end: number }> };
}

const KNOWN_STATUSES: readonly SubscriptionStatus[] = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
];

/** Unknown future statuses become null, which grants no access, instead of failing the webhook. */
export function normalizeStatus(status: string): SubscriptionStatus | null {
  return (KNOWN_STATUSES as readonly string[]).includes(status)
    ? (status as SubscriptionStatus)
    : null;
}

export function isEntitled(status: string | null | undefined): boolean {
  return status != null && (ENTITLED_STATUSES as readonly string[]).includes(status);
}

export function hasLiveSubscription(status: string | null | undefined): boolean {
  return status != null && (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

export const customerIdOf = (customer: string | { id: string }): string =>
  typeof customer === "string" ? customer : customer.id;

const iso = (unixSeconds: number | null | undefined): string | null =>
  unixSeconds == null ? null : new Date(unixSeconds * 1000).toISOString();

export function profilePatchFromSubscription(sub: SubscriptionLike): BillingPatch {
  const status = normalizeStatus(sub.status);
  return {
    plan: isEntitled(status) ? "pro" : "none",
    subscription_status: status,
    stripe_customer_id: customerIdOf(sub.customer),
    stripe_subscription_id: sub.id,
    trial_end: iso(sub.trial_end),
    current_period_end: iso(sub.items.data[0]?.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end,
  };
}
