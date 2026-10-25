import { describe, expect, it } from "vitest";
import { hasHandle } from "@/server/synthesis/checks";
import { renderRivalReport } from "./export";
import { buildScorecards, rivalKeyOf } from "./view";

const L = "11111111-1111-4111-8111-111111111111";
const EXCERPT = "Ledgerly raised prices again and I am done with them";

describe("rival report export", () => {
  const scorecards = buildScorecards({
    week: "2026-10-19",
    thisWeek: [{ competitorId: L, toolName: null, issue: "pricing", complaints: 3, switching: 1 }],
    insights: [
      {
        week: "2026-10-12",
        competitorId: L,
        toolName: null,
        issue: "pricing",
        complaints: 1,
        switching: 0,
        summary: "Recent price rises push small teams away.",
      },
    ],
    names: new Map([[rivalKeyOf({ competitorId: L, toolName: null }), "Ledgerly"]]),
    pick: "all",
  });
  const md = renderRivalReport({
    week: "2026-10-19",
    productName: "Invoicer",
    scorecards,
    fixes: [{ title: "Flat pricing", summary: "One plan answers the main complaint." }],
  });

  it("has the counts, trends, summaries and fixes", () => {
    expect(md).toContain("## Ledgerly");
    expect(md).toContain("Complaints this week: 3");
    expect(md).toContain("Pricing: 3 (up from last week)");
    expect(md).toContain("Recent price rises push small teams away.");
    expect(md).toContain("**Flat pricing**");
  });

  it("contains no handles and no excerpt quotes", () => {
    expect(hasHandle(md)).toBe(false);
    expect(md).not.toContain(EXCERPT);
    expect(md).not.toMatch(/https?:\/\//);
  });
});
