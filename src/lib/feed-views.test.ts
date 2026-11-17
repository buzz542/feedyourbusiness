import { describe, expect, it } from "vitest";
import { countsAfterMove, FEED_VIEWS, inView, type ViewCounts } from "./feed-views";

/**
 * The Reply views (docs/PLAN.md 4.4, plus Hidden) as the side panel counts them. The database
 * test (tests/db/feed.test.ts) checks inView against the SQL the feed runs, view by view.
 */

const NOW = new Date("2026-11-17T12:00:00Z");
const MIN = 60;
const recent = { createdAt: "2026-11-17T09:00:00Z", relevance: 80 };
const old = { createdAt: "2026-11-15T09:00:00Z", relevance: 80 };
const COUNTS: ViewCounts = { today: 4, all: 10, saved: 2, replied: 3, hidden: 1 };

describe("views", () => {
  it("has five views, Today first", () => {
    expect(FEED_VIEWS).toEqual(["today", "all", "saved", "replied", "hidden"]);
  });

  it("puts a post in a view by its state, its age and the minimum match", () => {
    expect(inView("today", { ...recent, state: "new" }, NOW, MIN)).toBe(true);
    expect(inView("today", { ...recent, state: "saved" }, NOW, MIN)).toBe(true);
    expect(inView("today", { ...recent, state: "replied" }, NOW, MIN)).toBe(false);
    expect(inView("today", { ...old, state: "new" }, NOW, MIN)).toBe(false);
    expect(inView("all", { ...old, state: "replied" }, NOW, MIN)).toBe(true);
    expect(inView("all", { ...old, state: "hidden" }, NOW, MIN)).toBe(false);
    expect(inView("hidden", { ...old, state: "hidden" }, NOW, MIN)).toBe(true);
    expect(inView("all", { ...recent, relevance: 59, state: "new" }, NOW, MIN)).toBe(false);
  });

  it("counts Today from exactly 24 hours ago", () => {
    const edge = { createdAt: "2026-11-16T12:00:00Z", relevance: 80, state: "new" as const };
    expect(inView("today", edge, NOW, MIN)).toBe(true);
    expect(inView("today", { ...edge, createdAt: "2026-11-16T11:59:59Z" }, NOW, MIN)).toBe(false);
  });
});

describe("countsAfterMove", () => {
  const move = (post: typeof recent, from: string, to: string) =>
    countsAfterMove(COUNTS, post, from as never, to as never, NOW, MIN);

  it("saving a post from today adds it to Saved and leaves Today and All alone", () => {
    expect(move(recent, "new", "saved")).toEqual({ ...COUNTS, saved: 3 });
  });

  it("hiding a saved post from today moves it out of Today, All and Saved into Hidden", () => {
    expect(move(recent, "saved", "hidden")).toEqual({
      today: 3,
      all: 9,
      saved: 1,
      replied: 3,
      hidden: 2,
    });
  });

  it("unhiding an older post puts it back in All, not in Today", () => {
    expect(move(old, "hidden", "new")).toEqual({ ...COUNTS, all: 11, hidden: 0 });
  });

  it("marking replied moves a post from Today to Replied", () => {
    expect(move(recent, "new", "replied")).toEqual({ ...COUNTS, today: 3, replied: 4 });
  });

  it("changes nothing for a post under the minimum match, which no count includes", () => {
    expect(move({ ...recent, relevance: 41 }, "new", "hidden")).toEqual(COUNTS);
  });

  it("never counts below zero", () => {
    const empty: ViewCounts = { today: 0, all: 0, saved: 0, replied: 0, hidden: 0 };
    expect(countsAfterMove(empty, recent, "saved", "new", NOW, MIN).saved).toBe(0);
  });
});
