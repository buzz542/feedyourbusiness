import { hasLiveSubscription } from "@/server/billing/subscription";

/**
 * Account deletion (docs/PLAN.md 4.7, 10.6): typed confirmation, the Stripe subscription canceled
 * at once (no further charge), the auth user deleted (which cascades to every row the user owns),
 * and the deletion recorded in `events` with no user id and in the append-only `audit_log`.
 * Posts no product links to any more go at the next purge.
 */

export const CONFIRM_WORD = "DELETE";

export interface DeleteAccountDeps {
  billing(userId: string): Promise<{ subscriptionId: string | null; status: string | null } | null>;
  cancelNow(subscriptionId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  audit(entry: { actor: string; action: string; target: string | null }): Promise<void>;
  recordEvent(): Promise<unknown>;
}

export type DeleteResult = { ok: true } | { ok: false; reason: "not_confirmed" };

export async function deleteAccount(
  deps: DeleteAccountDeps,
  userId: string,
  confirmation: unknown,
): Promise<DeleteResult> {
  if (typeof confirmation !== "string" || confirmation.trim() !== CONFIRM_WORD)
    return { ok: false, reason: "not_confirmed" };
  const billing = await deps.billing(userId);
  // Cancel first: if Stripe fails, nothing is deleted and the user can try again.
  if (billing?.subscriptionId && hasLiveSubscription(billing.status))
    await deps.cancelNow(billing.subscriptionId);
  await deps.audit({ actor: "user", action: "account_deleted", target: null });
  await deps.deleteUser(userId);
  await deps.recordEvent();
  return { ok: true };
}
