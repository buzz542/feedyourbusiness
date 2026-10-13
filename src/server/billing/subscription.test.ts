import { describe, expect, it } from "vitest";
import { subscriptionFixture } from "./fakes";
import {
  customerIdOf,
  isEntitled,
  normalizeStatus,
  profilePatchFromSubscription,
} from "./subscription";

describe("isEntitled", () => {
  it.each([
    ["trialing", true],
    ["active", true],
    ["past_due", false],
    ["unpaid", false],
    ["canceled", false],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["paused", false],
    [null, false],
    [undefined, false],
    ["something_new", false],
  ])("%s -> %s", (status, expected) => {
    expect(isEntitled(status)).toBe(expected);
  });
});

describe("normalizeStatus", () => {
  it("keeps known statuses and turns unknown future ones into null instead of failing", () => {
    expect(normalizeStatus("trialing")).toBe("trialing");
    expect(normalizeStatus("brand_new_status")).toBeNull();
  });
});

describe("customerIdOf", () => {
  it("handles an id string or an expanded customer object", () => {
    expect(customerIdOf("cus_1")).toBe("cus_1");
    expect(customerIdOf({ id: "cus_2" })).toBe("cus_2");
  });
});

describe("profilePatchFromSubscription", () => {
  it("grants pro while trialing and records the trial end and period end", () => {
    const patch = profilePatchFromSubscription(subscriptionFixture());
    expect(patch).toEqual({
      plan: "pro",
      subscription_status: "trialing",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      trial_end: "2026-10-20T10:00:00.000Z",
      current_period_end: "2026-10-20T10:00:00.000Z",
      cancel_at_period_end: false,
    });
  });

  it("keeps pro for an active subscription with no trial", () => {
    const patch = profilePatchFromSubscription(
      subscriptionFixture({ status: "active", trial_end: null }),
    );
    expect(patch).toMatchObject({ plan: "pro", subscription_status: "active", trial_end: null });
  });

  it.each(["canceled", "unpaid", "past_due", "incomplete_expired"])(
    "revokes access when %s",
    (status) => {
      expect(profilePatchFromSubscription(subscriptionFixture({ status })).plan).toBe("none");
    },
  );

  it("revokes access for a status it does not recognise", () => {
    const patch = profilePatchFromSubscription(subscriptionFixture({ status: "from_the_future" }));
    expect(patch).toMatchObject({ plan: "none", subscription_status: null });
  });

  it("reports a scheduled cancellation without revoking access yet", () => {
    const patch = profilePatchFromSubscription(subscriptionFixture({ cancel_at_period_end: true }));
    expect(patch).toMatchObject({ plan: "pro", cancel_at_period_end: true });
  });

  it("tolerates a subscription with no items", () => {
    const patch = profilePatchFromSubscription(subscriptionFixture({ items: { data: [] } }));
    expect(patch.current_period_end).toBeNull();
  });
});
