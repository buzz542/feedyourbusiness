import type { CollectSource } from "@/sources/types";
import type { JobStatus, JobStore } from "./ports";

/**
 * The first run after checkout (docs/PLAN.md 7.3): one `first_run` job per enabled collect source
 * (twice the daily budget; the collect handler runs them, and the window follows how niche the
 * product is, src/server/pipeline/breadth.ts) and the feed-ready email,
 * which waits until every source has finished. Dedupe keys make it happen once per product.
 */
export async function startFirstRun(input: {
  store: JobStore;
  sources: readonly CollectSource[];
  productId: string;
  now: Date;
  /** Whether a source costs money (costPerUnitFor in production, the same as the collect job). */
  isPaid?: (source: CollectSource) => boolean;
}): Promise<number> {
  const { productId, now } = input;
  const isPaid = input.isPaid ?? ((source: CollectSource) => source.costPerUnitUsd > 0);
  if (input.sources.length === 0) return 0;
  return input.store.enqueue([
    ...input.sources.map((source) => ({
      kind: "first_run" as const,
      productId,
      source: source.id,
      dedupeKey: `first_run:${productId}:${source.id}`,
      // The free sources are due a second earlier, so one runner pass claims and runs them before
      // the paid source, which judges how niche the product is from their results
      // (src/server/pipeline/breadth.ts). The runner stops at the first empty claim, so nothing is
      // queued for later.
      runAfter: isPaid(source) ? now : new Date(now.getTime() - 1000),
    })),
    {
      kind: "digest_daily" as const,
      productId,
      source: null,
      dedupeKey: `feed_ready:${productId}`,
      runAfter: new Date(now.getTime() + 60_000),
      payload: { email: "feed_ready" },
    },
  ]);
}

export interface SourceProgress {
  source: string;
  status: JobStatus;
}

/** True while any source is still collecting. */
export const firstRunActive = (progress: readonly SourceProgress[]) =>
  progress.some((p) => p.status === "queued" || p.status === "running" || p.status === "waiting");
