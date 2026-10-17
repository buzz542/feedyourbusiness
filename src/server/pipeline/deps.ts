import "server-only";
import { collectSources } from "@/sources/registry";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createPurgeHandler, type CronDeps } from "./cron";
import { collectableProducts, createSupabaseJobStore, purgeExpired } from "./supabase-jobs";

/**
 * Production wiring for the job crons. The collect and deletion sync handlers join this list with
 * the collect step and deletion sync (M3); synthesis and digests with their milestones. A kind
 * without a handler is never enqueued.
 */
export function createServerCronDeps(): CronDeps {
  const db = createSupabaseAdminClient();
  return {
    store: createSupabaseJobStore(db),
    handlers: {
      purge: createPurgeHandler((now) => purgeExpired(db, now)),
    },
    products: () => collectableProducts(db),
    sources: collectSources(),
    clock: () => new Date(),
  };
}
