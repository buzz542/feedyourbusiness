import "server-only";
import type { CollectContext, CollectSource, Recheck } from "@/sources/types";
import { SourceError, settleAbandoned } from "./collect";
import type { BudgetStore, Job, JobHandler, StepResult } from "./ports";

/**
 * Deletion sync (docs/PLAN.md 2.3.6, 7.2), two ways:
 * - Sources that can check at once (Hacker News, Bluesky): once a day, every stored post the source
 *   reports deleted (or hidden) is deleted here, with its product links. Posts are checked in
 *   batches ordered by id; a run that reaches its time budget saves its cursor and the next run
 *   resumes there, so no post is skipped however many are stored.
 * - The vendor's re-check (Reddit): once a day per product, the posts it linked first that were
 *   collected 72 to 96 hours earlier are re-collected through the vendor, and every one not reported
 *   live is deleted here. Outside the product's daily budget, inside the whole monthly cap (new
 *   collection gets 90 percent of it).
 */

export interface DeletionStore {
  /** Stored posts from this source not yet past delete_after, after `afterId` (by id). */
  stored(
    source: string,
    afterId: string | null,
    limit: number,
    now: Date,
  ): Promise<{ id: string; externalId: string }[]>;
  /** Deletes these posts and their product links; returns how many were deleted. */
  remove(source: string, externalIds: readonly string[]): Promise<number>;
  /** The Reddit posts collected in [from, to) that this product linked first (reddit_recheck_posts). */
  recheckDue(
    productId: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<{ externalId: string; url: string }[]>;
}

export interface DeletionSyncDeps {
  /** The source when it is registered and its kill switch is on; otherwise null. */
  sourceFor(id: string): CollectSource | null;
  fetchFor(source: CollectSource): CollectContext["fetch"];
  store: DeletionStore;
  budget: BudgetStore;
  /** The monthly cap a re-check may use: the whole vendor cap (monthlyCapFor(..., "recheck")). */
  recheckCap(source: CollectSource): number | null;
  userAgent: string;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to the server's environment; a source reads only the names it declares. */
  credential?: (name: string) => string | undefined;
  batchSize?: number;
}

/** Bluesky looks up 25 posts a request; Hacker News one, so a batch is a few seconds of requests. */
const BATCH_SIZE = 100;
/** Posts per re-check run; the ids sent are kept in the job's payload (8 KB). */
const RECHECK_LIMIT = 200;
/** Re-checks are outside the per-product daily budget: only the monthly cap limits them. */
const NO_DAILY_LIMIT = 2_000_000_000;
const POLL_DELAY_MS = 2 * 60_000;
const MAX_POLL_MS = 60 * 60_000;
const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const monthStart = (date: Date) => `${date.toISOString().slice(0, 7)}-01`;

export function createDeletionSyncHandler(deps: DeletionSyncDeps): JobHandler {
  const readEnv = deps.credential ?? ((name: string) => process.env[name]);
  const batchSize = deps.batchSize ?? BATCH_SIZE;

  /** One step of a product's re-check: reserve and trigger, then poll, then delete the gone. */
  async function recheckStep(
    job: Job,
    source: CollectSource,
    recheck: Recheck,
    ctx: CollectContext,
    now: () => Date,
  ): Promise<StepResult> {
    if (!recheck.enabled(ctx)) return { status: "done", payload: { result: "off" } };
    const productId = job.productId!;
    const handle = typeof job.payload.handle === "string" ? job.payload.handle : null;

    if (!handle) {
      const from = new Date(String(job.payload.from));
      const to = new Date(String(job.payload.to));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
        throw new SourceError("InvalidRecheckWindow");
      const due = await deps.store.recheckDue(productId, from, to, RECHECK_LIMIT);
      if (due.length === 0) return { status: "done", payload: { result: "nothing_due" } };
      const cap = deps.recheckCap(source);
      const reserved = await deps.budget.reserve({
        jobId: job.id,
        productId,
        source: source.id,
        day:
          typeof job.payload.day === "string" ? job.payload.day : now().toISOString().slice(0, 10),
        units: due.length,
        limit: NO_DAILY_LIMIT,
        ...(cap !== null ? { monthlyCap: cap, monthStart: monthStart(now()) } : {}),
      });
      if (reserved === "monthly_cap") return { status: "done", payload: { result: "monthly_cap" } };
      if (reserved === "refused") return { status: "done", payload: { result: "budget" } };
      const started = await recheck.start(
        ctx,
        due.map((p) => p.url),
      );
      if (started.kind === "failed") throw new SourceError(started.errorClass);
      return {
        status: "waiting",
        runAfter: new Date(now().getTime() + POLL_DELAY_MS),
        payload: {
          handle: started.handle,
          startedAt: now().toISOString(),
          unitCost: source.costPerUnitUsd,
          // Only these are judged when the result comes, whatever becomes due meanwhile.
          sent: due.map((p) => p.externalId),
        },
      };
    }

    const result = await recheck.poll(ctx, handle);
    if (result.kind === "failed") throw new SourceError(result.errorClass);
    if (result.kind === "pending") {
      const startedAt = Date.parse(String(job.payload.startedAt));
      if (!(now().getTime() - startedAt <= MAX_POLL_MS)) {
        await settleAbandoned(deps.budget, job);
        return { status: "done", payload: { result: "timeout" } };
      }
      return { status: "waiting", runAfter: new Date(now().getTime() + POLL_DELAY_MS) };
    }
    const sent = Array.isArray(job.payload.sent) ? job.payload.sent.map(String) : [];
    const live = new Set(result.live);
    const gone = sent.filter((id) => !live.has(id));
    const removed = gone.length > 0 ? await deps.store.remove(source.id, gone) : 0;
    const used = Math.max(0, result.units);
    await deps.budget.settle(job.id, used, used * Number(job.payload.unitCost ?? 0));
    return { status: "done", payload: { result: "ok", checked: sent.length, removed } };
  }

  return async (job, { now, deadline }) => {
    const today = now().toISOString().slice(0, 10);
    // Today's existence check covers every post again, so one left over from an earlier day stops.
    // A re-check covers its own window, so it always runs to the end.
    if (!job.productId && typeof job.payload.day === "string" && job.payload.day < today)
      return { status: "done", payload: { result: "superseded" } };
    const source = job.source ? deps.sourceFor(job.source) : null;
    if (!source || (!source.checkDeleted && !(source.recheck && job.productId))) {
      if ("reserved" in job.payload) await settleAbandoned(deps.budget, job);
      return { status: "done", payload: { result: "source_off" } };
    }

    const ctx: CollectContext = {
      fetch: deps.fetchFor(source),
      terms: [],
      since: now(),
      budget: 0,
      now: now(),
      userAgent: deps.userAgent,
      sleep: deps.sleep ?? realSleep,
      credential: (name) => (source.credentials.includes(name) ? readEnv(name) : undefined),
    };

    if (source.recheck && job.productId) return recheckStep(job, source, source.recheck, ctx, now);

    let cursor = typeof job.payload.cursor === "string" ? job.payload.cursor : null;
    let checked = Number(job.payload.checked ?? 0);
    let removed = Number(job.payload.removed ?? 0);
    while (now().getTime() < deadline) {
      const batch = await deps.store.stored(source.id, cursor, batchSize, now());
      if (batch.length > 0 && source.checkDeleted) {
        const asked = new Set(batch.map((p) => p.externalId));
        const gone = (await source.checkDeleted(ctx, [...asked])).filter((id) => asked.has(id));
        if (gone.length > 0) removed += await deps.store.remove(source.id, gone);
        checked += batch.length;
        cursor = batch[batch.length - 1]!.id;
      }
      if (batch.length < batchSize)
        return { status: "done", payload: { result: "ok", checked, removed } };
    }
    return { status: "waiting", runAfter: now(), payload: { cursor, checked, removed } };
  };
}
