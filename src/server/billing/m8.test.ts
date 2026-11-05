import { beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { nextStepFor } from "@/server/auth/next-step";
import { handleStripeEvent } from "./events";
import { FakeProfileStore, FakeStripe } from "./fakes";
import { createCancelHandler, createCheckoutHandler, type BillingDeps } from "./handlers";
import { applyWelcome } from "./welcome";

/** M8: the consent record (10.2), the tax-inclusive price (10.1) and the welcome step (7.3). */

const NOW = new Date("2026-11-02T12:00:00Z");
const SESSION = "cs_test_a1b2c3d4e5f6g7h8";
let store: FakeProfileStore;
let stripe: FakeStripe;

const deps = (): BillingDeps => ({
  config: {
    siteUrl: "https://app.example.test",
    priceId: "price_1",
    managedPayments: true,
  } as BillingDeps["config"],
  stripe,
  store,
  getUser: async () => ({ id: "user-1", email: "maker@example.test" }),
  isAllowed: () => true,
  getAccount: async () => ({
    termsAccepted: true,
    product: { status: "active" },
    subscriptionStatus: null,
  }),
  now: () => NOW,
});

const post = (body?: unknown) =>
  new Request("https://app.example.test/api/billing/checkout", {
    method: "POST",
    headers: { origin: "https://app.example.test", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  store = new FakeProfileStore();
  store.addUser("user-1");
  stripe = new FakeStripe();
});

describe("consent before checkout", () => {
  it.each([[undefined], [{}], [{ consent: "yes" }], [{ consent: false }]])(
    "answers 400 without { consent: true } (%j)",
    async (body) => {
      const response = await createCheckoutHandler(deps())(post(body));
      expect(response.status).toBe(400);
      expect(stripe.checkoutCalls).toHaveLength(0);
    },
  );

  it("puts the consent time in the subscription's metadata", async () => {
    const response = await createCheckoutHandler(deps())(post({ consent: true }));
    expect(response.status).toBe(200);
    expect(stripe.checkoutCalls[0]!.subscription_data?.metadata).toEqual({
      user_id: "user-1",
      service_consent_at: NOW.toISOString(),
    });
  });

  it("refuses a second checkout when Stripe has a live subscription our copy has not seen yet", async () => {
    store.addUser("user-1", { stripe_customer_id: "cus_1" });
    stripe.customerSubscriptions.set("cus_1", ["sub_new"]);
    const response = await createCheckoutHandler(deps())(post({ consent: true }));
    expect(response.status).toBe(409);
    expect(stripe.checkoutCalls).toHaveLength(0);
  });

  it.each([
    ["another amount", { unitAmount: 2500 }],
    ["another currency", { currency: "gbp" }],
    ["another interval", { interval: "year" as const }],
  ])("refuses a price that is not the advertised one (%s)", async (_, change) => {
    stripe.price = { ...stripe.price, ...change };
    const response = await createCheckoutHandler(deps())(post({ consent: true }));
    expect(response.status).toBe(502);
    expect(stripe.checkoutCalls).toHaveLength(0);
  });

  it("refuses a price that is not tax-inclusive, so no tax is added at checkout", async () => {
    stripe.price = { ...stripe.price, taxBehavior: "exclusive" };
    const response = await createCheckoutHandler(deps())(post({ consent: true }));
    expect(response.status).toBe(502);
    expect(stripe.checkoutCalls).toHaveLength(0);
  });

  it("has the webhook write service_consent_at, never moving it back", async () => {
    const sub = {
      id: "sub_1",
      customer: "cus_1",
      status: "trialing",
      trial_end: Math.floor(NOW.getTime() / 1000) + 7 * 86400,
      cancel_at_period_end: false,
      metadata: { user_id: "user-1", service_consent_at: NOW.toISOString() },
      items: { data: [{ current_period_end: Math.floor(NOW.getTime() / 1000) + 7 * 86400 }] },
    };
    stripe.subscriptions.set("sub_1", sub);
    const event = (id: string, created: number) =>
      ({
        id,
        type: "customer.subscription.updated",
        created,
        data: { object: sub },
      }) as unknown as Stripe.Event;
    await handleStripeEvent(event("evt_1", 1), { stripe, store });
    expect(store.consent.get("user-1")).toEqual(NOW);

    // A redelivered event from an older contract never moves the record back.
    const earlier = new Date(NOW.getTime() - 86_400_000);
    sub.metadata.service_consent_at = earlier.toISOString();
    await handleStripeEvent(event("evt_2", 2), { stripe, store });
    expect(store.consent.get("user-1")).toEqual(NOW);

    // A new subscription after a lapse carries a new consent, which is the one that counts.
    const later = new Date(NOW.getTime() + 30 * 86_400_000);
    sub.metadata.service_consent_at = later.toISOString();
    await handleStripeEvent(event("evt_3", 3), { stripe, store });
    expect(store.consent.get("user-1")).toEqual(later);
  });
});

describe("cancel a past-due subscription", () => {
  it.each(["past_due", "unpaid"])(
    "ends a %s subscription at once instead of at the period end",
    async (status) => {
      store.addUser("user-1", {
        subscription_status: status as "past_due",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
      });
      const response = await createCancelHandler(deps())(
        new Request("https://app.example.test/api/billing/cancel", {
          method: "POST",
          headers: { origin: "https://app.example.test", "content-type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        cancelAtPeriodEnd: false,
        ended: true,
        accessUntil: null,
      });
      expect(stripe.canceledNow).toEqual(["sub_1"]);
      expect(stripe.cancelCalls).toEqual([]);
    },
  );
});

describe("welcome step", () => {
  beforeEach(() => {
    stripe.sessions.set(SESSION, {
      clientReferenceId: "user-1",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      status: "complete",
      created: new Date(NOW.getTime() - 5 * 60_000),
    });
    stripe.subscriptions.set("sub_1", {
      id: "sub_1",
      customer: "cus_1",
      status: "trialing",
      trial_end: Math.floor(NOW.getTime() / 1000) + 7 * 86400,
      cancel_at_period_end: false,
      metadata: { user_id: "user-1" },
      items: { data: [{ current_period_end: Math.floor(NOW.getTime() / 1000) + 7 * 86400 }] },
    });
  });

  it("lands a just-paid user on Reply before the webhook arrives, and refuses a second checkout", async () => {
    expect(await applyWelcome({ stripe, store }, "user-1", SESSION)).toBe("applied");
    const profile = await store.getBillingProfile("user-1");
    expect(profile?.subscriptionStatus).toBe("trialing");
    expect(
      nextStepFor({
        termsAccepted: true,
        product: { status: "active" },
        subscriptionStatus: profile?.subscriptionStatus ?? null,
      }),
    ).toBe("/app/reply");
    const second = await createCheckoutHandler({
      ...deps(),
      getAccount: async () => ({
        termsAccepted: true,
        product: { status: "active" },
        subscriptionStatus: "trialing",
      }),
    })(post({ consent: true }));
    expect(second.status).toBe(409);
  });

  it("applies nothing for a session that is not complete, and says nobody paid", async () => {
    stripe.sessions.set(SESSION, { ...stripe.sessions.get(SESSION)!, status: "open" });
    expect(await applyWelcome({ stripe, store }, "user-1", SESSION)).toBe("not_paid");
    expect((await store.getBillingProfile("user-1"))?.subscriptionStatus ?? null).toBeNull();
  });

  it("an old session replayed from a bookmark never overwrites a newer subscription", async () => {
    // The user's current subscription is sub_2; cs_A created sub_1, which has since ended.
    store.addUser("user-1", {
      subscription_status: "trialing",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_2",
    });
    stripe.subscriptions.set("sub_1", {
      ...stripe.subscriptions.get("sub_1")!,
      status: "canceled",
    });
    expect(await applyWelcome({ stripe, store }, "user-1", SESSION)).toBe("stale");
    const profile = await store.getBillingProfile("user-1");
    expect(profile).toMatchObject({
      stripeSubscriptionId: "sub_2",
      subscriptionStatus: "trialing",
    });
  });

  it("is stamped with Stripe's session time, so a webhook that arrives after it still applies", async () => {
    expect(await applyWelcome({ stripe, store }, "user-1", SESSION)).toBe("applied");
    // Stripe's event for the subscription is created after the session (but before our clock).
    stripe.subscriptions.set("sub_1", {
      ...stripe.subscriptions.get("sub_1")!,
      cancel_at_period_end: true,
    });
    const created = Math.floor((NOW.getTime() - 4 * 60_000) / 1000);
    await handleStripeEvent(
      {
        id: "evt_after",
        type: "customer.subscription.updated",
        created,
        data: { object: stripe.subscriptions.get("sub_1") },
      } as unknown as Stripe.Event,
      { stripe, store },
    );
    expect(store.row("user-1").cancel_at_period_end).toBe(true);
  });

  it("a webhook that arrived first is never overwritten by the welcome step", async () => {
    stripe.subscriptions.set("sub_1", {
      ...stripe.subscriptions.get("sub_1")!,
      cancel_at_period_end: true,
    });
    await handleStripeEvent(
      {
        id: "evt_first",
        type: "customer.subscription.updated",
        created: Math.floor((NOW.getTime() - 60_000) / 1000),
        data: { object: stripe.subscriptions.get("sub_1") },
      } as unknown as Stripe.Event,
      { stripe, store },
    );
    stripe.subscriptions.set("sub_1", {
      ...stripe.subscriptions.get("sub_1")!,
      cancel_at_period_end: false,
    });
    expect(await applyWelcome({ stripe, store }, "user-1", SESSION)).toBe("stale");
    expect(store.row("user-1").cancel_at_period_end).toBe(true);
  });

  it("welcomes a returning subscriber whose old subscription ended onto the new one", async () => {
    store.addUser("user-1", {
      subscription_status: "canceled",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_old",
    });
    expect(await applyWelcome({ stripe, store }, "user-1", SESSION)).toBe("applied");
    expect(await store.getBillingProfile("user-1")).toMatchObject({
      stripeSubscriptionId: "sub_1",
      subscriptionStatus: "trialing",
    });
  });

  it("checkout.session.completed arriving first entitles the user, and a second checkout is refused", async () => {
    await handleStripeEvent(
      {
        id: "evt_completed",
        type: "checkout.session.completed",
        created: Math.floor((NOW.getTime() - 60_000) / 1000),
        data: {
          object: {
            mode: "subscription",
            client_reference_id: "user-1",
            customer: "cus_1",
            subscription: "sub_1",
          },
        },
      } as unknown as Stripe.Event,
      { stripe, store },
    );
    // The welcome step is now stale (its stamp is older), and that is fine: the state is there.
    expect(await applyWelcome({ stripe, store }, "user-1", SESSION)).toBe("stale");
    expect((await store.getBillingProfile("user-1"))?.subscriptionStatus).toBe("trialing");
    const second = await createCheckoutHandler(deps())(post({ consent: true }));
    expect(second.status).toBe(409);
  });

  it("applies nothing for another user's session or a malformed id", async () => {
    store.addUser("user-2");
    expect(await applyWelcome({ stripe, store }, "user-2", SESSION)).toBe("mismatch");
    expect(await applyWelcome({ stripe, store }, "user-1", "not-a-session")).toBe("invalid");
    expect((await store.getBillingProfile("user-2"))?.subscriptionStatus ?? null).toBeNull();
  });
});
