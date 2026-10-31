import type { CollectSource } from "@/sources/types";
import type { JobKind, JobStore, NewJob } from "./ports";

const HOUR = 60 * 60_000;

/**
 * The daily cron's enqueue (docs/PLAN.md 7.2, 13): a collect job per collectable product and
 * enabled source, a deletion sync per source that supports it, and the purge. Dedupe keys carry the
 * UTC day, so running it twice in a day adds nothing. Only kinds that have a handler are enqueued.
 */
export async function enqueueDaily(input: {
  store: JobStore;
  /** Confirmed, active products of entitled owners. */
  products: () => Promise<string[]>;
  /** Products with vendor posts due for their deletion re-check, collected in [from, to). */
  recheckProducts?: (from: Date, to: Date) => Promise<string[]>;
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
        // A job left over from an earlier day stops once today's has started.
        payload: { day },
      });
  // The vendor's one-time re-check, about 72 hours after collection (2.3.6): per product, the posts
  // collected 72 to 96 hours ago, a window that moves a day each day so each post is checked once.
  const recheckSources = input.sources.filter((s) => s.recheck);
  if (input.kinds.has("deletion_sync") && input.recheckProducts && recheckSources.length > 0) {
    const from = new Date(input.now.getTime() - 96 * HOUR);
    const to = new Date(input.now.getTime() - 72 * HOUR);
    const due = await input.recheckProducts(from, to);
    for (const source of recheckSources)
      for (const product of due)
        jobs.push({
          kind: "deletion_sync",
          productId: product,
          source: source.id,
          dedupeKey: `deletion_sync:${source.id}:${product}:${day}`,
          runAfter: input.now,
          payload: { day, from: from.toISOString(), to: to.toISOString() },
        });
  }
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
