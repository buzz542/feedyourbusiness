import { afterEach, describe, expect, it, vi } from "vitest";
import { type EventRow, type EventStore, EVENT_NAMES, track } from "./track";

/** First-party analytics (docs/PLAN.md 12.6): the events table only, written server-side. */

class FakeEventStore implements EventStore {
  rows: EventRow[] = [];
  fail = false;
  async insert(row: EventRow): Promise<void> {
    if (this.fail) throw new Error("insert failed for someone@example.test");
    this.rows.push(row);
  }
}

const USER = "00000000-0000-4000-8000-0000000000a1";

afterEach(() => vi.restoreAllMocks());

describe("track", () => {
  it("records a known event with safe props", async () => {
    const store = new FakeEventStore();
    expect(await track(store, "feed_opened", USER, { view: "today", count: 12, first: true })).toBe(
      true,
    );
    expect(store.rows).toEqual([
      { name: "feed_opened", userId: USER, props: { view: "today", count: 12, first: true } },
    ]);
  });

  it("records an event without a user, as account deletion does", async () => {
    const store = new FakeEventStore();
    expect(await track(store, "account_deleted", null)).toBe(true);
    expect(store.rows).toEqual([{ name: "account_deleted", userId: null, props: {} }]);
  });

  it("knows exactly the event names the database allows", () => {
    expect([...EVENT_NAMES].sort()).toEqual(
      [
        "signed_up",
        "product_confirmed",
        "checkout_started",
        "trial_started",
        "feed_opened",
        "rivals_opened",
        "build_opened",
        "post_saved",
        "post_replied",
        "post_hidden",
        "digest_opened",
        "subscription_canceled",
        "account_deleted",
      ].sort(),
    );
  });

  it.each(["page_viewed", "", "SIGNED_UP", "signed_up "])(
    "refuses the unknown event name %j",
    async (name) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = new FakeEventStore();
      expect(await track(store, name as never, USER)).toBe(false);
      expect(store.rows).toEqual([]);
    },
  );

  it.each([
    ["an email", { contact: "someone@example.test" }],
    ["an email without a dot", { contact: "someone@localhost" }],
    ["a URL", { from: "https://www.reddit.com/r/SaaS/comments/abc" }],
    ["a URL without a scheme", { from: "www.reddit.com" }],
    ["a domain", { site: "example.com" }],
    ["a path", { page: "/app/reply" }],
    ["long text", { note: "this is a sentence someone typed into a box" }],
    ["a long token", { tag: "a".repeat(41) }],
    ["a post or product id", { post: "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b" }],
    ["an author hash", { author: "9f86d081884c7d659a2feaa0c55ad015" }],
    ["a handle", { who: "@someone" }],
    ["a Reddit username", { who: "u/someone" }],
    ["a community name", { community: "r/SaaS" }],
    ["a large number", { phone: 447700900123 }],
    ["a non-finite number", { n: Number.POSITIVE_INFINITY }],
    ["a nested object", { nested: { a: 1 } }],
    ["an array", { list: ["a"] }],
    ["null", { x: null }],
    ["a bare community name under any key", { community: "saas" }],
    ["a bare community name under a known key", { view: "saas" }],
    ["a post id", { post: "t3_abc123" }],
    ["a bare username", { author: "someone" }],
    ["a label that is not one of ours", { source: "linkedin" }],
    ["a fractional count", { count: 1.5 }],
    ["a negative count", { count: -1 }],
    ["an unknown key", { note: "x" }],
  ])("refuses props containing %s", async (_label, props) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new FakeEventStore();
    expect(await track(store, "feed_opened", USER, props as never)).toBe(false);
    expect(store.rows).toEqual([]);
    // The refusal is logged by rule, never with the value.
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/someone|reddit|example|SaaS|4477/);
  });

  it("refuses a user id that is not a uuid", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new FakeEventStore();
    expect(await track(store, "signed_up", "someone@example.test")).toBe(false);
    expect(store.rows).toEqual([]);
  });

  it("never throws: a failed write returns false and logs the error class only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new FakeEventStore();
    store.fail = true;
    expect(await track(store, "signed_up", USER)).toBe(false);
    expect(error.mock.calls.flat().join(" ")).not.toContain("someone@example.test");
  });

  it("sends nothing to a third party: no network call is made", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await track(new FakeEventStore(), "post_saved", USER, { source: "hackernews" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
