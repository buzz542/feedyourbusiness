import { renderTrialReminder } from "../../../emails/trial-reminder";
import type { BillingConfig } from "./config";
import {
  BILLING_PATHS,
  REMINDER_CRON_PERIOD_HOURS,
  REMINDER_HOURS_BEFORE_CHARGE,
  REMINDER_SCHEDULER_SLACK_HOURS,
} from "./constants";
import type { BillingStripe, ProfileStore, TrialingProfile } from "./ports";

export interface Mailer {
  send(message: { to: string; subject: string; text: string; html: string }): Promise<void>;
}

const HOUR_MS = 3_600_000;

/**
 * How far ahead a reminder becomes due, for a cron that runs every `periodHours`.
 *
 * The run before the one that sends saw more than this many hours left, and consecutive runs are at
 * most `periodHours` plus the scheduler slack apart, so the email always lands at least 48 hours
 * before the charge: 48 to 73 hours on the daily (Hobby) schedule, 48 to 50 on the hourly one.
 */
export function reminderWindowHours(periodHours: number = REMINDER_CRON_PERIOD_HOURS): number {
  return REMINDER_HOURS_BEFORE_CHARGE + periodHours + REMINDER_SCHEDULER_SLACK_HOURS;
}

/**
 * Who is due a reminder right now: the first charge is within the window, and the trial has not
 * ended. Someone who has already cancelled will not be charged, so they get no reminder.
 */
export function selectDueReminders(
  trialing: readonly TrialingProfile[],
  now: Date,
  windowHours: number = reminderWindowHours(),
): TrialingProfile[] {
  const windowEnd = now.getTime() + windowHours * HOUR_MS;
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
  /** Defaults to the window for the deployed cron period. Tests pass other cadences. */
  windowHours?: number;
}): Promise<ReminderRunResult> {
  const { store, stripe, config, mailer, getEmail, now } = args;

  const due = selectDueReminders(
    await store.listTrialingProfilesWithoutReminder(),
    now,
    args.windowHours ?? reminderWindowHours(),
  );
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
        settingsUrl: `${config.siteUrl}${BILLING_PATHS.settings}`,
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
