import { isCronAuthorized } from "@/server/http/cron";
import { json } from "@/server/http/respond";
import { runDailyCron } from "@/server/pipeline/cron";
import { createServerCronDeps } from "@/server/pipeline/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 06:00 UTC: enqueue the day's jobs (collect, deletion sync, purge), then run them for up to 240 seconds. On Vercel Hobby this is the only run of the day (D6). */
export async function GET(request: Request) {
  if (!isCronAuthorized(request, process.env.CRON_SECRET))
    return json(401, { error: "unauthorized" });

  try {
    const result = await runDailyCron(createServerCronDeps());
    return json(result.status, result.body);
  } catch (error) {
    console.error(`[cron] daily failed: ${error instanceof Error ? error.name : "UnknownError"}`);
    return json(500, { error: "daily_failed" });
  }
}
