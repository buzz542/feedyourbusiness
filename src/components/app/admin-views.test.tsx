import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminViewsPanel } from "./admin-views";

/** Admin views (docs/PLAN.md 4.8): counts and sums, never post text or emails. */

describe("AdminViewsPanel", () => {
  it("renders health, costs and metrics with no post text or email", () => {
    const html = renderToStaticMarkup(
      <AdminViewsPanel
        views={{
          health: [
            {
              id: "hackernews",
              name: "Hacker News",
              enabled: true,
              lastRunAt: "2026-11-05T06:01:00.000Z",
              lastStatus: "done",
              failuresByClass: { Http429: 2 },
              usedToday: 140,
              dailyBudget: 300,
              usedThisMonth: 140,
              monthlyCap: null,
            },
          ],
          costs: {
            byDay: [{ day: "2026-11-05", vendor: 0.15, model: 0.03 }],
            byProduct: [
              { productId: "11111111-2222-4333-8444-555555555555", vendor: 0.15, model: 0.03 },
            ],
            totalThisMonth: 0.18,
          },
          metrics: {
            signedUp30d: 2,
            activated30d: 1,
            weeklyActiveUsers: 2,
            repliesPerActiveUserThisWeek: 1,
            trialing: 3,
            paying: 2,
            ended: 1,
          },
        }}
      />,
    );
    expect(html).toContain("Hacker News: switched on");
    expect(html).toContain("Http429 2");
    expect(html).toContain("Costs this month: $0.18");
    expect(html).toContain("Weekly active users: 2");
    expect(html).not.toMatch(/@[a-z]/i);
  });
});
