import { renderTrialReminder } from "../../../emails/trial-reminder";
import type { BillingConfig } from "./config";
import { REMINDER_HOURS_BEFORE_CHARGE } from "./constants";
import type { BillingStripe, ProfileStore, TrialingProfile } from "./ports";

export interface Mailer {
  send(message: { to: string; subject: string; text: string; html: string }): Promise<void>;
}

const HOUR_MS = 3_600_000;

/**
 * Who is due a reminder right now. A reminder is due once the first charge is within the window,
 * and never after the trial has ended. Someone who has already cancelled will not be charged, so
 * they get no reminder. The cron runs hourly, so the email lands 47 to 48 hours before the charge.
 */
export function selectDueReminders(
  trialing: readonly TrialingProfile[],
  now: Date,
  hoursBefore: number = REMINDER_HOURS_BEFORE_CHARGE,
): TrialingProfile[] {
  const windowEnd = now.getTime() + hoursBefore * HOUR_MS;
  return trialing.filter(
    (p) =>
      !p.cancelAtPeriodEnd &&
      p.trialEnd.getTime() > now.getTime() &&
      p.trialEnd.getTime() <= windowEnd,
  );
}

export interface ReminderRunResult {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function runTrialReminders(args: {
  store: ProfileStore;
  stripe: BillingStripe;
  config: BillingConfig;
  mailer: Mailer;
  getEmail: (userId: string) => Promise<string | null>;
  now: Date;
}): Promise<ReminderRunResult> {
  const { store, stripe, config, mailer, getEmail, now } = args;

  const due = selectDueReminders(await store.listTrialingProfilesWithoutReminder(), now);
  const result: ReminderRunResult = { due: due.length, sent: 0, failed: 0, skipped: 0 };
  if (due.length === 0) return result;

  const price = await stripe.getPrice(config.priceId);
  if (!price.active || price.unitAmount == null || !price.interval) {
    // Without the real amount we must not send a reminder that omits the price.
    return { ...result, failed: due.length };
  }

  for (const profile of due) {
    // Claim first so two overlapping runs cannot both send. Release if sending fails.
    if (!(await store.claimTrialReminder(profile.id, now))) {
      result.skipped++;
      continue;
    }
    try {
      const to = await getEmail(profile.id);
      if (!to) throw new Error("no email address");
      const email = renderTrialReminder({
        chargeDate: profile.trialEnd,
        price: {
          unitAmount: price.unitAmount,
          currency: price.currency,
          interval: price.interval,
          intervalCount: price.intervalCount ?? 1,
        },
        settingsUrl: `${config.siteUrl}/settings`,
      });
      await mailer.send({ to, ...email });
      result.sent++;
    } catch {
      await store.releaseTrialReminder(profile.id);
      result.failed++;
    }
  }
  return result;
}
