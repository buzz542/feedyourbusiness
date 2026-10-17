import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bluesky, resetBlueskySession } from "./bluesky";
import type { CollectContext, CollectedPost } from "./types";

/** Bluesky through authenticated XRPC from the dedicated account, read-only (docs/PLAN.md 7.5). */

const fixture = (name: string) => readFileSync(`tests/fixtures/bluesky/${name}`, "utf8");
const NOW = new Date("2026-10-17T09:00:00Z");
const SINCE = new Date("2026-10-15T09:00:00Z");

type Http = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Reply = string | number | (() => Response);

function fakeHttp(routes: Array<[RegExp, Reply]>) {
  return vi.fn<Http>(async (input) => {
    const url = String(input);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`unrouted ${url}`);
    const reply = route[1];
    if (typeof reply === "function") return reply();
    if (typeof reply === "number") return new Response("", { status: reply });
    return new Response(reply, { status: 200, headers: { "content-type": "application/json" } });
  });
}

const CREDENTIALS: Record<string, string> = {
  BLUESKY_IDENTIFIER: "askedfor-bot.example.test",
  BLUESKY_APP_PASSWORD: "xxxx-xxxx-xxxx-xxxx",
};

function ctx(http: Http, over: Partial<CollectContext> = {}): CollectContext {
  return {
    fetch: http,
    terms: [
      { id: "t-invoice", term: "invoice reminders" },
      { id: "t-payments", term: "late fees" },
    ],
    since: SINCE,
    budget: 300,
    now: NOW,
    userAgent: "AskedFor/1.0 (+https://askedfor.app; hello@askedfor.app)",
    sleep: vi.fn(async () => {}),
    credential: (name) => CREDENTIALS[name],
    ...over,
  };
}

const ROUTES: Array<[RegExp, Reply]> = [
  [/com\.atproto\.server\.createSession$/, fixture("session.json")],
  [/searchPosts\?.*q=invoice\+reminders/, fixture("search-invoice.json")],
  [/searchPosts\?.*q=late\+fees/, fixture("search-payments.json")],
];

async function collect(c: CollectContext) {
  const state = await bluesky.start(c);
  if (state.kind !== "done") throw new Error(`expected done, got ${JSON.stringify(state)}`);
  return state;
}

beforeEach(() => resetBlueskySession());

describe("bluesky source", () => {
  it("declares the entryway host only, and links on bsky.app", () => {
    expect(bluesky).toMatchObject({
      id: "bluesky",
      mode: "collect",
      access: "official_api",
      allowedHosts: ["bsky.social"],
      linkHosts: ["bsky.app"],
      dailyBudget: 300,
      retentionDays: 30,
      costPerUnitUsd: 0,
    });
  });

  it("signs in once with the app password and searches each term, latest first, since the window", async () => {
    const http = fakeHttp(ROUTES);
    await collect(ctx(http));
    const [sessionCall, ...searches] = http.mock.calls;
    expect(String(sessionCall![0])).toBe(
      "https://bsky.social/xrpc/com.atproto.server.createSession",
    );
    const init = sessionCall![1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      identifier: "askedfor-bot.example.test",
      password: "xxxx-xxxx-xxxx-xxxx",
    });
    for (const [input, searchInit] of searches) {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://bsky.social/xrpc/app.bsky.feed.searchPosts");
      expect(url.searchParams.get("sort")).toBe("latest");
      expect(url.searchParams.get("since")).toBe(SINCE.toISOString());
      expect(new Headers(searchInit!.headers).get("authorization")).toMatch(/^Bearer ey/);
      expect(new Headers(searchInit!.headers).get("user-agent")).toMatch(/AskedFor/);
    }
  });

  it("uses at most one session per invocation, across jobs", async () => {
    const http = fakeHttp(ROUTES);
    await collect(ctx(http));
    await collect(ctx(http));
    const sessions = http.mock.calls.filter(([input]) => String(input).endsWith("createSession"));
    expect(sessions).toHaveLength(1);
  });

  it("signs in again once the access token is about to expire", async () => {
    const http = fakeHttp(ROUTES);
    await collect(ctx(http));
    // The fixture token expires at 11:00; a minute before, the session is renewed.
    await collect(ctx(http, { now: new Date("2026-10-17T10:59:30Z") }));
    const sessions = http.mock.calls.filter(([input]) => String(input).endsWith("createSession"));
    expect(sessions).toHaveLength(2);
  });

  it("maps posts: DID link, author key, text excerpt, community, and flags adult self-labels", async () => {
    const { posts, units } = await collect(ctx(fakeHttp(ROUTES)));
    const byId = new Map(posts.map((p) => [p.externalId, p]));
    expect(byId.get("at://did:plc:examplemakerone/app.bsky.feed.post/3kexamplea1")).toEqual({
      externalId: "at://did:plc:examplemakerone/app.bsky.feed.post/3kexamplea1",
      url: "https://bsky.app/profile/did:plc:examplemakerone/post/3kexamplea1",
      excerpt:
        "Is there an app that sends invoice reminders automatically? Tired of chasing clients.",
      postedAt: new Date("2026-10-17T07:00:00.000Z"),
      authorKey: "did:plc:examplemakerone",
      community: "Bluesky",
      termId: "t-invoice",
      nsfw: false,
    } satisfies CollectedPost);
    // Adult labels, from the record's self-labels or the post view, mark the post NSFW.
    expect(byId.get("at://did:plc:exampleadultlabel/app.bsky.feed.post/3kexamplea2")!.nsfw).toBe(
      true,
    );
    expect(byId.get("at://did:plc:examplelabeled/app.bsky.feed.post/3kexamplea3")!.nsfw).toBe(true);
    // Outside the window: dropped. Found twice: kept once.
    expect([...byId.keys()].some((k) => k.includes("3kexamplea4"))).toBe(false);
    expect(posts.filter((p) => p.externalId.endsWith("3kexamplea1"))).toHaveLength(1);
    for (const post of posts) {
      expect(post.excerpt.length).toBeLessThanOrEqual(280);
      expect(post.url).not.toMatch(/\.example\.test/); // never the handle
    }
    expect(units).toBe(6);
  });

  it("drops posts hidden by moderation or by an author who opted out of logged-out viewers", async () => {
    const view = (rkey: string, over: Record<string, unknown> = {}) => ({
      uri: `at://did:plc:example${rkey}/app.bsky.feed.post/${rkey}`,
      cid: `bafyexample${rkey}`,
      author: { did: `did:plc:example${rkey}`, handle: `${rkey}.example.test` },
      record: { text: `Post ${rkey} about invoice reminders.`, createdAt: "2026-10-17T07:00:00Z" },
      indexedAt: "2026-10-17T07:00:00Z",
      ...over,
    });
    const label = (val: string) => [{ src: "did:plc:examplemod", uri: "at://x", val, cts: "2026" }];
    const http = fakeHttp([
      [/createSession$/, fixture("session.json")],
      [
        /searchPosts/,
        JSON.stringify({
          posts: [
            view("kept"),
            view("hidden", { labels: label("!hide") }),
            view("optout", {
              author: {
                did: "did:plc:exampleoptout",
                handle: "optout.example.test",
                labels: label("!no-unauthenticated"),
              },
            }),
            // createdAt is client-declared: one set in the future is clamped to the index time.
            view("future", {
              record: { text: "Post from the future.", createdAt: "2027-01-01T00:00:00Z" },
            }),
          ],
        }),
      ],
    ]);
    const { posts } = await collect(ctx(http, { terms: [{ id: "t", term: "invoice" }] }));
    expect(posts.map((p) => p.externalId.split("/").pop())).toEqual(["kept", "future"]);
    expect(posts[1]!.postedAt).toEqual(new Date("2026-10-17T07:00:00Z"));
  });

  it("stops at the budget and makes no call at zero", async () => {
    const http = fakeHttp(ROUTES);
    const { units } = await collect(ctx(http, { budget: 2 }));
    expect(units).toBeLessThanOrEqual(2);
    const limits = http.mock.calls
      .filter(([input]) => String(input).includes("searchPosts"))
      .map(([input]) => Number(new URL(String(input)).searchParams.get("limit")));
    expect(limits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2);
    const none = fakeHttp(ROUTES);
    expect(await bluesky.start(ctx(none, { budget: 0 }))).toEqual({
      kind: "done",
      posts: [],
      units: 0,
    });
    expect(none).not.toHaveBeenCalled();
  });

  it("refuses to start without credentials, without calling anything", async () => {
    const http = fakeHttp(ROUTES);
    expect(await bluesky.start(ctx(http, { credential: () => undefined }))).toEqual({
      kind: "failed",
      errorClass: "MissingCredentials",
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("fails with a class name when a response does not match the API's shape", async () => {
    const http = fakeHttp([
      [/createSession$/, fixture("session.json")],
      [/searchPosts/, JSON.stringify({ posts: [{ uri: 7 }] })],
    ]);
    expect(await bluesky.start(ctx(http))).toEqual({
      kind: "failed",
      errorClass: "InvalidResponse",
    });
  });

  it("finds deleted posts with getPosts, 25 at a time", async () => {
    const http = fakeHttp([
      [/createSession$/, fixture("session.json")],
      [/getPosts/, fixture("get-posts.json")],
    ]);
    const live = "at://did:plc:examplemakerone/app.bsky.feed.post/3kexamplea1";
    const ids = [
      live,
      ...Array.from(
        { length: 29 },
        (_, i) => `at://did:plc:examplegone/app.bsky.feed.post/3kgone${i}`,
      ),
    ];
    const gone = await bluesky.checkDeleted!(ctx(http), ids);
    expect(gone).toHaveLength(29);
    expect(gone).not.toContain(live);
    const lookups = http.mock.calls.filter(([input]) => String(input).includes("getPosts"));
    expect(lookups).toHaveLength(2);
    for (const [input] of lookups)
      expect(new URL(String(input)).searchParams.getAll("uris").length).toBeLessThanOrEqual(25);
  });

  it("is read-only: the module calls no write method", () => {
    const code = readFileSync("src/sources/bluesky.ts", "utf8");
    expect(code).not.toMatch(/com\.atproto\.repo/);
    expect(code).not.toMatch(/app\.bsky\.(graph|feed)\.(like|repost|post|follow|block)\b/);
    expect(code.match(/method: "POST"/g)).toHaveLength(1); // createSession only
  });
});

describe("bluesky fixtures", () => {
  it("are synthetic: invented example DIDs and handles", () => {
    for (const name of ["search-invoice.json", "search-payments.json", "get-posts.json"]) {
      const posts = (
        JSON.parse(fixture(name)) as { posts: { author: { did: string; handle: string } }[] }
      ).posts;
      for (const post of posts) {
        expect(post.author.did, name).toMatch(/^did:plc:example[a-z0-9]+$/);
        expect(post.author.handle, name).toMatch(/\.example\.test$/);
      }
    }
  });
});
