import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { collectSources } from "@/sources/registry";
import { createPurgeHandler, type CronDeps } from "./cron";
import { collectableProducts, createSupabaseJobStore, purgeExpired } from "./supabase-jobs";

/**
 * The cron routes' dependencies (docs/PLAN.md 7.2, 13). Only kinds with a handler are enqueued, so
 * a kind is switched on here when its step exists: the purge now; collect and deletion sync with
 * the collect step and deletion sync (M3), synthesis and digests with their milestones.
 */
export function createServerCronDeps(): CronDeps {
  const admin = createSupabaseAdminClient();
  return {
    store: createSupabaseJobStore(admin),
    handlers: { purge: createPurgeHandler((now) => purgeExpired(admin, now)) },
    products: () => collectableProducts(admin),
    sources: collectSources(),
    clock: () => new Date(),
  };
}
