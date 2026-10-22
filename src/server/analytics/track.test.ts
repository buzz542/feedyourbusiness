import { afterEach, describe, expect, it, vi } from "vitest";
import { createTracker, EVENT_NAMES, type EventStore } from "./track";

function fakeStore(fail = false) {
  const rows: { userId: string | null; name: string; props: Record<string, unknown> }[] = [];
  const store: EventStore = {
    async insert(row) {
      if (fail) throw new Error("db down for someone@example.test");
      rows.push(row);
    },
  };
  return { store, rows };
}

afterEach(() => vi.restoreAllMocks());

describe("track", () => {
  it("records a known event with safe props", async () => {
    const { store, rows } = fakeStore();
    const track = createTracker(store);
    expect(
      await track("post_saved", "u1", {
        source: "hackernews",
        category: "wish",
        count: 3,
        first: true,
      }),
    ).toBe(true);
    expect(rows).toEqual([
      {
        userId: "u1",
        name: "post_saved",
        props: { source: "hackernews", category: "wish", count: 3, first: true },
      },
    ]);
  });

  it("allows no user (account_deleted is recorded without one)", async () => {
    const { store, rows } = fakeStore();
    expect(await createTracker(store)("account_deleted", null)).toBe(true);
    expect(rows[0]).toEqual({ userId: null, name: "account_deleted", props: {} });
  });

  it("matches the database's list of event names", () => {
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

  it("refuses an unknown event name", async () => {
    const { store, rows } = fakeStore();
    expect(await createTracker(store)("page_viewed" as never, "u1")).toBe(false);
    expect(rows).toEqual([]);
  });

  it.each([
    ["an email", { source: "someone@example.test" }],
    ["an obfuscated email", { source: "someone at example dot test@x" }],
    ["a URL", { source: "https://example.test/a" }],
    ["a scheme-less URL", { source: "www.example.test" }],
    ["a bare domain", { source: "example.test/path" }],
    ["long text", { source: "x".repeat(41) }],
    ["a sentence", { category: "I need a tool that does invoices" }],
    ["a nested object", { count: { a: 1 } }],
    ["an array", { first: ["a"] }],
    ["a bad key", { "Bad Key": 1 }],
    [
      "too many keys",
      Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`k${String.fromCharCode(97 + i)}`, 1]),
      ),
    ],
    ["a non-finite number", { count: Number.POSITIVE_INFINITY }],
  ])("refuses props with %s", async (_label, props) => {
    const { store, rows } = fakeStore();
    expect(await createTracker(store)("feed_opened", "u1", props as Record<string, never>)).toBe(
      false,
    );
    expect(rows).toEqual([]);
  });

  it("sends nothing to a third party", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { store } = fakeStore();
    await createTracker(store)("feed_opened", "u1", { view: "today" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws, and logs only the error class", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = fakeStore(true);
    expect(await createTracker(store)("feed_opened", "u1")).toBe(false);
    expect(log.mock.calls.flat().join(" ")).not.toContain("example.test");
  });
});
