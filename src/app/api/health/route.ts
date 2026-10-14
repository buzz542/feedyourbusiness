import { createHealthHandler, runHealthChecks } from "@/server/health/checks";
import { getHealthDeps } from "@/server/health/deps";
import { guard } from "@/server/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Liveness without credentials. With `Authorization: Bearer $CRON_SECRET` it checks Supabase,
 * Stripe (config, price, webhook endpoint) and email. See docs/PLAN.md, "Verify a deployment".
 */
export function GET(request: Request) {
  return guard(() =>
    createHealthHandler({
      cronSecret: process.env.CRON_SECRET,
      run: () => runHealthChecks(getHealthDeps()),
    })(request),
  );
}
