import { beforeEach, describe, expect, it } from "vitest";
import { nextStepFor } from "@/server/auth/next-step";
import { createCheckoutHandler } from "./handlers";
import {
  FakeProfileStore,
  FakeStripe,
  TEST_CONFIG,
  subscriptionEvent,
  subscriptionFixture,
} from "./fakes";
import { handleStripeEvent } from "./events";
import { confirmCheckout } from "./welcome";

const SESSION = "cs_test_a1B2c3D4e5F6g7H8";
let store: FakeProfileStore;
let stripe: FakeStripe;

beforeEach(() => {
  store = new FakeProfileStore();
  store.addUser("user-1");
  store.addUser("user-2");
  stripe = new FakeStripe();
  stripe.subscriptions.set(
    "sub_1",
    subscriptionFixture({
      metadata: { user_id: "user-1", service_consent_at: "2026-10-25T10:00:00.000Z" },
    }),
  );
  stripe.checkoutSessions.set(SESSION, {
    clientReferenceId: "user-1",
    subscriptionId: "sub_1",
    mode: "subscription",
    createdAt: new Date("2026-10-25T10:00:00Z"),
  });
});

const stateOf = (id: string) => ({
  termsAccepted: true,
  product: { id: "p", name: "P", status: "active" as const },
  subscriptionStatus: store.row(id).subscription_status ?? null,
});

describe("welcome step after checkout", () => {
  it("a just-paid user whose webhook has not arrived lands on Reply, not billing", async () => {
    expect(nextStepFor(stateOf("user-1")).path).toBe("/app/billing");
    expect(await confirmCheckout({ stripe, store }, "user-1", SESSION)).toEqual({
      ok: true,
      entitled: true,
    });
    expect(nextStepFor(stateOf("user-1")).path).toBe("/app/reply");
    expect(store.rows.get("user-1")!.serviceConsentAt?.toISOString()).toBe(
      "2026-10-25T10:00:00.000Z",
    );
  });

  it("and a second checkout is refused", async () => {
    await confirmCheckout({ stripe, store }, "user-1", SESSION);
    const response = await createCheckoutHandler({
      config: TEST_CONFIG,
      stripe,
      store,
      getUser: async () => ({ id: "user-1", email: "maker@example.test" }),
    })(
      new Request("https://app.example.test/api/billing/checkout", {
        method: "POST",
        headers: { origin: "https://app.example.test" },
        body: JSON.stringify({ consent: true }),
      }),
    );
    expect(response.status).toBe(409);
  });

  it("refuses someone else's Checkout Session", async () => {
    expect(await confirmCheckout({ stripe, store }, "user-2", SESSION)).toEqual({
      ok: false,
      reason: "not_yours",
    });
    expect(store.row("user-2").subscription_status).toBeUndefined();
  });

  it.each(["", "cs_x", "../../etc", "cs_test_<script>"])(
    "refuses a malformed id %j",
    async (id) => {
      expect(await confirmCheckout({ stripe, store }, "user-1", id)).toEqual({
        ok: false,
        reason: "invalid",
      });
    },
  );

  it("refuses an unknown session", async () => {
    expect(await confirmCheckout({ stripe, store }, "user-1", "cs_test_unknownunknown1")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("does not undo a newer webhook (the patch carries the session's time)", async () => {
    await handleStripeEvent(
      subscriptionEvent(
        "updated",
        subscriptionFixture({ status: "active" }),
        "2026-10-26T10:00:00Z",
      ),
      { store, stripe: { getSubscription: async () => subscriptionFixture({ status: "active" }) } },
    );
    await confirmCheckout({ stripe, store }, "user-1", SESSION);
    expect(store.row("user-1").subscription_status).toBe("active");
  });
});
