import { describe, expect, it } from "vitest";
import { buildExport } from "./export";

const EXCERPT = "Is there an app that sends invoice reminders automatically?";

describe("data export", () => {
  const out = buildExport(
    {
      account: {
        email: "maker@example.test",
        createdAt: "2026-10-01T00:00:00Z",
        termsAcceptedAt: "2026-10-01T00:00:00Z",
        emailDaily: true,
        emailWeekly: false,
        subscriptionStatus: "trialing",
        trialEnd: "2026-10-08T00:00:00Z",
        currentPeriodEnd: null,
      },
      product: { url: "https://invoicer.example.test", name: "Invoicer", owner_id: "u1", id: "p1" },
      competitors: [
        { name: "Ledgerly", domain: null, aliases: [], origin: "user", product_id: "p1" },
      ],
      terms: [{ term: "invoice reminders", intent: "problem", active: true, paused: false }],
      feed: [
        {
          url: "https://news.ycombinator.com/item?id=1",
          source: "hackernews",
          community: "Hacker News",
          category: "looking_for_tool",
          reason: "Asks for an invoice reminder tool",
          relevance: 88,
          state: "saved",
          excerpt: EXCERPT,
          author_hash: "abc123",
        },
      ],
      themes: [
        {
          week: "2026-10-19",
          kind: "ask",
          title: "Nudges",
          summary: "Ours.",
          count: 3,
          example_post_ids: ["x"],
        },
      ],
      rivalInsights: [],
    },
    new Date("2026-10-25T12:00:00Z"),
  );
  const json = JSON.stringify(out);

  it("contains the user's data", () => {
    expect(out.account.email).toBe("maker@example.test");
    expect(out.product?.name).toBe("Invoicer");
    expect(out.competitors[0]!.name).toBe("Ledgerly");
    expect(out.feed[0]!.url).toBe("https://news.ycombinator.com/item?id=1");
    expect(out.feed[0]!.reason).toBe("Asks for an invoice reminder tool");
  });

  it("never contains post excerpts, author hashes or internal ids", () => {
    expect(json).not.toContain(EXCERPT);
    expect(json).not.toContain("abc123");
    expect(json).not.toContain("owner_id");
    expect(json).not.toContain("example_post_ids");
  });
});
