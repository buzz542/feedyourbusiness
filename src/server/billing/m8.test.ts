import { beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { nextStepFor } from "@/server/auth/next-step";
import { handleStripeEvent } from "./events";
import { FakeProfileStore, FakeStripe } from "./fakes";
import { createCheckoutHandler, type BillingDeps } from "./handlers";
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

  it("refuses a price that is not tax-inclusive, so no tax is added at checkout", async () => {
    stripe.price = { ...stripe.price, taxBehavior: "exclusive" };
    const response = await createCheckoutHandler(deps())(post({ consent: true }));
    expect(response.status).toBe(502);
    expect(stripe.checkoutCalls).toHaveLength(0);
  });

  it("has the webhook write service_consent_at once", async () => {
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
    await handleStripeEvent(event("evt_2", 2), {
      stripe,
      store,
    });
    expect(store.consent.get("user-1")).toEqual(NOW);
  });
});

describe("welcome step", () => {
  beforeEach(() => {
    stripe.sessions.set(SESSION, {
      clientReferenceId: "user-1",
      customerId: "cus_1",
      subscriptionId: "sub_1",
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
    expect(await applyWelcome({ stripe, store, now: () => NOW }, "user-1", SESSION)).toBe(
      "applied",
    );
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

  it("applies nothing for another user's session or a malformed id", async () => {
    store.addUser("user-2");
    expect(await applyWelcome({ stripe, store, now: () => NOW }, "user-2", SESSION)).toBe(
      "mismatch",
    );
    expect(await applyWelcome({ stripe, store, now: () => NOW }, "user-1", "not-a-session")).toBe(
      "invalid",
    );
    expect((await store.getBillingProfile("user-2"))?.subscriptionStatus ?? null).toBeNull();
  });
});
