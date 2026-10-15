/** Billing constants from docs/BRIEF.md, "Payments and consumer law". Changing one needs founder sign-off. */

/** Default: 7-day trial, card required. */
export const TRIAL_DAYS = 7;

/** Reminder email goes out at least this long before the first charge (DMCC subscription rules). */
export const REMINDER_HOURS_BEFORE_CHARGE = 48;

/**
 * How often the trial-reminder cron runs, in hours. Must match `vercel.json`, which
 * tests/deploy/vercel-config.test.ts checks: 24 on Vercel Hobby (daily), 1 once the founder
 * confirms Vercel Pro (hourly). The reminder window widens with the period so the email still
 * lands at least 48 hours before the charge.
 */
export const REMINDER_CRON_PERIOD_HOURS = 24;

/** Allowance for scheduler jitter: Vercel Hobby fires a daily cron anywhere within its hour. */
export const REMINDER_SCHEDULER_SLACK_HOURS = 1;

/**
 * Runs the reminder may miss (a failed send, an outage, a skipped invocation) and still land at
 * least 48 hours before the charge. Each tolerated miss widens the window by one cron period.
 */
export const REMINDER_MISSED_RUNS_TOLERATED = 1;

/** App paths the billing flow links to (docs/PLAN.md, section 4.2). */
export const BILLING_PATHS = {
  settings: "/app/settings",
  // Stripe fills in {CHECKOUT_SESSION_ID}; the welcome step confirms the session server-side.
  checkoutSuccess: "/app/reply?welcome=1&session_id={CHECKOUT_SESSION_ID}",
  checkoutCanceled: "/app/billing?checkout=canceled",
} as const;

/**
 * Subscription statuses that unlock the product. `past_due` is deliberately excluded: the
 * brief does not say how long a failed card keeps access, so the safe default is none.
 * Decide this with the founder before launch (docs/PHASE0-FINDINGS.md).
 */
export const ENTITLED_STATUSES = ["trialing", "active"] as const;

/**
 * Statuses where a Stripe subscription still exists and may bill. A second checkout in any of
 * these would create a duplicate subscription and double-charge, so it is refused. For past_due
 * and unpaid the right move is the billing portal, to fix the payment method.
 */
export const LIVE_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
] as const;
