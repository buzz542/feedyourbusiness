import { describe, expect, it } from "vitest";
import { verifyUnsubscribe } from "@/server/email/unsubscribe";
import {
  createDailyDigestHandler,
  digestJobs,
  enqueueDigests,
  londonClock,
  type DigestCard,
} from "./digest";
import { FakeJobStore } from "./fakes";
import type { Job } from "./ports";

const SECRET = "x".repeat(40);
const USER = "11111111-1111-4111-8111-111111111111";

describe("08:00 UK time across the daylight saving change", () => {
  it.each([
    // British Summer Time (UTC+1): the 07:00 UTC cron is 08:00 in London.
    ["2026-10-23T07:10:00Z", 8, true],
    ["2026-10-23T08:10:00Z", 9, false],
    // Clocks go back on 25 Oct 2026: from then the 08:00 UTC cron is 08:00 in London.
    ["2026-10-26T07:10:00Z", 7, false],
    ["2026-10-26T08:10:00Z", 8, true],
    // And forward again on 29 Mar 2026.
    ["2026-03-27T08:30:00Z", 8, true],
    ["2026-03-30T07:30:00Z", 8, true],
    ["2026-03-30T08:30:00Z", 9, false],
  ])("at %s London says %i o'clock (send: %s)", (iso, hour, send) => {
    expect(londonClock(new Date(iso)).hour).toBe(hour);
    expect(digestJobs(["p1"], new Date(iso)).length > 0).toBe(send);
  });

  it("exactly one of the two daily crons enqueues, every day of a year", async () => {
    const store = new FakeJobStore();
    for (let day = 0; day < 366; day++) {
      const base = Date.UTC(2026, 0, 1) + day * 86_400_000;
      for (const hour of [7, 8])
        await enqueueDigests({
          store,
          products: async () => ["p1"],
          now: new Date(base + hour * 3_600_000 + 59 * 60_000),
        });
    }
    expect(store.jobs.filter((j) => j.kind === "digest_daily")).toHaveLength(366);
    expect(store.jobs.filter((j) => j.kind === "digest_weekly").length).toBeGreaterThanOrEqual(52);
  });

  it("adds the Monday digest on Mondays only", () => {
    expect(digestJobs(["p1"], new Date("2026-10-26T08:05:00Z")).map((j) => j.kind)).toEqual([
      "digest_daily",
      "digest_weekly",
    ]);
    expect(digestJobs(["p1"], new Date("2026-10-27T08:05:00Z")).map((j) => j.kind)).toEqual([
      "digest_daily",
    ]);
  });
});

describe("daily posts email", () => {
  const NOW = new Date("2026-10-26T08:05:00Z");
  const card: DigestCard = {
    id: "c1",
    source: "reddit",
    community: "r/SaaS",
    category: "looking_for_tool",
    reason: "Asks for an invoice reminder tool",
    postedAt: new Date("2026-10-26T05:00:00Z"),
  };
  const job: Job = {
    id: "j1",
    kind: "digest_daily",
    productId: "p1",
    source: null,
    status: "running",
    payload: {},
    attempts: 1,
    runAfter: NOW,
  };
  const ctx = { now: () => NOW, deadline: Infinity };

  function setup(cards: DigestCard[], daily = true) {
    const sent: { to: string; text: string; html: string; headers?: Record<string, string> }[] = [];
    const claimed = new Set<string>();
    const handler = createDailyDigestHandler({
      recipient: async () => ({ userId: USER, email: "maker@example.test", daily, weekly: true }),
      newCards: async () => cards,
      claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
      mailer: () => ({ send: async (m) => void sent.push(m) }),
      siteUrl: "https://askedfor.example.test",
      secret: SECRET,
    });
    return { handler, sent };
  }

  it("lists source, community, age, category and reason, links to the card, says the line", async () => {
    const { handler, sent } = setup([card]);
    await handler(job, ctx);
    expect(sent).toHaveLength(1);
    const { text } = sent[0]!;
    expect(text).toContain("Looking for a tool · Reddit · r/SaaS · 3h");
    expect(text).toContain("Asks for an invoice reminder tool");
    expect(text).toContain("https://askedfor.example.test/app/reply?view=all#card-c1");
    expect(text).toContain("Say you built it.");
  });

  it("carries no post excerpt and no link to the post itself", async () => {
    const { handler, sent } = setup([card]);
    await handler(job, ctx);
    expect(sent[0]!.html).not.toMatch(/reddit\.com|excerpt/);
  });

  it("has a working one-click unsubscribe", async () => {
    const { handler, sent } = setup([card]);
    await handler(job, ctx);
    const header = sent[0]!.headers!["List-Unsubscribe"]!;
    expect(sent[0]!.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const token = new URL(header.slice(1, -1)).searchParams.get("t");
    expect(verifyUnsubscribe(SECRET, token)).toEqual({ userId: USER, list: "daily" });
  });

  it("sends no email when there are no new posts", async () => {
    const { handler, sent } = setup([]);
    expect(await handler(job, ctx)).toEqual({ status: "done", payload: { result: "nothing_new" } });
    expect(sent).toHaveLength(0);
  });

  it("sends nothing to someone who turned it off", async () => {
    const { handler, sent } = setup([card], false);
    await handler(job, ctx);
    expect(sent).toHaveLength(0);
  });

  it("never sends twice for the same job", async () => {
    const { handler, sent } = setup([card]);
    await handler(job, ctx);
    await handler(job, ctx);
    expect(sent).toHaveLength(1);
  });
});
