import "server-only";
import type { SpendCap } from "@/server/llm/llm";
import type {
  CollectContext,
  CollectedPost,
  CollectSource,
  CollectTerm,
  RunState,
} from "@/sources/types";
import type { BudgetStore, Job, JobHandler } from "./ports";
import {
  breadthOf,
  FREE_RECHECK_MS,
  FREE_WAIT_MS,
  firstRunWindowHours,
  NICHE_WINDOW_HOURS,
} from "./breadth";
import { errorName } from "./runner";

/**
 * One collect job (docs/PLAN.md 7.3) as resumable steps: reserve the budget (once per job), start
 * the source or poll its pending run, process the posts (filter, hash, classify, ingest: each part
 * idempotent), and settle the budget (once). A job that crashes and runs again repeats only work
 * that is safe to repeat.
 */

/** What the first run needs to judge how niche a product is (src/server/pipeline/breadth.ts). */
export interface FirstRunDeps {
  /** Whether another first_run job for this product is still queued, running or waiting. */
  othersActive(productId: string, jobId: string): Promise<boolean>;
  /** The same, counting only free sources: a paid first run waits for these, never for another paid one. */
  freeActive(productId: string, jobId: string): Promise<boolean>;
  /** This product's stored posts scoring STRONG_SCORE or more, posted in the last RECENT_DAYS. */
  strongRecent(productId: string, now: Date): Promise<number>;
  /** Lowers the product's feed minimum to NICHE_THRESHOLD if it is still the default. */
  lowerThreshold(productId: string): Promise<void>;
}

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
    terms: readonly CollectTerm[];
    timeLeft?: () => number;
  }): Promise<{
    stored: number;
    refused?: number;
    capped?: SpendCap;
    invalid?: number;
    unavailable?: boolean;
    deferred?: boolean;
  }>;
  /**
   * The model spend cap this product has reached (Llm.capReached), or null. Checked before a new
   * run reserves budget, so no paid fetch starts whose posts could not be classified (8.1).
   */
  spendCap?(productId: string): Promise<SpendCap | null>;
  /**
   * Why posts could not be classified or stored now (a missing model key or author pepper), as an
   * error class name, or null. Checked before any budget is reserved, so no paid fetch starts whose
   * posts would be thrown away.
   */
  ready?(): string | null;
  /** The vendor's monthly record cap (BRIGHTDATA_MONTHLY_RECORD_CAP), or null when none applies. */
  monthlyCap(source: CollectSource): number | null;
  /** Units per product per day (dailyBudgetFor); the module's dailyBudget when unset. */
  budgetFor?(source: CollectSource): number;
  /** Price per unit (costPerUnitFor); the module's costPerUnitUsd when unset. */
  costFor?(source: CollectSource): number;
  userAgent: string;
  /** Unset, every first run reads the month and the feed minimum is never changed. */
  firstRun?: FirstRunDeps;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to the server's environment. */
  credential?: (name: string) => string | undefined;
}

const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const POLL_DELAY_MS = 2 * 60_000;
/**
 * How long a vendor run may take before the job gives up. A run with 12 keywords took 3 to 4 hours
 * (26 Nov 2026), and the job once gave up after one hour: the records were billed and never read.
 * Reddit now starts one run per keyword, which takes minutes, but a slow one must still be read.
 */
const MAX_POLL_MS = 2 * 60 * 60_000;
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

/** A window kept in the payload, if it is a sane number of hours. */
const storedWindow = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= NICHE_WINDOW_HOURS
    ? value
    : null;

/**
 * How far back a run reads (the founder, 24 and 27 Nov 2026): a first run reads a month, except a
 * paid source on a wide topic, which reads a week (src/server/pipeline/breadth.ts); a daily run reads
 * the last 48 hours. Retention still applies: posts are
 * deleted 7 or 30 days after we collect them (D4), whatever their age when read.
 */
export const FIRST_RUN_WINDOW_HOURS = 30 * 24;
export const DAILY_WINDOW_HOURS = 48;
export const collectWindowHours = (firstRun: boolean): number =>
  firstRun ? FIRST_RUN_WINDOW_HOURS : DAILY_WINDOW_HOURS;

export function createCollectHandler(deps: CollectHandlerDeps): JobHandler {
  const readEnv = deps.credential ?? ((name: string) => process.env[name]);

  const abandon = (job: Job) => settleAbandoned(deps.budget, job);

  const run: JobHandler = async (job, { now, deadline }) => {
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

    if (!("reserved" in job.payload)) {
      const missing = deps.ready?.() ?? null;
      if (missing) return { status: "done", payload: { result: "not_ready", errorClass: missing } };
      const cap = await deps.spendCap?.(job.productId);
      if (cap) return { status: "done", payload: { result: "spend_cap", cap } };
    }

    const firstRun = job.kind === "first_run";
    const unitCost = deps.costFor?.(source) ?? source.costPerUnitUsd;
    const paid = unitCost > 0;
    const units = (deps.budgetFor?.(source) ?? source.dailyBudget) * (firstRun ? 2 : 1);

    // A paid first run waits for the free sources, then reads a week for a wide topic or a month
    // for a niche one. Nothing is reserved while it waits. The window is kept in the payload so
    // every poll of the vendor run uses the same one.
    let windowHours = storedWindow(job.payload.windowHours) ?? collectWindowHours(firstRun);
    if (firstRun && paid && deps.firstRun && !("reserved" in job.payload)) {
      const waitingSince =
        typeof job.payload.awaitingSince === "string"
          ? Date.parse(job.payload.awaitingSince)
          : now().getTime();
      try {
        if (
          now().getTime() - waitingSince < FREE_WAIT_MS &&
          (await deps.firstRun.freeActive(job.productId, job.id))
        )
          return {
            status: "waiting",
            runAfter: new Date(now().getTime() + FREE_RECHECK_MS),
            payload: { awaitingSince: new Date(waitingSince).toISOString() },
          };
        windowHours = firstRunWindowHours(
          breadthOf(await deps.firstRun.strongRecent(job.productId, now())),
        );
      } catch {
        // The breadth could not be read: read the month (the niche default) rather than fail a
        // paid first run that has reserved nothing yet.
        windowHours = NICHE_WINDOW_HOURS;
      }
    }

    const cap = deps.monthlyCap(source);
    const reserved = await deps.budget.reserve({
      jobId: job.id,
      productId: job.productId,
      source: source.id,
      day: typeof job.payload.day === "string" ? job.payload.day : utcDay(now()),
      units,
      limit: units,
      ...(cap !== null ? { monthlyCap: cap } : {}),
    });
    if (reserved === "refused") return { status: "done", payload: { result: "budget" } };
    if (reserved === "monthly_cap") return { status: "done", payload: { result: "monthly_cap" } };

    const handle = typeof job.payload.handle === "string" ? job.payload.handle : null;
    const reservedUnits = Number(job.payload.reserved ?? units);
    // The reservation is written in the same transaction that charges the budget, so it is the
    // checkpoint: a paid job that comes back reserved but with no vendor handle may already have
    // been read and billed (a crash, a lost answer, a failure after the reads). It is never started
    // again; the whole reservation counts, in the safe direction for the caps (2.1.3, 2.1.8, 7.2).
    if (paid && reserved === "already" && !handle) {
      await deps.budget.settle(job.id, reservedUnits, reservedUnits * unitCost);
      return { status: "done", payload: { result: "interrupted" } };
    }

    const ctx: CollectContext = {
      fetch: deps.fetchFor(source),
      terms: terms ?? [],
      since: new Date(now().getTime() - windowHours * HOUR),
      budget: units,
      now: now(),
      ...(typeof job.payload.startedAt === "string"
        ? { startedAt: new Date(job.payload.startedAt) }
        : {}),
      userAgent: deps.userAgent,
      sleep: deps.sleep ?? realSleep,
      // Only the names the source declares; any other secret reads as unset.
      credential: (name) => (source.credentials.includes(name) ? readEnv(name) : undefined),
    };
    let state: RunState;
    try {
      state = handle && source.poll ? await source.poll(ctx, handle) : await source.start(ctx);
    } catch (error) {
      // A paid source that throws may have read and billed already: count the whole reservation
      // and end, rather than retry into a second bill.
      if (!paid) throw error;
      // A 4xx from the vendor (not 429) refused the request before any work: nothing was billed.
      const refused = error instanceof Error && /^Http4(?!29)\d\d$/.test(error.name);
      const billed = refused ? 0 : reservedUnits;
      await deps.budget.settle(job.id, billed, billed * unitCost);
      return { status: "done", payload: { result: "source_failed", errorClass: errorName(error) } };
    }

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
        payload: { handle: state.handle, startedAt, unitCost, windowHours },
      };
    }
    if (state.kind === "failed") {
      if (!paid) throw new SourceError(state.errorClass);
      // What a paid run read before it failed is recorded; it is not retried into a second bill.
      const read = Math.max(0, state.units ?? reservedUnits);
      await deps.budget.settle(job.id, read, read * unitCost);
      return {
        status: "done",
        payload: { result: "source_failed", errorClass: new SourceError(state.errorClass).name },
      };
    }

    // Every unit the source reports, beyond the reservation too: the monthly cap must see them.
    // Settled before classification, so a failure after the reads never hides them.
    const used = Math.max(0, state.units);
    await deps.budget.settle(job.id, used, used * unitCost);
    if (!collectable)
      return { status: "done", payload: { result: "not_collectable", units: used } };
    const out = await deps.process({
      job,
      source,
      posts: state.posts,
      now: now(),
      since: ctx.since,
      terms: ctx.terms,
      timeLeft: () => deadline - now().getTime(),
    });
    const summary = {
      stored: out.stored,
      refused: out.refused ?? 0,
      units: used,
      ...(out.capped ? { capped: out.capped } : {}),
      ...(out.invalid ? { invalid: out.invalid } : {}),
      ...(out.unavailable ? { unavailable: true } : {}),
    };
    // Out of time between batches: a free source runs again on the next run (posts it already
    // linked are skipped); a paid one is never read twice (2.1.3), so what is left waits for
    // tomorrow's overlapping window.
    if (out.deferred && !paid)
      return { status: "waiting", runAfter: now(), payload: { result: "deferred", ...summary } };
    return {
      status: "done",
      payload: { result: out.deferred ? "partial" : "ok", ...summary },
    };
  };
  // When the last first-run source has finished, a niche product's feed minimum drops to 50.
  const judge = async (productId: string, jobId: string, at: Date) => {
    const firstRunDeps = deps.firstRun;
    if (!firstRunDeps || (await firstRunDeps.othersActive(productId, jobId))) return;
    if (breadthOf(await firstRunDeps.strongRecent(productId, at)) === "niche")
      await firstRunDeps.lowerThreshold(productId);
  };

  const handler: JobHandler = async (job, context) => {
    const result = await run(job, context);
    if (job.kind === "first_run" && result.status === "done" && job.productId) {
      try {
        await judge(job.productId, job.id, context.now());
      } catch {
        // Best effort: judging the product never fails the collect job; the default stays.
      }
    }
    return result;
  };
  handler.onFailed = abandon;
  return handler;
}
