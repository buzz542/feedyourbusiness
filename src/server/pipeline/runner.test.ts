import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { reddit } from "@/sources/reddit";
import type { CollectedPost, CollectSource, RunState } from "@/sources/types";
import { createCollectHandler, type CollectHandlerDeps } from "./collect";
import { enqueueDaily } from "./enqueue";
import { FakeBudget, FakeJobStore } from "./fakes";
import type { JobHandler } from "./ports";
import { runJobs } from "./runner";

/**
 * The jobs runner and the collect job's steps (docs/PLAN.md 7.2, 7.3), with a fake clock, fake
 * sources and the in-memory job store.
 */

const DAY = "2026-10-17";
const T0 = new Date(`${DAY}T06:00:00Z`);

function clockFrom(start: Date) {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const post = (id: string): CollectedPost => ({
  externalId: id,
  url: `https://news.hn.example/item?id=${id}`,
  excerpt: `Looking for a tool ${id}`,
  postedAt: new Date(`${DAY}T05:00:00Z`),
  authorKey: `author-${id}`,
  community: "Hacker News",
  termId: null,
  nsfw: false,
});

function source(over: Partial<CollectSource> = {}): CollectSource {
  return {
    id: "hackernews",
    displayName: "Hacker News",
    mode: "collect",
    access: "official_api",
    termsUrl: "https://terms.example/",
    allowedHosts: ["api.hn.example"],
    linkHosts: ["news.hn.example"],
    dailyBudget: 20,
    retentionDays: 30,
    costPerUnitUsd: 0,
    credentials: [],
    start: vi.fn(async (): Promise<RunState> => ({
      kind: "done",
      posts: [post("1"), post("2")],
      units: 2,
    })),
    ...over,
  };
}

function setup(src: CollectSource) {
  const store = new FakeJobStore();
  const budget = new FakeBudget(store);
  const stored = new Map<string, CollectedPost>();
  const process = vi.fn<CollectHandlerDeps["process"]>(async ({ posts }) => {
    for (const p of posts) if (!stored.has(p.externalId)) stored.set(p.externalId, p);
    return { stored: posts.length };
  });
  const deps: CollectHandlerDeps = {
    sourceFor: (id) => (id === src.id ? src : null),
    fetchFor: () => vi.fn(),
    budget,
    terms: async () => [{ id: "t1", term: "invoice tool" }],
    process,
    monthlyCap: () => null,
    userAgent: "AskedFor/test",
    sleep: async () => {},
  };
  const handlers: Record<string, JobHandler> = { collect: createCollectHandler(deps) };
  return { store, budget, stored, process, handlers };
}

async function enqueueCollect(store: FakeJobStore) {
  await store.enqueue([
    {
      kind: "collect",
      productId: "p1",
      source: "hackernews",
      dedupeKey: `collect:p1:hackernews:${DAY}`,
    },
  ]);
}

describe("runJobs", () => {
  it("runs a collect job: reserve, start, process, settle", async () => {
    const src = source();
    const { store, budget, stored, handlers } = setup(src);
    await enqueueCollect(store);
    const clock = clockFrom(T0);
    const summary = await runJobs({ store, handlers, clock: clock.now });
    expect(summary).toMatchObject({ claimed: 1, done: 1, failed: 0 });
    expect([...stored.keys()]).toEqual(["1", "2"]);
    expect(store.jobs[0]!.status).toBe("done");
    // 20 reserved, 2 used: 18 given back.
    expect(budget.ledger.get(`p1:hackernews:${DAY}`)).toBe(2);
  });

  it("resumes a pending vendor run on a later tick", async () => {
    const poll = vi
      .fn<NonNullable<CollectSource["poll"]>>()
      .mockResolvedValueOnce({ kind: "pending", handle: "snap-1" })
      .mockResolvedValueOnce({ kind: "done", posts: [post("9")], units: 1 });
    const src = source({
      id: "reddit",
      access: "vendor_api",
      retentionDays: 7,
      start: vi.fn(async (): Promise<RunState> => ({ kind: "pending", handle: "snap-1" })),
      poll,
    });
    const { store, stored, handlers } = setup(src);
    await store.enqueue([
      { kind: "collect", productId: "p1", source: "reddit", dedupeKey: `collect:p1:reddit:${DAY}` },
    ]);
    const clock = clockFrom(T0);

    await runJobs({ store, handlers, clock: clock.now });
    expect(store.jobs[0]).toMatchObject({ status: "waiting", payload: { handle: "snap-1" } });

    // Too early: run_after is two minutes out.
    clock.advance(60_000);
    expect((await runJobs({ store, handlers, clock: clock.now })).claimed).toBe(0);

    clock.advance(70_000);
    await runJobs({ store, handlers, clock: clock.now }); // still pending
    clock.advance(130_000);
    await runJobs({ store, handlers, clock: clock.now }); // done
    expect(src.start).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledWith(expect.anything(), "snap-1");
    expect(store.jobs[0]!.status).toBe("done");
    expect([...stored.keys()]).toEqual(["9"]);
  });

  it("re-runs a job that crashed mid-step without charging the budget twice or storing a post twice", async () => {
    const src = source();
    const { store, budget, stored, process, handlers } = setup(src);
    // The first run stores one post, then crashes before finishing.
    process.mockImplementationOnce(async ({ posts }) => {
      stored.set(posts[0]!.externalId, posts[0]!);
      throw Object.assign(new Error("connection reset"), { name: "FetchError" });
    });
    await enqueueCollect(store);
    const clock = clockFrom(T0);

    await runJobs({ store, handlers, clock: clock.now });
    expect(store.jobs[0]).toMatchObject({
      status: "queued",
      payload: { failures: 1, reserved: 20 },
    });

    clock.advance(10 * 60_000);
    await runJobs({ store, handlers, clock: clock.now });
    expect(store.jobs[0]!.status).toBe("done");
    expect(budget.reserveCalls).toBe(2); // asked twice, charged once
    expect(budget.ledger.get(`p1:hackernews:${DAY}`)).toBe(2);
    expect([...stored.keys()].sort()).toEqual(["1", "2"]);
  });

  it("hands back a claimed job it had no time to start, so it is not counted as a crash", async () => {
    const store = new FakeJobStore();
    await store.enqueue([
      { kind: "purge", productId: null, source: null, dedupeKey: "purge:a", runAfter: T0 },
      { kind: "purge", productId: null, source: null, dedupeKey: "purge:b", runAfter: T0 },
    ]);
    const clock = clockFrom(T0);
    const ran: string[] = [];
    const handlers: Record<string, JobHandler> = {
      purge: async (job) => {
        ran.push(job.id);
        clock.advance(300_000); // the first job uses the whole budget
        return { status: "done" };
      },
    };
    const summary = await runJobs({ store, handlers, clock: clock.now, budgetMs: 240_000 });
    expect(summary).toMatchObject({ claimed: 2, done: 1, released: 1, failed: 0 });
    expect(ran).toHaveLength(1);
    const left = store.jobs.find((j) => j.id !== ran[0])!;
    expect(left).toMatchObject({ status: "queued", lockedUntil: null });
    expect(left.payload.failures).toBeUndefined();
  });

  it("stops claiming once the time budget is spent", async () => {
    const clock = clockFrom(T0);
    const store = new FakeJobStore();
    const slow: JobHandler = async () => {
      clock.advance(100_000); // each job takes 100 seconds
      return { status: "done" };
    };
    await store.enqueue(
      Array.from({ length: 30 }, (_, i) => ({
        kind: "purge" as const,
        productId: null,
        source: null,
        dedupeKey: `purge:${i}`,
      })),
    );
    const summary = await runJobs({ store, handlers: { purge: slow }, clock: clock.now, limit: 1 });
    // 240 seconds: the claims at 0, 100 and 200 seconds run; none after.
    expect(summary.claimed).toBe(3);
    expect(store.claims).toBe(3);
    expect(store.jobs.filter((j) => j.status === "queued")).toHaveLength(27);
  });

  it("marks a job failed with its error class after three failures", async () => {
    const clock = clockFrom(T0);
    const store = new FakeJobStore();
    const broken: JobHandler = async () => {
      throw Object.assign(new Error("secret detail"), { name: "TypeError" });
    };
    await store.enqueue([{ kind: "purge", productId: null, source: null, dedupeKey: "purge:x" }]);
    for (let i = 0; i < 3; i++) {
      await runJobs({ store, handlers: { purge: broken }, clock: clock.now });
      clock.advance(60 * 60_000);
    }
    expect(store.jobs[0]).toMatchObject({
      status: "failed",
      payload: { failures: 3, lastError: "TypeError" },
    });
    expect(JSON.stringify(store.jobs[0])).not.toContain("secret detail");
  });

  it("gives a reservation back when a collect job fails for good", async () => {
    const src = source({
      start: vi.fn(async (): Promise<RunState> => ({ kind: "failed", errorClass: "HttpError" })),
    });
    const { store, budget, handlers } = setup(src);
    await enqueueCollect(store);
    const clock = clockFrom(T0);
    for (let i = 0; i < 3; i++) {
      await runJobs({ store, handlers, clock: clock.now });
      clock.advance(60 * 60_000);
    }
    expect(store.jobs[0]!.status).toBe("failed");
    expect(budget.ledger.get(`p1:hackernews:${DAY}`)).toBe(0);
  });

  it("finishes a collect job without calling the source when the budget is spent", async () => {
    const src = source();
    const { store, budget, handlers } = setup(src);
    budget.ledger.set(`p1:hackernews:${DAY}`, 15); // 15 of 20 used
    await enqueueCollect(store);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(src.start).not.toHaveBeenCalled();
    expect(store.jobs[0]).toMatchObject({ status: "done", payload: { result: "budget" } });
  });

  it("stops a collect job whose source was switched off", async () => {
    const src = source();
    const { store, handlers } = setup(src);
    await store.enqueue([
      {
        kind: "collect",
        productId: "p1",
        source: "bluesky",
        dedupeKey: `collect:p1:bluesky:${DAY}`,
      },
    ]);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(store.jobs[0]).toMatchObject({ status: "done", payload: { result: "source_off" } });
  });
});

describe("settling a vendor run that never finishes", () => {
  /** A vendor source whose run was triggered: from then on the vendor may bill for it. */
  function vendorSetup(poll: NonNullable<CollectSource["poll"]>) {
    const src = source({
      id: "reddit",
      access: "vendor_api",
      retentionDays: 7,
      costPerUnitUsd: 0.0015,
      start: vi.fn(async (): Promise<RunState> => ({ kind: "pending", handle: "snap-1" })),
      poll: vi.fn(poll),
    });
    let on = true;
    const store = new FakeJobStore();
    const budget = new FakeBudget(store);
    const handlers = {
      collect: createCollectHandler({
        sourceFor: (id) => (on && id === "reddit" ? src : null),
        fetchFor: () => vi.fn(),
        budget,
        terms: async () => [{ id: "t1", term: "invoice tool" }],
        process: vi.fn(async () => ({ stored: 0 })),
        monthlyCap: () => null,
        userAgent: "AskedFor/test",
      }),
    };
    const enqueue = () =>
      store.enqueue([
        {
          kind: "collect",
          productId: "p1",
          source: "reddit",
          dedupeKey: `collect:p1:reddit:${DAY}`,
        },
      ]);
    return { src, store, budget, handlers, enqueue, switchOff: () => void (on = false) };
  }
  const KEY = `p1:reddit:${DAY}`;

  it("counts the whole reservation, at its cost, when the run times out", async () => {
    const { store, budget, handlers, enqueue } = vendorSetup(async () => ({
      kind: "pending",
      handle: "snap-1",
    }));
    await enqueue();
    const clock = clockFrom(T0);
    for (let i = 0; i < 40 && store.jobs[0]!.status !== "done"; i++) {
      await runJobs({ store, handlers, clock: clock.now });
      clock.advance(3 * 60_000);
    }
    expect(store.jobs[0]).toMatchObject({ status: "done", payload: { result: "timeout" } });
    expect(budget.ledger.get(KEY)).toBe(20);
    expect(budget.costs.get(KEY)).toBeCloseTo(0.03, 6);
  });

  it("counts the whole reservation when a paid run fails after the trigger, and does not retry it", async () => {
    const { store, budget, handlers, enqueue } = vendorSetup(async () => ({
      kind: "failed",
      errorClass: "VendorRunFailed",
    }));
    await enqueue();
    const clock = clockFrom(T0);
    for (let i = 0; i < 6; i++) {
      await runJobs({ store, handlers, clock: clock.now });
      clock.advance(60 * 60_000);
    }
    expect(store.jobs[0]).toMatchObject({
      status: "done",
      payload: { result: "source_failed", errorClass: "VendorRunFailed" },
    });
    expect(budget.ledger.get(KEY)).toBe(20);
    expect(budget.costs.get(KEY)).toBeCloseTo(0.03, 6);
  });

  it("counts the whole reservation when the source is switched off mid-run", async () => {
    const { store, budget, handlers, enqueue, switchOff } = vendorSetup(async () => ({
      kind: "pending",
      handle: "snap-1",
    }));
    await enqueue();
    const clock = clockFrom(T0);
    await runJobs({ store, handlers, clock: clock.now });
    switchOff();
    clock.advance(3 * 60_000);
    await runJobs({ store, handlers, clock: clock.now });
    expect(store.jobs[0]).toMatchObject({ status: "done", payload: { result: "source_off" } });
    expect(budget.ledger.get(KEY)).toBe(20);
    expect(budget.costs.get(KEY)).toBeCloseTo(0.03, 6);
  });

  it("records records billed beyond the reservation, so the monthly cap sees them", async () => {
    const { store, budget, handlers, enqueue } = vendorSetup(async () => ({
      kind: "done",
      posts: [],
      units: 25,
    }));
    await enqueue();
    const clock = clockFrom(T0);
    await runJobs({ store, handlers, clock: clock.now });
    clock.advance(3 * 60_000);
    await runJobs({ store, handlers, clock: clock.now });
    expect(budget.ledger.get(KEY)).toBe(25);
    expect(budget.costs.get(KEY)).toBeCloseTo(0.0375, 6);
  });
});

describe("kill switches and caps", () => {
  it("a source switched off mid-run makes no further request", async () => {
    const { createSourceFetch } = await import("@/server/net/source-fetch");
    const { hackernews } = await import("@/sources/hackernews");
    const env: Record<string, string | undefined> = { SOURCE_HACKERNEWS_ENABLED: "true" };
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      env.SOURCE_HACKERNEWS_ENABLED = "false"; // switched off while the first request is out
      return new Response(JSON.stringify({ hits: [] }));
    });
    const store = new FakeJobStore();
    const budget = new FakeBudget(store);
    const handlers = {
      collect: createCollectHandler({
        sourceFor: () => hackernews,
        fetchFor: (s) => createSourceFetch(s, { env, fetchImpl }),
        budget,
        terms: async () => [
          { id: "t1", term: "invoice tool" },
          { id: "t2", term: "late fees" },
        ],
        process: vi.fn(async () => ({ stored: 0 })),
        monthlyCap: () => null,
        userAgent: "AskedFor/test",
        sleep: async () => {},
      }),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await enqueueCollect(store);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.jobs[0]!.payload.lastError).toBe("SafeFetchError");
  });

  it("sizes the reservation by the env budget and records the env price", async () => {
    const src = source({
      id: "reddit",
      access: "vendor_api",
      retentionDays: 7,
      dailyBudget: 120,
      costPerUnitUsd: 0.0015,
      start: vi.fn(async (ctx): Promise<RunState> => ({
        kind: "done",
        posts: [],
        units: ctx.budget,
      })),
    });
    const store = new FakeJobStore();
    const budget = new FakeBudget(store);
    const handlers = {
      collect: createCollectHandler({
        sourceFor: () => src,
        fetchFor: () => vi.fn(),
        budget,
        terms: async () => [{ id: "t1", term: "invoice tool" }],
        process: vi.fn(async () => ({ stored: 0 })),
        monthlyCap: () => null,
        budgetFor: () => 60,
        costFor: () => 0.0021,
        userAgent: "AskedFor/test",
      }),
    };
    await store.enqueue([
      { kind: "collect", productId: "p1", source: "reddit", dedupeKey: `collect:p1:reddit:${DAY}` },
    ]);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(budget.ledger.get(`p1:reddit:${DAY}`)).toBe(60);
    expect(budget.costs.get(`p1:reddit:${DAY}`)).toBeCloseTo(0.126, 6);
  });
});

describe("credentials", () => {
  it("gives a source only the env names it declares", async () => {
    const seen: Record<string, string | undefined> = {};
    const src = source({
      credentials: ["HACKERNEWS_TOKEN"],
      start: vi.fn(async (ctx): Promise<RunState> => {
        seen.declared = ctx.credential("HACKERNEWS_TOKEN");
        seen.other = ctx.credential("SUPABASE_SECRET_KEY");
        return { kind: "done", posts: [], units: 0 };
      }),
    });
    const store = new FakeJobStore();
    const env: Record<string, string> = { HACKERNEWS_TOKEN: "t", SUPABASE_SECRET_KEY: "secret" };
    const handlers = {
      collect: createCollectHandler({
        sourceFor: () => src,
        fetchFor: () => vi.fn(),
        budget: new FakeBudget(store),
        terms: async () => [{ id: "t1", term: "invoice tool" }],
        process: vi.fn(async () => ({ stored: 0 })),
        monthlyCap: () => null,
        userAgent: "AskedFor/test",
        credential: (name) => env[name],
      }),
    };
    await enqueueCollect(store);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(seen).toEqual({ declared: "t", other: undefined });
  });
});

describe("enqueueDaily", () => {
  const sources = [source(), source({ id: "bluesky", checkDeleted: async () => [] })];

  it("enqueues collect per product and source, deletion sync per source, and purge, once a day", async () => {
    const store = new FakeJobStore();
    const input = {
      store,
      products: async () => ["p1", "p2"],
      sources,
      kinds: new Set(["collect", "deletion_sync", "purge"] as const),
      now: T0,
    };
    expect(await enqueueDaily(input)).toBe(6);
    expect(store.jobs.map((j) => j.dedupeKey).sort()).toEqual([
      `collect:p1:bluesky:${DAY}`,
      `collect:p1:hackernews:${DAY}`,
      `collect:p2:bluesky:${DAY}`,
      `collect:p2:hackernews:${DAY}`,
      `deletion_sync:bluesky:${DAY}`,
      `purge:${DAY}`,
    ]);
    expect(await enqueueDaily(input)).toBe(0);
    expect(store.jobs).toHaveLength(6);
    // Due by the app's clock, the clock claims use, not the database's.
    for (const job of store.jobs) expect(job.runAfter).toEqual(T0);
    expect(store.jobs.find((j) => j.kind === "deletion_sync")?.payload).toEqual({ day: DAY });
  });

  it("enqueues a deletion re-check per product with Reddit posts due, over the 72 to 96 hour window", async () => {
    const store = new FakeJobStore();
    const recheckSource = source({
      id: "reddit",
      access: "vendor_api",
      retentionDays: 7,
      recheck: {
        enabled: () => true,
        start: async () => ({ kind: "pending", handle: "h" }),
        poll: async () => ({ kind: "pending" }),
      },
    });
    const recheckProducts = vi.fn(async () => ["p1", "p2"]);
    await enqueueDaily({
      store,
      products: async () => [],
      recheckProducts,
      sources: [recheckSource],
      kinds: new Set(["deletion_sync"] as const),
      now: T0,
    });
    const from = new Date(T0.getTime() - 96 * 3_600_000);
    const to = new Date(T0.getTime() - 72 * 3_600_000);
    expect(recheckProducts).toHaveBeenCalledWith(from, to);
    expect(store.jobs.map((j) => [j.dedupeKey, j.productId, j.payload])).toEqual([
      [
        `deletion_sync:reddit:p1:${DAY}`,
        "p1",
        { day: DAY, from: from.toISOString(), to: to.toISOString() },
      ],
      [
        `deletion_sync:reddit:p2:${DAY}`,
        "p2",
        { day: DAY, from: from.toISOString(), to: to.toISOString() },
      ],
    ]);
  });

  it("enqueues only the kinds that have a handler", async () => {
    const store = new FakeJobStore();
    await enqueueDaily({
      store,
      products: async () => ["p1"],
      sources,
      kinds: new Set(["purge"] as const),
      now: T0,
    });
    expect(store.jobs.map((j) => j.kind)).toEqual(["purge"]);
  });
});

describe("a product that stopped being collectable", () => {
  it("is skipped at run time: no budget reserved, no source called (docs/PLAN.md 7.3 step 1)", async () => {
    const src = source();
    const { store, budget } = setup(src);
    const paused: CollectHandlerDeps = {
      sourceFor: () => src,
      fetchFor: () => vi.fn(),
      budget,
      terms: async () => null, // paused, unconfirmed or no longer entitled since the enqueue
      process: vi.fn(),
      monthlyCap: () => null,
      userAgent: "AskedFor/test",
    };
    await enqueueCollect(store);
    await runJobs({
      store,
      handlers: { collect: createCollectHandler(paused) },
      clock: clockFrom(T0).now,
    });
    expect(store.jobs[0]).toMatchObject({ status: "done", payload: { result: "not_collectable" } });
    expect(budget.reserveCalls).toBe(0);
    expect(src.start).not.toHaveBeenCalled();
  });
});

describe("a vendor run in flight when the product stops being collectable", () => {
  it("still settles what the vendor billed, and stores nothing", async () => {
    let collectable = true;
    const poll = vi.fn<NonNullable<CollectSource["poll"]>>(async () => ({
      kind: "done",
      posts: [post("9")],
      units: 6,
    }));
    const src = source({
      id: "reddit",
      access: "vendor_api",
      retentionDays: 7,
      costPerUnitUsd: 0.0015,
      start: vi.fn(async (): Promise<RunState> => ({ kind: "pending", handle: "snap-1" })),
      poll,
    });
    const store = new FakeJobStore();
    const budget = new FakeBudget(store);
    const process = vi.fn<CollectHandlerDeps["process"]>(async () => ({ stored: 1 }));
    const handlers = {
      collect: createCollectHandler({
        sourceFor: () => src,
        fetchFor: () => vi.fn(),
        budget,
        terms: async () => (collectable ? [{ id: "t1", term: "invoice tool" }] : null),
        process,
        monthlyCap: () => null,
        userAgent: "AskedFor/test",
      }),
    };
    await store.enqueue([
      { kind: "collect", productId: "p1", source: "reddit", dedupeKey: `collect:p1:reddit:${DAY}` },
    ]);
    const clock = clockFrom(T0);
    await runJobs({ store, handlers, clock: clock.now });
    collectable = false; // paused while the vendor works
    clock.advance(3 * 60_000);
    await runJobs({ store, handlers, clock: clock.now });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(process).not.toHaveBeenCalled();
    expect(store.jobs[0]).toMatchObject({ status: "done", payload: { result: "not_collectable" } });
    expect(budget.ledger.get(`p1:reddit:${DAY}`)).toBe(6);
    expect(budget.costs.get(`p1:reddit:${DAY}`)).toBeCloseTo(0.009, 6);
  });
});

describe("model spend caps in the collect job (docs/PLAN.md 8.1)", () => {
  function capSetup(over: Partial<CollectHandlerDeps> = {}) {
    const start = vi.fn(async (): Promise<RunState> => ({
      kind: "done",
      posts: [post("1")],
      units: 1,
    }));
    const src = source({ start });
    const store = new FakeJobStore();
    const budget = new FakeBudget(store);
    const handlers = {
      collect: createCollectHandler({
        sourceFor: () => src,
        fetchFor: () => vi.fn(),
        budget,
        terms: async () => [{ id: "t1", term: "invoice tool" }],
        process: vi.fn(async () => ({ stored: 3, refused: 0, capped: "global_daily" as const })),
        monthlyCap: () => null,
        userAgent: "AskedFor/test",
        ...over,
      }),
    };
    return { start, store, budget, handlers };
  }

  it("shows a cap reached during classification in the job result", async () => {
    const { store, handlers } = capSetup();
    await store.enqueue([
      {
        kind: "collect",
        productId: "p1",
        source: "hackernews",
        dedupeKey: `collect:p1:hackernews:${DAY}`,
      },
    ]);
    await runJobs({ store, handlers, clock: () => T0 });
    expect(store.jobs[0]).toMatchObject({
      status: "done",
      payload: { result: "ok", stored: 3, refused: 0, capped: "global_daily" },
    });
  });

  it.each(["product_monthly", "global_daily"] as const)(
    "starts no fetch and reserves nothing once the %s cap is reached",
    async (cap) => {
      const spendCap = vi.fn(async () => cap);
      const { start, store, budget, handlers } = capSetup({ spendCap });
      await store.enqueue([
        {
          kind: "collect",
          productId: "p1",
          source: "hackernews",
          dedupeKey: `collect:p1:hackernews:${DAY}`,
        },
      ]);
      await runJobs({ store, handlers, clock: () => T0 });
      expect(spendCap).toHaveBeenCalledWith("p1");
      expect(start).not.toHaveBeenCalled();
      expect(budget.ledger.size).toBe(0);
      expect(store.jobs[0]).toMatchObject({
        status: "done",
        payload: { result: "spend_cap", cap },
      });
    },
  );
});

describe("collecting Reddit through the vendor (the real module, a fake vendor)", () => {
  const fixture = (name: string) => readFileSync(`tests/fixtures/reddit/${name}`, "utf8");
  const CONFIG: Record<string, string> = {
    BRIGHTDATA_API_TOKEN: "test-token",
    BRIGHTDATA_REDDIT_DATASET_ID: "gd_lvz8ah06191smkebj4",
  };

  function redditSetup() {
    const store = new FakeJobStore();
    const budget = new FakeBudget(store);
    const stored: CollectedPost[] = [];
    const http = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/trigger?")) return new Response(fixture("trigger.json"));
      if (url.includes("/progress/")) return new Response(fixture("progress-ready.json"));
      if (url.includes("/snapshot/")) return new Response(fixture("snapshot.json"));
      throw new Error(`unrouted ${url}`);
    });
    const deps: CollectHandlerDeps = {
      sourceFor: (id) => (id === "reddit" ? reddit : null),
      fetchFor: () => http,
      budget,
      terms: async () => [
        { id: "t-invoice", term: "invoice reminders" },
        { id: "t-fees", term: "late fees" },
      ],
      process: async ({ posts }) => {
        stored.push(...posts);
        return { stored: posts.length };
      },
      monthlyCap: () => 20_000,
      userAgent: "AskedFor/test",
      sleep: async () => {},
      credential: (name) => CONFIG[name],
    };
    return { store, budget, stored, http, handlers: { collect: createCollectHandler(deps) } };
  }

  const enqueue = (store: FakeJobStore, product: string) =>
    store.enqueue([
      {
        kind: "collect",
        productId: product,
        source: "reddit",
        dedupeKey: `collect:${product}:reddit:${DAY}`,
      },
    ]);

  it("triggers, waits for the snapshot, then stores the kept posts and records the cost", async () => {
    const { store, budget, stored, http, handlers } = redditSetup();
    await enqueue(store, "p1");
    const clock = clockFrom(T0);
    await runJobs({ store, handlers, clock: clock.now });
    expect(store.jobs[0]!.status).toBe("waiting");
    expect(http).toHaveBeenCalledTimes(1); // the trigger only
    clock.advance(3 * 60_000);
    await runJobs({ store, handlers, clock: clock.now });
    expect(store.jobs[0]!.status).toBe("done");
    expect(stored.map((p) => p.externalId)).toEqual(["1exa001", "1exa002", "1exa015"]);
    // 15 records billed at $1.50 per 1,000; 120 reserved, 105 given back.
    expect(budget.costs.get(`p1:reddit:${DAY}`)).toBeCloseTo(0.0225, 6);
    expect(budget.ledger.get(`p1:reddit:${DAY}`)).toBe(15);
  });

  it("makes no vendor call once the monthly cap is reached", async () => {
    const { store, budget, http, handlers } = redditSetup();
    budget.ledger.set(`p9:reddit:2026-10-03`, 19_950); // other customers, this month
    await enqueue(store, "p1");
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(store.jobs[0]).toMatchObject({ status: "done", payload: { result: "monthly_cap" } });
    expect(http).not.toHaveBeenCalled();
  });
});

describe("paid sources are never charged twice and never go unrecorded (review)", () => {
  const paid = (over: Partial<CollectSource> = {}) =>
    source({ id: "x", retentionDays: 7, costPerUnitUsd: 0.005, dailyBudget: 20, ...over });
  const setupPaid = (src: CollectSource) => {
    const s = setup(src);
    return s;
  };
  const enqueueX = (store: FakeJobStore) =>
    store.enqueue([
      { kind: "collect", productId: "p1", source: "x", dedupeKey: `collect:p1:x:${DAY}` },
    ]);
  const ledger = (budget: FakeBudget) => budget.ledger.get(`p1:x:${DAY}`);

  it("records the units a paid run read before classification failed, and never starts it again", async () => {
    const src = paid();
    const { store, budget, process, handlers } = setupPaid(src);
    process.mockRejectedValue(
      Object.assign(new Error("model down"), { name: "LlmUnavailableError" }),
    );
    await enqueueX(store);
    const clock = clockFrom(T0);
    for (let run = 0; run < 4; run++) {
      await runJobs({ store, handlers, clock: clock.now });
      clock.advance(60 * 60_000);
    }
    expect(src.start).toHaveBeenCalledTimes(1);
    expect(ledger(budget)).toBe(2); // the two posts read, recorded once
    expect(budget.costs.get(`p1:x:${DAY}`)).toBeCloseTo(0.01, 6);
    expect(store.jobs[0]!.status).toBe("done");
    expect(store.jobs[0]!.payload.result).toBe("interrupted");
  });

  it("settles what a failed paid run read, and does not retry it", async () => {
    const src = paid({
      start: vi.fn(async (): Promise<RunState> => ({
        kind: "failed",
        errorClass: "Http503",
        units: 7,
      })),
    });
    const { store, budget, handlers } = setupPaid(src);
    await enqueueX(store);
    const clock = clockFrom(T0);
    await runJobs({ store, handlers, clock: clock.now });
    clock.advance(60 * 60_000);
    await runJobs({ store, handlers, clock: clock.now });
    expect(src.start).toHaveBeenCalledTimes(1);
    expect(ledger(budget)).toBe(7);
    expect(store.jobs[0]!.payload).toMatchObject({
      result: "source_failed",
      errorClass: "Http503",
    });
  });

  it("counts the whole reservation when a paid run crashed after it was reserved", async () => {
    const src = paid({
      start: vi.fn(async (): Promise<RunState> => {
        throw Object.assign(new Error("killed"), { name: "FunctionTimeout" });
      }),
    });
    const { store, budget, handlers } = setupPaid(src);
    await enqueueX(store);
    const clock = clockFrom(T0);
    for (let run = 0; run < 3; run++) {
      await runJobs({ store, handlers, clock: clock.now });
      clock.advance(60 * 60_000);
    }
    expect(src.start).toHaveBeenCalledTimes(1);
    expect(ledger(budget)).toBe(20);
    expect(budget.costs.get(`p1:x:${DAY}`)).toBeCloseTo(0.1, 6);
  });
});

describe("monthly caps for paid official sources (2.1.8)", () => {
  it("gives a paid source with no approved monthly cap a cap of 0, and a free one none", async () => {
    const { monthlyCapFor } = await import("./config");
    expect(monthlyCapFor({ access: "official_api", costPerUnitUsd: 0.005 }, {})).toBe(0);
    expect(monthlyCapFor({ access: "official_api", costPerUnitUsd: 0 }, {})).toBeNull();
    expect(monthlyCapFor({ access: "vendor_api", costPerUnitUsd: 0.0015 }, {})).toBe(18_000);
  });
});
