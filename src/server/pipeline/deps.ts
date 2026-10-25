import "server-only";
import { isLaunched } from "@/lib/launch";
import { isSignInAllowed } from "@/server/auth/allowlist";
import { createClassifier } from "@/server/classify/classify";
import { createSupabaseProductLoader } from "@/server/classify/supabase-product";
import { createServerLlm } from "@/server/llm/deps";
import type { Llm, SpendCap } from "@/server/llm/llm";
import { createSourceFetch } from "@/server/net/source-fetch";
import { authorHasher } from "@/server/privacy/author-hash";
import { createSupabaseAdminClient, type AdminClient } from "@/server/supabase/admin";
import { createSupabaseSynthesisStore } from "@/server/synthesis/supabase-synthesis";
import { createSynthesizeHandler } from "@/server/synthesis/synthesize";
import { collectSources } from "@/sources/registry";
import { createCollectHandler } from "./collect";
import { createCollectStep, type Classifier } from "./collect-step";
import { costPerUnitFor, dailyBudgetFor, monthlyCapFor, SOURCE_USER_AGENT } from "./config";
import { createPurgeHandler, type CronDeps } from "./cron";
import { createDeletionSyncHandler } from "./deletion-sync";
import { createDailyDigestHandler, createWeeklyDigestHandler } from "./digest";
import { createFirstRunHandler, createFirstRunNotify } from "./first-run";
import { createSupabaseDailyDigestDeps, createSupabaseWeeklyDigestDeps } from "./supabase-digest";
import type { JobHandler, JobKind } from "./ports";
import {
  createSupabaseCollectStore,
  createSupabaseDeletionStore,
  loadCollectTerms,
  recheckProducts,
} from "./supabase-collect";
import { createSupabaseNotifyDeps } from "./supabase-first-run";
import {
  collectableProducts,
  createSupabaseBudgetStore,
  createSupabaseJobStore,
  purgeExpired,
} from "./supabase-jobs";

/**
 * The Haiku classifier (docs/PLAN.md 8.2), one per cron run so each product's context is read once.
 * Null when no model key is configured (F13): the collect handler is then not registered, so no
 * collect job is enqueued and nothing is fetched or stored, since a post cannot be stored without
 * its relevance, category and reason.
 */
function serverClassifier(db: AdminClient): {
  classifier: Classifier;
  spendCap: (productId: string) => Promise<SpendCap | null>;
  llm: Llm;
} | null {
  let llm: Llm;
  try {
    llm = createServerLlm();
  } catch {
    return null;
  }
  return {
    classifier: createClassifier({ llm, product: createSupabaseProductLoader(db) }),
    spendCap: (productId) => llm.capReached(productId),
    llm,
  };
}

/** The products whose owner may sign in before launch (SIGNUP_ALLOWLIST). */
async function allowlistedProducts(db: AdminClient, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("products")
    .select("id, owner_id")
    .in("id", [...ids]);
  if (error) throw new Error("Supabase: could not load product owners");
  const kept: string[] = [];
  for (const row of data ?? []) {
    const user = await db.auth.admin.getUserById(row.owner_id);
    if (!user.error && isSignInAllowed(user.data.user?.email)) kept.push(row.id);
  }
  return kept;
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
  const model = serverClassifier(db);
  const notify = createFirstRunNotify(createSupabaseNotifyDeps(db));
  handlers.digest_daily = createDailyDigestHandler(createSupabaseDailyDigestDeps(db));
  handlers.digest_weekly = createWeeklyDigestHandler(createSupabaseWeeklyDigestDeps(db));
  // Without a model key nothing is collected, so the first run sends no "feed ready" email.
  handlers.first_run = createFirstRunHandler(null, async () => ({
    status: "done",
    payload: { result: "model_off" },
  }));
  if (model) {
    const collect = createCollectHandler({
      sourceFor,
      fetchFor: (source) => createSourceFetch(source),
      budget,
      terms: (productId, source) => loadCollectTerms(db, productId, source.id),
      process: createCollectStep({
        store: createSupabaseCollectStore(db),
        classifier: model.classifier,
        hash: authorHasher(),
      }),
      spendCap: model.spendCap,
      monthlyCap: (source) => monthlyCapFor(source),
      budgetFor: (source) => dailyBudgetFor(source),
      costFor: (source) => costPerUnitFor(source),
      userAgent: SOURCE_USER_AGENT,
    });
    handlers.collect = collect;
    handlers.synthesize = createSynthesizeHandler({
      llm: model.llm,
      store: createSupabaseSynthesisStore(db),
    });
    handlers.first_run = createFirstRunHandler(collect, notify);
  }
  return {
    store: createSupabaseJobStore(db),
    handlers,
    products: async () => {
      const ids = await collectableProducts(db);
      // Before launch, collection runs only for allowlisted accounts (docs/PLAN.md 12.10).
      return isLaunched() ? ids : allowlistedProducts(db, ids);
    },
    recheckProducts: (from, to) => recheckProducts(db, from, to),
    sources: collectSources(),
    clock: () => new Date(),
  };
}
