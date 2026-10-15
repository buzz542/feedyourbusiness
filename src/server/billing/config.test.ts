import { describe, expect, it } from "vitest";
import { BillingConfigError, loadBillingConfig } from "./config";

const base = {
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_abc123",
  STRIPE_PRICE_ID: "price_abc123",
  NEXT_PUBLIC_SITE_URL: "https://app.example.test/",
};

describe("loadBillingConfig", () => {
  it("accepts a test-mode configuration, defaults Managed Payments on, and trims the URL", () => {
    const config = loadBillingConfig(base);
    expect(config).toMatchObject({
      mode: "test",
      managedPayments: true,
      siteUrl: "https://app.example.test",
    });
  });

  it.each([
    ["missing secret key", { STRIPE_SECRET_KEY: undefined }],
    ["publishable key instead of secret", { STRIPE_SECRET_KEY: "pk_test_abc123" }],
    ["bad webhook secret", { STRIPE_WEBHOOK_SECRET: "nope" }],
    ["bad price id", { STRIPE_PRICE_ID: "prod_abc" }],
    ["bad site url", { NEXT_PUBLIC_SITE_URL: "not a url" }],
  ])("rejects %s, naming the field and never the value", (_label, patch) => {
    const run = () => loadBillingConfig({ ...base, ...patch });
    expect(run).toThrow(BillingConfigError);
    expect(run).not.toThrow(/abc123/);
  });

  describe("live mode is locked until the founder unlocks it", () => {
    const live = { ...base, STRIPE_SECRET_KEY: "sk_live_abc123" };

    it("refuses a live key without BILLING_LIVE_ENABLED", () => {
      expect(() => loadBillingConfig(live)).toThrow(/BILLING_LIVE_ENABLED/);
      expect(() => loadBillingConfig({ ...live, BILLING_LIVE_ENABLED: "false" })).toThrow(
        BillingConfigError,
      );
    });

    it("refuses live billing without a merchant of record", () => {
      expect(() =>
        loadBillingConfig({
          ...live,
          BILLING_LIVE_ENABLED: "true",
          STRIPE_MANAGED_PAYMENTS: "false",
        }),
      ).toThrow(/merchant of record/);
    });

    it("allows live mode only when both are set and trial reminders run hourly", () => {
      const hourly = { reminderCronPeriodHours: 1 };
      expect(loadBillingConfig({ ...live, BILLING_LIVE_ENABLED: "true" }, hourly)).toMatchObject({
        mode: "live",
        managedPayments: true,
      });
    });

    it("refuses live billing while trial reminders run only daily (Vercel Hobby)", () => {
      const run = () =>
        loadBillingConfig(
          { ...live, BILLING_LIVE_ENABLED: "true" },
          { reminderCronPeriodHours: 24 },
        );
      expect(run).toThrow(BillingConfigError);
      expect(run).toThrow(/hourly/);
    });

    it("keeps test mode working on the daily schedule", () => {
      expect(loadBillingConfig(base, { reminderCronPeriodHours: 24 }).mode).toBe("test");
    });

    it("treats restricted live keys as live too", () => {
      expect(() => loadBillingConfig({ ...base, STRIPE_SECRET_KEY: "rk_live_abc123" })).toThrow(
        /BILLING_LIVE_ENABLED/,
      );
    });
  });

  it("allows turning Managed Payments off in test mode", () => {
    expect(loadBillingConfig({ ...base, STRIPE_MANAGED_PAYMENTS: "false" }).managedPayments).toBe(
      false,
    );
  });
});
