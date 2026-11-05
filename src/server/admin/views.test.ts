import { describe, expect, it } from "vitest";
import { costSummary, metricsSummary, sourceHealth } from "./views";

/** Admin views (docs/PLAN.md 4.8, 12.6): computed from rows, never holding post text or emails. */

const NOW = new Date("2026-11-05T12:00:00Z");
const day = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("sourceHealth", () => {
  it("gives each collect source its last run, failures by error class, usage and switch", () => {
    const rows = sourceHealth({
      sources: [
        {
          id: "hackernews",
          displayName: "Hacker News",
          enabled: true,
          dailyBudget: 300,
          monthlyCap: null,
        },
        {
          id: "reddit",
          displayName: "Reddit",
          enabled: false,
          dailyBudget: 120,
          monthlyCap: 18000,
        },
      ],
      jobs: [
        {
          source: "hackernews",
          kind: "collect",
          status: "done",
          last_error: null,
          finished_at: day(0),
          updated_at: day(0),
        },
        {
          source: "hackernews",
          kind: "collect",
          status: "failed",
          last_error: "Http429",
          finished_at: day(1),
          updated_at: day(1),
        },
        {
          source: "hackernews",
          kind: "collect",
          status: "failed",
          last_error: "Http429",
          finished_at: day(2),
          updated_at: day(2),
        },
        {
          source: "reddit",
          kind: "collect",
          status: "failed",
          last_error: "monthly_cap",
          finished_at: day(9),
          updated_at: day(9),
        },
      ],
      ledger: [
        { source: "hackernews", usage_date: "2026-11-05", reads: 140, cost_usd: 0 },
        { source: "reddit", usage_date: "2026-11-02", reads: 90, cost_usd: 0.14 },
        { source: "reddit", usage_date: "2026-10-30", reads: 500, cost_usd: 0.75 },
      ],
      now: NOW,
    });
    expect(rows[0]).toEqual({
      id: "hackernews",
      name: "Hacker News",
      enabled: true,
      lastRunAt: day(0),
      lastStatus: "done",
      failuresByClass: { Http429: 2 },
      usedToday: 140,
      dailyBudget: 300,
      usedThisMonth: 140,
      monthlyCap: null,
    });
    expect(rows[1]).toMatchObject({ enabled: false, usedThisMonth: 90, monthlyCap: 18000 });
  });
});

describe("costSummary", () => {
  it("adds vendor and model spend per day and per product, this month", () => {
    const summary = costSummary({
      ledger: [
        { product_id: "p1", usage_date: "2026-11-05", cost_usd: 0.15 },
        { product_id: "p2", usage_date: "2026-11-04", cost_usd: 0.3 },
        { product_id: "p2", usage_date: "2026-10-31", cost_usd: 9 },
      ],
      llm: [
        { product_id: "p1", created_at: "2026-11-05T09:00:00Z", cost_usd: 0.02 },
        { product_id: null, created_at: "2026-11-05T10:00:00Z", cost_usd: 0.01 },
      ],
      now: NOW,
    });
    expect(summary.byDay[0]).toEqual({ day: "2026-11-05", vendor: 0.15, model: 0.03 });
    expect(summary.byProduct).toEqual([
      { productId: "p2", vendor: 0.3, model: 0 },
      { productId: "p1", vendor: 0.15, model: 0.02 },
    ]);
    expect(summary.totalThisMonth).toBeCloseTo(0.48);
  });
});

describe("metricsSummary", () => {
  it("computes activation, weekly active users, replies per user and the plan split", () => {
    const u = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const m = metricsSummary({
      events: [
        { name: "signed_up", user_id: u(1), at: day(10) },
        { name: "signed_up", user_id: u(2), at: day(9) },
        { name: "product_confirmed", user_id: u(1), at: day(9) },
        { name: "feed_opened", user_id: u(1), at: day(1) },
        { name: "feed_opened", user_id: u(2), at: day(2) },
        { name: "post_replied", user_id: u(1), at: day(1) },
        { name: "post_replied", user_id: u(1), at: day(1) },
        { name: "post_replied", user_id: u(2), at: day(20) },
      ],
      statuses: { trialing: 3, active: 2, canceled: 1 },
      now: NOW,
    });
    expect(m).toEqual({
      signedUp30d: 2,
      activated30d: 1,
      weeklyActiveUsers: 2,
      repliesPerActiveUserThisWeek: 1,
      trialing: 3,
      paying: 2,
      ended: 1,
    });
    expect(JSON.stringify(m)).not.toMatch(/@|http/);
  });
});
