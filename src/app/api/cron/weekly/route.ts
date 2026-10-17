import { isCronAuthorized } from "@/server/http/cron";
import { json } from "@/server/http/respond";
import { runWeeklyCron } from "@/server/pipeline/cron";
import { createServerCronDeps } from "@/server/pipeline/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Sunday 21:00 UTC: enqueue the weekly synthesis per product (its handler arrives in M6 and M7). */
export async function GET(request: Request) {
  if (!isCronAuthorized(request, process.env.CRON_SECRET))
    return json(401, { error: "unauthorized" });

  try {
    const result = await runWeeklyCron(createServerCronDeps());
    return json(result.status, result.body);
  } catch (error) {
    console.error(`[cron] weekly failed: ${error instanceof Error ? error.name : "UnknownError"}`);
    return json(500, { error: "weekly_failed" });
  }
}
