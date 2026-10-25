import type { CollectSource } from "@/sources/types";
import { enqueueDigests } from "./digest";
import { enqueueDaily } from "./enqueue";
import type { JobHandler, JobKind, JobStore } from "./ports";
import { runJobs, type RunSummary } from "./runner";

/**
 * What the three job cron routes do (docs/PLAN.md 7.2, 13). The routes stay thin: check
 * CRON_SECRET, build these deps, call one of these, return its status and body.
 */

export interface CronDeps {
  store: JobStore;
  handlers: Readonly<Partial<Record<JobKind, JobHandler>>>;
  products: () => Promise<string[]>;
  /** Products with vendor posts due for their deletion re-check (reddit_recheck_products). */
  recheckProducts?: (from: Date, to: Date) => Promise<string[]>;
  sources: readonly CollectSource[];
  clock: () => Date;
}

export interface CronResult {
  status: number;
  body: Record<string, unknown>;
}

const kindsOf = (deps: CronDeps) => new Set(Object.keys(deps.handlers) as JobKind[]);

/** Non-2xx when a job failed for good this run, so cron monitoring shows it. */
const statusFor = (summary: RunSummary) => (summary.failed > 0 ? 500 : 200);

/** 06:00 UTC: enqueue the day's jobs, then (on Hobby, where nothing else ticks) run them. */
export async function runDailyCron(deps: CronDeps): Promise<CronResult> {
  const enqueued = await enqueueDaily({
    store: deps.store,
    products: deps.products,
    ...(deps.recheckProducts ? { recheckProducts: deps.recheckProducts } : {}),
    sources: deps.sources,
    kinds: kindsOf(deps),
    now: deps.clock(),
  });
  const summary = await runJobs({ store: deps.store, handlers: deps.handlers, clock: deps.clock });
  return { status: statusFor(summary), body: { enqueued, ...summary } };
}

/**
 * Every 10 minutes on Pro: purge once an hour ("every tick" in 7.2, deduped by the hour so the
 * jobs table stays small), then advance due jobs (pending vendor runs, retries). On Hobby this route
 * is not scheduled, and the daily cron purges.
 */
export async function runTickCron(deps: CronDeps): Promise<CronResult> {
  const now = deps.clock();
  const enqueued = kindsOf(deps).has("purge")
    ? await deps.store.enqueue([
        {
          kind: "purge",
          productId: null,
          source: null,
          dedupeKey: `purge:${now.toISOString().slice(0, 13)}`,
          runAfter: now,
        },
      ])
    : 0;
  const summary = await runJobs({ store: deps.store, handlers: deps.handlers, clock: deps.clock });
  return { status: statusFor(summary), body: { enqueued, ...summary } };
}

/**
 * Sunday 21:00 UTC: enqueue the weekly synthesis per product. Its handler arrives with the Build
 * and Rivals tabs (M6, M7); until then there is nothing to enqueue.
 */
export async function runWeeklyCron(deps: CronDeps): Promise<CronResult> {
  if (!kindsOf(deps).has("synthesize")) return { status: 200, body: { enqueued: 0 } };
  const week = deps.clock().toISOString().slice(0, 10);
  const enqueued = await deps.store.enqueue(
    (await deps.products()).map((product) => ({
      kind: "synthesize" as const,
      productId: product,
      source: null,
      dedupeKey: `synthesize:${product}:${week}`,
    })),
  );
  return { status: 200, body: { enqueued } };
}

/** The purge job: purge_expired(now), with its counts in the job's result. */
export function createPurgeHandler(
  purge: (now: Date) => Promise<Record<string, number>>,
): JobHandler {
  return async (_job, { now }) => ({ status: "done", payload: { result: await purge(now()) } });
}

/**
 * 07:00 and 08:00 UTC: the daily posts email and, on Mondays, the weekly digest, at 08:00 UK time.
 * Only the run that falls in London's 08:00 hour enqueues (digest.ts), then due jobs run.
 */
export async function runDigestCron(deps: CronDeps): Promise<CronResult> {
  const enqueued = await enqueueDigests({
    store: deps.store,
    products: deps.products,
    now: deps.clock(),
  });
  const summary = await runJobs({ store: deps.store, handlers: deps.handlers, clock: deps.clock });
  return { status: statusFor(summary), body: { enqueued, ...summary } };
}
