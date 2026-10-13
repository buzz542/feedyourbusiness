import { describe, expect, it } from "vitest";
import { formatInterval, formatMoney, renewalTerms } from "./terms";

describe("formatMoney", () => {
  it("formats minor units in the currency's own precision", () => {
    expect(formatMoney(2900, "usd")).toBe("$29.00");
    expect(formatMoney(2900, "GBP")).toBe("£29.00");
    expect(formatMoney(2900, "jpy")).toBe("¥2,900");
  });
});

describe("formatInterval", () => {
  it("pluralises only when the count is more than one", () => {
    expect(formatInterval("month")).toBe("month");
    expect(formatInterval("month", 3)).toBe("3 months");
  });
});

describe("renewalTerms", () => {
  const terms = renewalTerms({ unitAmount: 2900, currency: "usd", interval: "month" });

  it("states the trial, the exact charge, the renewal period and how to cancel", () => {
    expect(terms).toContain("7-day trial is free");
    expect(terms).toContain("$29.00");
    expect(terms).toContain("every month until you cancel");
    expect(terms).toContain("cancel online from Settings in two clicks");
  });

  it("contains no em dash and fits Stripe's 1200 character limit for custom text", () => {
    expect(terms).not.toContain("\u2014");
    expect(terms.length).toBeLessThanOrEqual(1200);
  });
});
