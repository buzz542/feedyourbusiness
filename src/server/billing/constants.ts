/** Billing constants from docs/BRIEF.md, "Payments and consumer law". Changing one needs founder sign-off. */

/** Default: 7-day trial, card required. */
export const TRIAL_DAYS = 7;

/** Reminder email goes out this long before the first charge (DMCC subscription rules). */
export const REMINDER_HOURS_BEFORE_CHARGE = 48;

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
