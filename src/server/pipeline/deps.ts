import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { loadAllowlist } from "@/server/auth/allowlist";
import { collectSources } from "@/sources/registry";
import { allowlistedProducts } from "./collectable";
import { createSourceFetch } from "@/server/net/source-fetch";
import { costPerUnitFor, monthlyCapFor, SOURCE_USER_AGENT } from "./config";
import { createPurgeHandler, type CronDeps } from "./cron";
import { createDeletionSyncHandler } from "./deletion-sync";
import {
  createOwnerEmailLookup,
  createSupabaseDeletionStore,
  recheckProducts,
} from "./supabase-collect";
import {
  collectableRows,
  createSupabaseBudgetStore,
  createSupabaseJobStore,
  purgeExpired,
} from "./supabase-jobs";

/**
 * The cron routes' dependencies (docs/PLAN.md 7.2, 13). Only kinds with a handler are enqueued, so
 * a kind is switched on here when its step exists: the purge and deletion sync now; collect once
 * the classifier exists (M4: the collect step needs it); synthesis and digests with their
 * milestones. Every collect source is off by default, so deletion sync has nothing to do until one
 * is switched on.
 */
export function createServerCronDeps(): CronDeps {
  const admin = createSupabaseAdminClient();
  const sources = collectSources();
  return {
    store: createSupabaseJobStore(admin),
    handlers: {
      purge: createPurgeHandler((now) => purgeExpired(admin, now)),
      // Deletion sync needs no model, so it runs as soon as a source is switched on: Hacker News and
      // Bluesky existence checks, X lookups (its deletion compliance) and the Reddit re-check.
      deletion_sync: createDeletionSyncHandler({
        sourceFor: (id) => collectSources().find((s) => s.id === id) ?? null,
        // Each source's own fetch, bound to its own hosts (2.1.9), never the combined safeFetch.
        fetchFor: (source) => createSourceFetch(source),
        store: createSupabaseDeletionStore(admin),
        budget: createSupabaseBudgetStore(admin),
        recheckCap: (source) => monthlyCapFor(source, process.env, "recheck"),
        costFor: (source) => costPerUnitFor(source),
        userAgent: SOURCE_USER_AGENT,
      }),
    },
    recheckProducts: (from, to) => recheckProducts(admin, from, to),
    // Before launch, only accounts on SIGNUP_ALLOWLIST (12.10).
    products: async () =>
      allowlistedProducts(
        await collectableRows(admin),
        createOwnerEmailLookup(admin),
        loadAllowlist(),
      ),
    sources,
    clock: () => new Date(),
  };
}
