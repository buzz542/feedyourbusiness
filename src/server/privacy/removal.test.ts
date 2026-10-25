import { describe, expect, it } from "vitest";
import {
  deleteAndSuppress,
  submitRemoval,
  targetOf,
  type RemovalAdminDeps,
  type RemovalSource,
} from "./removal";

const NOW = new Date("2026-10-25T12:00:00Z");

describe("the removal form", () => {
  function store(existing = 0) {
    const rows: Record<string, unknown>[] = [];
    return {
      rows,
      store: {
        countSince: async () => existing + rows.length,
        insert: async (row: Record<string, unknown>) => {
          rows.push(row);
          return `req-${rows.length}`;
        },
      },
    };
  }
  const input = {
    link_or_handle: "https://news.ycombinator.com/item?id=123",
    contact_email: "someone@example.test",
  };

  it("stores the request with the IP hash and tells the requester it arrived", async () => {
    const { store: s, rows } = store();
    const sent: string[] = [];
    expect(
      await submitRemoval(
        { store: s, notify: async (to) => void sent.push(to) },
        input,
        "iphash",
        NOW,
      ),
    ).toEqual({ ok: true, id: "req-1" });
    expect(rows[0]).toMatchObject({ ip_hash: "iphash", source: null });
    expect(sent).toEqual(["someone@example.test"]);
  });

  it("allows 5 a day per IP hash, then refuses", async () => {
    const { store: s } = store(4);
    expect((await submitRemoval({ store: s }, input, "h", NOW)).ok).toBe(true);
    expect(await submitRemoval({ store: s }, input, "h", NOW)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
  });

  it("refuses a missing link or a bad email with a message per field", async () => {
    const { store: s, rows } = store();
    const result = await submitRemoval(
      { store: s },
      { link_or_handle: "", contact_email: "x" },
      "h",
      NOW,
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(Object.keys((result as { errors: object }).errors).sort()).toEqual([
      "contact_email",
      "link_or_handle",
    ]);
    expect(rows).toEqual([]);
  });
});

describe("what a request points at", () => {
  it.each([
    [
      "https://news.ycombinator.com/item?id=42",
      "hackernews",
      "https://news.ycombinator.com/item?id=42",
    ],
    [
      "https://old.reddit.com/r/SaaS/comments/abc/title/",
      "reddit",
      "https://www.reddit.com/r/SaaS/comments/abc/title/",
    ],
    ["https://twitter.com/someone/status/123456", "x", "https://x.com/i/web/status/123456"],
    [
      "https://bsky.app/profile/did:plc:abc/post/3kx",
      "bluesky",
      "https://bsky.app/profile/did:plc:abc/post/3kx",
    ],
  ])("a link %s is a %s post", (link, source, url) => {
    expect(targetOf(link, null)).toMatchObject({
      kind: "post",
      source,
      urls: expect.arrayContaining([url]),
    });
  });

  it.each([
    ["u/someone", "reddit", "someone"],
    ["@someone.bsky.social", "bluesky", "someone.bsky.social"],
    ["someone", "x", "someone"],
  ] as const)("a username %s on %s is an author", (name, source, expected) => {
    expect(targetOf(name, source)).toEqual({ kind: "author", source, name: expected });
  });

  it("a username without a source, or a link on another site, is unknown", () => {
    expect(targetOf("someone", null)).toEqual({ kind: "unknown" });
    expect(targetOf("https://evil.example/x", "reddit")).toEqual({ kind: "unknown" });
  });
});

describe("delete and suppress (one admin click)", () => {
  function setup(request: { link_or_handle: string; source: RemovalSource | null }) {
    const log: string[] = [];
    const suppressed = new Set<string>();
    const posts = [
      {
        url: "https://news.ycombinator.com/item?id=42",
        source: "hackernews",
        author: "hash:hackernews:writer",
      },
      {
        url: "https://news.ycombinator.com/item?id=43",
        source: "hackernews",
        author: "hash:hackernews:writer",
      },
      {
        url: "https://bsky.app/profile/did:plc:xyz/post/1",
        source: "bluesky",
        author: "hash:bluesky:did:plc:xyz",
      },
      { url: "https://x.com/i/web/status/9", source: "x", author: "hash:x:777" },
    ];
    const deps: RemovalAdminDeps = {
      load: async (id) => ({
        id,
        ...request,
        contact_email: "someone@example.test",
        status: "received",
      }),
      authorOfPost: async (source, urls) =>
        posts.find((p) => p.source === source && urls.includes(p.url))?.author ?? null,
      authorKeyOfLink: async () => null,
      stableId: async (source, name) =>
        source === "bluesky"
          ? name === "writer.bsky.social"
            ? "did:plc:xyz"
            : null
          : source === "x"
            ? name === "writer"
              ? "777"
              : null
            : name,
      hash: (source, key) => `hash:${source}:${key.toLowerCase()}`,
      suppress: async (h, s) => void suppressed.add(`${s}|${h}`),
      deletePosts: async (h, s) => {
        const before = posts.length;
        for (let i = posts.length - 1; i >= 0; i--)
          if (posts[i]!.author === h && posts[i]!.source === s) posts.splice(i, 1);
        return before - posts.length;
      },
      close: async (id, status) => void log.push(`close:${status}`),
      audit: async (e) => void log.push(`audit:${e.action}`),
      notify: async (_to, outcome) => void log.push(`email:${outcome}`),
    };
    return { deps, log, suppressed, posts };
  }

  it("a post link deletes that author's posts, suppresses the hash, closes, emails and audits", async () => {
    const { deps, log, suppressed, posts } = setup({
      link_or_handle: "https://news.ycombinator.com/item?id=42",
      source: null,
    });
    expect(await deleteAndSuppress(deps, "r1", "admin-1", NOW)).toEqual({
      ok: true,
      deleted: 2,
      suppressed: true,
    });
    expect(suppressed.has("hackernews|hash:hackernews:writer")).toBe(true);
    expect(posts.some((p) => p.author === "hash:hackernews:writer")).toBe(false);
    expect(log).toEqual(["close:removed", "audit:removal_delete_and_suppress", "email:removed"]);
  });

  it("a Bluesky handle resolves to the DID and suppresses the DID-keyed author", async () => {
    const { deps, suppressed, posts } = setup({
      link_or_handle: "@writer.bsky.social",
      source: "bluesky",
    });
    await deleteAndSuppress(deps, "r1", "admin-1", NOW);
    expect(suppressed.has("bluesky|hash:bluesky:did:plc:xyz")).toBe(true);
    expect(posts.some((p) => p.source === "bluesky")).toBe(false);
  });

  it("an X username resolves to the user id", async () => {
    const { deps, suppressed } = setup({ link_or_handle: "writer", source: "x" });
    await deleteAndSuppress(deps, "r1", "admin-1", NOW);
    expect(suppressed.has("x|hash:x:777")).toBe(true);
  });

  it("a Reddit or Hacker News username is hashed as the source hashes it", async () => {
    const { deps, suppressed } = setup({ link_or_handle: "u/Writer", source: "reddit" });
    await deleteAndSuppress(deps, "r1", "admin-1", NOW);
    expect(suppressed.has("reddit|hash:reddit:writer")).toBe(true);
  });

  it("a request that matches nothing is closed as not found, and says so", async () => {
    const { deps, log, suppressed } = setup({
      link_or_handle: "https://evil.example/x",
      source: null,
    });
    expect(await deleteAndSuppress(deps, "r1", "admin-1", NOW)).toEqual({
      ok: true,
      deleted: 0,
      suppressed: false,
    });
    expect(suppressed.size).toBe(0);
    expect(log).toEqual(["close:rejected", "audit:removal_not_matched", "email:not_found"]);
  });

  it("a request already handled is left alone", async () => {
    const { deps } = setup({ link_or_handle: "x", source: null });
    deps.load = async (id) => ({
      id,
      link_or_handle: "x",
      source: null,
      contact_email: "a@example.test",
      status: "removed",
    });
    expect(await deleteAndSuppress(deps, "r1", "admin-1", NOW)).toEqual({
      ok: false,
      reason: "closed",
    });
  });
});
