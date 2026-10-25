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
  /** For the invoice preview: the reminder states the full amount, tax included (10.5). */
  subscriptionId?: string | null;
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
  /** Stores the consent time once (record_service_consent); later calls never move it. */
  recordServiceConsent(userId: string, at: Date): Promise<boolean>;
}

export interface PriceInfo {
  active: boolean;
  unitAmount: number | null;
  currency: string;
  interval: "day" | "week" | "month" | "year" | null;
  intervalCount: number | null;
  /** "inclusive" when the amount already includes tax; anything else may add tax at checkout. */
  taxBehavior?: "inclusive" | "exclusive" | "unspecified" | null;
}

/** A completed Checkout Session, as the welcome step reads it (docs/PLAN.md 7.3). */
export interface CheckoutSessionInfo {
  clientReferenceId: string | null;
  subscriptionId: string | null;
  mode: string;
  createdAt: Date;
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
  /** A Checkout Session by id, or null if Stripe has none. */
  getCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo | null>;
  /** Cancels at once, with no further charge (account deletion, 10.6). */
  cancelNow(subscriptionId: string): Promise<void>;
  /** The next invoice's total, tax included, from Stripe's invoice preview; null if none. */
  previewNextInvoice(subscriptionId: string): Promise<{ total: number; currency: string } | null>;
  /** Verify the signature and parse the event. Throws if the signature is invalid. */
  verifyWebhook(rawBody: string, signature: string): Stripe.Event;
}
