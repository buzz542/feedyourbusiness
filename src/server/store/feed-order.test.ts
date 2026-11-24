import { describe, expect, it } from "vitest";
import { FEED_ORDER } from "./feed";

/** The feed is newest first (the founder, 24 Nov 2026): a month of posts, the newest at the top. */
describe("FEED_ORDER", () => {
  it("sorts by when the post was written, newest first, then when we found it, then id", () => {
    expect(FEED_ORDER).toEqual([
      { column: "posted_at", ascending: false },
      { column: "created_at", ascending: false },
      { column: "id", ascending: true },
    ]);
  });

  it("never sorts by match score first, so a strong old match does not sit above a new one", () => {
    expect(FEED_ORDER.map((o) => o.column)).not.toContain("relevance");
    expect(FEED_ORDER[0]?.column).toBe("posted_at");
  });
});
