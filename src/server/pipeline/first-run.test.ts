import { describe, expect, it } from "vitest";
import { FakeJobStore } from "./fakes";
import {
  createFirstRunHandler,
  createFirstRunNotify,
  startFirstRun,
  summarizeFirstRun,
} from "./first-run";
import type { JobHandler } from "./ports";
import { runJobs } from "./runner";

const PRODUCT = "prod-1";
const T0 = new Date("2026-10-25T09:00:00Z");
const sources = [{ id: "hackernews" }, { id: "bluesky" }];

function setup() {
  const store = new FakeJobStore();
  let now = T0;
  const clock = () => now;
  const sent: { to: string; subject: string; text: string; html: string }[] = [];
  const claimed = new Set<string>();
  const stored: Record<string, number> = {};
  // Hacker News finishes at once; Bluesky only on the second attempt.
  const attempts: Record<string, number> = {};
  const collect: JobHandler = async (job) => {
    attempts[job.source!] = (attempts[job.source!] ?? 0) + 1;
    if (job.source === "bluesky" && attempts.bluesky === 1)
      return { status: "waiting", runAfter: new Date(clock().getTime() + 60_000) };
    stored.looking_for_tool = (stored.looking_for_tool ?? 0) + 2;
    return { status: "done", payload: { result: "ok" } };
  };
  const notify = createFirstRunNotify({
    pending: async (p) =>
      store.jobs.filter(
        (j) =>
          j.productId === p &&
          j.kind === "first_run" &&
          j.source &&
          !["done", "failed"].includes(j.status),
      ).length,
    counts: async () => ({ ...stored }),
    recipient: async () => "maker@example.test",
    claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
    mailer: () => ({ send: async (m) => void sent.push(m) }),
    siteUrl: "https://askedfor.example.test",
  });
  const handlers = { first_run: createFirstRunHandler(collect, notify) };
  const run = (minutes: number) => {
    now = new Date(T0.getTime() + minutes * 60_000);
    return runJobs({ store, handlers, clock, budgetMs: 1_000 });
  };
  return { store, sent, run, attempts, claimed };
}

describe("first run after checkout", () => {
  it("is enqueued once, however often it is started", async () => {
    const { store } = setup();
    expect(await startFirstRun({ store, productId: PRODUCT, sources, now: T0 })).toBe(3);
    expect(await startFirstRun({ store, productId: PRODUCT, sources, now: T0 })).toBe(0);
    expect(store.jobs.map((j) => j.source)).toEqual(["hackernews", "bluesky", null]);
  });

  it("results appear as sources finish, then the feed-ready email is sent once", async () => {
    const { store, sent, run } = setup();
    await startFirstRun({ store, productId: PRODUCT, sources, now: T0 });

    await run(0);
    const progress = summarizeFirstRun(store.jobs);
    expect(progress?.sources).toEqual([
      { source: "hackernews", status: "done" },
      { source: "bluesky", status: "running" },
    ]);
    expect(progress?.finished).toBe(false);
    expect(sent).toHaveLength(0);

    await run(2);
    // Notify ran before Bluesky finished in this pass, or after: either way not yet twice.
    await run(5);
    await run(10);
    expect(summarizeFirstRun(store.jobs)?.finished).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Your AskedFor feed is ready");
    expect(sent[0]!.text).toContain("Looking for a tool: 4");
    expect(sent[0]!.text).toContain("https://askedfor.example.test/app/reply");

    await run(30);
    expect(sent).toHaveLength(1);
  });

  it("a notify job that runs again after sending never sends twice", async () => {
    const { sent, claimed } = setup();
    const notify = createFirstRunNotify({
      pending: async () => 0,
      counts: async () => ({}),
      recipient: async () => "maker@example.test",
      claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
      mailer: () => ({ send: async (m) => void sent.push(m) }),
      siteUrl: "https://askedfor.example.test",
    });
    const job = {
      id: "n1",
      kind: "first_run" as const,
      productId: PRODUCT,
      source: null,
      status: "running" as const,
      payload: { startedAt: T0.toISOString() },
      attempts: 1,
      runAfter: T0,
    };
    const ctx = { now: () => T0, deadline: T0.getTime() + 1000 };
    await notify(job, ctx);
    await notify(job, ctx);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Nothing matched yet");
  });

  it("the email carries no excerpts, only our labels and counts", async () => {
    const { store, sent, run } = setup();
    await startFirstRun({ store, productId: PRODUCT, sources, now: T0 });
    for (const m of [0, 2, 5, 10]) await run(m);
    expect(sent[0]!.html).not.toMatch(/excerpt|reddit\.com|news\.ycombinator/i);
  });

  it("sends anyway after three hours if a source is still pending", async () => {
    const sent: unknown[] = [];
    const notify = createFirstRunNotify({
      pending: async () => 1,
      counts: async () => ({}),
      recipient: async () => "maker@example.test",
      claim: async () => true,
      mailer: () => ({ send: async (m) => void sent.push(m) }),
      siteUrl: "https://askedfor.example.test",
    });
    const job = {
      id: "n1",
      kind: "first_run" as const,
      productId: PRODUCT,
      source: null,
      status: "running" as const,
      payload: { startedAt: T0.toISOString() },
      attempts: 1,
      runAfter: T0,
    };
    const at = (h: number) => ({
      now: () => new Date(T0.getTime() + h * 3_600_000),
      deadline: Infinity,
    });
    expect((await notify(job, at(1))).status).toBe("waiting");
    expect((await notify(job, at(3.1))).status).toBe("done");
    expect(sent).toHaveLength(1);
  });

  it("without a model key, source jobs end at once and nothing is collected", async () => {
    const handler = createFirstRunHandler(null, async () => ({ status: "done" as const }));
    const result = await handler(
      {
        id: "j",
        kind: "first_run",
        productId: PRODUCT,
        source: "hackernews",
        status: "running",
        payload: {},
        attempts: 1,
        runAfter: T0,
      },
      { now: () => T0, deadline: Infinity },
    );
    expect(result).toEqual({ status: "done", payload: { result: "model_off" } });
  });
});
