import { getBillingCore, getEmailForUser } from "@/server/billing/deps";
import { runTrialReminders } from "@/server/billing/trial-reminders";
import { createResendMailer } from "@/server/email/mailer";
import { isCronAuthorized } from "@/server/http/cron";
import { json } from "@/server/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends the DMCC reminder 48 hours before a trial turns into a charge. Must run hourly in
 * production (Vercel Pro) for the email to land 47 to 48 hours before the charge. On the Hobby
 * plan vercel.json runs it daily, because Hobby fails any deploy with a more frequent cron.
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
