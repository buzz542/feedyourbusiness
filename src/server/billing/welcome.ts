import { consentFrom } from "./events";
import type { BillingStripe, ProfileStore } from "./ports";
import { isEntitled, profilePatchFromSubscription } from "./subscription";

/**
 * The welcome step after checkout (docs/PLAN.md 7.3, 10.4). Stripe returns the customer to
 * /app/reply?welcome=1&session_id=...; before any entitlement check, the Checkout Session is read
 * server-side, its client_reference_id must be the signed-in user, and the subscription's state is
 * applied, so a new subscriber never sees the billing page (or starts a second checkout) while the
 * webhook is still on its way. The patch carries the session's creation time, so any webhook event
 * that follows still applies.
 */

export type WelcomeOutcome =
  | { ok: true; entitled: boolean }
  | { ok: false; reason: "invalid" | "not_found" | "not_yours" | "no_subscription" };

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export async function confirmCheckout(
  deps: {
    stripe: Pick<BillingStripe, "getCheckoutSession" | "getSubscription">;
    store: Pick<ProfileStore, "applyBillingPatch" | "recordServiceConsent">;
  },
  userId: string,
  sessionId: string,
): Promise<WelcomeOutcome> {
  if (!SESSION_ID.test(sessionId)) return { ok: false, reason: "invalid" };
  const session = await deps.stripe.getCheckoutSession(sessionId);
  if (!session) return { ok: false, reason: "not_found" };
  if (session.clientReferenceId !== userId) return { ok: false, reason: "not_yours" };
  if (session.mode !== "subscription" || !session.subscriptionId)
    return { ok: false, reason: "no_subscription" };
  const sub = await deps.stripe.getSubscription(session.subscriptionId);
  if (!sub) return { ok: false, reason: "no_subscription" };
  if (sub.metadata.user_id && sub.metadata.user_id !== userId)
    return { ok: false, reason: "not_yours" };
  const patch = profilePatchFromSubscription(sub);
  await deps.store.applyBillingPatch(userId, patch, session.createdAt);
  const consentAt = consentFrom(sub.metadata);
  if (consentAt) await deps.store.recordServiceConsent(userId, consentAt);
  return { ok: true, entitled: isEntitled(patch.subscription_status) };
}
