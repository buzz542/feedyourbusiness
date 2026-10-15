import type Stripe from "stripe";
import type { SubscriptionLike } from "./subscription";

/**
 * Ports for the billing module. The business logic depends on these small interfaces, not on the
 * Stripe SDK or Supabase, so it is tested with in-memory fakes and never touches the network.
 */

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

/** Columns of public.profiles that the Stripe webhook may write. ISO strings for dates. */
export type BillingPatch = {
  plan?: "none" | "pro";
  subscription_status?: SubscriptionStatus | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  trial_end?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
};

export interface BillingProfile {
  id: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
}

export interface TrialingProfile {
  id: string;
  trialEnd: Date;
  cancelAtPeriodEnd: boolean;
}

export type EventClaim = "new" | "retry" | "duplicate";

export interface ProfileStore {
  getBillingProfile(userId: string): Promise<BillingProfile | null>;
  findUserIdByCustomerId(customerId: string): Promise<string | null>;
  /** False when the patch is older than one already applied, or the profile no longer exists. */
  applyBillingPatch(userId: string, patch: BillingPatch, eventAt: Date): Promise<boolean>;
  claimEvent(eventId: string, type: string): Promise<EventClaim>;
  markEventProcessed(eventId: string): Promise<void>;
  listTrialingProfilesWithoutReminder(): Promise<TrialingProfile[]>;
  /** Atomically mark the reminder as sent. False if another run already claimed it. */
  claimTrialReminder(userId: string, now: Date): Promise<boolean>;
  releaseTrialReminder(userId: string): Promise<void>;
}

export interface PriceInfo {
  active: boolean;
  unitAmount: number | null;
  currency: string;
  interval: "day" | "week" | "month" | "year" | null;
  intervalCount: number | null;
}

export interface CancelState {
  cancelAtPeriodEnd: boolean;
  status: string;
  /** ISO time the subscription stops (trial end or period end). */
  accessUntil: string | null;
}

/** A registered Stripe webhook endpoint. Used by the health check, never for billing decisions. */
export interface WebhookEndpointInfo {
  url: string;
  status: string;
  enabledEvents: readonly string[];
}

export interface BillingStripe {
  getPrice(priceId: string): Promise<PriceInfo>;
  listWebhookEndpoints(): Promise<WebhookEndpointInfo[]>;
  /** Events of these types since `since` that some endpoint failed to receive (health check). */
  countUndeliveredEvents(args: { since: Date; types: readonly string[] }): Promise<number>;
  /** Current state of a subscription, or null if Stripe no longer has it. */
  getSubscription(subscriptionId: string): Promise<SubscriptionLike | null>;
  createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
  ): Promise<{ url: string | null }>;
  createPortalSession(args: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<CancelState>;
  /** Verify the signature and parse the event. Throws if the signature is invalid. */
  verifyWebhook(rawBody: string, signature: string): Stripe.Event;
}
