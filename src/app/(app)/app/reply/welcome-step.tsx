import "server-only";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/server/auth/session";
import { getBillingCore } from "@/server/billing/deps";
import { confirmCheckout } from "@/server/billing/welcome";
import { createSupabaseEventSink } from "@/server/events/sink";
import { track } from "@/server/events/track";
import { createServerCronDeps } from "@/server/pipeline/deps";
import { startFirstRun } from "@/server/pipeline/first-run";
import { runJobs } from "@/server/pipeline/runner";
import { createSupabaseJobStore } from "@/server/pipeline/supabase-jobs";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { collectSources } from "@/sources/registry";

/**
 * Stripe returns here with ?welcome=1&session_id=... (docs/PLAN.md 7.3). Confirm the Checkout
 * Session and apply the subscription before any entitlement check, start the first run (once,
 * deduped), process it after the response, then load the Reply tab afresh. Returns null when this
 * is not a return from Checkout.
 */
export async function WelcomeStep({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}): Promise<null> {
  if (params.welcome !== "1") return null;
  const user = await requireUser("/app/reply");
  const sessionId = typeof params.session_id === "string" ? params.session_id : "";
  let entitled = false;
  try {
    const { stripe, store } = getBillingCore();
    const outcome = await confirmCheckout({ stripe, store }, user.id, sessionId);
    entitled = outcome.ok && outcome.entitled;
  } catch (error) {
    console.error(`[welcome] confirm failed: ${error instanceof Error ? error.name : "Unknown"}`);
  }
  if (!entitled) redirect("/app");

  const db = await createSupabaseServerClient();
  const product = await db
    .from("products")
    .select("id, status")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (product.data && product.data.status === "active") {
    const productId = product.data.id;
    const admin = createSupabaseAdminClient();
    const store = createSupabaseJobStore(admin);
    const started = await startFirstRun({
      store,
      productId,
      sources: collectSources(),
      now: new Date(),
    }).catch(() => 0);
    if (started > 0) {
      await track(createSupabaseEventSink(), "trial_started", user.id, {}, new Date());
      // Results stream in while the user watches; the daily cron finishes anything left.
      after(async () => {
        try {
          const deps = createServerCronDeps();
          await runJobs({ store: deps.store, handlers: deps.handlers, clock: deps.clock });
        } catch (error) {
          console.error(
            `[welcome] first run failed: ${error instanceof Error ? error.name : "Unknown"}`,
          );
        }
      });
    }
  }
  redirect("/app/reply");
}
