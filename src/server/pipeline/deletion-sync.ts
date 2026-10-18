import "server-only";
import type { CollectContext, CollectSource } from "@/sources/types";
import type { JobHandler } from "./ports";

/**
 * Deletion sync (docs/PLAN.md 2.3.6, 7.2): once a day per source that can check (Hacker News,
 * Bluesky), every stored post the source reports deleted (or hidden) is deleted here, with its
 * product links. Posts are checked in batches ordered by id; a run that reaches its time budget
 * saves its cursor and the next run resumes there, so no post is skipped however many are stored.
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
}

export interface DeletionSyncDeps {
  /** The source when it is registered and its kill switch is on; otherwise null. */
  sourceFor(id: string): CollectSource | null;
  fetchFor(source: CollectSource): CollectContext["fetch"];
  store: DeletionStore;
  userAgent: string;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to the server's environment; a source reads only the names it declares. */
  credential?: (name: string) => string | undefined;
  batchSize?: number;
}

/** Bluesky looks up 25 posts a request; Hacker News one, so a batch is a few seconds of requests. */
const BATCH_SIZE = 100;
const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function createDeletionSyncHandler(deps: DeletionSyncDeps): JobHandler {
  const readEnv = deps.credential ?? ((name: string) => process.env[name]);
  const batchSize = deps.batchSize ?? BATCH_SIZE;

  return async (job, { now, deadline }) => {
    const today = now().toISOString().slice(0, 10);
    // Today's job checks everything again, so a job left over from an earlier day stops.
    if (typeof job.payload.day === "string" && job.payload.day < today)
      return { status: "done", payload: { result: "superseded" } };
    const source = job.source ? deps.sourceFor(job.source) : null;
    if (!source?.checkDeleted) return { status: "done", payload: { result: "source_off" } };

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

    let cursor = typeof job.payload.cursor === "string" ? job.payload.cursor : null;
    let checked = Number(job.payload.checked ?? 0);
    let removed = Number(job.payload.removed ?? 0);
    while (now().getTime() < deadline) {
      const batch = await deps.store.stored(source.id, cursor, batchSize, now());
      if (batch.length > 0) {
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
