import { describe, expect, it, vi } from "vitest";
import type { CollectContext, CollectSource } from "@/sources/types";
import { createDeletionSyncHandler, type DeletionStore } from "./deletion-sync";
import { FakeBudget, FakeJobStore } from "./fakes";
import type { Job, JobContext } from "./ports";
import { runJobs } from "./runner";

/**
 * Deletion sync (docs/PLAN.md 2.3.6, 7.2): Hacker News and Bluesky posts deleted at the source are
 * deleted here, working through every stored post in batches and resuming where a run stopped.
 */

const NOW = new Date("2026-10-17T06:00:00Z");
const DAY = "2026-10-17";

function store(externalIds: string[]) {
  const posts = externalIds.map((externalId, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    externalId,
  }));
  const removed: string[] = [];
  const s: DeletionStore & { removed: string[]; posts: typeof posts } = {
    posts,
    removed,
    stored: vi.fn(async (_source: string, afterId: string | null, limit: number) =>
      posts
        .filter((p) => !removed.includes(p.externalId) && (afterId === null || p.id > afterId))
        .slice(0, limit),
    ),
    remove: vi.fn(async (_source: string, ids: readonly string[]) => {
      removed.push(...ids);
      return ids.length;
    }),
    recheckDue: vi.fn(async () => []),
  };
  return s;
}

function source(gone: (ids: readonly string[]) => string[], over: Partial<CollectSource> = {}) {
  return {
    id: "hackernews",
    displayName: "Hacker News",
    mode: "collect",
    access: "official_api",
    termsUrl: "https://terms.example/",
    allowedHosts: ["api.hn.example"],
    linkHosts: ["news.hn.example"],
    dailyBudget: 300,
    retentionDays: 30,
    costPerUnitUsd: 0,
    credentials: [],
    start: async () => ({ kind: "done", posts: [], units: 0 }),
    checkDeleted: vi.fn(async (_ctx: CollectContext, ids: readonly string[]) => gone(ids)),
    ...over,
  } satisfies CollectSource;
}

const job = (over: Partial<Job> = {}): Job => ({
  id: "job-1",
  kind: "deletion_sync",
  productId: null,
  source: "hackernews",
  status: "running",
  payload: { day: DAY },
  attempts: 1,
  runAfter: NOW,
  ...over,
});

const run = (
  handler: ReturnType<typeof createDeletionSyncHandler>,
  j: Job,
  ctx?: Partial<JobContext>,
) => handler(j, { now: () => NOW, deadline: NOW.getTime() + 240_000, ...ctx });

function handlerFor(src: CollectSource | null, s: DeletionStore, batchSize = 2) {
  return createDeletionSyncHandler({
    sourceFor: () => src,
    fetchFor: () => vi.fn(),
    store: s,
    budget: new FakeBudget(new FakeJobStore()),
    recheckCap: () => null,
    userAgent: "AskedFor/test",
    sleep: async () => {},
    batchSize,
  });
}

describe("deletion sync", () => {
  it("removes every stored post the source reports gone, in batches, and keeps the rest", async () => {
    const s = store(["1", "2", "3", "4", "5"]);
    const src = source((ids) => ids.filter((id) => id === "2" || id === "5"));
    const result = await run(handlerFor(src, s), job());
    expect(result).toEqual({ status: "done", payload: { result: "ok", checked: 5, removed: 2 } });
    expect(s.removed).toEqual(["2", "5"]);
    expect(src.checkDeleted).toHaveBeenCalledTimes(3);
  });

  it("stops at the time budget and resumes from its cursor on the next run", async () => {
    const s = store(["1", "2", "3", "4", "5"]);
    let clock = NOW.getTime();
    const src = source((ids) => {
      clock += 100_000; // each batch takes 100 seconds
      return ids.filter((id) => id === "4");
    });
    const handler = handlerFor(src, s);
    const deadline = NOW.getTime() + 150_000;
    const first = await handler(job(), { now: () => new Date(clock), deadline });
    expect(first.status).toBe("waiting");
    const cursor = first.payload?.cursor;
    expect(cursor).toBe(s.posts[3]!.id); // two batches of two
    const second = await handler(job({ payload: { day: DAY, ...first.payload } }), {
      now: () => new Date(clock),
      deadline: clock + 240_000,
    });
    expect(second).toEqual({ status: "done", payload: { result: "ok", checked: 5, removed: 1 } });
    expect(s.removed).toEqual(["4"]);
  });

  it("removes only ids it asked about", async () => {
    const s = store(["1", "2"]);
    const src = source(() => ["1", "not-asked"]);
    await run(handlerFor(src, s), job());
    expect(s.removed).toEqual(["1"]);
  });

  it("leaves a job from an earlier day to today's", async () => {
    const s = store(["1"]);
    const src = source(() => ["1"]);
    expect(await run(handlerFor(src, s), job({ payload: { day: "2026-10-16" } }))).toEqual({
      status: "done",
      payload: { result: "superseded" },
    });
    expect(src.checkDeleted).not.toHaveBeenCalled();
  });

  it("does nothing for a source that is off or cannot check", async () => {
    const s = store(["1"]);
    expect((await run(handlerFor(null, s), job())).payload).toEqual({ result: "source_off" });
    const noCheck = source(() => []);
    const { checkDeleted: _ignored, ...withoutCheck } = noCheck;
    expect((await run(handlerFor(withoutCheck, s), job())).payload).toEqual({
      result: "source_off",
    });
    expect(s.stored).not.toHaveBeenCalled();
  });

  it("gives the source only its declared credentials", async () => {
    const s = store(["1"]);
    const seen: (string | undefined)[] = [];
    const src = source(() => [], {
      credentials: ["HACKERNEWS_TOKEN"],
      checkDeleted: vi.fn(async (ctx: CollectContext) => {
        seen.push(ctx.credential("HACKERNEWS_TOKEN"), ctx.credential("SUPABASE_SECRET_KEY"));
        return [];
      }),
    });
    const env: Record<string, string> = { HACKERNEWS_TOKEN: "t", SUPABASE_SECRET_KEY: "s" };
    const handler = createDeletionSyncHandler({
      sourceFor: () => src,
      fetchFor: () => vi.fn(),
      store: s,
      budget: new FakeBudget(new FakeJobStore()),
      recheckCap: () => null,
      userAgent: "AskedFor/test",
      sleep: async () => {},
      credential: (name) => env[name],
    });
    await run(handler, job());
    expect(seen).toEqual(["t", undefined]);
  });
});

describe("the Reddit deletion re-check", () => {
  const DUE = [
    { externalId: "a", url: "https://www.reddit.com/r/SaaS/comments/a/x/" },
    { externalId: "b", url: "https://www.reddit.com/r/SaaS/comments/b/x/" },
    { externalId: "c", url: "https://www.reddit.com/r/SaaS/comments/c/x/" },
  ];
  const FROM = "2026-10-13T06:00:00.000Z";
  const TO = "2026-10-14T06:00:00.000Z";

  function vendor(over: Partial<NonNullable<CollectSource["recheck"]>> = {}) {
    const recheck = {
      enabled: vi.fn(() => true),
      start: vi.fn(async () => ({ kind: "pending" as const, handle: "snap-r" })),
      poll: vi.fn(async () => ({ kind: "done" as const, live: ["a"], units: 3 })),
      ...over,
    };
    return {
      ...source(() => [], {
        id: "reddit",
        access: "vendor_api",
        retentionDays: 7,
        costPerUnitUsd: 0.0015,
        recheck,
      }),
      checkDeleted: undefined,
    } as CollectSource & { recheck: typeof recheck };
  }

  function setup(src: CollectSource, cap: number | null = 20_000) {
    const jobs = new FakeJobStore();
    const budget = new FakeBudget(jobs);
    const s = store([]);
    vi.mocked(s.recheckDue).mockResolvedValue(DUE);
    const handlers = {
      deletion_sync: createDeletionSyncHandler({
        sourceFor: () => src,
        fetchFor: () => vi.fn(),
        store: s,
        budget,
        recheckCap: () => cap,
        userAgent: "AskedFor/test",
        sleep: async () => {},
      }),
    };
    const enqueue = () =>
      jobs.enqueue([
        {
          kind: "deletion_sync",
          productId: "p1",
          source: "reddit",
          dedupeKey: `deletion_sync:reddit:p1:${DAY}`,
          payload: { day: DAY, from: FROM, to: TO },
        },
      ]);
    let clock = NOW.getTime();
    const tick = async (minutes = 3) => {
      await runJobs({ store: jobs, handlers, clock: () => new Date(clock) });
      clock += minutes * 60_000;
    };
    return { jobs, budget, s, enqueue, tick };
  }

  it("re-collects the product's due posts, then deletes every one not reported live", async () => {
    const src = vendor();
    const { jobs, budget, s, enqueue, tick } = setup(src);
    await enqueue();
    await tick();
    expect(s.recheckDue).toHaveBeenCalledWith("p1", new Date(FROM), new Date(TO), 200);
    expect(src.recheck.start).toHaveBeenCalledWith(
      expect.anything(),
      DUE.map((p) => p.url),
    );
    expect(jobs.jobs[0]!.status).toBe("waiting");
    await tick();
    expect(s.removed).toEqual(["b", "c"]);
    expect(jobs.jobs[0]).toMatchObject({
      status: "done",
      payload: { result: "ok", checked: 3, removed: 2 },
    });
    // Outside the product's daily budget, inside the monthly cap: 3 records at $1.50 per 1,000.
    expect(budget.ledger.get(`p1:reddit:${DAY}`)).toBe(3);
    expect(budget.costs.get(`p1:reddit:${DAY}`)).toBeCloseTo(0.0045, 6);
  });

  it("removes only posts it sent, even if more become due meanwhile", async () => {
    const src = vendor({
      poll: vi.fn(async () => ({ kind: "done" as const, live: [], units: 3 })),
    });
    const { s, enqueue, tick } = setup(src);
    await enqueue();
    await tick();
    vi.mocked(s.recheckDue).mockResolvedValue([
      ...DUE,
      { externalId: "late", url: "https://www.reddit.com/r/SaaS/comments/late/x/" },
    ]);
    await tick();
    expect(s.removed).toEqual(["a", "b", "c"]);
  });

  it("does nothing when REDDIT_DELETION_RECHECK is false", async () => {
    const src = vendor({ enabled: vi.fn(() => false) });
    const { jobs, budget, s, enqueue, tick } = setup(src);
    await enqueue();
    await tick();
    expect(jobs.jobs[0]).toMatchObject({ status: "done", payload: { result: "off" } });
    expect(s.recheckDue).not.toHaveBeenCalled();
    expect(budget.reserveCalls).toBe(0);
  });

  it("stops at the monthly cap without calling the vendor", async () => {
    const src = vendor();
    const { jobs, budget, enqueue, tick } = setup(src);
    budget.ledger.set(`p9:reddit:2026-10-02`, 19_999);
    await enqueue();
    await tick();
    expect(jobs.jobs[0]).toMatchObject({ status: "done", payload: { result: "monthly_cap" } });
    expect(src.recheck.start).not.toHaveBeenCalled();
  });

  it("does nothing when no post is due", async () => {
    const src = vendor();
    const { jobs, budget, s, enqueue, tick } = setup(src);
    vi.mocked(s.recheckDue).mockResolvedValue([]);
    await enqueue();
    await tick();
    expect(jobs.jobs[0]).toMatchObject({ status: "done", payload: { result: "nothing_due" } });
    expect(budget.reserveCalls).toBe(0);
  });

  it("counts the whole reservation when the vendor run fails for good after the trigger", async () => {
    const src = vendor({
      poll: vi.fn(async () => ({ kind: "failed" as const, errorClass: "VendorRunFailed" })),
    });
    const { jobs, budget, s, enqueue, tick } = setup(src);
    await enqueue();
    for (let i = 0; i < 6 && jobs.jobs[0]!.status !== "failed"; i++) await tick(60);
    expect(jobs.jobs[0]!.status).toBe("failed");
    expect(s.removed).toEqual([]);
    expect(budget.ledger.get(`p1:reddit:${DAY}`)).toBe(3);
  });
});
