import { describe, expect, it } from "vitest";
import { costPerUnitFor, dailyBudgetFor, monthlyCapFor, SOURCE_USER_AGENT } from "./config";

describe("pipeline config", () => {
  const vendor = { access: "vendor_api" as const, costPerUnitUsd: 0.0015 };

  it("applies the monthly record cap to vendor sources only, 20,000 by default", () => {
    expect(monthlyCapFor({ access: "official_api", costPerUnitUsd: 0 }, {}, "collect")).toBeNull();
    expect(monthlyCapFor(vendor, {}, "recheck")).toBe(20_000);
    expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: "5000" }, "recheck")).toBe(5_000);
    expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: " 0 " }, "recheck")).toBe(0);
  });

  it("holds 10 percent of the cap back from collection for deletion re-checks", () => {
    expect(monthlyCapFor(vendor, {}, "collect")).toBe(18_000);
    expect(monthlyCapFor(vendor, {}, "recheck")).toBe(20_000);
    expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: "1005" }, "collect")).toBe(904);
    expect(monthlyCapFor({ access: "official_api", costPerUnitUsd: 0 }, {}, "recheck")).toBeNull();
  });

  it("stops vendor collection on a cap that is not a whole number, never lifting it", () => {
    for (const bad of ["abc", "1e9", "-5", "20000.5", "Infinity"])
      expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: bad }, "collect"), bad).toBe(0);
  });

  it("names a monitored contact in the user agent", () => {
    expect(SOURCE_USER_AGENT).toMatch(
      /^AskedFor\/1\.0 \(\+https:\/\/askedfor\.app; hello@askedfor\.app\)$/,
    );
  });

  it("reads each source's daily budget from its env var, with the plan's defaults", () => {
    const reddit = { id: "reddit", dailyBudget: 120 };
    const x = { id: "x", dailyBudget: 0 };
    const hn = { id: "hackernews", dailyBudget: 300 };
    expect(dailyBudgetFor(reddit, {})).toBe(120);
    expect(dailyBudgetFor(reddit, { REDDIT_DAILY_RECORDS_PER_PRODUCT: "60" })).toBe(60);
    expect(dailyBudgetFor(x, {})).toBe(0);
    expect(dailyBudgetFor(x, { X_DAILY_READS_PER_PRODUCT: "50" })).toBe(50);
    expect(dailyBudgetFor(hn, { REDDIT_DAILY_RECORDS_PER_PRODUCT: "5" })).toBe(300);
  });

  it("stops a source whose budget is not a whole number, never lifting it", () => {
    for (const bad of ["lots", "-1", "1.5", "1e3"]) {
      expect(
        dailyBudgetFor(
          { id: "reddit", dailyBudget: 120 },
          { REDDIT_DAILY_RECORDS_PER_PRODUCT: bad },
        ),
        bad,
      ).toBe(0);
      expect(
        dailyBudgetFor({ id: "x", dailyBudget: 0 }, { X_DAILY_READS_PER_PRODUCT: bad }),
        bad,
      ).toBe(0);
    }
  });

  it("prices Reddit records from BRIGHTDATA_COST_PER_1K, $1.50 by default", () => {
    const reddit = { id: "reddit", costPerUnitUsd: 0.0015 };
    expect(costPerUnitFor(reddit, {})).toBeCloseTo(0.0015, 10);
    expect(costPerUnitFor(reddit, { BRIGHTDATA_COST_PER_1K: "2.10" })).toBeCloseTo(0.0021, 10);
    expect(
      costPerUnitFor({ id: "x", costPerUnitUsd: 0.005 }, { BRIGHTDATA_COST_PER_1K: "9" }),
    ).toBe(0.005);
    // A price that cannot be read is never taken as cheaper than the plan's.
    for (const bad of ["free", "-1", ""])
      expect(costPerUnitFor(reddit, { BRIGHTDATA_COST_PER_1K: bad }), bad).toBeCloseTo(0.0015, 10);
  });
});
