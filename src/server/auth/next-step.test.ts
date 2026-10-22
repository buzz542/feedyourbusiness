import { describe, expect, it } from "vitest";
import { nextStepFor, type AccountState } from "./next-step";

const NOW = new Date("2026-10-22T12:00:00Z");
const base: AccountState = {
  termsAcceptedAt: NOW,
  product: { status: "active" },
  subscriptionStatus: "trialing",
};

describe("nextStepFor: where /app sends a user (docs/PLAN.md 4.2, 4.3)", () => {
  it("terms not accepted: the terms step, before anything else", () => {
    expect(nextStepFor({ termsAcceptedAt: null, product: null, subscriptionStatus: null })).toBe(
      "/app/terms",
    );
    expect(nextStepFor({ ...base, termsAcceptedAt: null })).toBe("/app/terms");
  });

  it("no product: onboarding", () => {
    expect(nextStepFor({ ...base, product: null, subscriptionStatus: null })).toBe(
      "/app/onboarding",
    );
  });

  it("draft product: back to onboarding to confirm it, even when entitled", () => {
    expect(nextStepFor({ ...base, product: { status: "draft" } })).toBe("/app/onboarding");
  });

  it.each([null, "incomplete", "incomplete_expired", "canceled", "unpaid", "paused"] as const)(
    "confirmed product, not entitled (%s): billing",
    (status) => {
      expect(nextStepFor({ ...base, subscriptionStatus: status })).toBe("/app/billing");
    },
  );

  it("past_due: settings, to update the card (never a second checkout)", () => {
    expect(nextStepFor({ ...base, subscriptionStatus: "past_due" })).toBe("/app/settings");
  });

  it.each(["trialing", "active"] as const)("entitled (%s): Reply", (status) => {
    expect(nextStepFor({ ...base, subscriptionStatus: status })).toBe("/app/reply");
  });

  it("a paused product still opens Reply when entitled", () => {
    expect(nextStepFor({ ...base, product: { status: "paused" } })).toBe("/app/reply");
  });

  it("an unknown status grants nothing", () => {
    expect(nextStepFor({ ...base, subscriptionStatus: "mystery" })).toBe("/app/billing");
  });
});
