import "server-only";
import { after } from "next/server";
import { firstRunProgress } from "@/server/email/supabase-digest";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createServerCronDeps } from "./deps";
import { startFirstRun } from "./first-run";
import { runJobs } from "./runner";

/**
 * Starts the first run once (dedupe keys) and works its jobs after the response, so results appear
 * while the user watches (docs/PLAN.md 7.3). The daily cron finishes anything still pending.
 */
export async function ensureFirstRun(productId: string): Promise<void> {
  const deps = createServerCronDeps();
  const added = await startFirstRun({
    store: deps.store,
    sources: deps.sources,
    productId,
    now: deps.clock(),
  });
  if (added > 0)
    after(async () => {
      await runJobs({ store: deps.store, handlers: deps.handlers, clock: deps.clock });
    });
}

/** First-run progress by source for the signed-in owner's product. */
export const loadFirstRunProgress = (productId: string) =>
  firstRunProgress(createSupabaseAdminClient(), productId);
