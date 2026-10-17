import type { Job, JobHandler, JobStore } from "./ports";

/**
 * The jobs runner (docs/PLAN.md 7.2): claims up to 10 due jobs at a time, runs each through its
 * handler inside a time budget (240 of the 300 seconds a function may run), and finishes or
 * reschedules it. No new claims once the budget is spent. A job whose handler throws is retried
 * with a growing delay, and marked failed with its error class after the third failure.
 */

export const RUN_BUDGET_MS = 240_000;
export const MAX_FAILURES = 3;
const CLAIM_LIMIT = 10;
/** Longer than any single step, so a running job is never claimed twice. */
const LEASE_SECONDS = 300;
const RETRY_DELAY_MS = 5 * 60_000;

export interface RunSummary {
  claimed: number;
  done: number;
  waiting: number;
  retried: number;
  failed: number;
}

export const errorName = (error: unknown): string =>
  (error instanceof Error && error.name) || "UnknownError";

export async function runJobs(input: {
  store: JobStore;
  handlers: Readonly<Partial<Record<Job["kind"], JobHandler>>>;
  clock: () => Date;
  budgetMs?: number;
  limit?: number;
}): Promise<RunSummary> {
  const { store, handlers, clock } = input;
  const deadline = clock().getTime() + (input.budgetMs ?? RUN_BUDGET_MS);
  const summary: RunSummary = { claimed: 0, done: 0, waiting: 0, retried: 0, failed: 0 };

  while (clock().getTime() < deadline) {
    const jobs = await store.claim(clock(), input.limit ?? CLAIM_LIMIT, LEASE_SECONDS);
    if (jobs.length === 0) break;
    summary.claimed += jobs.length;

    for (const job of jobs) {
      const handler = handlers[job.kind];
      try {
        if (!handler)
          throw Object.assign(new Error(`No handler for ${job.kind}`), { name: "NoHandler" });
        const result = await handler(job, { now: clock, deadline });
        if (result.status === "done") {
          await store.finish(job.id, { status: "done", payload: result.payload });
          summary.done++;
        } else {
          await store.finish(job.id, {
            status: "waiting",
            runAfter: result.runAfter,
            payload: result.payload,
          });
          summary.waiting++;
        }
      } catch (error) {
        const errorClass = errorName(error);
        console.error(`[jobs] ${job.kind} failed: ${errorClass}`);
        const failures = Number(job.payload.failures ?? 0) + 1;
        if (failures >= MAX_FAILURES) {
          await handler
            ?.onFailed?.(job)
            .catch((cleanup: unknown) =>
              console.error(`[jobs] ${job.kind} cleanup failed: ${errorName(cleanup)}`),
            );
          await store.finish(job.id, { status: "failed", errorClass, payload: { failures } });
          summary.failed++;
        } else {
          await store.finish(job.id, {
            status: "queued",
            errorClass,
            payload: { failures },
            runAfter: new Date(clock().getTime() + failures * RETRY_DELAY_MS),
          });
          summary.retried++;
        }
      }
    }
  }
  return summary;
}
