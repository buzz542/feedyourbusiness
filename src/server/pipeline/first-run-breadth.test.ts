import { describe, expect, it, vi } from "vitest";
import type { CollectContext, CollectSource, RunState } from "@/sources/types";
import {
  breadthOf,
  FREE_WAIT_MS,
  NICHE_WINDOW_HOURS,
  WIDE_MIN_STRONG,
  WIDE_WINDOW_HOURS,
  firstRunWindowHours,
} from "./breadth";
import { createCollectHandler, type CollectHandlerDeps, type FirstRunDeps } from "./collect";
import { FakeBudget, FakeJobStore } from "./fakes";
import { runJobs } from "./runner";

/**
 * The first run judges how niche the product is (the founder, 27 Nov 2026). The free sources run
 * first; the paid source (Reddit) waits for them, then reads the past week when the topic is wide
 * (plenty of strong recent matches) or the past month when it is niche. When the last first-run
 * source finishes, a niche product's feed minimum drops from 60 to 50. Later runs read recent posts
 * only, and a post already in the feed is never linked twice (unique product_id, post_id).
 */

const T0 = new Date("2026-11-27T10:00:00Z");
const HOUR = 3_600_000;

function clockFrom(start: Date) {
  let now = start.getTime();
  return { now: () => new Date(now), advance: (ms: number) => void (now += ms) };
}

function src(
  id: string,
  cost: number,
  start: CollectSource["start"],
  poll?: CollectSource["poll"],
) {
  const source: CollectSource = {
    id,
    displayName: id,
    mode: "collect",
    access: cost > 0 ? "vendor_api" : "official_api",
    termsUrl: "https://terms.example/",
    allowedHosts: [`api.${id}.example`],
    linkHosts: [`${id}.example`],
    dailyBudget: 120,
    retentionDays: cost > 0 ? 7 : 30,
    costPerUnitUsd: cost,
    credentials: [],
    start: vi.fn(start),
    ...(poll ? { poll: vi.fn(poll) } : {}),
  };
  return source;
}

const done = async (): Promise<RunState> => ({ kind: "done", posts: [], units: 0 });

function setup(opts: { strong: number; sources: CollectSource[] }) {
  const store = new FakeJobStore();
  const budget = new FakeBudget(store);
  const lowered: string[] = [];
  const active = (productId: string, jobId: string, freeOnly: boolean) =>
    store.jobs.some(
      (j) =>
        j.productId === productId &&
        j.kind === "first_run" &&
        j.id !== jobId &&
        (!freeOnly || opts.sources.find((s) => s.id === j.source)?.costPerUnitUsd === 0) &&
        (j.status === "queued" || j.status === "running" || j.status === "waiting"),
    );
  const firstRun: FirstRunDeps = {
    othersActive: async (productId, jobId) => active(productId, jobId, false),
    freeActive: async (productId, jobId) => active(productId, jobId, true),
    strongRecent: vi.fn(async () => opts.strong),
    lowerThreshold: async (productId) => void lowered.push(productId),
  };
  const deps: CollectHandlerDeps = {
    sourceFor: (id) => opts.sources.find((s) => s.id === id) ?? null,
    fetchFor: () => vi.fn(),
    budget,
    terms: async () => [{ id: "t1", term: "airport taxi" }],
    process: vi.fn(async ({ posts }) => ({ stored: posts.length })),
    monthlyCap: () => null,
    userAgent: "AskedFor/test",
    firstRun,
  };
  const handlers = { first_run: createCollectHandler(deps), collect: createCollectHandler(deps) };
  const enqueue = (source: string, runAfter: Date) =>
    store.enqueue([
      { kind: "first_run", productId: "p1", source, dedupeKey: `first_run:p1:${source}`, runAfter },
    ]);
  return { store, budget, handlers, enqueue, lowered, firstRun };
}

const sinceOf = (fn: unknown, call = 0) =>
  ((fn as ReturnType<typeof vi.fn>).mock.calls[call]![0] as CollectContext).since;

describe("breadth", () => {
  it("is wide with enough strong recent matches, niche otherwise", () => {
    expect(breadthOf(WIDE_MIN_STRONG)).toBe("wide");
    expect(breadthOf(WIDE_MIN_STRONG - 1)).toBe("niche");
    expect(breadthOf(0)).toBe("niche");
  });

  it("reads a week for a wide topic and a month for a niche one", () => {
    expect(firstRunWindowHours("wide")).toBe(WIDE_WINDOW_HOURS);
    expect(WIDE_WINDOW_HOURS).toBe(7 * 24);
    expect(firstRunWindowHours("niche")).toBe(NICHE_WINDOW_HOURS);
    expect(NICHE_WINDOW_HOURS).toBe(30 * 24);
  });
});

describe("the first run judges how niche the product is", () => {
  it("Reddit waits for the free sources and reserves nothing while it waits", async () => {
    const reddit = src("reddit", 0.0015, done);
    const hn = src("hackernews", 0, done);
    const { store, budget, handlers, enqueue } = setup({ strong: 12, sources: [reddit, hn] });
    // Reddit first in the claim order, so it finds Hacker News still running.
    await enqueue("reddit", new Date(T0.getTime() - 1000));
    await enqueue("hackernews", T0);
    const clock = clockFrom(T0);
    await runJobs({ store, handlers, clock: clock.now });
    const job = store.jobs.find((j) => j.source === "reddit")!;
    expect(job.status).toBe("waiting");
    expect(reddit.start).not.toHaveBeenCalled();
    expect("reserved" in job.payload).toBe(false);
    expect([...budget.ledger.keys()].some((key) => key.includes(":reddit:"))).toBe(false);
  });

  it("then reads the past week when the topic is wide", async () => {
    const reddit = src("reddit", 0.0015, done);
    const hn = src("hackernews", 0, done);
    const { store, handlers, enqueue } = setup({ strong: 12, sources: [reddit, hn] });
    await enqueue("reddit", new Date(T0.getTime() - 1000));
    await enqueue("hackernews", T0);
    const clock = clockFrom(T0);
    await runJobs({ store, handlers, clock: clock.now });
    clock.advance(30_000);
    await runJobs({ store, handlers, clock: clock.now });
    expect(reddit.start).toHaveBeenCalledTimes(1);
    expect(sinceOf(reddit.start).getTime()).toBe(clock.now().getTime() - 7 * 24 * HOUR);
  });

  it("reads the past month when the topic is niche", async () => {
    const reddit = src("reddit", 0.0015, done);
    const { store, handlers, enqueue } = setup({ strong: 3, sources: [reddit] });
    await enqueue("reddit", T0);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(sinceOf(reddit.start).getTime()).toBe(T0.getTime() - 30 * 24 * HOUR);
  });

  it("stops waiting after ten minutes and reads the month", async () => {
    const reddit = src("reddit", 0.0015, done);
    const { store, handlers, enqueue, firstRun } = setup({ strong: 0, sources: [reddit] });
    firstRun.freeActive = async () => true; // a free source that never finishes
    await enqueue("reddit", T0);
    const clock = clockFrom(T0);
    for (let i = 0; i < 40 && store.jobs[0]!.status !== "done"; i++) {
      await runJobs({ store, handlers, clock: clock.now });
      clock.advance(30_000);
    }
    expect(store.jobs[0]!.status).toBe("done");
    const started = sinceOf(reddit.start).getTime() + 30 * 24 * HOUR;
    expect(started - T0.getTime()).toBeGreaterThanOrEqual(FREE_WAIT_MS);
    expect(started - T0.getTime()).toBeLessThan(FREE_WAIT_MS + 60_000);
  });

  it("does not wait for another paid source", async () => {
    const reddit = src("reddit", 0.0015, done);
    const x = src("x", 0.005, async () => ({ kind: "pending", handle: "x-1" }));
    x.poll = vi.fn(async () => ({ kind: "pending", handle: "x-1" }) as RunState);
    const { store, handlers, enqueue } = setup({ strong: 3, sources: [reddit, x] });
    await enqueue("x", new Date(T0.getTime() - 1000));
    await enqueue("reddit", T0);
    await runJobs({ store, handlers, clock: () => T0 });
    expect(reddit.start).toHaveBeenCalledTimes(1);
  });

  it("reads the month when the breadth cannot be looked up, and does not fail", async () => {
    const reddit = src("reddit", 0.0015, done);
    const { store, handlers, enqueue, firstRun } = setup({ strong: 50, sources: [reddit] });
    firstRun.strongRecent = async () => {
      throw new Error("db blip");
    };
    await enqueue("reddit", T0);
    await runJobs({ store, handlers, clock: () => T0 });
    expect(store.jobs[0]!.status).toBe("done");
    expect(sinceOf(reddit.start).getTime()).toBe(T0.getTime() - 30 * 24 * HOUR);
  });

  it("keeps the chosen window while it polls the vendor run", async () => {
    const reddit = src(
      "reddit",
      0.0015,
      async () => ({ kind: "pending", handle: "snap-1" }),
      async () => ({ kind: "done", posts: [], units: 5 }),
    );
    const { store, handlers, enqueue } = setup({ strong: 12, sources: [reddit] });
    await enqueue("reddit", T0);
    const clock = clockFrom(T0);
    await runJobs({ store, handlers, clock: clock.now });
    clock.advance(3 * 60_000);
    await runJobs({ store, handlers, clock: clock.now });
    expect(store.jobs[0]!.status).toBe("done");
    const pollSince = sinceOf(reddit.poll).getTime();
    expect(clock.now().getTime() - pollSince).toBe(7 * 24 * HOUR);
  });

  it("the free sources read the month on their first run, whatever the breadth", async () => {
    const hn = src("hackernews", 0, done);
    const { store, handlers, enqueue } = setup({ strong: 50, sources: [hn] });
    await enqueue("hackernews", T0);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(sinceOf(hn.start).getTime()).toBe(T0.getTime() - 30 * 24 * HOUR);
  });

  it("a daily run still reads the last 48 hours", async () => {
    const reddit = src("reddit", 0.0015, done);
    const { store, handlers } = setup({ strong: 3, sources: [reddit] });
    await store.enqueue([
      { kind: "collect", productId: "p1", source: "reddit", dedupeKey: "collect:p1:reddit:d" },
    ]);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(sinceOf(reddit.start).getTime()).toBe(T0.getTime() - 48 * HOUR);
  });
});

describe("the feed minimum after the first run", () => {
  it("drops to 50 for a niche product once the last first-run source has finished", async () => {
    const reddit = src("reddit", 0.0015, done);
    const hn = src("hackernews", 0, done);
    const { store, handlers, enqueue, lowered } = setup({ strong: 3, sources: [reddit, hn] });
    await enqueue("hackernews", T0);
    await enqueue("reddit", new Date(T0.getTime() + 1000));
    const clock = clockFrom(T0);
    for (let i = 0; i < 5; i++) {
      await runJobs({ store, handlers, clock: clock.now });
      clock.advance(30_000);
    }
    expect(store.jobs.every((j) => j.status === "done")).toBe(true);
    expect(lowered).toEqual(["p1"]);
  });

  it("stays at 60 for a wide product", async () => {
    const hn = src("hackernews", 0, done);
    const { store, handlers, enqueue, lowered } = setup({ strong: 25, sources: [hn] });
    await enqueue("hackernews", T0);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(store.jobs[0]!.status).toBe("done");
    expect(lowered).toEqual([]);
  });

  it("is not judged while another first-run source is still going", async () => {
    const hn = src("hackernews", 0, done);
    const reddit = src("reddit", 0.0015, async () => ({ kind: "pending", handle: "snap-1" }));
    reddit.poll = vi.fn(async () => ({ kind: "pending", handle: "snap-1" }) as RunState);
    const { store, handlers, enqueue, lowered } = setup({ strong: 3, sources: [reddit, hn] });
    await enqueue("hackernews", T0);
    await enqueue("reddit", new Date(T0.getTime() + 1000));
    const clock = clockFrom(T0);
    await runJobs({ store, handlers, clock: clock.now });
    clock.advance(30_000);
    await runJobs({ store, handlers, clock: clock.now });
    expect(store.jobs.find((j) => j.source === "hackernews")!.status).toBe("done");
    expect(store.jobs.find((j) => j.source === "reddit")!.status).toBe("waiting");
    expect(lowered).toEqual([]);
  });

  it("a failure to judge never fails the collect job", async () => {
    const hn = src("hackernews", 0, done);
    const { store, handlers, enqueue, firstRun } = setup({ strong: 3, sources: [hn] });
    firstRun.lowerThreshold = async () => {
      throw new Error("db down");
    };
    await enqueue("hackernews", T0);
    await runJobs({ store, handlers, clock: clockFrom(T0).now });
    expect(store.jobs[0]!.status).toBe("done");
  });
});

describe("startFirstRun", () => {
  it("queues the free sources a second early, so one runner pass runs them before the paid one", async () => {
    const { startFirstRun } = await import("./first-run");
    const store = new FakeJobStore();
    await startFirstRun({
      store,
      sources: [src("reddit", 0.0015, done), src("hackernews", 0, done), src("bluesky", 0, done)],
      productId: "p1",
      now: T0,
    });
    const at = (source: string) =>
      store.jobs.find((j) => j.kind === "first_run" && j.source === source)!.runAfter.getTime();
    expect(at("hackernews")).toBe(T0.getTime() - 1000);
    expect(at("bluesky")).toBe(T0.getTime() - 1000);
    expect(at("reddit")).toBe(T0.getTime());
  });

  it("uses the same idea of paid as the collect job (a cost override)", async () => {
    const { startFirstRun } = await import("./first-run");
    const store = new FakeJobStore();
    await startFirstRun({
      store,
      sources: [src("reddit", 0.0015, done)],
      productId: "p1",
      now: T0,
      isPaid: () => false,
    });
    expect(store.jobs.find((j) => j.kind === "first_run")!.runAfter.getTime()).toBe(
      T0.getTime() - 1000,
    );
  });

  it("one runner pass after payment runs the free sources, then Reddit, with no waiting", async () => {
    // The runner started after checkout stops at the first empty claim and never sleeps: Reddit
    // must start in that same pass (code review, 27 Nov 2026).
    const { startFirstRun } = await import("./first-run");
    const reddit = src("reddit", 0.0015, done);
    const hn = src("hackernews", 0, done);
    const bluesky = src("bluesky", 0, done);
    const { store, handlers } = setup({ strong: 3, sources: [reddit, hn, bluesky] });
    await startFirstRun({ store, sources: [reddit, hn, bluesky], productId: "p1", now: T0 });
    await runJobs({ store, handlers, clock: () => T0 });
    expect(hn.start).toHaveBeenCalledTimes(1);
    expect(bluesky.start).toHaveBeenCalledTimes(1);
    expect(reddit.start).toHaveBeenCalledTimes(1);
    expect(sinceOf(reddit.start).getTime()).toBe(T0.getTime() - 30 * 24 * HOUR);
  });
});
