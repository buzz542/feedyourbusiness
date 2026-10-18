import { describe, expect, it } from "vitest";
import { FEED_PAGE_SIZE, feedHref, parseFeedFilters, type FeedFilters } from "./reply-filters";

/** The Reply tab's filters live in the URL (docs/PLAN.md 4.4), so a view can be bookmarked. */

const RIVAL = "6f1c1c3e-2b7a-4c55-9d0e-3a1f2b4c5d6e";

describe("parseFeedFilters", () => {
  it("defaults to Today, no filters, the product's threshold, page 1", () => {
    expect(parseFeedFilters({}, 60)).toEqual({
      view: "today",
      category: null,
      source: null,
      rival: null,
      min: 60,
      q: null,
      page: 1,
    });
  });

  it("reads every filter", () => {
    expect(
      parseFeedFilters(
        {
          view: "saved",
          category: "wish",
          source: "reddit",
          rival: RIVAL,
          min: "75",
          q: " late  fees ",
          page: "3",
        },
        60,
      ),
    ).toEqual({
      view: "saved",
      category: "wish",
      source: "reddit",
      rival: RIVAL,
      min: 75,
      q: "late fees",
      page: 3,
    });
  });

  it.each([
    ["view", "everything", { view: "today" }],
    ["category", "not_relevant", { category: null }],
    ["source", "linkedin", { source: null }],
    ["rival", "c1", { rival: null }],
    ["rival", "' or 1=1", { rival: null }],
    ["min", "39", { min: 60 }],
    ["min", "96", { min: 60 }],
    ["min", "7.5", { min: 60 }],
    ["page", "0", { page: 1 }],
    ["page", "11", { page: 10 }],
    ["q", "   ", { q: null }],
  ])("ignores a bad %s (%j)", (key, value, want) => {
    expect(parseFeedFilters({ [key]: value }, 60)).toMatchObject(want);
  });

  it("caps the search text at 100 characters", () => {
    expect(parseFeedFilters({ q: "x".repeat(150) }, 60).q).toHaveLength(100);
  });

  it("takes the first value when a key repeats", () => {
    expect(parseFeedFilters({ view: ["all", "saved"] }, 60).view).toBe("all");
  });

  it("keeps a product threshold inside 40 to 95", () => {
    expect(parseFeedFilters({}, 20).min).toBe(40);
    expect(parseFeedFilters({}, 99).min).toBe(95);
  });

  it("pages 50 cards at a time", () => {
    expect(FEED_PAGE_SIZE).toBe(50);
  });
});

describe("feedHref", () => {
  const base: FeedFilters = parseFeedFilters({}, 60);

  it("writes only what differs from the defaults", () => {
    expect(feedHref(base, {}, 60)).toBe("/app/reply");
    expect(feedHref(base, { view: "all", category: "wish" }, 60)).toBe(
      "/app/reply?view=all&category=wish",
    );
  });

  it("round-trips through the parser", () => {
    const filters: FeedFilters = {
      view: "replied",
      category: "pain_point",
      source: "hackernews",
      rival: RIVAL,
      min: 80,
      q: "100% & more",
      page: 2,
    };
    const href = feedHref(filters, {}, 60);
    const params = new URL(href, "https://askedfor.app").searchParams;
    expect(parseFeedFilters(Object.fromEntries(params), 60)).toEqual(filters);
  });

  it("goes back to page 1 when a filter changes", () => {
    expect(feedHref({ ...base, page: 3 }, { source: "bluesky" }, 60)).toBe(
      "/app/reply?source=bluesky",
    );
    expect(feedHref({ ...base, page: 3 }, { page: 4 }, 60)).toBe("/app/reply?page=4");
  });
});
