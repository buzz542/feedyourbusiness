import { getBillingCore, getEmailForUser } from "@/server/billing/deps";
import { runTrialReminders } from "@/server/billing/trial-reminders";
import { createResendMailer } from "@/server/email/mailer";
import { isCronAuthorized } from "@/server/http/cron";
import { json } from "@/server/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends the DMCC reminder at least 48 hours before a trial turns into a charge. vercel.json runs it
 * daily on Vercel Hobby (48 to 73 hours of notice) and hourly once the founder confirms Pro (48 to
 * 50 hours); `REMINDER_CRON_PERIOD_HOURS` must match the schedule, which a deploy test checks.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request, process.env.CRON_SECRET))
    return json(401, { error: "unauthorized" });

  try {
    const result = await runTrialReminders({
      ...getBillingCore(),
      mailer: createResendMailer(),
      getEmail: getEmailForUser,
      now: new Date(),
    });
    // Non-2xx on any failure, so a missed reminder shows up in cron monitoring.
    return json(result.failed > 0 ? 500 : 200, result);
  } catch (error) {
    console.error(
      `[cron] trial-reminders failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return json(500, { error: "trial_reminders_failed" });
  }
}
