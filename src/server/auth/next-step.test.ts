import { describe, expect, it } from "vitest";
import { type AccountState, isConfirmedProduct, nextStepFor } from "./next-step";

/** Where /app sends someone (docs/PLAN.md 4.2, 4.3). */

const ready: AccountState = {
  termsAccepted: true,
  product: { status: "active" },
  subscriptionStatus: "trialing",
};

describe("nextStepFor", () => {
  it("asks for the two confirmations first, whatever else is true", () => {
    expect(nextStepFor({ ...ready, termsAccepted: false })).toBe("/app/terms");
    expect(nextStepFor({ termsAccepted: false, product: null, subscriptionStatus: null })).toBe(
      "/app/terms",
    );
  });

  it("sends someone with no product to onboarding", () => {
    expect(nextStepFor({ ...ready, product: null })).toBe("/app/onboarding");
  });

  it("sends someone with a draft product back to onboarding to confirm it", () => {
    expect(nextStepFor({ ...ready, product: { status: "draft" } })).toBe("/app/onboarding");
  });

  it.each([null, "incomplete", "incomplete_expired", "canceled", "something_new"])(
    "sends a confirmed product without a live subscription (%s) to billing",
    (status) => {
      expect(nextStepFor({ ...ready, subscriptionStatus: status })).toBe("/app/billing");
    },
  );

  it.each(["past_due", "unpaid", "paused"])(
    "sends a %s subscription to settings to fix the card, never to a second checkout",
    (status) => {
      expect(nextStepFor({ ...ready, subscriptionStatus: status })).toBe("/app/settings");
    },
  );

  it.each(["trialing", "active"])("sends an entitled (%s) account to Reply", (status) => {
    expect(nextStepFor({ ...ready, subscriptionStatus: status })).toBe("/app/reply");
  });

  it("an entitled account with paused collection still reaches Reply", () => {
    expect(nextStepFor({ ...ready, product: { status: "paused" } })).toBe("/app/reply");
  });
});

describe("isConfirmedProduct (shared by /app and checkout)", () => {
  it.each([
    [null, false],
    [{ status: "draft" }, false],
    [{ status: "active" }, true],
    [{ status: "paused" }, true],
    [{ status: "archived" }, false],
  ])("%j is confirmed: %s", (product, expected) => {
    expect(isConfirmedProduct(product)).toBe(expected);
  });
});
