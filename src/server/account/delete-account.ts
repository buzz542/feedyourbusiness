import type { EventName } from "@/server/analytics/track";
import type { BillingProfile } from "@/server/billing/ports";

/**
 * Account deletion (docs/PLAN.md 4.7, 10.6). The user types DELETE; the subscription is canceled
 * at once (not at the period end); the audit log records it; the auth user is deleted with the
 * admin API, which cascades every owned row (tests/db/account.test.ts); and `account_deleted` is
 * recorded in `events` with no user id. Posts nobody links to any more go at the next purge.
 *
 * Each step must succeed before the next, so a failure leaves a whole account the user can delete
 * again, never a deleted account that is still billed.
 */

export const DELETE_CONFIRMATION = "DELETE";

/** Statuses after which Stripe never bills the subscription again. */
const ENDED = new Set(["canceled", "incomplete_expired"]);

export interface AccountDeletionDeps {
  getBillingProfile(userId: string): Promise<BillingProfile | null>;
  /** Cancels immediately. Succeeds when the subscription has already ended. */
  cancelSubscriptionNow(subscriptionId: string): Promise<void>;
  writeAudit(entry: { actor: string; action: string; target: string | null }): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
  track(name: EventName, userId: null): Promise<void>;
}

export type DeletionOutcome = "deleted" | "confirmation_mismatch";

export async function deleteAccount(
  deps: AccountDeletionDeps,
  userId: string,
  typed: string,
): Promise<DeletionOutcome> {
  if (typed !== DELETE_CONFIRMATION) return "confirmation_mismatch";

  const profile = await deps.getBillingProfile(userId);
  const subscriptionId = profile?.stripeSubscriptionId ?? null;
  if (subscriptionId && !ENDED.has(profile?.subscriptionStatus ?? "")) {
    await deps.cancelSubscriptionNow(subscriptionId);
  }
  await deps.writeAudit({ actor: "self", action: "account_deleted", target: userId });
  await deps.deleteAuthUser(userId);
  await deps.track("account_deleted", null);
  return "deleted";
}
