import { renderFeedReady } from "../../../emails/feed-ready";
import type { Mailer } from "@/server/billing/trial-reminders";
import { CATEGORY_LABELS } from "@/lib/reply-tips";
import { FEED_CATEGORIES } from "@/lib/reply-filters";
import type { CollectSource } from "@/sources/types";
import type { JobHandler, JobStore, NewJob } from "./ports";

/**
 * The first run after checkout (docs/PLAN.md 7.3): one `first_run` job per enabled collect source
 * (a 7-day window and twice the daily budget, in the collect handler), plus one notify job that
 * waits for them and then sends the "feed ready" email once. Dedupe keys make starting it again a
 * no-op, so a reload of the welcome page never collects twice.
 */

const WAIT_MS = 2 * 60_000;
/** After this the email goes anyway, with whatever arrived (a vendor run may finish tomorrow). */
const GIVE_UP_MS = 3 * 60 * 60_000;

export function firstRunJobs(
  productId: string,
  sources: readonly Pick<CollectSource, "id">[],
  now: Date,
): NewJob[] {
  return [
    ...sources.map((s): NewJob => ({
      kind: "first_run",
      productId,
      source: s.id,
      dedupeKey: `first_run:${productId}:${s.id}`,
      runAfter: now,
    })),
    {
      kind: "first_run",
      productId,
      source: null,
      dedupeKey: `first_run:${productId}:notify`,
      runAfter: new Date(now.getTime() + WAIT_MS),
      payload: { startedAt: now.toISOString() },
    },
  ];
}

export async function startFirstRun(input: {
  store: JobStore;
  productId: string;
  sources: readonly Pick<CollectSource, "id">[];
  now: Date;
}): Promise<number> {
  return input.store.enqueue(firstRunJobs(input.productId, input.sources, input.now));
}

export type SourceProgress = "queued" | "running" | "done" | "failed";

/** Per-source progress for the Reply tab's first-run banner. */
export interface FirstRunStatus {
  sources: { source: string; status: SourceProgress }[];
  finished: boolean;
}

export function summarizeFirstRun(
  rows: readonly { source: string | null; status: string }[],
): FirstRunStatus | null {
  const sources = rows
    .filter((r): r is { source: string; status: string } => r.source !== null)
    .map((r) => ({
      source: r.source,
      status: (r.status === "done" || r.status === "failed"
        ? r.status
        : r.status === "queued"
          ? "queued"
          : "running") as SourceProgress,
    }));
  if (sources.length === 0) return null;
  return { sources, finished: sources.every((s) => s.status === "done" || s.status === "failed") };
}

export interface NotifyDeps {
  /** Unfinished first_run collect jobs for the product. */
  pending(productId: string): Promise<number>;
  /** Stored cards per category for the product. */
  counts(productId: string): Promise<Record<string, number>>;
  /** The owner's email, or null (account gone). */
  recipient(productId: string): Promise<string | null>;
  /** Marks this job's email as claimed; false if already claimed (never sent twice). */
  claim(jobId: string): Promise<boolean>;
  mailer: () => Mailer | null;
  siteUrl: string;
}

export function createFirstRunNotify(deps: NotifyDeps): JobHandler {
  return async (job, { now }) => {
    if (!job.productId) return { status: "done", payload: { result: "no_product" } };
    const started = Date.parse(String(job.payload.startedAt ?? ""));
    const waited = Number.isNaN(started) ? GIVE_UP_MS : now().getTime() - started;
    if ((await deps.pending(job.productId)) > 0 && waited < GIVE_UP_MS)
      return { status: "waiting", runAfter: new Date(now().getTime() + WAIT_MS) };
    const mailer = deps.mailer();
    if (!mailer) return { status: "done", payload: { result: "email_off" } };
    const to = await deps.recipient(job.productId);
    if (!to) return { status: "done", payload: { result: "no_recipient" } };
    const counts = await deps.counts(job.productId);
    const email = renderFeedReady({
      counts: FEED_CATEGORIES.map((c) => ({ label: CATEGORY_LABELS[c], count: counts[c] ?? 0 })),
      appUrl: `${deps.siteUrl.replace(/\/$/, "")}/app/reply`,
    });
    if (!(await deps.claim(job.id))) return { status: "done", payload: { result: "already_sent" } };
    await mailer.send({ to, ...email, idempotencyKey: `job-${job.id}` });
    return { status: "done", payload: { result: "sent" } };
  };
}

/** first_run jobs with a source collect; the one without a source is the notify job. */
export function createFirstRunHandler(collect: JobHandler | null, notify: JobHandler): JobHandler {
  const handler: JobHandler = (job, ctx) =>
    job.source
      ? collect
        ? collect(job, ctx)
        : Promise.resolve({ status: "done", payload: { result: "model_off" } })
      : notify(job, ctx);
  handler.onFailed = (job) =>
    job.source && collect?.onFailed ? collect.onFailed(job) : Promise.resolve();
  return handler;
}
