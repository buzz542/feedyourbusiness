import { describe, expect, it } from "vitest";
import { buildScorecards, earlierWeeks, rivalKeyOf, type CountRow, type InsightRow } from "./view";

const L = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const WEEK = "2026-10-19";

const thisWeek: CountRow[] = [
  { competitorId: L, toolName: null, issue: "pricing", complaints: 5, switching: 2 },
  { competitorId: L, toolName: null, issue: "support", complaints: 1, switching: 0 },
  { competitorId: P, toolName: null, issue: "reliability", complaints: 2, switching: 1 },
  { competitorId: null, toolName: "Billwise", issue: "usability", complaints: 3, switching: 1 },
];
const insights: InsightRow[] = [
  {
    week: "2026-10-12",
    competitorId: L,
    toolName: null,
    issue: "pricing",
    complaints: 2,
    switching: 0,
    summary: "Price rises.",
  },
  {
    week: "2026-10-05",
    competitorId: L,
    toolName: null,
    issue: "pricing",
    complaints: 4,
    switching: 1,
    summary: "Older.",
  },
  {
    week: "2026-08-24",
    competitorId: L,
    toolName: null,
    issue: "support",
    complaints: 3,
    switching: 0,
    summary: "",
  },
  {
    week: "2026-10-12",
    competitorId: null,
    toolName: "billwise",
    issue: "usability",
    complaints: 3,
    switching: 0,
    summary: "",
  },
];
const names = new Map([
  [rivalKeyOf({ competitorId: L, toolName: null }), "Ledgerly"],
  [rivalKeyOf({ competitorId: P, toolName: null }), "Paidly"],
]);

describe("Rivals scorecards", () => {
  const all = buildScorecards({ week: WEEK, thisWeek, insights, names, pick: "all" });

  it("shows tracked rivals with this week's complaints and switchers", () => {
    expect(all.map((c) => [c.name, c.complaints, c.switching])).toEqual([
      ["Ledgerly", 6, 2],
      ["Paidly", 2, 1],
    ]);
  });

  it("orders issues by count with a trend against last week", () => {
    expect(all[0]!.issues).toEqual([
      { issue: "pricing", label: "Pricing", complaints: 5, trend: "up" },
      { issue: "support", label: "Support", complaints: 1, trend: "new" },
    ]);
  });

  it("has 9 weeks of history: 8 earlier weeks from insights, then this week live", () => {
    expect(earlierWeeks(WEEK)).toHaveLength(8);
    expect(earlierWeeks(WEEK)[0]).toBe("2026-08-24");
    expect(all[0]!.history).toEqual([3, 0, 0, 0, 0, 0, 4, 2, 6]);
  });

  it("keeps the newest summary per issue and skips empty ones", () => {
    expect(all[0]!.summaries).toEqual([{ issue: "pricing", text: "Price rises." }]);
  });

  it("Discovered shows untracked tools, case-folded", () => {
    const discovered = buildScorecards({
      week: WEEK,
      thisWeek,
      insights,
      names,
      pick: "discovered",
    });
    expect(discovered.map((c) => [c.name, c.complaints, c.issues[0]!.trend])).toEqual([
      ["Billwise", 3, "flat"],
    ]);
  });

  it("one rival shows just that rival, even with nothing this week", () => {
    const quiet = buildScorecards({
      week: WEEK,
      thisWeek: [],
      insights: [],
      names,
      pick: rivalKeyOf({ competitorId: P, toolName: null }),
    });
    expect(quiet.map((c) => [c.name, c.complaints])).toEqual([["Paidly", 0]]);
  });
});
