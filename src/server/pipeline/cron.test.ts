import { describe, expect, it, vi } from "vitest";
import {
  createPurgeHandler,
  runDailyCron,
  runTickCron,
  runWeeklyCron,
  type CronDeps,
} from "./cron";
import { FakeJobStore } from "./fakes";

/** The job cron routes' logic (docs/PLAN.md 7.2, 13), with fakes. */

const NOW = new Date("2026-10-17T06:00:00Z");

function deps(over: Partial<CronDeps> = {}): CronDeps & { store: FakeJobStore } {
  const store = new FakeJobStore();
  return {
    store,
    handlers: { purge: createPurgeHandler(async () => ({ posts_expired: 2 })) },
    products: async () => ["p1"],
    sources: [],
    clock: () => NOW,
    ...over,
  } as CronDeps & { store: FakeJobStore };
}

describe("runDailyCron", () => {
  it("enqueues the day's jobs once and runs them", async () => {
    const d = deps();
    expect(await runDailyCron(d)).toEqual({
      status: 200,
      body: { enqueued: 1, claimed: 1, done: 1, waiting: 0, retried: 0, failed: 0 },
    });
    expect(d.store.jobs[0]).toMatchObject({
      kind: "purge",
      status: "done",
      payload: { result: { posts_expired: 2 } },
    });
    // Idempotent: a second run the same day enqueues nothing.
    expect((await runDailyCron(d)).body.enqueued).toBe(0);
  });

  it("answers 500 when a job failed for good", async () => {
    const d = deps({
      handlers: {
        purge: async () => {
          throw new TypeError("boom");
        },
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    d.store.jobs.push({
      id: "x",
      kind: "purge",
      productId: null,
      source: null,
      status: "queued",
      payload: { failures: 2 },
      attempts: 2,
      runAfter: new Date(0),
      lockedUntil: null,
      dedupeKey: "purge:old",
    });
    expect((await runDailyCron(d)).status).toBe(500);
  });
});

describe("runTickCron", () => {
  it("purges once an hour (every tick on Pro) and runs the due jobs", async () => {
    let now = NOW;
    const d = deps({ clock: () => now });
    expect((await runTickCron(d)).body).toMatchObject({ enqueued: 1, claimed: 1, done: 1 });
    expect(d.store.jobs.map((j) => j.dedupeKey)).toEqual(["purge:2026-10-17T06"]);
    now = new Date("2026-10-17T06:10:00Z");
    expect((await runTickCron(d)).body).toMatchObject({ enqueued: 0, claimed: 0 });
    now = new Date("2026-10-17T07:00:00Z");
    expect((await runTickCron(d)).body).toMatchObject({ enqueued: 1 });
  });

  it("enqueues no purge without a purge handler", async () => {
    const d = deps({ handlers: {} });
    expect((await runTickCron(d)).body).toMatchObject({ enqueued: 0, claimed: 0 });
    expect(d.store.jobs).toHaveLength(0);
  });
});

describe("runWeeklyCron", () => {
  it("enqueues nothing until the synthesis handler exists", async () => {
    expect(await runWeeklyCron(deps())).toEqual({ status: 200, body: { enqueued: 0 } });
  });

  it("enqueues one synthesis per product per week when it does", async () => {
    const d = deps({ handlers: { synthesize: async () => ({ status: "done" }) } });
    expect((await runWeeklyCron(d)).body.enqueued).toBe(1);
    expect((await runWeeklyCron(d)).body.enqueued).toBe(0);
  });
});
