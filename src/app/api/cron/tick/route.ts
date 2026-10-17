import { isCronAuthorized } from "@/server/http/cron";
import { json } from "@/server/http/respond";
import { runTickCron } from "@/server/pipeline/cron";
import { createServerCronDeps } from "@/server/pipeline/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Every 10 minutes once the founder confirms Vercel Pro (F2): advance due jobs, such as a pending vendor run. Not scheduled on Hobby. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request, process.env.CRON_SECRET))
    return json(401, { error: "unauthorized" });

  try {
    const result = await runTickCron(createServerCronDeps());
    return json(result.status, result.body);
  } catch (error) {
    console.error(`[cron] tick failed: ${error instanceof Error ? error.name : "UnknownError"}`);
    return json(500, { error: "tick_failed" });
  }
}
