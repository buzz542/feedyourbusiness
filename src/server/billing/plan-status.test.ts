import { describe, expect, it } from "vitest";
import { TEST_PRICE } from "./fakes";
import { describePlan, priceInWords, summaryText, type PlanProfile } from "./plan-status";

/** Settings, Plan and billing in plain words (docs/PLAN.md 4.7, 10.3). */

const base: PlanProfile = {
  subscriptionStatus: null,
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  hasCustomer: true,
};
const TRIAL_END = "2026-10-21T09:00:00.000Z";
const PERIOD_END = "2026-12-21T09:00:00.000Z";

describe("describePlan", () => {
  it("a trial says when it ends and what comes next, with cancel and update card", () => {
    const view = describePlan(
      { ...base, subscriptionStatus: "trialing", trialEnd: TRIAL_END, currentPeriodEnd: TRIAL_END },
      TEST_PRICE,
    );
    expect(summaryText(view)).toBe(
      "Trial ends October 21, 2026 at 9:00 AM UTC. Then $29.00 a month.",
    );
    expect(view).toMatchObject({
      canCancel: true,
      canResume: false,
      canUpdateCard: true,
      canStartTrial: false,
      banner: null,
      accessUntil: TRIAL_END,
    });
  });

  it("a canceled trial says access lasts until the end and nothing is charged, with resume", () => {
    const view = describePlan(
      { ...base, subscriptionStatus: "trialing", trialEnd: TRIAL_END, cancelAtPeriodEnd: true },
      TEST_PRICE,
    );
    expect(summaryText(view)).toBe(
      "Trial canceled. You keep access until October 21, 2026 at 9:00 AM UTC and will not be charged.",
    );
    expect(view.canCancel).toBe(false);
    expect(view.canResume).toBe(true);
  });

  it("an active plan says when it renews and at what price", () => {
    const view = describePlan(
      { ...base, subscriptionStatus: "active", currentPeriodEnd: PERIOD_END },
      TEST_PRICE,
    );
    expect(summaryText(view)).toBe("Renews on December 21, 2026 at 9:00 AM UTC at $29.00 a month.");
    expect(view.canCancel).toBe(true);
  });

  it("a canceled active plan offers resume and says when access ends", () => {
    const view = describePlan(
      {
        ...base,
        subscriptionStatus: "active",
        currentPeriodEnd: PERIOD_END,
        cancelAtPeriodEnd: true,
      },
      TEST_PRICE,
    );
    expect(summaryText(view)).toContain("You keep access until December 21, 2026 at 9:00 AM UTC");
    expect(view.canResume).toBe(true);
    expect(view.canCancel).toBe(false);
  });

  it("past_due and unpaid show the banner and update card", () => {
    for (const status of ["past_due", "unpaid"]) {
      const view = describePlan({ ...base, subscriptionStatus: status }, TEST_PRICE);
      expect(view.banner).toMatch(/payment did not go through/);
      expect(view.canUpdateCard).toBe(true);
      expect(view.canStartTrial).toBe(false);
    }
  });

  it("no subscription or an ended one offers the trial and no billing controls", () => {
    for (const status of [null, "canceled", "incomplete", "incomplete_expired"]) {
      const view = describePlan({ ...base, subscriptionStatus: status }, TEST_PRICE);
      expect(view).toMatchObject({
        canStartTrial: true,
        canCancel: false,
        canResume: false,
        canUpdateCard: false,
      });
    }
  });

  it("without a customer there is no card to update", () => {
    const view = describePlan(
      { ...base, subscriptionStatus: "trialing", hasCustomer: false },
      null,
    );
    expect(view.canUpdateCard).toBe(false);
  });

  it("gives the moment, not a bare UTC date: a US evening charge is shown on its own day", () => {
    // 02:00 UTC on November 10 is 9:00 PM on November 9 in New York.
    const view = describePlan(
      { ...base, subscriptionStatus: "trialing", trialEnd: "2026-11-10T02:00:00.000Z" },
      TEST_PRICE,
    );
    expect(summaryText(view, "America/New_York")).toBe(
      "Trial ends November 9, 2026 at 9:00 PM EST. Then $29.00 a month.",
    );
    expect(view.summary).toContainEqual({ at: "2026-11-10T02:00:00.000Z" });
  });

  it("a paused subscription can be canceled as well as restarted", () => {
    const view = describePlan({ ...base, subscriptionStatus: "paused" }, TEST_PRICE);
    expect(view.canCancel).toBe(true);
    expect(view.canUpdateCard).toBe(true);
  });

  it("never shows a price that is not the full price, or one it could not read", () => {
    expect(priceInWords({ ...TEST_PRICE, taxBehavior: "exclusive" })).toBeNull();
    expect(priceInWords(null)).toBeNull();
    const view = describePlan(
      { ...base, subscriptionStatus: "trialing", trialEnd: TRIAL_END },
      { ...TEST_PRICE, taxBehavior: "exclusive" },
    );
    expect(summaryText(view)).toBe("Trial ends October 21, 2026 at 9:00 AM UTC.");
  });
});
