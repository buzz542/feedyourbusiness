import { describe, expect, it, vi } from "vitest";
import { parseFeedFilters } from "@/lib/reply-filters";
import { createFeedLoader, toCard } from "./feed";

/** Mapping the feed functions' rows into cards, and asking for one row more than a page. */

const ROW = {
  id: "pp-1",
  relevance: 82,
  category: "mentions_competitor",
  reason: "Unhappy with a rival's pricing.",
  state: "new",
  created_at: "2026-10-18T08:00:00+00:00",
  highlight_start: 0,
  highlight_end: 8,
  tool_mentioned: "Ledgerly",
  competitor_id: "comp-1",
  competitor_name: "Ledgerly",
  rival_issue: "pricing",
  rival_sentiment: "negative",
  switching: true,
  source: "reddit",
  community: "r/freelance",
  url: "https://www.reddit.com/r/freelance/comments/1exa001/x/",
  excerpt: "Ledgerly raised its price again.",
  posted_at: "2026-10-18T07:00:00+00:00",
};

describe("toCard", () => {
  it("maps a row", () => {
    expect(toCard(ROW)).toEqual({
      id: "pp-1",
      relevance: 82,
      category: "mentions_competitor",
      reason: "Unhappy with a rival's pricing.",
      state: "new",
      linkedAt: new Date("2026-10-18T08:00:00Z"),
      highlight: { start: 0, end: 8 },
      toolMentioned: "Ledgerly",
      rival: { id: "comp-1", name: "Ledgerly", issue: "pricing", switching: true },
      source: "reddit",
      community: "r/freelance",
      url: "https://www.reddit.com/r/freelance/comments/1exa001/x/",
      excerpt: "Ledgerly raised its price again.",
      postedAt: new Date("2026-10-18T07:00:00Z"),
    });
  });

  it("keeps a card without labels plain", () => {
    const card = toCard({
      ...ROW,
      category: "wish",
      highlight_start: null,
      highlight_end: null,
      tool_mentioned: null,
      competitor_id: null,
      competitor_name: null,
      rival_issue: null,
      rival_sentiment: null,
      switching: false,
      community: null,
    });
    expect(card).toMatchObject({
      highlight: null,
      toolMentioned: null,
      rival: null,
      community: null,
    });
  });

  it("drops a highlight that does not fit the excerpt", () => {
    expect(toCard({ ...ROW, highlight_start: 10, highlight_end: 400 })!.highlight).toBeNull();
  });

  it("skips a row it cannot read, and a link that is not https", () => {
    expect(toCard({ ...ROW, category: "not_relevant" })).toBeNull();
    expect(toCard({ ...ROW, url: "javascript:alert(1)" })).toBeNull();
    expect(toCard({ ...ROW, url: "http://www.reddit.com/r/x/comments/1/" })).toBeNull();
  });
});

describe("createFeedLoader", () => {
  function fakeDb(rows: unknown[]) {
    const rpc = vi.fn(async (name: string) =>
      name === "reply_feed"
        ? { data: rows, error: null }
        : { data: [{ today: 1, all_posts: 2, saved: 3, replied: 4 }], error: null },
    );
    return { rpc };
  }

  it("asks for one row more than the pages shown, to know whether to offer Load more", async () => {
    const db = fakeDb(Array.from({ length: 51 }, (_, i) => ({ ...ROW, id: `pp-${i}` })));
    const now = new Date("2026-10-18T09:00:00Z");
    const filters = parseFeedFilters({ view: "all", source: "reddit", q: "price" }, 60);
    const feed = await createFeedLoader(db as never)("prod-1", filters, now);
    expect(db.rpc).toHaveBeenCalledWith("reply_feed", {
      p_product: "prod-1",
      p_view: "all",
      p_category: undefined,
      p_source: "reddit",
      p_competitor: undefined,
      p_min_relevance: 60,
      p_query: "price",
      p_limit: 51,
      p_offset: 0,
      p_now: now.toISOString(),
    });
    expect(feed.cards).toHaveLength(50);
    expect(feed.hasMore).toBe(true);
    expect(feed.counts).toEqual({ today: 1, all: 2, saved: 3, replied: 4 });
  });

  it("throws on a database error, naming no detail", async () => {
    const db = { rpc: vi.fn(async () => ({ data: null, error: { message: "secret detail" } })) };
    const filters = parseFeedFilters({}, 60);
    await expect(createFeedLoader(db as never)("p", filters, new Date())).rejects.toThrow(
      /^Supabase: could not load the feed$/,
    );
  });
});
