import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_NAMES, track, type EventSink } from "./track";

const NOW = new Date("2026-10-15T09:00:00Z");

function sink() {
  const rows: Parameters<EventSink["insert"]>[0][] = [];
  return { rows, insert: vi.fn(async (row: (typeof rows)[number]) => void rows.push(row)) };
}

describe("track (docs/PLAN.md 12.6)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records a known event with small, safe props", async () => {
    const s = sink();
    const result = await track(s, "post_saved", "u1", { source: "hackernews", relevance: 72 }, NOW);
    expect(result).toEqual({ ok: true });
    expect(s.rows).toEqual([
      {
        name: "post_saved",
        user_id: "u1",
        props: { source: "hackernews", relevance: 72 },
        at: NOW.toISOString(),
      },
    ]);
  });

  it("allows an event without a user (account deletion) and without props", async () => {
    const s = sink();
    expect(await track(s, "account_deleted", null, undefined, NOW)).toEqual({ ok: true });
    expect(s.rows[0]).toMatchObject({ user_id: null, props: {} });
  });

  it("refuses unknown event names", async () => {
    const s = sink();
    for (const name of ["page_view", "", "SIGNED_UP", "signed_up "]) {
      expect(await track(s, name, "u1", {}, NOW)).toEqual({ ok: false, reason: "unknown_event" });
    }
    expect(s.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["an email", { contact: "someone@example.test" }],
    ["an email without dots", { contact: "someone@localhost" }],
    ["a URL", { link: "https://www.reddit.com/r/SaaS/comments/abc" }],
    ["a bare domain", { site: "example.test" }],
    ["a path", { where: "/r/SaaS" }],
    ["a handle", { who: "@someone" }],
    ["free text", { note: "I really need a tool for invoices" }],
    ["long text", { token: "a".repeat(41) }],
    ["a nested object", { nested: { a: 1 } }],
    ["a bare username", { source: "throwaway_1234" }],
    ["an id", { source: "00000000-0000-4000-8000-0000000000a1" }],
    ["an unbounded number", { view: 4155551234 }],
    ["a key this event does not take", { relevance: 50 }],
    ["an array", { list: [1, 2] }],
    ["a non-finite number", { n: Number.POSITIVE_INFINITY }],
    ["a bad key", { "Bad Key": 1 }],
    ["too many keys", Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]))],
    ["a relevance out of range", { view: "today", relevance: 101 }],
  ])("refuses props with %s", async (_label, props) => {
    const s = sink();
    expect(await track(s, "feed_opened", "u1", props as Record<string, unknown>, NOW)).toEqual({
      ok: false,
      reason: "invalid_props",
    });
    expect(s.insert).not.toHaveBeenCalled();
  });

  it("checks each event against its own props", async () => {
    const s = sink();
    expect(await track(s, "post_hidden", "u1", { relevance: 101 }, NOW)).toEqual({
      ok: false,
      reason: "invalid_props",
    });
    expect(
      await track(s, "post_hidden", "u1", { source: "reddit", category: "wish" }, NOW),
    ).toEqual({ ok: true });
    expect(await track(s, "signed_up", "u1", { source: "reddit" }, NOW)).toEqual({
      ok: false,
      reason: "invalid_props",
    });
  });

  it("never throws: a failing sink is reported, not raised", async () => {
    const s = { insert: vi.fn(async () => Promise.reject(new Error("db down"))) };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await track(s, "feed_opened", "u1", {}, NOW)).toEqual({
      ok: false,
      reason: "sink_failed",
    });
    expect(log.mock.calls.flat().join(" ")).not.toContain("db down");
  });

  it("sends nothing to a third party: only the sink is called", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await track(sink(), "rivals_opened", "u1", { rival: "discovered" }, NOW);
    expect(fetchSpy).not.toHaveBeenCalled();
    const imports = (file: string) => {
      const source = readFileSync(file, "utf8");
      const specifiers = /\bfrom\s+"([^"]+)"|\bimport\s*\(?\s*"([^"]+)"|\brequire\(\s*"([^"]+)"/g;
      return [...source.matchAll(specifiers)].map((m) => m[1] ?? m[2] ?? m[3]);
    };
    expect(imports("src/server/events/track.ts")).toEqual(["zod"]);
    expect(imports("src/server/events/sink.ts").sort()).toEqual(
      ["./track", "@/server/supabase/admin", "server-only"].sort(),
    );
  });

  it("knows exactly the event names the events table allows", () => {
    const migration = readFileSync("supabase/migrations/20261015220000_profiles_app.sql", "utf8");
    const list = /name text not null check \(name in \(([^)]*)\)\)/.exec(migration)?.[1] ?? "";
    const allowed = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(allowed.length).toBeGreaterThan(0);
    expect([...EVENT_NAMES].sort()).toEqual(allowed);
  });
});
