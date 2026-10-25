import { describe, expect, it } from "vitest";
import { computeMetrics } from "./metrics";

const NOW = new Date("2026-10-25T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("admin metrics", () => {
  const events = [
    { name: "signed_up", user_id: "a", at: ago(3) },
    { name: "signed_up", user_id: "b", at: ago(10) },
    { name: "signed_up", user_id: "c", at: ago(40) },
    { name: "product_confirmed", user_id: "a", at: ago(3) },
    { name: "feed_opened", user_id: "a", at: ago(1) },
    { name: "post_replied", user_id: "a", at: ago(1) },
    { name: "post_replied", user_id: "a", at: ago(2) },
    { name: "feed_opened", user_id: "b", at: ago(2) },
    { name: "account_deleted", user_id: null, at: ago(1) },
  ];
  const m = computeMetrics(events, ["active", "trialing", "canceled", null], 3, NOW);

  it("computes activation, weekly actives, replies per user and trial to paid", () => {
    expect(m).toEqual({
      signups30d: 2,
      activation: 0.5,
      weeklyActiveUsers: 2,
      repliesPerActiveUserPerWeek: 1,
      trialToPaid: 0.33,
      trialsStarted: 3,
      paying: 1,
    });
  });

  it("contains no post text, emails or user ids", () => {
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/@|"a"|"b"|excerpt/);
  });

  it("is empty-safe", () => {
    expect(computeMetrics([], [], 0, NOW)).toMatchObject({ activation: null, trialToPaid: null });
  });
});
