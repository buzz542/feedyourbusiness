import { describe, expect, it } from "vitest";
import { monthlyCapFor, SOURCE_USER_AGENT } from "./config";

describe("pipeline config", () => {
  const vendor = { access: "vendor_api" as const };

  it("applies the monthly record cap to vendor sources only, 20,000 by default", () => {
    expect(monthlyCapFor({ access: "official_api" }, {})).toBeNull();
    expect(monthlyCapFor(vendor, {})).toBe(20_000);
    expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: "5000" })).toBe(5_000);
    expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: " 0 " })).toBe(0);
  });

  it("stops vendor collection on a cap that is not a whole number, never lifting it", () => {
    for (const bad of ["abc", "1e9", "-5", "20000.5", "Infinity"])
      expect(monthlyCapFor(vendor, { BRIGHTDATA_MONTHLY_RECORD_CAP: bad }), bad).toBe(0);
  });

  it("names a monitored contact in the user agent", () => {
    expect(SOURCE_USER_AGENT).toMatch(
      /^AskedFor\/1\.0 \(\+https:\/\/askedfor\.app; hello@askedfor\.app\)$/,
    );
  });
});
