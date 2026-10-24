import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeProfileStore,
  FakeStripe,
  TEST_CONFIG,
  subscriptionEvent,
  subscriptionFixture,
} from "./fakes";
import {
  createCancelHandler,
  createCheckoutHandler,
  createPortalHandler,
  createWebhookHandler,
  type AuthedUser,
  type BillingDeps,
} from "./handlers";

let store: FakeProfileStore;
let stripe: FakeStripe;
let currentUser: AuthedUser | null;

const deps = (): BillingDeps => ({
  config: TEST_CONFIG,
  stripe,
  store,
  getUser: async () => currentUser,
  isAllowed: (email) => email === "maker@example.test",
});

const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.example.test${path}`, {
    method: "POST",
    headers: { origin: "https://app.example.test", "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  store = new FakeProfileStore();
  store.addUser("user-1");
  stripe = new FakeStripe();
  currentUser = { id: "user-1", email: "maker@example.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("pre-launch allowlist (docs/PLAN.md 12.10)", () => {
  beforeEach(() => {
    currentUser = { id: "user-1", email: "stranger@example.test" };
  });

  it("refuses checkout to a signed-in account off the allowlist, before touching Stripe", async () => {
    const response = await createCheckoutHandler(deps())(post("/x"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "private_beta" });
    expect(stripe.checkoutCalls).toEqual([]);
  });

  it("still lets an off-list subscriber cancel and reach the portal (cancel as easily as sign up)", async () => {
    store.addUser("user-1", {
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      subscription_status: "trialing",
    });
    const cancel = await createCancelHandler(deps())(post("/x", { action: "cancel" }));
    const portal = await createPortalHandler(deps())(post("/x"));
    expect(cancel.status).toBe(200);
    expect(portal.status).toBe(200);
    expect(stripe.cancelCalls).toHaveLength(1);
    expect(stripe.portalCalls).toHaveLength(1);
  });
});

describe.each([
  ["checkout", createCheckoutHandler, undefined],
  ["portal", createPortalHandler, undefined],
  ["cancel", createCancelHandler, { action: "cancel" }],
] as const)("%s: shared guards", (_name, make, body) => {
  it("rejects a cross-site request before looking at the session", async () => {
    const response = await make(deps())(
      post("/x", body, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a request with no origin information at all", async () => {
    const request = new Request("https://app.example.test/x", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
    expect((await make(deps())(request)).status).toBe(403);
  });

  it("requires a signed in user", async () => {
    currentUser = null;
    expect((await make(deps())(post("/x", body))).status).toBe(401);
  });
});

describe("checkout", () => {
  it("returns the Stripe URL for a signed in user", async () => {
    const response = await createCheckoutHandler(deps())(post("/api/billing/checkout"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.test/session_1" });
  });

  it("accepts a same-origin request that has Sec-Fetch-Site but no Origin header", async () => {
    const request = new Request("https://app.example.test/x", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect((await createCheckoutHandler(deps())(request)).status).toBe(200);
  });

  it.each(["trialing", "active", "past_due", "unpaid", "paused"] as const)(
    "refuses a second subscription while one is %s, so nobody is billed twice",
    async (status) => {
      store.addUser("user-1", { subscription_status: status, stripe_customer_id: "cus_1" });
      const response = await createCheckoutHandler(deps())(post("/x"));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "subscription_exists" });
      expect(stripe.checkoutCalls).toHaveLength(0);
    },
  );

  it.each(["incomplete", "incomplete_expired", "canceled"] as const)(
    "allows checkout again after a %s subscription",
    async (status) => {
      store.addUser("user-1", { subscription_status: status, stripe_customer_id: "cus_1" });
      expect((await createCheckoutHandler(deps())(post("/x"))).status).toBe(200);
    },
  );

  it("lets a lapsed subscriber check out again, on their existing customer", async () => {
    store.addUser("user-1", { subscription_status: "canceled", stripe_customer_id: "cus_1" });
    expect((await createCheckoutHandler(deps())(post("/x"))).status).toBe(200);
    expect(stripe.checkoutCalls[0]!.customer).toBe("cus_1");
  });

  it("hides Stripe errors behind a generic message", async () => {
    stripe.createCheckoutSession = async () => {
      throw new Error("Invalid API Key provided: sk_test_secret");
    };
    const response = await createCheckoutHandler(deps())(post("/x"));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("sk_test");
    expect(text).toContain("billing_unavailable");
  });
});

describe("portal", () => {
  it("opens the portal for a customer", async () => {
    store.addUser("user-1", { stripe_customer_id: "cus_1" });
    const response = await createPortalHandler(deps())(post("/x"));

    expect(response.status).toBe(200);
    expect(stripe.portalCalls).toEqual([
      { customerId: "cus_1", returnUrl: "https://app.example.test/app/settings" },
    ]);
  });

  it("answers 404 when the user has never been a customer", async () => {
    expect((await createPortalHandler(deps())(post("/x"))).status).toBe(404);
  });
});

describe("cancel: two clicks from Settings", () => {
  beforeEach(() =>
    store.addUser("user-1", { stripe_subscription_id: "sub_1", subscription_status: "trialing" }),
  );

  it("schedules cancellation at the end of the period and reports until when access lasts", async () => {
    const response = await createCancelHandler(deps())(post("/x", { action: "cancel" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cancelAtPeriodEnd: true,
      accessUntil: "2026-10-20T10:00:00.000Z",
    });
    expect(stripe.cancelCalls).toEqual([{ subscriptionId: "sub_1", cancel: true }]);
  });

  it("can undo the cancellation", async () => {
    await createCancelHandler(deps())(post("/x", { action: "resume" }));
    expect(stripe.cancelCalls).toEqual([{ subscriptionId: "sub_1", cancel: false }]);
  });

  it.each([[{ action: "refund" }], [{}], [null]])("rejects an invalid body %j", async (body) => {
    const request = post("/x");
    const bad = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(body),
    });
    expect((await createCancelHandler(deps())(bad)).status).toBe(400);
  });

  it("refuses an oversized cancel body", async () => {
    const big = post("/x", { action: "cancel", padding: "x".repeat(5_000) });
    expect((await createCancelHandler(deps())(big)).status).toBe(413);
  });

  it("answers 404 when there is no subscription", async () => {
    store.addUser("user-1");
    expect((await createCancelHandler(deps())(post("/x", { action: "cancel" }))).status).toBe(404);
  });
});

describe("webhook", () => {
  const signed = (event: unknown, signature = "valid-signature") =>
    new Request("https://app.example.test/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: JSON.stringify(event),
    });

  it("applies a correctly signed event", async () => {
    const event = subscriptionEvent("created", subscriptionFixture());
    const response = await createWebhookHandler({ stripe, store })(signed(event));

    expect(response.status).toBe(200);
    expect(store.row("user-1").plan).toBe("pro");
  });

  it("rejects a bad signature without touching the database", async () => {
    const event = subscriptionEvent("created", subscriptionFixture());
    const response = await createWebhookHandler({ stripe, store })(signed(event, "forged"));

    expect(response.status).toBe(400);
    expect(store.row("user-1").plan).toBe("none");
    expect(store.events.size).toBe(0);
  });

  it("rejects a request with no signature header", async () => {
    const request = new Request("https://app.example.test/w", { method: "POST", body: "{}" });
    expect((await createWebhookHandler({ stripe, store })(request)).status).toBe(400);
  });

  it("refuses an oversized body before reading it all, and before verifying anything", async () => {
    const verify = vi.spyOn(stripe, "verifyWebhook");
    const huge = new Request("https://app.example.test/w", {
      method: "POST",
      headers: { "stripe-signature": "valid-signature", "content-length": "5000000" },
      body: "{}",
    });

    expect((await createWebhookHandler({ stripe, store })(huge)).status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });

  it("refuses an oversized body even when content-length is missing", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(600_000));
        controller.enqueue(new Uint8Array(600_000));
        controller.close();
      },
    });
    const request = new Request("https://app.example.test/w", {
      method: "POST",
      headers: { "stripe-signature": "valid-signature" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    expect((await createWebhookHandler({ stripe, store })(request)).status).toBe(413);
  });

  it("answers 500 so Stripe retries when processing fails", async () => {
    store.failNextApply = true;
    const response = await createWebhookHandler({ stripe, store })(
      signed(subscriptionEvent("created", subscriptionFixture())),
    );
    expect(response.status).toBe(500);
  });

  it("answers 200 for an event type it ignores", async () => {
    const event = { id: "evt_ign", type: "invoice.paid", created: 1, data: { object: {} } };
    expect((await createWebhookHandler({ stripe, store })(signed(event))).status).toBe(200);
  });
});
