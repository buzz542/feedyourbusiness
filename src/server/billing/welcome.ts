import type { BillingStripe, ProfileStore } from "./ports";
import { profilePatchFromSubscription } from "./subscription";

/**
 * The welcome step after Checkout (docs/PLAN.md 7.3, 10.4): retrieve the Checkout Session
 * server-side, check it is this user's, and apply the billing patch before any entitlement check,
 * so a new subscriber is never shown the billing page (or able to start a second checkout) while
 * the webhook is still on its way.
 */
export type WelcomeResult = "applied" | "invalid" | "mismatch" | "pending" | "stale";

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export async function applyWelcome(
  deps: { stripe: BillingStripe; store: ProfileStore },
  userId: string,
  sessionId: string | null | undefined,
): Promise<WelcomeResult> {
  if (!sessionId || !SESSION_ID.test(sessionId)) return "invalid";
  const session = await deps.stripe.getCheckoutSession(sessionId);
  if (!session || session.clientReferenceId !== userId) return "mismatch";
  if (session.status !== "complete" || !session.subscriptionId || !session.customerId)
    return "pending";
  // Only the subscription the profile already holds, or the first one. An old session (a bookmark,
  // browser history) never overwrites a newer subscription.
  const profile = await deps.store.getBillingProfile(userId);
  if (profile?.stripeSubscriptionId && profile.stripeSubscriptionId !== session.subscriptionId)
    return "stale";
  const sub = await deps.stripe.getSubscription(session.subscriptionId);
  if (!sub) return "pending";
  // Stamped with Stripe's own time for the session, which is earlier than every event about the
  // subscription it created, so the webhook's state always wins over this one.
  const applied = await deps.store.applyBillingPatch(
    userId,
    {
      stripe_customer_id: session.customerId,
      stripe_subscription_id: session.subscriptionId,
      ...profilePatchFromSubscription(sub),
    },
    session.created,
  );
  return applied ? "applied" : "stale";
}
