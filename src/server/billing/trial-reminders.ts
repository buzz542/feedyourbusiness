import { renderTrialReminder } from "../../../emails/trial-reminder";
import type { BillingConfig } from "./config";
import {
  BILLING_PATHS,
  REMINDER_CRON_PERIOD_HOURS,
  REMINDER_HOURS_BEFORE_CHARGE,
  REMINDER_MISSED_RUNS_TOLERATED,
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
 * The run before the first due run saw more than this many hours left, and consecutive runs are at
 * most `periodHours` plus the scheduler slack apart. The window covers that gap once for the run
 * itself and once more for each tolerated missed run, so even after a failed run the email lands at
 * least 48 hours before the charge: 73 to 98 hours ahead on the daily (Hobby) schedule, 50 to 52 on
 * the hourly one.
 */
export function reminderWindowHours(periodHours: number = REMINDER_CRON_PERIOD_HOURS): number {
  const gap = periodHours + REMINDER_SCHEDULER_SLACK_HOURS;
  return REMINDER_HOURS_BEFORE_CHARGE + (1 + REMINDER_MISSED_RUNS_TOLERATED) * gap;
}

class SendTimeoutError extends Error {
  override name = "SendTimeoutError";
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SendTimeoutError()), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
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
  /** Not attempted because the run's time budget ran out; the next run picks them up. */
  deferred: number;
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
  /** Stop claiming new reminders after this long, well inside the route's maxDuration. */
  budgetMs?: number;
  /** Give up on one send after this long and release its claim, so a hung send loses nothing. */
  sendTimeoutMs?: number;
  /** Milliseconds since the run started. Injected in tests. */
  elapsedMs?: () => number;
}): Promise<ReminderRunResult> {
  const { store, stripe, config, mailer, getEmail, now } = args;
  const budgetMs = args.budgetMs ?? 40_000;
  const sendTimeoutMs = args.sendTimeoutMs ?? 10_000;
  const startedAt = Date.now();
  const elapsedMs = args.elapsedMs ?? (() => Date.now() - startedAt);

  const due = selectDueReminders(
    await store.listTrialingProfilesWithoutReminder(),
    now,
    args.windowHours ?? reminderWindowHours(),
  );
  const result: ReminderRunResult = {
    due: due.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
  };
  if (due.length === 0) return result;

  const price = await stripe.getPrice(config.priceId);
  if (!price.active || price.unitAmount == null || !price.interval) {
    // Without the real amount we must not send a reminder that omits the price.
    return { ...result, failed: due.length };
  }

  for (const [index, profile] of due.entries()) {
    if (elapsedMs() > budgetMs) {
      result.deferred = due.length - index;
      break;
    }
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
      await withTimeout(mailer.send({ to, ...email }), sendTimeoutMs);
      result.sent++;
    } catch {
      await store.releaseTrialReminder(profile.id);
      result.failed++;
    }
  }
  return result;
}
