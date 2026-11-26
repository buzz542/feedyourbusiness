import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SafeFetchError } from "@/server/net/safe-fetch";
import { createSourceFetch } from "@/server/net/source-fetch";
import { reddit } from "./reddit";
import {
  API,
  assertPinnedRequest,
  BRIGHTDATA_DATE_FILTERS,
  dateFilterFor,
  MAX_SNAPSHOT_BYTES,
  PINNED_DATASET_IDS,
  VendorRequestRefused,
} from "./reddit-brightdata";
import { BRIGHTDATA_API_HOST } from "./reddit-vendor";
import { sources } from "./registry";
import type { CollectContext, CollectedPost } from "./types";

/** Reddit through the data vendor's pinned API (docs/PLAN.md 7.7, 2.1.9). */

const fixture = (name: string) => readFileSync(`tests/fixtures/reddit/${name}`, "utf8");
const NOW = new Date("2026-10-17T09:00:00Z");
const SINCE = new Date("2026-10-15T09:00:00Z");
const DATASET = "gd_lvz8ah06191smkebj4";
/** A LinkedIn dataset id on the same vendor: must never be sent. */
const LINKEDIN_DATASET = "gd_l1viktl72bvl7bjuj0";

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

/** A trigger endpoint that hands out a new snapshot id for each run it is asked to start. */
function triggers(): Reply {
  let n = 0;
  return () =>
    new Response(JSON.stringify({ snapshot_id: `s_example000${++n}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

const CONFIG: Record<string, string> = {
  BRIGHTDATA_API_TOKEN: "test-token",
  BRIGHTDATA_REDDIT_DATASET_ID: DATASET,
};

function ctx(http: Http, over: Partial<CollectContext> = {}): CollectContext {
  return {
    fetch: http,
    terms: [
      { id: "t-invoice", term: "invoice reminders" },
      { id: "t-fees", term: "late fees" },
    ],
    since: SINCE,
    budget: 120,
    now: NOW,
    userAgent: "AskedFor/1.0 (+https://askedfor.app; hello@askedfor.app)",
    sleep: vi.fn(async () => {}),
    credential: (name) => CONFIG[name],
    ...over,
  };
}

const READY: Array<[RegExp, Reply]> = [
  [/\/progress\/s_example0001$/, fixture("progress-ready.json")],
  [/\/snapshot\/s_example0001\?format=json$/, fixture("snapshot.json")],
];

async function handleFrom(c: CollectContext): Promise<string> {
  const state = await reddit.start(c);
  if (state.kind !== "pending") throw new Error(`expected pending, got ${JSON.stringify(state)}`);
  return state.handle;
}

async function collected(routes = READY) {
  const handle = await handleFrom(ctx(fakeHttp([[/\/trigger\?/, fixture("trigger.json")]])));
  const http = fakeHttp(routes);
  const state = await reddit.poll!(ctx(http), handle);
  return { state, http };
}

describe("reddit source", () => {
  it("declares the vendor's API host only, a 7-day retention and links on reddit.com", () => {
    expect(reddit).toMatchObject({
      id: "reddit",
      mode: "collect",
      access: "vendor_api",
      vendor: { name: "Bright Data" },
      allowedHosts: [BRIGHTDATA_API_HOST],
      linkHosts: ["www.reddit.com", "old.reddit.com"],
      dailyBudget: 120,
      retentionDays: 7,
      costPerUnitUsd: 0.0015,
    });
    expect(new URL(API).host).toBe(BRIGHTDATA_API_HOST);
    expect(PINNED_DATASET_IDS).toEqual([DATASET]);
  });

  it("starts one run per keyword on the pinned dataset, all at once, within the budget", async () => {
    // The vendor works through the keywords of one run in turn (about 20 minutes each, measured
    // 26 Nov 2026), but runs started together go in parallel: one run per keyword.
    const http = fakeHttp([[/\/trigger\?/, triggers()]]);
    const state = await reddit.start(ctx(http));
    if (state.kind !== "pending") throw new Error("expected pending");
    expect(http).toHaveBeenCalledTimes(2);
    for (const [input, init] of http.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://api.brightdata.com/datasets/v3/trigger");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        dataset_id: DATASET,
        type: "discover_new",
        discover_by: "keyword",
        include_errors: "true",
      });
      expect(init!.method).toBe("POST");
      const headers = new Headers(init!.headers);
      expect(headers.get("authorization")).toBe("Bearer test-token");
      expect(headers.get("user-agent")).toMatch(/AskedFor/);
    }
    expect(http.mock.calls.map(([, init]) => JSON.parse(String(init!.body)))).toEqual([
      [{ keyword: "invoice reminders", date: "Past week", num_of_posts: 20 }],
      [{ keyword: "late fees", date: "Past week", num_of_posts: 20 }],
    ]);
    expect(JSON.parse(state.handle).h).toBe("s_example0001,s_example0002");
  });

  it("asks for at most 12 terms and 5 to 20 posts each, never more than the budget", async () => {
    const terms = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, term: `term ${i}` }));
    const bodies = async (budget: number) => {
      const http = fakeHttp([[/\/trigger\?/, triggers()]]);
      await reddit.start(ctx(http, { terms, budget }));
      return http.mock.calls.map(
        ([, init]) => JSON.parse(String(init!.body)) as { num_of_posts: number }[],
      );
    };
    const daily = await bodies(120);
    expect(daily).toHaveLength(12);
    expect(daily.every((body) => body.length === 1 && body[0]!.num_of_posts === 10)).toBe(true);
    const small = await bodies(42);
    expect(small).toHaveLength(8);
    expect(small.reduce((sum, body) => sum + body[0]!.num_of_posts, 0)).toBeLessThanOrEqual(42);
    expect(small.every((body) => body[0]!.num_of_posts === 5)).toBe(true);
  });

  it("keeps the runs already started when a later trigger is refused, and starts no more", async () => {
    let n = 0;
    const http = fakeHttp([
      [
        /\/trigger\?/,
        () =>
          ++n === 2
            ? new Response("", { status: 500 })
            : new Response(JSON.stringify({ snapshot_id: `s_example000${n}` }), { status: 200 }),
      ],
    ]);
    const terms = ["a one", "b two", "c three"].map((term, i) => ({ id: `t${i}`, term }));
    const state = await reddit.start(ctx(http, { terms }));
    if (state.kind !== "pending") throw new Error("expected pending");
    expect(http).toHaveBeenCalledTimes(2);
    expect(JSON.parse(state.handle).h).toBe("s_example0001");
  });

  it("fails when the very first trigger is refused", async () => {
    const http = fakeHttp([[/\/trigger\?/, 500]]);
    expect(await reddit.start(ctx(http))).toEqual({ kind: "failed", errorClass: "Http500" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  describe("several runs, one handle", () => {
    const MULTI = JSON.stringify({
      p: "brightdata",
      h: "s_example0001,s_example0002",
      t: [
        ["t-invoice", "invoice reminders"],
        ["t-fees", "late fees"],
      ],
    });
    const READY_1: [RegExp, Reply] = [/\/progress\/s_example0001$/, fixture("progress-ready.json")];
    const READY_2: [RegExp, Reply] = [/\/progress\/s_example0002$/, fixture("progress-ready.json")];
    const SNAP_1: [RegExp, Reply] = [/\/snapshot\/s_example0001\?/, fixture("snapshot.json")];
    const SNAP_2: [RegExp, Reply] = [/\/snapshot\/s_example0002\?/, fixture("snapshot.json")];

    it("waits for every run before it downloads any snapshot", async () => {
      const http = fakeHttp([
        READY_1,
        [/\/progress\/s_example0002$/, fixture("progress-running.json")],
      ]);
      expect(await reddit.poll!(ctx(http), MULTI)).toEqual({ kind: "pending", handle: MULTI });
      expect(http.mock.calls.every(([url]) => String(url).includes("/progress/"))).toBe(true);
    });

    it("merges the snapshots, counting the records of each as units", async () => {
      const single = (await collected()).state;
      const state = await reddit.poll!(ctx(fakeHttp([READY_1, READY_2, SNAP_1, SNAP_2])), MULTI);
      if (state.kind !== "done" || single.kind !== "done") throw new Error("expected done");
      expect(state.posts).toEqual(single.posts);
      expect(state.units).toBe(single.units * 2);
    });

    it("carries on with the runs that finished when one failed", async () => {
      const single = (await collected()).state;
      const http = fakeHttp([
        [/\/progress\/s_example0001$/, JSON.stringify({ status: "failed" })],
        READY_2,
        SNAP_2,
      ]);
      const state = await reddit.poll!(ctx(http), MULTI);
      if (state.kind !== "done" || single.kind !== "done") throw new Error("expected done");
      expect(state.posts).toEqual(single.posts);
      // The failed run may still have been billed, so it counts at its share of the budget
      // (120 over 2 runs), the safe direction for the caps (docs/PLAN.md 2.1.3, 2.1.8, 7.2).
      expect(state.units).toBe(single.units + 60);
    });

    it("reads the finished runs once a straggler has been pending for 45 minutes", async () => {
      const single = (await collected()).state;
      const http = fakeHttp([
        READY_1,
        [/\/progress\/s_example0002$/, fixture("progress-running.json")],
        SNAP_1,
      ]);
      const late = { startedAt: new Date(NOW.getTime() - 50 * 60_000) };
      const state = await reddit.poll!(ctx(http, late), MULTI);
      if (state.kind !== "done" || single.kind !== "done") throw new Error("expected done");
      expect(state.posts).toEqual(single.posts);
      expect(state.units).toBe(single.units + 60);
    });

    it("keeps waiting for a straggler before that", async () => {
      const http = fakeHttp([
        READY_1,
        [/\/progress\/s_example0002$/, fixture("progress-running.json")],
      ]);
      const early = { startedAt: new Date(NOW.getTime() - 10 * 60_000) };
      expect(await reddit.poll!(ctx(http, early), MULTI)).toEqual({
        kind: "pending",
        handle: MULTI,
      });
    });

    it("stops asking at the first run that is still going", async () => {
      const http = fakeHttp([[/\/progress\/s_example0001$/, fixture("progress-running.json")]]);
      expect((await reddit.poll!(ctx(http), MULTI)).kind).toBe("pending");
      expect(http).toHaveBeenCalledTimes(1);
    });

    it("counts a snapshot id repeated in a handle once", async () => {
      const single = (await collected()).state;
      const twice = JSON.stringify({ p: "brightdata", h: "s_example0001,s_example0001", t: [] });
      const state = await reddit.poll!(ctx(fakeHttp([READY_1, SNAP_1])), twice);
      if (state.kind !== "done" || single.kind !== "done") throw new Error("expected done");
      expect(state.units).toBe(single.units);
    });

    it("stops starting runs before the handle would outgrow what poll() accepts", async () => {
      const longIds = () => {
        let n = 0;
        return () =>
          new Response(JSON.stringify({ snapshot_id: `s${++n}`.padEnd(100, "x") }), {
            status: 200,
          });
      };
      const http = fakeHttp([[/\/trigger\?/, longIds()]]);
      const terms = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, term: `term ${i}` }));
      const state = await reddit.start(ctx(http, { terms }));
      if (state.kind !== "pending") throw new Error("expected pending");
      expect(JSON.parse(state.handle).h.length).toBeLessThanOrEqual(500);
      expect(http).toHaveBeenCalledTimes(4);
    });

    it("fails with a class name when every run failed", async () => {
      const http = fakeHttp([[/\/progress\//, JSON.stringify({ status: "failed" })]]);
      expect(await reddit.poll!(ctx(http), MULTI)).toEqual({
        kind: "failed",
        errorClass: "VendorRunFailed",
      });
    });

    it("refuses a handle with any bad snapshot id before calling anything", async () => {
      const http = fakeHttp([]);
      const bad = JSON.stringify({ p: "brightdata", h: "s_example0001,../trigger", t: [] });
      expect((await reddit.poll!(ctx(http), bad)).kind).toBe("failed");
      expect(http).not.toHaveBeenCalled();
    });
  });

  it("makes no call when the budget cannot buy one query", async () => {
    const http = fakeHttp([]);
    expect(await reddit.start(ctx(http, { budget: 4 }))).toEqual({
      kind: "done",
      posts: [],
      units: 0,
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("waits while the run is not ready, asking only for its progress", async () => {
    const handle = await handleFrom(ctx(fakeHttp([[/\/trigger\?/, fixture("trigger.json")]])));
    const http = fakeHttp([[/\/progress\/s_example0001$/, fixture("progress-running.json")]]);
    expect(await reddit.poll!(ctx(http), handle)).toEqual({ kind: "pending", handle });
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]![1]!.method).toBe("GET");
  });

  it("waits when the snapshot is still building (202)", async () => {
    const { state } = await collected([
      [/\/progress\//, fixture("progress-ready.json")],
      [/\/snapshot\//, 202],
    ]);
    expect(state.kind).toBe("pending");
  });

  it("maps posts and drops errors, NSFW, deleted authors, profiles, sensitive communities, off-Reddit links and old posts", async () => {
    const { state } = await collected();
    if (state.kind !== "done") throw new Error(JSON.stringify(state));
    expect(state.posts.map((p) => p.externalId)).toEqual(["1exa001", "1exa002", "1exa015"]);
    expect(state.posts[0]).toEqual({
      externalId: "1exa001",
      url: "https://www.reddit.com/r/freelance/comments/1exa001/example_post_1exa001/",
      excerpt:
        "How do you chase unpaid invoices without sounding rude? Looking for a tool that sends reminders for me. Spreadsheets are not cutting it.",
      postedAt: new Date("2026-10-17T06:00:00.000Z"),
      authorKey: "example_maker_one",
      community: "r/freelance",
      termId: "t-invoice",
      nsfw: false,
    } satisfies CollectedPost);
    // old.reddit.com becomes www.reddit.com, without the query or the fragment.
    expect(state.posts[1]).toMatchObject({
      url: "https://www.reddit.com/r/smallbusiness/comments/1exa002/late_fees_on_invoices/",
      termId: "t-fees",
    });
    // 1exa014's body was removed at the source, so the post is gone there and not kept here.
    expect(state.posts[2]!.excerpt.length).toBeLessThanOrEqual(280);
    // Every record is billed, the error record included.
    expect(state.units).toBe(15);
  });

  it("drops profile communities, every NSFW field, private, quarantined or unknown community types, and removed posts", async () => {
    const { state } = await collected([
      READY[0]!,
      [/\/snapshot\/s_example0001\?format=json$/, fixture("snapshot-drops.json")],
    ]);
    if (state.kind !== "done") throw new Error(JSON.stringify(state));
    // 1exa016 /r/u_<name>/ link, 1exa017 u_ community name, 1exa018 to 1exa020 nsfw, is_nsfw and
    // over18, 1exa021 and 1exa022 quarantined, 1exa023 private, 1exa024 an unknown type, 1exa025
    // a deleted body, 1exa026 and 1exa027 a deleted or removed title. 1exa028 is public and kept.
    expect(state.posts.map((p) => p.externalId)).toEqual(["1exa028"]);
    expect(state.units).toBe(13);
  });

  it("keeps none of the other fields: no comments, other users or vendor extras leave the module", async () => {
    const { state } = await collected();
    if (state.kind !== "done") throw new Error(JSON.stringify(state));
    const keys = [
      "externalId",
      "url",
      "excerpt",
      "postedAt",
      "authorKey",
      "community",
      "termId",
      "nsfw",
    ];
    for (const post of state.posts) expect(Object.keys(post).sort()).toEqual([...keys].sort());
    expect(JSON.stringify(state.posts)).not.toMatch(/example_other_person|invented reply|num_/i);
  });

  it("fails the run when the vendor run fails", async () => {
    const { state } = await collected([[/\/progress\//, JSON.stringify({ status: "failed" })]]);
    expect(state).toEqual({ kind: "failed", errorClass: "VendorRunFailed" });
  });

  it("refuses a snapshot over 5 MB, by its declared length and while reading", async () => {
    const declared = await collected([
      [/\/progress\//, fixture("progress-ready.json")],
      [
        /\/snapshot\//,
        () =>
          new Response("[]", {
            headers: { "content-length": String(MAX_SNAPSHOT_BYTES + 1) },
          }),
      ],
    ]);
    expect(declared.state).toEqual({ kind: "failed", errorClass: "SnapshotTooLarge" });

    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent++;
        controller.enqueue(chunk);
      },
    });
    const streamed = await collected([
      [/\/progress\//, fixture("progress-ready.json")],
      [/\/snapshot\//, () => new Response(endless)],
    ]);
    expect(streamed.state).toEqual({ kind: "failed", errorClass: "SnapshotTooLarge" });
    expect(sent).toBeLessThanOrEqual(7);
  });

  it("reports a download cut off mid-stream as InvalidResponse", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("[{"));
        controller.error(new TypeError("terminated"));
      },
    });
    const { state } = await collected([
      [/\/progress\//, fixture("progress-ready.json")],
      [/\/snapshot\//, () => new Response(broken)],
    ]);
    expect(state).toEqual({ kind: "failed", errorClass: "InvalidResponse" });
  });

  it("fails with a class name when no record matches the schema", async () => {
    const { state } = await collected([
      [/\/progress\//, fixture("progress-ready.json")],
      [/\/snapshot\//, JSON.stringify([{ post_id: 7 }, { url: null }])],
    ]);
    expect(state).toEqual({ kind: "failed", errorClass: "InvalidResponse" });
  });

  it("refuses to start without a token, without calling anything", async () => {
    const http = fakeHttp([]);
    const credential = (name: string) =>
      name === "BRIGHTDATA_API_TOKEN" ? undefined : CONFIG[name];
    expect(await reddit.start(ctx(http, { credential }))).toEqual({
      kind: "failed",
      errorClass: "MissingCredentials",
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("refuses to start when the env names a dataset that is not pinned (planted: LinkedIn's)", async () => {
    for (const value of [LINKEDIN_DATASET, undefined, ""]) {
      const http = fakeHttp([]);
      const credential = (name: string) =>
        name === "BRIGHTDATA_REDDIT_DATASET_ID" ? value : CONFIG[name];
      expect(await reddit.start(ctx(http, { credential }))).toEqual({
        kind: "failed",
        errorClass: "DatasetNotPinned",
      });
      expect(http).not.toHaveBeenCalled();
    }
  });

  it("refuses an unknown REDDIT_PROVIDER", async () => {
    const http = fakeHttp([]);
    const credential = (name: string) => (name === "REDDIT_PROVIDER" ? "other" : CONFIG[name]);
    expect(await reddit.start(ctx(http, { credential }))).toEqual({
      kind: "failed",
      errorClass: "UnknownProvider",
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("refuses a tampered handle before calling anything", async () => {
    for (const handle of [
      "not json",
      JSON.stringify({ p: "brightdata", h: "../../trigger" }),
      JSON.stringify({ p: "other", h: "s_1" }),
    ]) {
      const http = fakeHttp([]);
      const state = await reddit.poll!(ctx(http), handle);
      expect(state.kind).toBe("failed");
      expect(http).not.toHaveBeenCalled();
    }
  });
});

describe("the deletion re-check (docs/PLAN.md 2.3.6, 7.7)", () => {
  const STORED = [
    "https://www.reddit.com/r/freelance/comments/1exa001/example_post_1exa001/",
    "https://www.reddit.com/r/smallbusiness/comments/1exa002/late_fees_on_invoices/",
    "https://www.reddit.com/r/SaaS/comments/1exa099/gone_post/",
  ];

  it("re-collects the stored links by URL on the pinned dataset, and nothing else", async () => {
    const http = fakeHttp([[/\/trigger\?/, fixture("trigger.json")]]);
    const state = await reddit.recheck!.start(ctx(http), STORED);
    expect(state).toEqual({ kind: "pending", handle: "s_example0001" });
    const [input, init] = http.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://api.brightdata.com/datasets/v3/trigger");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dataset_id: DATASET,
      include_errors: "true",
    });
    expect(init!.method).toBe("POST");
    expect(JSON.parse(String(init!.body))).toEqual(STORED.map((u) => ({ url: u })));
  });

  it("refuses to send anything but stored Reddit post links", async () => {
    for (const bad of [
      "https://www.linkedin.com/in/someone",
      "https://www.reddit.com/user/example_person/",
      "https://old.reddit.com/r/SaaS/comments/1/x/",
      "https://www.reddit.com/r/SaaS/",
    ]) {
      const http = fakeHttp([[/\/trigger\?/, fixture("trigger.json")]]);
      expect(await reddit.recheck!.start(ctx(http), [STORED[0]!, bad]), bad).toEqual({
        kind: "failed",
        errorClass: "VendorRequestRefused",
      });
      expect(http).not.toHaveBeenCalled();
    }
  });

  it("reports live only the posts that came back intact; gone, deleted, removed or missing are not", async () => {
    const snapshot = JSON.stringify([
      JSON.parse(fixture("snapshot.json"))[0], // 1exa001, intact
      {
        ...JSON.parse(fixture("snapshot.json"))[1],
        user_posted: "[deleted]",
      }, // 1exa002, author deleted
      { error: "Page not found", error_code: "dead_page", input: { url: STORED[2] } },
      { ...JSON.parse(fixture("snapshot.json"))[0], post_id: "1exa003", description: "[removed]" },
      {
        ...JSON.parse(fixture("snapshot.json"))[0],
        post_id: "1exa004",
        title: "[deleted by user]",
        description: "",
      },
    ]);
    const http = fakeHttp([
      [/\/progress\//, fixture("progress-ready.json")],
      [/\/snapshot\//, snapshot],
    ]);
    const state = await reddit.recheck!.poll(ctx(http), "s_example0001");
    expect(state).toEqual({ kind: "done", live: ["1exa001"], units: 5 });
  });

  it("waits while the re-check snapshot is not ready", async () => {
    const http = fakeHttp([[/\/progress\//, fixture("progress-running.json")]]);
    expect(await reddit.recheck!.poll(ctx(http), "s_example0001")).toEqual({ kind: "pending" });
  });

  it("is on by default and REDDIT_DELETION_RECHECK=false turns it off", () => {
    expect(reddit.recheck!.enabled(ctx(fakeHttp([])))).toBe(true);
    const off = (name: string) => (name === "REDDIT_DELETION_RECHECK" ? "false" : CONFIG[name]);
    expect(reddit.recheck!.enabled(ctx(fakeHttp([]), { credential: off }))).toBe(false);
  });
});

describe("the pinned vendor requests (2.1.9)", () => {
  const trigger = (params: string) => `${API}/datasets/v3/trigger?${params}`;
  const PINNED = `dataset_id=${DATASET}&type=discover_new&discover_by=keyword&include_errors=true`;

  it("allows exactly the trigger, progress and snapshot requests", () => {
    expect(() => assertPinnedRequest(trigger(PINNED), "POST")).not.toThrow();
    // Collection by URL (the deletion re-check): the same dataset, no discovery parameters.
    expect(() =>
      assertPinnedRequest(trigger(`dataset_id=${DATASET}&include_errors=true`), "POST"),
    ).not.toThrow();
    expect(() =>
      assertPinnedRequest(`${API}/datasets/v3/progress/s_example0001`, "GET"),
    ).not.toThrow();
    expect(() =>
      assertPinnedRequest(`${API}/datasets/v3/snapshot/s_example0001?format=json`, "GET"),
    ).not.toThrow();
  });

  it.each([
    ["a LinkedIn dataset id", trigger(PINNED.replace(DATASET, LINKEDIN_DATASET)), "POST"],
    ["no dataset id", trigger("type=discover_new&discover_by=keyword&include_errors=true"), "POST"],
    [
      "a URL collection on another dataset",
      trigger(`dataset_id=${LINKEDIN_DATASET}&include_errors=true`),
      "POST",
    ],
    [
      "a URL collection with extras",
      trigger(`dataset_id=${DATASET}&include_errors=true&limit_per_input=9`),
      "POST",
    ],
    ["a URL collection without errors", trigger(`dataset_id=${DATASET}`), "POST"],
    ["a second dataset id", trigger(`${PINNED}&dataset_id=${LINKEDIN_DATASET}`), "POST"],
    ["an extra parameter", trigger(`${PINNED}&notify=https://evil.example/`), "POST"],
    ["discovery by URL", trigger(PINNED.replace("keyword", "url")), "POST"],
    ["a GET trigger", trigger(PINNED), "GET"],
    ["the Web Unlocker API", `${API}/request`, "POST"],
    ["the SERP API", `${API}/serp/req`, "POST"],
    ["a synchronous scrape", `${API}/datasets/v3/scrape?dataset_id=${DATASET}`, "POST"],
    ["the dataset list", `${API}/datasets/list`, "GET"],
    ["a zone change", `${API}/zone/get_active_zones`, "GET"],
    ["a CSV snapshot", `${API}/datasets/v3/snapshot/s_1?format=csv`, "GET"],
    ["an encoded traversal", `${API}/datasets/v3/progress/s_1%2F..%2Ftrigger`, "GET"],
    ["another host", "https://brightdata.com/datasets/v3/progress/s_1", "GET"],
    [
      "credentials in the URL",
      "https://user:pass@api.brightdata.com/datasets/v3/progress/s_1",
      "GET",
    ],
    ["plain http", "http://api.brightdata.com/datasets/v3/progress/s_1", "GET"],
  ])("refuses %s before it is sent", (_label, url, method) => {
    expect(() => assertPinnedRequest(url, method)).toThrow(VendorRequestRefused);
  });

  it("keeps the source's own fetch off every other source's host and every Reddit host", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const everythingOn = Object.fromEntries(
      sources.map((s) => [`SOURCE_${s.id.toUpperCase()}_ENABLED`, "true"]),
    );
    const sourceFetch = createSourceFetch(reddit, { env: everythingOn, fetchImpl });
    const others = sources
      .filter((s) => s.id !== "reddit")
      .flatMap((s) => [...s.allowedHosts, ...s.linkHosts]);
    const redditHosts = [
      "www.reddit.com",
      "old.reddit.com",
      "reddit.com",
      "oauth.reddit.com",
      "redd.it",
      "i.redd.it",
    ];
    for (const host of [...others, ...redditHosts])
      await expect(sourceFetch(`https://${host}/`)).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
    await sourceFetch(`${API}/datasets/v3/progress/s_1`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("calls nothing at all while the kill switch is off", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const sourceFetch = createSourceFetch(reddit, { env: {}, fetchImpl });
    await expect(sourceFetch(`${API}/datasets/v3/progress/s_1`)).rejects.toBeInstanceOf(
      SafeFetchError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("reddit fixtures", () => {
  it.each(["snapshot.json", "snapshot-drops.json"])(
    "%s is synthetic: every author and commenter is an invented example_ name",
    (file) => {
      const records = JSON.parse(fixture(file)) as Record<string, unknown>[];
      const names: string[] = [];
      const walk = (value: unknown, key = "") => {
        if (Array.isArray(value)) value.forEach((v) => walk(v, key));
        else if (value && typeof value === "object")
          for (const [k, v] of Object.entries(value)) walk(v, k);
        else if (typeof value === "string" && /user|author/i.test(key)) names.push(value);
      };
      walk(records);
      expect(names.length).toBeGreaterThan(10);
      for (const name of names) expect(name).toMatch(/^(example_[a-z_]+|\[deleted\])$/);
      for (const record of records)
        if (typeof record.url === "string")
          expect(record.url).toMatch(/example_|lookalike|off_reddit|late_fees|a_profile_post/);
    },
  );
});

describe("NSFW fails closed (docs/PLAN.md 2.1.2)", () => {
  it("treats a post record with no NSFW or over-18 boolean as unreadable, so the run fails", async () => {
    const { toRedditRecordForTest } = await import("./reddit-brightdata");
    const record = { ...JSON.parse(fixture("snapshot.json"))[0] };
    for (const k of ["nsfw", "is_nsfw", "over_18", "over18"]) delete record[k];
    expect(toRedditRecordForTest(record)).toBeNull();
    expect(toRedditRecordForTest({ ...record, over_18: false })).not.toBeNull();
    expect(toRedditRecordForTest({ ...record, nsfw: "no" })).toBeNull();
  });
});

describe("the date filter (checked against the live dataset, 26 Nov 2026)", () => {
  it("only ever sends a value the dataset accepts", () => {
    for (const hours of [
      0.5,
      1,
      2,
      24,
      25,
      48,
      24 * 7,
      24 * 8,
      24 * 30,
      24 * 31,
      24 * 32,
      24 * 400,
    ])
      expect(BRIGHTDATA_DATE_FILTERS, `${hours} hours`).toContain(dateFilterFor(hours));
  });

  it("never sends the values the vendor refused", () => {
    // "Past 24 hours" and "Past day" came back 400 "This value is not allowed".
    for (const hours of [1, 2, 12, 24, 36, 48])
      expect(["Past 24 hours", "Past day"]).not.toContain(dateFilterFor(hours));
  });

  it("covers the window it is asked for, widening rather than narrowing", () => {
    expect(dateFilterFor(1)).toBe("Past hour");
    expect(dateFilterFor(24)).toBe("Past week");
    expect(dateFilterFor(48)).toBe("Past week");
    expect(dateFilterFor(24 * 30)).toBe("Past month");
  });
});
