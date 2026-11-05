import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import type { BillingConfig } from "./config";
import { createStripeAdapter } from "./stripe-adapter";

/** cancelNow (docs/PLAN.md 10.6): only Stripe's word that a subscription ended counts as ended. */

const config = { secretKey: "sk_test_x" } as BillingConfig;
const invalid = (code: string) =>
  new Stripe.errors.StripeInvalidRequestError({
    message: "nope",
    code,
    type: "invalid_request_error",
  });

function stub(cancel: () => Promise<unknown>, retrieve: () => Promise<unknown>) {
  return { subscriptions: { cancel, retrieve } } as unknown as Stripe;
}

describe("cancelNow", () => {
  it("succeeds when Stripe cancels", async () => {
    const adapter = createStripeAdapter(
      config,
      stub(
        async () => ({}),
        async () => ({}),
      ),
    );
    await expect(adapter.cancelNow("sub_1")).resolves.toBeUndefined();
  });

  it("succeeds when Stripe has no such subscription", async () => {
    const adapter = createStripeAdapter(
      config,
      stub(
        async () => Promise.reject(invalid("resource_missing")),
        async () => ({}),
      ),
    );
    await expect(adapter.cancelNow("sub_1")).resolves.toBeUndefined();
  });

  it("succeeds when Stripe confirms it already ended", async () => {
    for (const status of ["canceled", "incomplete_expired"]) {
      const adapter = createStripeAdapter(
        config,
        stub(
          async () => Promise.reject(invalid("subscription_canceled")),
          async () => ({ status }),
        ),
      );
      await expect(adapter.cancelNow("sub_1")).resolves.toBeUndefined();
    }
  });

  it("fails when the lookup fails, or the subscription is still live", async () => {
    const lookupFails = createStripeAdapter(
      config,
      stub(
        async () => Promise.reject(invalid("other")),
        async () => Promise.reject(new Stripe.errors.StripeConnectionError({ message: "down" })),
      ),
    );
    await expect(lookupFails.cancelNow("sub_1")).rejects.toThrow();
    const stillLive = createStripeAdapter(
      config,
      stub(
        async () => Promise.reject(invalid("other")),
        async () => ({ status: "active" }),
      ),
    );
    await expect(stillLive.cancelNow("sub_1")).rejects.toThrow();
  });

  it("fails on any error that is not an invalid request", async () => {
    const adapter = createStripeAdapter(
      config,
      stub(
        async () => Promise.reject(new Stripe.errors.StripeAPIError({ message: "boom" })),
        async () => ({ status: "canceled" }),
      ),
    );
    await expect(adapter.cancelNow("sub_1")).rejects.toThrow();
  });
});

describe("liveSubscriptionIds", () => {
  const listing = (list: () => AsyncIterable<unknown>) =>
    ({ subscriptions: { list } }) as unknown as Stripe;

  it("lists the customer's subscriptions that can still bill", async () => {
    const adapter = createStripeAdapter(
      config,
      listing(async function* () {
        yield { id: "sub_a", status: "trialing" };
        yield { id: "sub_b", status: "canceled" };
        yield { id: "sub_c", status: "past_due" };
      }),
    );
    expect(await adapter.liveSubscriptionIds("cus_1")).toEqual(["sub_a", "sub_c"]);
  });

  it("returns nothing for a customer Stripe does not have, and fails on anything else", async () => {
    const missing = createStripeAdapter(
      config,
      listing(async function* () {
        throw invalid("resource_missing");
      }),
    );
    expect(await missing.liveSubscriptionIds("cus_test_old")).toEqual([]);
    const down = createStripeAdapter(
      config,
      listing(async function* () {
        throw new Stripe.errors.StripeConnectionError({ message: "down" });
      }),
    );
    await expect(down.liveSubscriptionIds("cus_1")).rejects.toThrow();
  });
});
