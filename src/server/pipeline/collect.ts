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
  terms(productId: string, source: CollectSource): Promise<CollectTerm[]>;
  /** Steps 5 to 9 of 7.3 for one batch of posts. Must be idempotent. */
  process(input: {
    job: Job;
    source: CollectSource;
    posts: CollectedPost[];
    now: Date;
  }): Promise<{ stored: number }>;
  /** The vendor's monthly record cap (BRIGHTDATA_MONTHLY_RECORD_CAP), or null when none applies. */
  monthlyCap(source: CollectSource): number | null;
}

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

const utcDay = (date: Date) => date.toISOString().slice(0, 10);
const monthStart = (date: Date) => `${date.toISOString().slice(0, 7)}-01`;

export function createCollectHandler(deps: CollectHandlerDeps): JobHandler {
  const handler: JobHandler = async (job, { now, deadline }) => {
    const source = job.source ? deps.sourceFor(job.source) : null;
    if (!source || !job.productId) return { status: "done", payload: { result: "source_off" } };
    if (now().getTime() >= deadline) return { status: "waiting", runAfter: now() };

    const firstRun = job.kind === "first_run";
    const units = source.dailyBudget * (firstRun ? 2 : 1);
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
      terms: await deps.terms(job.productId, source),
      since: new Date(now().getTime() - (firstRun ? 7 * 24 : 48) * HOUR),
      budget: units,
      now: now(),
    };
    const handle = typeof job.payload.handle === "string" ? job.payload.handle : null;
    const state = handle && source.poll ? await source.poll(ctx, handle) : await source.start(ctx);

    if (state.kind === "pending") {
      const startedAt =
        typeof job.payload.startedAt === "string" ? job.payload.startedAt : now().toISOString();
      if (now().getTime() - Date.parse(startedAt) > MAX_POLL_MS) {
        await deps.budget.settle(job.id, 0, 0);
        return { status: "done", payload: { result: "timeout" } };
      }
      return {
        status: "waiting",
        runAfter: new Date(now().getTime() + POLL_DELAY_MS),
        payload: { handle: state.handle, startedAt },
      };
    }
    if (state.kind === "failed") throw new SourceError(state.errorClass);

    const { stored } = await deps.process({ job, source, posts: state.posts, now: now() });
    const used = Math.max(0, Math.min(state.units, units));
    await deps.budget.settle(job.id, used, used * source.costPerUnitUsd);
    return { status: "done", payload: { result: "ok", stored, units: used } };
  };
  handler.onFailed = async (job) => {
    await deps.budget.settle(job.id, 0, 0);
  };
  return handler;
}
