import { describe, expect, it } from "vitest";
import { planStatus } from "./plan-status";

const PRICE = { unitAmount: 2900, currency: "usd", interval: "month" as const, intervalCount: 1 };
const END = new Date("2026-10-21T10:00:00Z");
const base = {
  subscriptionStatus: null,
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

describe("plan status in plain words", () => {
  it("trialing", () => {
    const s = planStatus({ ...base, subscriptionStatus: "trialing", trialEnd: END }, PRICE);
    expect(s.headline).toBe("Trial ends October 21, 2026. Then $29.00 a month.");
    expect(s).toMatchObject({ canCancel: true, canUpdateCard: true, canResume: false });
    expect(s.accessUntil).toEqual(END);
  });

  it("active", () => {
    const s = planStatus({ ...base, subscriptionStatus: "active", currentPeriodEnd: END }, PRICE);
    expect(s.headline).toBe("Active. Renews October 21, 2026. $29.00 a month.");
  });

  it("canceled at period end offers resume", () => {
    const s = planStatus(
      { ...base, subscriptionStatus: "trialing", trialEnd: END, cancelAtPeriodEnd: true },
      PRICE,
    );
    expect(s.headline).toBe("Canceled. You have access until October 21, 2026.");
    expect(s).toMatchObject({ canCancel: false, canResume: true });
  });

  it("past_due shows the banner and the card update", () => {
    const s = planStatus({ ...base, subscriptionStatus: "past_due", currentPeriodEnd: END }, PRICE);
    expect(s).toMatchObject({ pastDue: true, canUpdateCard: true, canStart: false });
  });

  it.each([null, "canceled", "incomplete_expired"])("%s offers the trial", (status) => {
    expect(planStatus({ ...base, subscriptionStatus: status }, PRICE).canStart).toBe(true);
  });

  it("works without a price", () => {
    expect(
      planStatus({ ...base, subscriptionStatus: "trialing", trialEnd: END }, null).headline,
    ).toBe("Trial ends October 21, 2026.");
  });
});
