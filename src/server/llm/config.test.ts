import { describe, expect, it } from "vitest";
import { loadSpendCaps } from "./config";

describe("loadSpendCaps", () => {
  it("defaults to $3 per product per month and $25 a day overall", () => {
    expect(loadSpendCaps({})).toEqual({ productMonthlyUsd: 3, dailyUsd: 25 });
    expect(loadSpendCaps({ LLM_DAILY_USD_CAP: "" })).toEqual({
      productMonthlyUsd: 3,
      dailyUsd: 25,
    });
  });

  it("reads the env", () => {
    expect(
      loadSpendCaps({ LLM_MONTHLY_USD_CAP_PER_PRODUCT: "1.5", LLM_DAILY_USD_CAP: "10" }),
    ).toEqual({ productMonthlyUsd: 1.5, dailyUsd: 10 });
  });

  it.each(["0", "-1", "lots", "Infinity", "100000"])(
    "refuses %s rather than running without a cap",
    (value) => {
      expect(() => loadSpendCaps({ LLM_DAILY_USD_CAP: value })).toThrow(/positive numbers/);
    },
  );
});
