import { describe, expect, it } from "vitest";
import { monthlyCapFor, SOURCE_USER_AGENT } from "./config";

describe("pipeline config", () => {
  const vendor = { access: "vendor_api" as const };

  it("applies the monthly record cap to vendor sources only, 20,000 by default", () => {
    expect(monthlyCapFor({ access: "official_api" }, {}, "collect")).toBeNull();
    expect(monthlyCapFor(vendor, {}, "recheck")).toBe(20_000);
    expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: "5000" }, "recheck")).toBe(5_000);
    expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: " 0 " }, "recheck")).toBe(0);
  });

  it("holds 10 percent of the cap back from collection for deletion re-checks", () => {
    expect(monthlyCapFor(vendor, {}, "collect")).toBe(18_000);
    expect(monthlyCapFor(vendor, {}, "recheck")).toBe(20_000);
    expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: "1005" }, "collect")).toBe(904);
    expect(monthlyCapFor({ access: "official_api" }, {}, "recheck")).toBeNull();
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
});
