import { isCronAuthorized } from "@/server/http/cron";
import { json } from "@/server/http/respond";
import { runDigestCron } from "@/server/pipeline/cron";
import { createServerCronDeps } from "@/server/pipeline/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 08:00 UTC, which is 08:00 in London in winter (GMT). It sends only when London's
 * clock says 08:00; in summer /api/cron/digest-bst (07:00 UTC) does (docs/PLAN.md 11).
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request, process.env.CRON_SECRET))
    return json(401, { error: "unauthorized" });
  try {
    const result = await runDigestCron(createServerCronDeps());
    return json(result.status, result.body);
  } catch (error) {
    console.error(`[cron] digest failed: ${error instanceof Error ? error.name : "UnknownError"}`);
    return json(500, { error: "digest_failed" });
  }
}
