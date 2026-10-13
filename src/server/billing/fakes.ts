import type Stripe from "stripe";
import type { BillingConfig } from "./config";
import type {
  BillingPatch,
  BillingProfile,
  BillingStripe,
  CancelState,
  EventClaim,
  PriceInfo,
  ProfileStore,
  TrialingProfile,
} from "./ports";
import type { SubscriptionLike } from "./subscription";

/**
 * In-memory test doubles. FakeProfileStore mirrors the semantics of the SQL functions
 * apply_billing_patch and claim_billing_event, which tests/db/billing-functions.test.ts verifies
 * against real Postgres. Test code only.
 */

interface Row {
  id: string;
  patch: BillingPatch;
  billingEventAt: Date | null;
  trialReminderSentAt: Date | null;
}

export class FakeProfileStore implements ProfileStore {
  rows = new Map<string, Row>();
  events = new Map<string, { processed: boolean }>();
  /** Set to make the next applyBillingPatch throw, to test retries. */
  failNextApply = false;

  addUser(id: string, patch: BillingPatch = {}): void {
    this.rows.set(id, {
      id,
      patch: { plan: "none", cancel_at_period_end: false, ...patch },
      billingEventAt: null,
      trialReminderSentAt: null,
    });
  }

  row(id: string): Row & BillingPatch {
    const r = this.rows.get(id);
    if (!r) throw new Error(`no such user ${id}`);
    return { ...r, ...r.patch };
  }

  async getBillingProfile(userId: string): Promise<BillingProfile | null> {
    const r = this.rows.get(userId);
    if (!r) return null;
    return {
      id: r.id,
      stripeCustomerId: r.patch.stripe_customer_id ?? null,
      stripeSubscriptionId: r.patch.stripe_subscription_id ?? null,
      subscriptionStatus: r.patch.subscription_status ?? null,
    };
  }

  async findUserIdByCustomerId(customerId: string): Promise<string | null> {
    for (const r of this.rows.values()) if (r.patch.stripe_customer_id === customerId) return r.id;
    return null;
  }

  async applyBillingPatch(userId: string, patch: BillingPatch, eventAt: Date): Promise<boolean> {
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error("simulated database failure");
    }
    const r = this.rows.get(userId);
    if (!r) return false;
    if (r.billingEventAt && r.billingEventAt.getTime() > eventAt.getTime()) return false;
    if ("trial_end" in patch && patch.trial_end !== r.patch.trial_end) r.trialReminderSentAt = null;
    r.patch = { ...r.patch, ...patch };
    r.billingEventAt = eventAt;
    return true;
  }

  async claimEvent(eventId: string): Promise<EventClaim> {
    const existing = this.events.get(eventId);
    if (!existing) {
      this.events.set(eventId, { processed: false });
      return "new";
    }
    return existing.processed ? "duplicate" : "retry";
  }

  async markEventProcessed(eventId: string): Promise<void> {
    const e = this.events.get(eventId);
    if (e) e.processed = true;
  }

  async listTrialingProfilesWithoutReminder(): Promise<TrialingProfile[]> {
    return [...this.rows.values()].flatMap((r) =>
      r.patch.subscription_status === "trialing" && r.patch.trial_end && !r.trialReminderSentAt
        ? [
            {
              id: r.id,
              trialEnd: new Date(r.patch.trial_end),
              cancelAtPeriodEnd: r.patch.cancel_at_period_end ?? false,
            },
          ]
        : [],
    );
  }

  async claimTrialReminder(userId: string, now: Date): Promise<boolean> {
    const r = this.rows.get(userId);
    if (!r || r.trialReminderSentAt) return false;
    r.trialReminderSentAt = now;
    return true;
  }

  async releaseTrialReminder(userId: string): Promise<void> {
    const r = this.rows.get(userId);
    if (r) r.trialReminderSentAt = null;
  }
}

export const TEST_PRICE: PriceInfo = {
  active: true,
  unitAmount: 2900,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
};

export class FakeStripe implements BillingStripe {
  price: PriceInfo = { ...TEST_PRICE };
  checkoutCalls: Stripe.Checkout.SessionCreateParams[] = [];
  portalCalls: Array<{ customerId: string; returnUrl: string }> = [];
  cancelCalls: Array<{ subscriptionId: string; cancel: boolean }> = [];
  checkoutUrl: string | null = "https://checkout.stripe.test/session_1";
  webhookSecret = "valid-signature";

  async getPrice(): Promise<PriceInfo> {
    return this.price;
  }

  /** Current Stripe state by subscription id. Missing means Stripe no longer has it. */
  subscriptions = new Map<string, SubscriptionLike>();
  failNextRetrieve = false;

  async getSubscription(subscriptionId: string): Promise<SubscriptionLike | null> {
    if (this.failNextRetrieve) {
      this.failNextRetrieve = false;
      throw new Error("simulated Stripe outage");
    }
    return this.subscriptions.get(subscriptionId) ?? null;
  }

  async createCheckoutSession(params: Stripe.Checkout.SessionCreateParams) {
    this.checkoutCalls.push(params);
    return { url: this.checkoutUrl };
  }

  async createPortalSession(args: { customerId: string; returnUrl: string }) {
    this.portalCalls.push(args);
    return { url: "https://billing.stripe.test/portal_1" };
  }

  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<CancelState> {
    this.cancelCalls.push({ subscriptionId, cancel });
    return {
      cancelAtPeriodEnd: cancel,
      status: "trialing",
      accessUntil: "2026-10-20T10:00:00.000Z",
    };
  }

  verifyWebhook(rawBody: string, signature: string): Stripe.Event {
    if (signature !== this.webhookSecret) throw new Error("bad signature");
    return JSON.parse(rawBody) as Stripe.Event;
  }
}

export const TEST_CONFIG: BillingConfig = {
  secretKey: "sk_test_abc123",
  webhookSecret: "whsec_abc123",
  priceId: "price_abc123",
  siteUrl: "https://app.example.test",
  managedPayments: true,
  mode: "test",
};

let counter = 0;

export function subscriptionFixture(overrides: Partial<SubscriptionLike> = {}): SubscriptionLike {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "trialing",
    trial_end: Math.floor(Date.parse("2026-10-20T10:00:00Z") / 1000),
    cancel_at_period_end: false,
    metadata: { user_id: "user-1" },
    items: {
      data: [{ current_period_end: Math.floor(Date.parse("2026-10-20T10:00:00Z") / 1000) }],
    },
    ...overrides,
  };
}

export function subscriptionEvent(
  type: "created" | "updated" | "deleted",
  sub: SubscriptionLike,
  createdAt = "2026-10-13T10:00:00Z",
): Stripe.Event {
  return {
    id: `evt_${++counter}`,
    type: `customer.subscription.${type}`,
    created: Math.floor(Date.parse(createdAt) / 1000),
    data: { object: sub },
  } as unknown as Stripe.Event;
}

export function checkoutCompletedEvent(
  overrides: Record<string, unknown> = {},
  createdAt = "2026-10-13T10:00:00Z",
): Stripe.Event {
  return {
    id: `evt_${++counter}`,
    type: "checkout.session.completed",
    created: Math.floor(Date.parse(createdAt) / 1000),
    data: {
      object: {
        mode: "subscription",
        client_reference_id: "user-1",
        customer: "cus_1",
        subscription: "sub_1",
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}
