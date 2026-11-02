import type { CollectSource } from "@/sources/types";
import type { JobStatus, JobStore } from "./ports";

/**
 * The first run after checkout (docs/PLAN.md 7.3): one `first_run` job per enabled collect source
 * (7-day window, twice the daily budget; the collect handler runs them) and the feed-ready email,
 * which waits until every source has finished. Dedupe keys make it happen once per product.
 */
export async function startFirstRun(input: {
  store: JobStore;
  sources: readonly CollectSource[];
  productId: string;
  now: Date;
}): Promise<number> {
  const { productId, now } = input;
  if (input.sources.length === 0) return 0;
  return input.store.enqueue([
    ...input.sources.map((source) => ({
      kind: "first_run" as const,
      productId,
      source: source.id,
      dedupeKey: `first_run:${productId}:${source.id}`,
      runAfter: now,
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
