import type Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkoutCompletedEvent,
  FakeProfileStore,
  subscriptionEvent,
  subscriptionFixture,
} from "./fakes";
import { startFirstRunAfterEvent, type FirstRunTriggerDeps } from "./first-run-trigger";

/**
 * The first run starts as soon as a webhook makes the owner entitled (the founder, 26 Nov 2026),
 * not when they come back to the app or at the next tick. Only an entitled owner with an active
 * product starts one: a first_run job for anyone else would finish "not_collectable" and use up
 * its once-per-product dedupe key.
 */
/** An update whose status was not entitled before it (incomplete to trialing, say). */
const withPrevious = (event: Stripe.Event, status: string): Stripe.Event => {
  // Plain objects: spreading Stripe's event union makes the type checker crawl.
  const plain = event as unknown as { data: Record<string, unknown> };
  return {
    ...plain,
    data: { ...plain.data, previous_attributes: { status } },
  } as unknown as Stripe.Event;
};
const becameEntitled = (event: Stripe.Event) => withPrevious(event, "incomplete");

let store: FakeProfileStore;
let product: { id: string; status: string } | null;
let started: string[];

const deps = (): FirstRunTriggerDeps => ({
  store,
  productFor: async () => product,
  startFirstRun: async (productId) => {
    started.push(productId);
  },
});

beforeEach(() => {
  store = new FakeProfileStore();
  store.addUser("user-1", { subscription_status: "trialing", stripe_customer_id: "cus_1" });
  product = { id: "prod-1", status: "active" };
  started = [];
});

describe("startFirstRunAfterEvent", () => {
  it("starts the first run when checkout completes for an entitled owner", async () => {
    expect(await startFirstRunAfterEvent(checkoutCompletedEvent(), deps())).toBe("started");
    expect(started).toEqual(["prod-1"]);
  });

  it("starts it from a subscription event, finding the owner by metadata or customer", async () => {
    await startFirstRunAfterEvent(subscriptionEvent("created", subscriptionFixture()), deps());
    await startFirstRunAfterEvent(
      becameEntitled(subscriptionEvent("updated", subscriptionFixture({ metadata: {} }))),
      deps(),
    );
    expect(started).toEqual(["prod-1", "prod-1"]);
  });

  it("ignores an update that does not move the owner into an entitled status, such as a renewal", async () => {
    // Job rows (and their dedupe keys) are purged after 30 days, so a renewal must never ask.
    const renewal = subscriptionEvent("updated", subscriptionFixture({ status: "active" }));
    const trialEnded = withPrevious(renewal, "trialing");
    expect(await startFirstRunAfterEvent(renewal, deps())).toBe("skipped");
    expect(await startFirstRunAfterEvent(trialEnded, deps())).toBe("skipped");
    expect(started).toEqual([]);
  });

  it("does nothing while the owner is not entitled", async () => {
    store.addUser("user-1", { subscription_status: "incomplete", stripe_customer_id: "cus_1" });
    expect(await startFirstRunAfterEvent(checkoutCompletedEvent(), deps())).toBe("skipped");
    expect(started).toEqual([]);
  });

  it("does nothing for a draft or paused product, or none", async () => {
    for (const p of [{ id: "prod-1", status: "draft" }, { id: "prod-1", status: "paused" }, null]) {
      product = p;
      expect(await startFirstRunAfterEvent(checkoutCompletedEvent(), deps())).toBe("skipped");
    }
    expect(started).toEqual([]);
  });

  it("does nothing for a cancellation, an unknown owner or another event type", async () => {
    const events = [
      subscriptionEvent("deleted", subscriptionFixture()),
      becameEntitled(
        subscriptionEvent("updated", subscriptionFixture({ metadata: {}, customer: "cus_other" })),
      ),
      checkoutCompletedEvent({ client_reference_id: null }),
      checkoutCompletedEvent({ mode: "payment" }),
      { id: "evt_x", type: "invoice.paid", created: 1, data: { object: {} } },
    ];
    for (const event of events)
      expect(await startFirstRunAfterEvent(event as never, deps())).toBe("skipped");
    expect(started).toEqual([]);
  });
});
