import { hasLiveSubscription, isEntitled } from "@/server/billing/subscription";

/**
 * Where /app sends a signed-in user (docs/PLAN.md 4.2, 4.3): the confirmations, then onboarding
 * until the product is confirmed, then billing, then Reply. A subscription that still exists but
 * is not entitled (past_due, unpaid, paused) goes to settings to fix the card, because a second
 * checkout would be refused and could double-bill.
 */

export interface AccountState {
  termsAccepted: boolean;
  product: { status: string } | null;
  subscriptionStatus: string | null;
}

export type NextStep =
  "/app/terms" | "/app/onboarding" | "/app/billing" | "/app/settings" | "/app/reply";

const CONFIRMED_STATUSES: readonly string[] = ["active", "paused"];

/**
 * A product counts as confirmed once it leaves draft (4.3, step 5); paused is still confirmed.
 * Named statuses only, so a status added later is refused until someone decides otherwise.
 */
export function isConfirmedProduct(product: AccountState["product"]): boolean {
  return product != null && CONFIRMED_STATUSES.includes(product.status);
}

export function nextStepFor(state: AccountState): NextStep {
  if (!state.termsAccepted) return "/app/terms";
  if (!isConfirmedProduct(state.product)) return "/app/onboarding";
  if (isEntitled(state.subscriptionStatus)) return "/app/reply";
  if (hasLiveSubscription(state.subscriptionStatus)) return "/app/settings";
  return "/app/billing";
}
