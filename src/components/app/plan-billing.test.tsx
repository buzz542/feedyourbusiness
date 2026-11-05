import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TEST_PRICE } from "@/server/billing/fakes";
import { describePlan, type PlanProfile } from "@/server/billing/plan-status";
import { PlanBilling } from "./plan-billing";

/** Settings, Plan and billing (docs/PLAN.md 10.3). The two clicks themselves run in the E2E. */

const base: PlanProfile = {
  subscriptionStatus: "trialing",
  trialEnd: "2026-10-21T09:00:00.000Z",
  currentPeriodEnd: "2026-10-21T09:00:00.000Z",
  cancelAtPeriodEnd: false,
  hasCustomer: true,
};
const act = async () => ({ error: "test" });
const render = (p: Partial<PlanProfile>) =>
  renderToStaticMarkup(
    <PlanBilling
      view={describePlan({ ...base, ...p }, TEST_PRICE)}
      setCancellation={act}
      openCardPortal={act}
    />,
  );

describe("PlanBilling", () => {
  it("shows the status in plain words with Cancel and Update card, and no confirm step yet", () => {
    const html = render({});
    expect(html).toContain("Trial ends October 21, 2026. Then $29.00 a month.");
    expect(html).toContain("Cancel subscription");
    expect(html).toContain("Update card");
    expect(html).not.toContain("Yes, cancel");
    expect(html).not.toContain('role="alert"');
  });

  it("shows Resume for a canceled subscription", () => {
    const html = render({ cancelAtPeriodEnd: true });
    expect(html).toContain("Resume subscription");
    expect(html).not.toContain("Cancel subscription");
  });

  it("shows the past_due banner", () => {
    const html = render({ subscriptionStatus: "past_due" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Update your card to keep using AskedFor.");
  });

  it("offers the trial when there is no subscription", () => {
    const html = render({ subscriptionStatus: null, hasCustomer: false });
    expect(html).toContain('href="/app/billing"');
    expect(html).not.toContain("Update card");
  });
});
