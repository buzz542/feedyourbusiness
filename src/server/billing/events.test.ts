import { beforeEach, describe, expect, it } from "vitest";
import { UnresolvedUserError, handleStripeEvent } from "./events";
import {
  FakeProfileStore,
  FakeStripe,
  checkoutCompletedEvent,
  subscriptionEvent,
  subscriptionFixture,
} from "./fakes";

let store: FakeProfileStore;
let stripe: FakeStripe;

const handle = (event: Parameters<typeof handleStripeEvent>[0]) =>
  handleStripeEvent(event, { store, stripe });

beforeEach(() => {
  store = new FakeProfileStore();
  store.addUser("user-1");
  stripe = new FakeStripe();
});

describe("checkout.session.completed", () => {
  it("links the Stripe customer and subscription to the user who started checkout", async () => {
    const outcome = await handle(checkoutCompletedEvent());

    expect(outcome).toBe("processed");
    expect(store.row("user-1")).toMatchObject({
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
    });
  });

  it("does not grant access by itself: only subscription events change the plan", async () => {
    await handle(checkoutCompletedEvent());
    expect(store.row("user-1").plan).toBe("none");
  });

  it.each([
    ["a one-off payment", { mode: "payment" }],
    ["no user reference", { client_reference_id: null }],
    ["no customer", { customer: null }],
  ])("ignores %s", async (_label, overrides) => {
    expect(await handle(checkoutCompletedEvent(overrides))).toBe("ignored");
    expect(store.row("user-1").stripe_customer_id).toBeUndefined();
  });

  it("accepts an expanded subscription object", async () => {
    await handle(checkoutCompletedEvent({ subscription: { id: "sub_9" } }));
    expect(store.row("user-1").stripe_subscription_id).toBe("sub_9");
  });
});

describe("customer.subscription.*", () => {
  it("starts a trial and grants access", async () => {
    await handle(subscriptionEvent("created", subscriptionFixture()));

    expect(store.row("user-1")).toMatchObject({
      plan: "pro",
      subscription_status: "trialing",
      trial_end: "2026-10-20T10:00:00.000Z",
    });
  });

  it("revokes access when the subscription is deleted", async () => {
    await handle(subscriptionEvent("created", subscriptionFixture(), "2026-10-13T10:00:00Z"));
    await handle(
      subscriptionEvent(
        "deleted",
        subscriptionFixture({ status: "canceled" }),
        "2026-10-21T10:00:00Z",
      ),
    );

    expect(store.row("user-1")).toMatchObject({ plan: "none", subscription_status: "canceled" });
  });

  it("finds the user by customer id when the subscription carries no user metadata", async () => {
    await handle(checkoutCompletedEvent());
    const sub = subscriptionFixture({ metadata: {} });

    expect(await handle(subscriptionEvent("updated", sub, "2026-10-13T10:05:00Z"))).toBe(
      "processed",
    );
    expect(store.row("user-1").plan).toBe("pro");
  });

  it("throws, so Stripe redelivers, when the user cannot be resolved yet", async () => {
    const sub = subscriptionFixture({ metadata: {}, customer: "cus_unknown" });
    await expect(handle(subscriptionEvent("created", sub))).rejects.toBeInstanceOf(
      UnresolvedUserError,
    );
  });
});

describe("trusting Stripe's current state, not the event payload", () => {
  it("applies the subscription as it is now when the payload is out of date", async () => {
    // The event says trialing, but by the time we process it the subscription is canceled.
    const stalePayload = subscriptionFixture({ status: "trialing" });
    stripe.subscriptions.set("sub_1", subscriptionFixture({ status: "canceled" }));

    await handle(subscriptionEvent("updated", stalePayload));

    expect(store.row("user-1")).toMatchObject({ plan: "none", subscription_status: "canceled" });
  });

  it("ends in the right state whichever way two same-second events are delivered", async () => {
    const second = "2026-10-14T10:00:00Z";
    const becameActive = subscriptionEvent(
      "updated",
      subscriptionFixture({ status: "active" }),
      second,
    );
    const becameCanceled = subscriptionEvent(
      "updated",
      subscriptionFixture({ status: "canceled" }),
      second,
    );
    stripe.subscriptions.set("sub_1", subscriptionFixture({ status: "canceled" })); // the truth

    for (const order of [
      [becameActive, becameCanceled],
      [becameCanceled, becameActive],
    ]) {
      store = new FakeProfileStore();
      store.addUser("user-1");
      for (const event of order) await handle(event);
      expect(store.row("user-1")).toMatchObject({ plan: "none", subscription_status: "canceled" });
    }
  });

  it("falls back to the payload when Stripe no longer has the subscription", async () => {
    await handle(subscriptionEvent("created", subscriptionFixture()));
    expect(store.row("user-1").plan).toBe("pro");
  });

  it("fails the event, so Stripe retries, when the lookup itself fails", async () => {
    const event = subscriptionEvent("created", subscriptionFixture());
    stripe.failNextRetrieve = true;

    await expect(handle(event)).rejects.toThrow("simulated Stripe outage");
    expect(store.row("user-1").plan).toBe("none");

    expect(await handle(event)).toBe("processed");
    expect(store.row("user-1").plan).toBe("pro");
  });

  it("resolves the user from the fresh subscription's metadata", async () => {
    stripe.subscriptions.set("sub_1", subscriptionFixture({ metadata: { user_id: "user-1" } }));
    const payload = subscriptionFixture({ metadata: {}, customer: "cus_unknown" });

    expect(await handle(subscriptionEvent("created", payload))).toBe("processed");
  });
});

describe("ordering and redelivery", () => {
  it("drops a stale event that arrives after a newer one", async () => {
    await handle(
      subscriptionEvent(
        "updated",
        subscriptionFixture({ status: "canceled" }),
        "2026-10-15T10:00:00Z",
      ),
    );

    const outcome = await handle(
      subscriptionEvent(
        "updated",
        subscriptionFixture({ status: "active" }),
        "2026-10-14T10:00:00Z",
      ),
    );

    expect(outcome).toBe("stale");
    expect(store.row("user-1")).toMatchObject({ plan: "none", subscription_status: "canceled" });
  });

  it("acknowledges and skips an event it has already processed", async () => {
    const event = subscriptionEvent("created", subscriptionFixture());
    expect(await handle(event)).toBe("processed");

    store.rows.get("user-1")!.patch.plan = "none";

    expect(await handle(event)).toBe("duplicate");
    expect(store.row("user-1").plan).toBe("none");
  });

  it("reprocesses an event whose earlier attempt failed before it finished", async () => {
    const event = subscriptionEvent("created", subscriptionFixture());
    store.failNextApply = true;

    await expect(handle(event)).rejects.toThrow("simulated database failure");
    expect(store.row("user-1").plan).toBe("none");

    expect(await handle(event)).toBe("processed");
    expect(store.row("user-1").plan).toBe("pro");
  });

  it("acknowledges events for a user who has since deleted their account", async () => {
    store.rows.delete("user-1");
    expect(await handle(subscriptionEvent("updated", subscriptionFixture()))).toBe("stale");
  });
});

describe("other events", () => {
  it("ignores events it does not handle without touching the database", async () => {
    const event = { id: "evt_x", type: "invoice.paid", created: 1, data: { object: {} } } as never;
    expect(await handle(event)).toBe("ignored");
    expect(store.events.size).toBe(0);
  });
});
