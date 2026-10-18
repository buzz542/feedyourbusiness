import "server-only";
import type { CollectContext, CollectedPost, CollectSource, CollectTerm } from "@/sources/types";
import type { BudgetStore, Job, JobHandler } from "./ports";

/**
 * One collect job (docs/PLAN.md 7.3) as resumable steps: reserve the budget (once per job), start
 * the source or poll its pending run, process the posts (filter, hash, classify, ingest: each part
 * idempotent), and settle the budget (once). A job that crashes and runs again repeats only work
 * that is safe to repeat.
 */

export interface CollectHandlerDeps {
  /** The source when it is registered and its kill switch is on; otherwise null. */
  sourceFor(id: string): CollectSource | null;
  fetchFor(source: CollectSource): CollectContext["fetch"];
  budget: BudgetStore;
  /**
   * Step 1 of 7.3: the product's active terms for this source, or null when the product is no
   * longer collectable (paused, unconfirmed, or its owner no longer entitled) since the enqueue.
   */
  terms(productId: string, source: CollectSource): Promise<CollectTerm[] | null>;
  /** Steps 5 to 9 of 7.3 for one batch of posts (createCollectStep). Must be idempotent. */
  process(input: {
    job: Job;
    source: CollectSource;
    posts: CollectedPost[];
    now: Date;
    since: Date;
  }): Promise<{ stored: number }>;
  /** The vendor's monthly record cap (BRIGHTDATA_MONTHLY_RECORD_CAP), or null when none applies. */
  monthlyCap(source: CollectSource): number | null;
  /** Units per product per day (dailyBudgetFor); the module's dailyBudget when unset. */
  budgetFor?(source: CollectSource): number;
  /** Price per unit (costPerUnitFor); the module's costPerUnitUsd when unset. */
  costFor?(source: CollectSource): number;
  userAgent: string;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to the server's environment. */
  credential?: (name: string) => string | undefined;
}

const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const POLL_DELAY_MS = 2 * 60_000;
const MAX_POLL_MS = 60 * 60_000;
const HOUR = 60 * 60_000;

/** The error a source reported, by class name only. */
export class SourceError extends Error {
  constructor(errorClass: string) {
    super("The source failed");
    this.name = errorClass.replace(/[^A-Za-z0-9_]/g, "").slice(0, 60) || "SourceError";
  }
}

/**
 * A job that ends without finishing its run. Before a vendor run is triggered nothing was used, so
 * the reservation goes back; once it is (a handle is stored), the vendor may bill for it, so the
 * whole reservation counts, at the cost recorded with the handle.
 */
export async function settleAbandoned(budget: BudgetStore, job: Job): Promise<void> {
  if (typeof job.payload.handle !== "string") {
    await budget.settle(job.id, 0, 0);
    return;
  }
  const reserved = Number(job.payload.reserved ?? 0);
  const unitCost = Number(job.payload.unitCost ?? 0);
  await budget.settle(job.id, reserved, reserved * unitCost);
}

const utcDay = (date: Date) => date.toISOString().slice(0, 10);
const monthStart = (date: Date) => `${date.toISOString().slice(0, 7)}-01`;

export function createCollectHandler(deps: CollectHandlerDeps): JobHandler {
  const readEnv = deps.credential ?? ((name: string) => process.env[name]);

  const abandon = (job: Job) => settleAbandoned(deps.budget, job);

  const handler: JobHandler = async (job, { now, deadline }) => {
    const source = job.source ? deps.sourceFor(job.source) : null;
    if (!source || !job.productId) {
      if ("reserved" in job.payload) await abandon(job);
      return { status: "done", payload: { result: "source_off" } };
    }
    if (now().getTime() >= deadline) return { status: "waiting", runAfter: now() };
    const terms = await deps.terms(job.productId, source);
    // Checked before the budget is reserved. A run that already reserved (a vendor run in flight)
    // finishes so its cost is settled, but stores nothing for a product that is no longer collected.
    const collectable = terms !== null;
    if (!collectable && !("reserved" in job.payload))
      return { status: "done", payload: { result: "not_collectable" } };

    const firstRun = job.kind === "first_run";
    const unitCost = deps.costFor?.(source) ?? source.costPerUnitUsd;
    const units = (deps.budgetFor?.(source) ?? source.dailyBudget) * (firstRun ? 2 : 1);
    const cap = deps.monthlyCap(source);
    const reserved = await deps.budget.reserve({
      jobId: job.id,
      productId: job.productId,
      source: source.id,
      day: typeof job.payload.day === "string" ? job.payload.day : utcDay(now()),
      units,
      limit: units,
      ...(cap !== null ? { monthlyCap: cap, monthStart: monthStart(now()) } : {}),
    });
    if (reserved === "refused") return { status: "done", payload: { result: "budget" } };
    if (reserved === "monthly_cap") return { status: "done", payload: { result: "monthly_cap" } };

    const ctx: CollectContext = {
      fetch: deps.fetchFor(source),
      terms: terms ?? [],
      since: new Date(now().getTime() - (firstRun ? 7 * 24 : 48) * HOUR),
      budget: units,
      now: now(),
      userAgent: deps.userAgent,
      sleep: deps.sleep ?? realSleep,
      // Only the names the source declares; any other secret reads as unset.
      credential: (name) => (source.credentials.includes(name) ? readEnv(name) : undefined),
    };
    const handle = typeof job.payload.handle === "string" ? job.payload.handle : null;
    const state = handle && source.poll ? await source.poll(ctx, handle) : await source.start(ctx);

    if (state.kind === "pending") {
      const startedAt =
        typeof job.payload.startedAt === "string" ? job.payload.startedAt : now().toISOString();
      if (now().getTime() - Date.parse(startedAt) > MAX_POLL_MS) {
        await abandon(job);
        return { status: "done", payload: { result: "timeout" } };
      }
      return {
        status: "waiting",
        runAfter: new Date(now().getTime() + POLL_DELAY_MS),
        payload: { handle: state.handle, startedAt, unitCost },
      };
    }
    if (state.kind === "failed") throw new SourceError(state.errorClass);

    // Every unit the source reports, beyond the reservation too: the monthly cap must see them.
    const used = Math.max(0, state.units);
    if (!collectable) {
      await deps.budget.settle(job.id, used, used * unitCost);
      return { status: "done", payload: { result: "not_collectable", units: used } };
    }
    const { stored } = await deps.process({
      job,
      source,
      posts: state.posts,
      now: now(),
      since: ctx.since,
    });
    await deps.budget.settle(job.id, used, used * unitCost);
    return { status: "done", payload: { result: "ok", stored, units: used } };
  };
  handler.onFailed = abandon;
  return handler;
}
