import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { hackernews } from "./hackernews";
import type { CollectContext, CollectedPost } from "./types";

/** Hacker News through Algolia HN Search and the Firebase item API (docs/PLAN.md 7.4). */

const fixture = (name: string) => readFileSync(`tests/fixtures/hackernews/${name}`, "utf8");
const NOW = new Date("2026-10-17T09:00:00Z");
const SINCE = new Date("2026-10-15T09:00:00Z");

type Reply = string | number | (() => Response);
type Http = (input: string | URL, init?: RequestInit) => Promise<Response>;

function fakeFetch(routes: Array<[RegExp, Reply]>) {
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

function ctx(http: Http, over: Partial<CollectContext> = {}): CollectContext {
  return {
    fetch: http,
    terms: [
      { id: "t-invoice", term: "invoice tool" },
      { id: "t-payments", term: "chase payments" },
    ],
    since: SINCE,
    budget: 300,
    now: NOW,
    userAgent: "AskedFor/1.0 (+https://askedfor.app; hello@askedfor.app)",
    sleep: vi.fn(async () => {}),
    credential: () => undefined,
    ...over,
  };
}

const SEARCH = [
  [/query=invoice\+tool/, fixture("search-invoice.json")],
  [/query=chase\+payments/, fixture("search-payments.json")],
] satisfies Array<[RegExp, Reply]>;

async function collect(c: CollectContext): Promise<{ posts: CollectedPost[]; units: number }> {
  const state = await hackernews.start(c);
  if (state.kind !== "done") throw new Error(`expected done, got ${state.kind}`);
  return state;
}

describe("hackernews source", () => {
  it("declares only the official API hosts, and links on news.ycombinator.com", () => {
    expect(hackernews).toMatchObject({
      id: "hackernews",
      mode: "collect",
      access: "official_api",
      allowedHosts: ["hn.algolia.com", "hacker-news.firebaseio.com"],
      linkHosts: ["news.ycombinator.com"],
      dailyBudget: 300,
      retentionDays: 30,
      costPerUnitUsd: 0,
    });
  });

  it("searches each term by date for stories and comments since the window start", async () => {
    const http = fakeFetch(SEARCH);
    await collect(ctx(http));
    const urls = http.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url.origin + url.pathname).toBe("https://hn.algolia.com/api/v1/search_by_date");
      expect(url.searchParams.get("tags")).toBe("(story,comment)");
      expect(url.searchParams.get("numericFilters")).toBe(
        `created_at_i>${Math.floor(SINCE.getTime() / 1000)}`,
      );
    }
    expect(urls.map((u) => u.searchParams.get("query"))).toEqual([
      "invoice tool",
      "chase payments",
    ]);
    const init = http.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("user-agent")).toMatch(
      /AskedFor\/1\.0 .*hello@askedfor\.app/,
    );
  });

  it("maps hits to posts: link, plain-text excerpt, author key, community, term", async () => {
    const { posts, units } = await collect(ctx(fakeFetch(SEARCH)));
    expect(posts.map((p) => p.externalId)).toEqual(["90000001", "90000002", "90000004"]);
    const [story, comment, long] = posts as [CollectedPost, CollectedPost, CollectedPost];
    expect(story).toEqual({
      externalId: "90000001",
      url: "https://news.ycombinator.com/item?id=90000001",
      excerpt:
        "Ask HN: Is there a tool that chases unpaid invoices for you? I freelance and spend > 2 hours a week sending polite reminders. Anything that does it automatically?",
      postedAt: new Date("2026-10-17T06:00:00Z"),
      authorKey: "example_maker_one",
      community: "Hacker News",
      termId: "t-invoice",
      nsfw: false,
    });
    expect(comment!.excerpt).toBe(
      "We tried three invoicing apps & none of them let us set late fees. link",
    );
    expect(long!.excerpt.length).toBeLessThanOrEqual(280);
    expect(long!.excerpt.endsWith("…")).toBe(true);
    for (const post of posts) expect(post.excerpt).not.toMatch(/<[a-z/]/i);
    // The duplicate (found by both terms) and the post outside the window are dropped.
    expect(units).toBe(5);
  });

  it("stops at the budget", async () => {
    const http = fakeFetch(SEARCH);
    const { posts, units } = await collect(ctx(http, { budget: 2 }));
    const asked = http.mock.calls.map(([input]) =>
      Number(new URL(String(input)).searchParams.get("hitsPerPage")),
    );
    expect(asked.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2);
    expect(units).toBeLessThanOrEqual(2);
    expect(posts.length).toBeLessThanOrEqual(2);
  });

  it("makes no call with a budget of zero", async () => {
    const http = fakeFetch(SEARCH);
    expect(await hackernews.start(ctx(http, { budget: 0 }))).toEqual({
      kind: "done",
      posts: [],
      units: 0,
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("paces requests at no more than 2 a second", async () => {
    const sleep = vi.fn(async () => {});
    await collect(ctx(fakeFetch(SEARCH), { sleep }));
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("backs off on 429 and retries once, then stops with what it has", async () => {
    let calls = 0;
    const http = fakeFetch([
      [
        /query=invoice\+tool/,
        () =>
          ++calls === 1
            ? new Response("", { status: 429, headers: { "retry-after": "3" } })
            : new Response(fixture("search-invoice.json")),
      ],
      [/query=chase\+payments/, 429],
    ]);
    const sleep = vi.fn(async () => {});
    const { posts } = await collect(ctx(http, { sleep }));
    expect(sleep).toHaveBeenCalledWith(3_000);
    expect(posts.map((p) => p.externalId)).toEqual(["90000001", "90000002"]);
  });

  it("fails the run with a class name when the response does not match the API's shape", async () => {
    const http = fakeFetch([[/search_by_date/, JSON.stringify({ hits: [{ objectID: 1 }] })]]);
    expect(await hackernews.start(ctx(http))).toEqual({
      kind: "failed",
      errorClass: "InvalidResponse",
    });
  });

  it("skips a malformed hit instead of failing the run", async () => {
    const good = JSON.parse(fixture("search-invoice.json")).hits[0];
    const http = fakeFetch([[/search_by_date/, JSON.stringify({ hits: [{ objectID: 1 }, good] })]]);
    const { posts } = await collect(ctx(http, { terms: [{ id: "t", term: "invoice" }] }));
    expect(posts.map((p) => p.externalId)).toEqual([good.objectID]);
  });

  it("finds deleted and dead items, and missing ones", async () => {
    const http = fakeFetch([
      [/item\/90000011\.json$/, fixture("item-live.json")],
      [/item\/90000012\.json$/, fixture("item-deleted.json")],
      [/item\/90000013\.json$/, fixture("item-dead.json")],
      [/item\/90000014\.json$/, "null"],
    ]);
    const gone = await hackernews.checkDeleted!(ctx(http), [
      "90000011",
      "90000012",
      "90000013",
      "90000014",
    ]);
    expect(gone).toEqual(["90000012", "90000013", "90000014"]);
    for (const [input] of http.mock.calls)
      expect(String(input)).toMatch(
        /^https:\/\/hacker-news\.firebaseio\.com\/v0\/item\/\d+\.json$/,
      );
  });

  it("refuses an external id that is not a number before asking", async () => {
    const http = fakeFetch([]);
    await expect(hackernews.checkDeleted!(ctx(http), ["1/../../x"])).resolves.toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });
});

describe("hackernews fixtures", () => {
  it("are synthetic: every author is an invented example_ name", () => {
    for (const name of ["search-invoice.json", "search-payments.json"]) {
      const hits = (JSON.parse(fixture(name)) as { hits: { author: string }[] }).hits;
      for (const hit of hits) expect(hit.author, name).toMatch(/^example_[a-z_]+$/);
    }
    for (const name of ["item-live.json", "item-dead.json"])
      expect((JSON.parse(fixture(name)) as { by: string }).by).toMatch(/^example_[a-z_]+$/);
  });
});
