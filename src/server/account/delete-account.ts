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

export interface AccountDeletionDeps {
  getBillingProfile(userId: string): Promise<BillingProfile | null>;
  /** Cancels immediately. Succeeds when the subscription has already ended. */
  cancelSubscriptionNow(subscriptionId: string): Promise<void>;
  /** Every subscription of the customer that could still bill, from Stripe itself. */
  liveSubscriptionIds(customerId: string): Promise<string[]>;
  /** Every subscription our checkout made for this user, found by its metadata in Stripe. */
  liveSubscriptionIdsForUser(userId: string): Promise<string[]>;
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

  // Stripe decides what can still bill, not our copy of the status (a webhook may be late):
  // the profile's subscription, and any other live one on the same customer.
  // A checkout whose webhook has not landed yet is found by our user id in its metadata.
  const profile = await deps.getBillingProfile(userId);
  const ids = new Set<string>();
  if (profile?.stripeSubscriptionId) ids.add(profile.stripeSubscriptionId);
  if (profile?.stripeCustomerId)
    for (const id of await deps.liveSubscriptionIds(profile.stripeCustomerId)) ids.add(id);
  for (const id of await deps.liveSubscriptionIdsForUser(userId)) ids.add(id);
  for (const id of ids) await deps.cancelSubscriptionNow(id);
  // Requested before, done after: the log never claims a deletion that did not happen.
  await deps.writeAudit({ actor: "self", action: "account_deletion_requested", target: userId });
  await deps.deleteAuthUser(userId);
  // The account is gone either way; a failed second row must not report a failed deletion.
  try {
    await deps.writeAudit({ actor: "self", action: "account_deleted", target: userId });
  } catch (error) {
    console.error(
      `[account] audit after deletion failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
  }
  await deps.track("account_deleted", null);
  return "deleted";
}
