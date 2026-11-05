import { describe, expect, it } from "vitest";
import { authorHasher, hashAuthors } from "./author-hash";
import {
  closeRemoval,
  handleRemoval,
  parseRemovalTarget,
  RemovalForm,
  type RemovalDeps,
  type RemovalRequest,
  type RemovalSource,
} from "./removal";

/** Remove my post (docs/PLAN.md 4.8). The database side is tests/db/removal.test.ts. */

const PEPPER = "p".repeat(40);
const hash = authorHasher({ AUTHOR_HASH_PEPPER: PEPPER });
const NOW = new Date("2026-11-05T12:00:00Z");
const DID = "did:plc:invented00example";

/** What collection would have stored for this author (the same hasher, the same key). */
const collected = (source: RemovalSource, authorKey: string) =>
  hashAuthors(source, [{ authorKey } as never], hash)[0]!.authorHash;

function fakes(stored: Record<string, string> = {}) {
  const removed: Array<Parameters<RemovalDeps["removeAndSuppress"]>[0]> = [];
  const mails: Array<[string, string]> = [];
  const closed: string[] = [];
  const deps: RemovalDeps = {
    findPostAuthor: async (source, id) => stored[`${source}:${id}`] ?? null,
    hash,
    resolveBlueskyHandle: async (handle) => (handle === "maker.bsky.social" ? DID : null),
    resolveXUsername: async (name) => (name.toLowerCase() === "maker" ? "1234567890" : null),
    removeAndSuppress: async (args) => {
      removed.push(args);
      return 2;
    },
    close: async (id) => {
      closed.push(id);
    },
    sendDone: async (to, outcome) => {
      mails.push([to, outcome]);
    },
    now: () => NOW,
  };
  return { deps, removed, mails, closed };
}

const request = (source: RemovalSource, linkOrHandle: string): RemovalRequest => ({
  id: "req-1",
  source,
  linkOrHandle,
  contactEmail: "person@example.test",
});

describe("parseRemovalTarget", () => {
  it.each([
    [
      "hackernews",
      "https://news.ycombinator.com/item?id=4242",
      { kind: "post", externalId: "4242" },
    ],
    [
      "reddit",
      "https://www.reddit.com/r/SaaS/comments/1abc23/a_title/",
      { kind: "post", externalId: "1abc23" },
    ],
    ["reddit", "https://old.reddit.com/user/someone", { kind: "author", key: "someone" }],
    ["reddit", "u/someone", { kind: "author", key: "someone" }],
    ["hackernews", "someone", { kind: "author", key: "someone" }],
    [
      "bluesky",
      `https://bsky.app/profile/${DID}/post/3kabc`,
      { kind: "post", externalId: `at://${DID}/app.bsky.feed.post/3kabc` },
    ],
    [
      "bluesky",
      "https://bsky.app/profile/maker.bsky.social/post/3kabc",
      { kind: "bluesky_post_by_handle", handle: "maker.bsky.social" },
    ],
    ["bluesky", "@maker.bsky.social", { kind: "author", key: "maker.bsky.social" }],
    [
      "x",
      "https://x.com/maker/status/1790000000000000000",
      { kind: "post", externalId: "1790000000000000000" },
    ],
    ["x", "https://twitter.com/maker", { kind: "author", key: "maker" }],
    ["x", "@maker", { kind: "author", key: "maker" }],
    ["x", "@12345678", { kind: "author", key: "12345678" }],
    [
      "hackernews",
      "https://news.ycombinator.com/user?id=someone",
      { kind: "author", key: "someone" },
    ],
    [
      "reddit",
      "reddit.com/r/SaaS/comments/1abc23/a_title/",
      { kind: "post", externalId: "1abc23" },
    ],
    [
      "reddit",
      "https://m.reddit.com/r/SaaS/comments/1abc23/",
      { kind: "post", externalId: "1abc23" },
    ],
    ["reddit", "https://redd.it/1abc23", { kind: "post", externalId: "1abc23" }],
    [
      "x",
      "mobile.x.com/maker/status/1790000000000000000",
      { kind: "post", externalId: "1790000000000000000" },
    ],
  ] as const)("%s: %s", (source, input, want) => {
    expect(parseRemovalTarget(input, source)).toMatchObject(want);
  });

  it.each([
    ["reddit", "https://news.ycombinator.com/item?id=1"],
    ["hackernews", "https://evil.example/item?id=1"],
    ["x", "https://x.com/i/web/status/notanumber"],
    ["hackernews", "two words"],
    // A comment permalink names the commenter, not the post's author: we cannot tell whose it is.
    ["reddit", "https://www.reddit.com/r/SaaS/comments/1abc23/a_title/def456/"],
    // A reply link is someone else's comment.
    ["hackernews", "https://news.ycombinator.com/reply?id=4242"],
    ["bluesky", "https://bsky.app/profile/%E0%A4%A/post/x"],
    ["reddit", ""],
  ] as const)("refuses %s: %s", (source, input) => {
    expect(parseRemovalTarget(input, source)).toBeNull();
  });
});

describe("handleRemoval", () => {
  it("a post link suppresses that post's stored author and names the post", async () => {
    const f = fakes({ "hackernews:4242": "stored-hash" });
    const outcome = await handleRemoval(
      f.deps,
      request("hackernews", "https://news.ycombinator.com/item?id=4242"),
      "admin:a1",
    );
    expect(outcome).toEqual({ kind: "removed", postsDeleted: 2 });
    expect(f.removed).toEqual([
      {
        requestId: "req-1",
        source: "hackernews",
        authorHash: "stored-hash",
        externalId: "4242",
        actor: "admin:a1",
        now: NOW,
      },
    ]);
    expect(f.mails).toEqual([["person@example.test", "removed"]]);
  });

  it("a Reddit or Hacker News username is hashed as collection hashes it", async () => {
    for (const [source, input, key] of [
      ["reddit", "u/Some_One", "some_one"],
      ["hackernews", "@someone", "someone"],
    ] as const) {
      const f = fakes();
      await handleRemoval(f.deps, request(source, input), "admin:a1");
      expect(f.removed[0]!.authorHash).toBe(collected(source, key));
    }
  });

  it("a Bluesky handle resolves to the DID and suppresses the DID-keyed author", async () => {
    const f = fakes();
    await handleRemoval(f.deps, request("bluesky", "@maker.bsky.social"), "admin:a1");
    expect(f.removed[0]!.authorHash).toBe(collected("bluesky", DID));
  });

  it("a Bluesky post link with a handle resolves it before matching the post", async () => {
    const uri = `at://${DID}/app.bsky.feed.post/3kabc`;
    const f = fakes({ [`bluesky:${uri}`]: "stored-bsky" });
    await handleRemoval(
      f.deps,
      request("bluesky", "https://bsky.app/profile/maker.bsky.social/post/3kabc"),
      "admin:a1",
    );
    expect(f.removed[0]).toMatchObject({ authorHash: "stored-bsky", externalId: uri });
  });

  it("an X username resolves to the user id, even one made only of digits", async () => {
    const f = fakes();
    await handleRemoval(f.deps, request("x", "@Maker"), "admin:a1");
    expect(f.removed[0]!.authorHash).toBe(collected("x", "1234567890"));
    const digits = fakes();
    digits.deps.resolveXUsername = async (name) => (name === "12345678" ? "999000111" : null);
    await handleRemoval(digits.deps, request("x", "@12345678"), "admin:a1");
    expect(digits.removed[0]!.authorHash).toBe(collected("x", "999000111"));
  });

  it("a Reddit link matches a post stored with the vendor's t3_ prefix too", async () => {
    const f = fakes({ "reddit:t3_1abc23": "stored-reddit" });
    await handleRemoval(
      f.deps,
      request("reddit", "https://www.reddit.com/r/SaaS/comments/1abc23/x/"),
      "admin:a1",
    );
    expect(f.removed[0]).toMatchObject({ authorHash: "stored-reddit", externalId: "t3_1abc23" });
  });

  it("a Bluesky post we no longer hold still suppresses its author, whose DID the link names", async () => {
    const f = fakes();
    await handleRemoval(
      f.deps,
      request("bluesky", `https://bsky.app/profile/${DID}/post/3kgone`),
      "admin:a1",
    );
    expect(f.removed[0]).toMatchObject({ authorHash: collected("bluesky", DID), externalId: null });
  });

  it("a link to a post we never stored, or a name that does not resolve, removes nothing", async () => {
    for (const r of [
      request("hackernews", "https://news.ycombinator.com/item?id=9"),
      request("bluesky", "@nobody.bsky.social"),
      request("bluesky", "https://bsky.app/profile/nobody.bsky.social/post/3k"),
      request("x", "@nobody"),
    ]) {
      const f = fakes();
      expect(await handleRemoval(f.deps, r, "admin:a1")).toEqual({ kind: "not_found" });
      expect(f.removed).toEqual([]);
      expect(f.mails).toEqual([]);
    }
  });

  it("an unreadable request changes nothing", async () => {
    const f = fakes();
    expect(await handleRemoval(f.deps, request("reddit", "https://example.com/x"), "a")).toEqual({
      kind: "unreadable",
    });
    expect(f.removed).toEqual([]);
  });

  it("closing a request with no match tells the requester", async () => {
    const f = fakes();
    await closeRemoval(f.deps, request("x", "@nobody"), "admin:a1");
    expect(f.closed).toEqual(["req-1"]);
    expect(f.mails).toEqual([["person@example.test", "not_found"]]);
  });
});

describe("RemovalForm", () => {
  const ok = {
    source: "reddit",
    linkOrHandle: "u/someone",
    contactEmail: "person@example.test",
    details: "",
    confirm: true,
  };
  it("accepts a complete form", () => {
    expect(RemovalForm.safeParse(ok).success).toBe(true);
  });
  it.each([
    [{ source: "linkedin" }],
    [{ contactEmail: "not an email" }],
    [{ confirm: false }],
    [{ linkOrHandle: "" }],
    [{ details: "d".repeat(1001) }],
  ])("refuses %j", (change) => {
    expect(RemovalForm.safeParse({ ...ok, ...change }).success).toBe(false);
  });
});
