import type { CollectSource } from "@/sources/types";
import type { JobKind, JobStore, NewJob } from "./ports";

/**
 * The daily cron's enqueue (docs/PLAN.md 7.2, 13): a collect job per collectable product and
 * enabled source, a deletion sync per source that supports it, and the purge. Dedupe keys carry the
 * UTC day, so running it twice in a day adds nothing. Only kinds that have a handler are enqueued.
 */
export async function enqueueDaily(input: {
  store: JobStore;
  /** Confirmed, active products of entitled owners. */
  products: () => Promise<string[]>;
  /** Enabled collect sources. */
  sources: readonly CollectSource[];
  kinds: ReadonlySet<JobKind>;
  now: Date;
}): Promise<number> {
  const day = input.now.toISOString().slice(0, 10);
  const jobs: NewJob[] = [];
  if (input.kinds.has("collect") && input.sources.length > 0)
    for (const product of await input.products())
      for (const source of input.sources)
        jobs.push({
          kind: "collect",
          productId: product,
          source: source.id,
          dedupeKey: `collect:${product}:${source.id}:${day}`,
          runAfter: input.now,
        });
  if (input.kinds.has("deletion_sync"))
    for (const source of input.sources.filter((s) => s.checkDeleted))
      jobs.push({
        kind: "deletion_sync",
        productId: null,
        source: source.id,
        dedupeKey: `deletion_sync:${source.id}:${day}`,
        runAfter: input.now,
      });
  if (input.kinds.has("purge"))
    jobs.push({
      kind: "purge",
      productId: null,
      source: null,
      dedupeKey: `purge:${day}`,
      // Due by the app's clock, the clock claims use, not the database's.
      runAfter: input.now,
    });
  return jobs.length > 0 ? input.store.enqueue(jobs) : 0;
}
