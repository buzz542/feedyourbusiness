import { describe, expect, it, vi } from "vitest";
import type { CollectContext, CollectSource } from "@/sources/types";
import { createDeletionSyncHandler, type DeletionStore } from "./deletion-sync";
import type { Job, JobContext } from "./ports";

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
      userAgent: "AskedFor/test",
      sleep: async () => {},
      credential: (name) => env[name],
    });
    await run(handler, job());
    expect(seen).toEqual(["t", undefined]);
  });
});
