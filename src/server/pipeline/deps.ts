import "server-only";
import { createSourceFetch } from "@/server/net/source-fetch";
import { authorHasher } from "@/server/privacy/author-hash";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { collectSources } from "@/sources/registry";
import { createCollectHandler } from "./collect";
import { createCollectStep, type Classifier } from "./collect-step";
import { costPerUnitFor, dailyBudgetFor, monthlyCapFor, SOURCE_USER_AGENT } from "./config";
import { createPurgeHandler, type CronDeps } from "./cron";
import { createDeletionSyncHandler } from "./deletion-sync";
import type { JobHandler, JobKind } from "./ports";
import {
  createSupabaseCollectStore,
  createSupabaseDeletionStore,
  loadCollectTerms,
  recheckProducts,
} from "./supabase-collect";
import {
  collectableProducts,
  createSupabaseBudgetStore,
  createSupabaseJobStore,
  purgeExpired,
} from "./supabase-jobs";

/**
 * The classifier arrives with M4 (docs/PLAN.md 8.2). Until it does, the collect handler is not
 * registered, so no collect job is enqueued and nothing is fetched or stored: a post cannot be
 * stored without its relevance, category and reason.
 */
function serverClassifier(): Classifier | null {
  return null;
}

/**
 * Production wiring for the job crons. Synthesis and digests join this list with their
 * milestones. A kind without a handler is never enqueued.
 */
export function createServerCronDeps(): CronDeps {
  const db = createSupabaseAdminClient();
  const sourceFor = (id: string) => collectSources().find((s) => s.id === id) ?? null;
  const budget = createSupabaseBudgetStore(db);
  const handlers: Partial<Record<JobKind, JobHandler>> = {
    purge: createPurgeHandler((now) => purgeExpired(db, now)),
    // Needs no model: it only deletes what the source no longer has.
    deletion_sync: createDeletionSyncHandler({
      sourceFor,
      fetchFor: (source) => createSourceFetch(source),
      store: createSupabaseDeletionStore(db),
      budget,
      recheckCap: (source) => monthlyCapFor(source, process.env, "recheck"),
      costFor: (source) => costPerUnitFor(source),
      userAgent: SOURCE_USER_AGENT,
    }),
  };
  const classifier = serverClassifier();
  if (classifier) {
    const collect = createCollectHandler({
      sourceFor,
      fetchFor: (source) => createSourceFetch(source),
      budget,
      terms: (productId) => loadCollectTerms(db, productId),
      process: createCollectStep({
        store: createSupabaseCollectStore(db),
        classifier,
        hash: authorHasher(),
      }),
      monthlyCap: (source) => monthlyCapFor(source),
      budgetFor: (source) => dailyBudgetFor(source),
      costFor: (source) => costPerUnitFor(source),
      userAgent: SOURCE_USER_AGENT,
    });
    handlers.collect = collect;
    handlers.first_run = collect;
  }
  return {
    store: createSupabaseJobStore(db),
    handlers,
    products: () => collectableProducts(db),
    recheckProducts: (from, to) => recheckProducts(db, from, to),
    sources: collectSources(),
    clock: () => new Date(),
  };
}
