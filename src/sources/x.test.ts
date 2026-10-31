import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { allowedHosts } from "./registry";
import type { CollectContext, CollectedPost } from "./types";
import { createXSource, x } from "./x";

/** X through the official API v2, shipped off (docs/PLAN.md 7.6). */

const fixture = (name: string) => readFileSync(`tests/fixtures/x/${name}`, "utf8");
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

function ctx(http: Http, over: Partial<CollectContext> = {}): CollectContext {
  return {
    fetch: http,
    terms: [
      { id: "t-invoice", term: "invoice reminders" },
      { id: "t-fees", term: "late fees" },
    ],
    since: SINCE,
    budget: 200,
    now: NOW,
    userAgent: "AskedFor/1.0 (+https://askedfor.app; hello@askedfor.app)",
    sleep: vi.fn(async () => {}),
    credential: (name) => (name === "X_BEARER_TOKEN" ? "test-bearer" : undefined),
    ...over,
  };
}

const ROUTES: Array<[RegExp, Reply]> = [
  [/query=%22invoice\+reminders%22/, fixture("search-invoice.json")],
  [/query=%22late\+fees%22/, fixture("search-fees.json")],
];

async function collect(c: CollectContext) {
  const state = await x.start(c);
  if (state.kind !== "done") throw new Error(`expected done, got ${JSON.stringify(state)}`);
  return state;
}

describe("x source", () => {
  it("declares the official API host only, links on x.com, 7-day retention and a zero budget", () => {
    expect(x).toMatchObject({
      id: "x",
      mode: "collect",
      access: "official_api",
      allowedHosts: ["api.x.com"],
      linkHosts: ["x.com"],
      dailyBudget: 0,
      retentionDays: 7,
      costPerUnitUsd: 0.005,
    });
    expect(x.checkDeleted).toBeTypeOf("function");
    expect(allowedHosts({})).not.toContain("api.x.com");
    expect(allowedHosts({ SOURCE_X_ENABLED: "true" })).toEqual(["api.x.com"]);
  });

  it("makes no call with a budget of 0, even when switched on", async () => {
    const http = fakeHttp(ROUTES);
    expect(await x.start(ctx(http, { budget: 0 }))).toEqual({ kind: "done", posts: [], units: 0 });
    expect(http).not.toHaveBeenCalled();
  });

  it("starts once deletion compliance exists, with nothing in its way but the env and budget", async () => {
    const http = fakeHttp(ROUTES);
    expect((await x.start(ctx(http))).kind).toBe("done");
    expect(x.configProblems?.(() => undefined)).toEqual([]);
  });

  it("searches recent posts per term with the plan's query and fields, and asks for no user data", async () => {
    const http = fakeHttp(ROUTES);
    await collect(ctx(http));
    expect(http).toHaveBeenCalledTimes(2);
    const [input, init] = http.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://api.x.com/2/tweets/search/recent");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: '"invoice reminders" -is:retweet lang:en',
      start_time: SINCE.toISOString(),
      max_results: "100",
      "tweet.fields": "created_at,author_id,lang,possibly_sensitive",
    });
    const headers = new Headers(init!.headers);
    expect(headers.get("authorization")).toBe("Bearer test-bearer");
    expect(headers.get("user-agent")).toMatch(/AskedFor/);
  });

  it("maps posts: status link, decoded excerpt, author id, and drops sensitive, old and repeated posts", async () => {
    const { posts, units } = await collect(ctx(fakeHttp(ROUTES)));
    expect(posts.map((p) => p.externalId)).toEqual(["1900000000000000001", "1900000000000000004"]);
    expect(posts[0]).toEqual({
      externalId: "1900000000000000001",
      url: "https://x.com/i/web/status/1900000000000000001",
      excerpt:
        "Any app that sends invoice reminders for me? Chasing clients by hand & it is a pain.",
      postedAt: new Date("2026-10-17T07:00:00.000Z"),
      authorKey: "9000000001",
      community: "X",
      termId: "t-invoice",
      nsfw: false,
    } satisfies CollectedPost);
    expect(posts[1]!.excerpt.length).toBeLessThanOrEqual(280);
    // Billed per post read: every post returned counts.
    expect(units).toBe(5);
  });

  it("keeps the start time inside the API's 7-day window on a first run", async () => {
    const http = fakeHttp(ROUTES);
    await collect(ctx(http, { since: new Date(NOW.getTime() - 7 * 24 * 60 * 60_000) }));
    const start = Date.parse(
      new URL(String(http.mock.calls[0]![0])).searchParams.get("start_time")!,
    );
    expect(start).toBeGreaterThan(NOW.getTime() - 7 * 24 * 60 * 60_000);
  });

  it("splits the budget: 10 to 100 posts a request, never more than the budget in total", async () => {
    const asked = async (budget: number) => {
      const http = fakeHttp([[/search\/recent/, fixture("search-empty.json")]]);
      await collect(ctx(http, { budget }));
      return http.mock.calls.map(([input]) =>
        Number(new URL(String(input)).searchParams.get("max_results")),
      );
    };
    expect(await asked(25)).toEqual([12, 12]);
    expect(await asked(15)).toEqual([15]);
    expect(await asked(9)).toEqual([]);
  });

  it("backs off on 429 once, then stops with what it has", async () => {
    let calls = 0;
    const http = fakeHttp([
      [
        /query=%22invoice\+reminders%22/,
        () =>
          ++calls === 1
            ? new Response("", { status: 429, headers: { "retry-after": "4" } })
            : new Response(fixture("search-invoice.json")),
      ],
      [/query=%22late\+fees%22/, 429],
    ]);
    const sleep = vi.fn(async () => {});
    const { posts } = await collect(ctx(http, { sleep }));
    expect(sleep).toHaveBeenCalledWith(4_000);
    expect(posts.map((p) => p.externalId)).toEqual(["1900000000000000001"]);
  });

  it("fails with a class name on a response that does not match, or without a token", async () => {
    const bad = fakeHttp([[/search\/recent/, JSON.stringify({ data: [{ id: 5 }] })]]);
    expect(await x.start(ctx(bad))).toEqual({
      kind: "failed",
      errorClass: "InvalidResponse",
      units: 0,
    });
    const none = fakeHttp(ROUTES);
    expect(await x.start(ctx(none, { credential: () => undefined }))).toEqual({
      kind: "failed",
      errorClass: "MissingCredentials",
      units: 0,
    });
    expect(none).not.toHaveBeenCalled();
  });
});

describe("x fixtures", () => {
  it("are synthetic: invented post and author ids", () => {
    for (const name of ["search-invoice.json", "search-fees.json"]) {
      const { data } = JSON.parse(fixture(name)) as { data: { id: string; author_id: string }[] };
      for (const post of data) {
        expect(post.id, name).toMatch(/^19000000000000000\d\d$/);
        expect(post.author_id, name).toMatch(/^900000000\d$/);
      }
    }
  });
});

describe("x deletion compliance (docs/PLAN.md 7.6)", () => {
  const lookup = (ids: string[]) =>
    JSON.stringify({ data: ids.map((id) => ({ id, text: "Synthetic text" })) });
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => `19000000000000${String(i).padStart(5, "0")}`);

  it("reports every id the lookup no longer returns, asking for ids only", async () => {
    const http = fakeHttp([
      [/\/2\/tweets\?/, lookup(["1900000000000000001", "1900000000000000003"])],
    ]);
    const gone = await x.checkDeleted!(ctx(http), [
      "1900000000000000001",
      "1900000000000000002",
      "1900000000000000003",
    ]);
    expect(gone).toEqual(["1900000000000000002"]);
    const url = new URL(String(http.mock.calls[0]![0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.x.com/2/tweets");
    expect(url.searchParams.get("ids")).toBe(
      "1900000000000000001,1900000000000000002,1900000000000000003",
    );
    expect(url.searchParams.get("tweet.fields")).toBe("id");
    expect(url.searchParams.get("expansions")).toBeNull();
    const init = http.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-bearer");
  });

  it("looks up at most 100 ids a request", async () => {
    const all = ids(250);
    const http = vi.fn<Http>(async (input) => {
      const asked = new URL(String(input)).searchParams.get("ids")!.split(",");
      return new Response(lookup(asked), { status: 200 });
    });
    expect(await x.checkDeleted!(ctx(http), all)).toEqual([]);
    expect(
      http.mock.calls.map((c) => new URL(String(c[0])).searchParams.get("ids")!.split(",").length),
    ).toEqual([100, 100, 50]);
  });

  it("ignores anything that is not a post id, and asks for nothing when none are left", async () => {
    const http = fakeHttp([]);
    expect(await x.checkDeleted!(ctx(http), ["abc", "1,2", ""])).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it("throws on a failed request, so no post is wrongly treated as live or gone", async () => {
    await expect(
      x.checkDeleted!(ctx(fakeHttp([[/\/2\/tweets\?/, 503]])), ["1900000000000000001"]),
    ).rejects.toThrow("Http503");
    await expect(
      x.checkDeleted!(ctx(fakeHttp([[/\/2\/tweets\?/, '{"data":[{"id":5}]}']])), [
        "1900000000000000001",
      ]),
    ).rejects.toThrow("InvalidResponse");
    await expect(
      x.checkDeleted!(ctx(fakeHttp([]), { credential: () => undefined }), ["1900000000000000001"]),
    ).rejects.toThrow("MissingCredentials");
  });

  it("backs off on 429 once, then stops with what it found", async () => {
    let calls = 0;
    const http = vi.fn<Http>(async () => {
      calls++;
      return new Response("", { status: 429, headers: { "retry-after": "2" } });
    });
    const sleep = vi.fn(async () => {});
    expect(await x.checkDeleted!(ctx(http, { sleep }), ["1900000000000000001"])).toEqual([]);
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });
});

describe("deletion compliance gate (docs/PLAN.md 7.6)", () => {
  it("refuses to start, and makes no request, until deletion compliance is built", async () => {
    const notReady = createXSource({ deletionComplianceReady: false });
    const http = vi.fn();
    const ctx = {
      fetch: http,
      terms: [{ id: "t1", term: "invoice tool" }],
      since: new Date("2026-10-30T00:00:00Z"),
      budget: 100,
      now: new Date("2026-10-31T00:00:00Z"),
      userAgent: "AskedFor/test",
      sleep: async () => {},
      credential: () => "token",
    };
    expect(await notReady.start(ctx)).toEqual({
      kind: "failed",
      errorClass: "DeletionComplianceMissing",
    });
    expect(http).not.toHaveBeenCalled();
    expect(notReady.configProblems?.(() => undefined)).not.toEqual([]);
    expect(x.configProblems?.(() => undefined)).toEqual([]);
  });
});

describe("a failure after some reads (7.6)", () => {
  it("reports the posts already read, so they are recorded", async () => {
    let calls = 0;
    const http = vi.fn(async () => {
      calls++;
      if (calls === 1)
        return new Response(readFileSync("tests/fixtures/x/search-invoice.json", "utf8"));
      return new Response("", { status: 503 });
    });
    const state = await x.start({
      fetch: http as never,
      terms: [
        { id: "t1", term: "invoice tool" },
        { id: "t2", term: "late fees" },
      ],
      since: new Date("2026-10-10T00:00:00Z"),
      budget: 40,
      now: new Date("2026-10-17T12:00:00Z"),
      userAgent: "AskedFor/test",
      sleep: async () => {},
      credential: () => "token",
    });
    expect(state.kind).toBe("failed");
    expect(state.kind === "failed" && state.units).toBeGreaterThan(0);
  });
});
