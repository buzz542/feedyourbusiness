import type { BillingStripe, ProfileStore } from "./ports";
import { hasLiveSubscription, profilePatchFromSubscription } from "./subscription";

/**
 * The welcome step after Checkout (docs/PLAN.md 7.3, 10.4): retrieve the Checkout Session
 * server-side, check it is this user's, and apply the billing patch before any entitlement check,
 * so a new subscriber is never shown the billing page (or able to start a second checkout) while
 * the webhook is still on its way.
 */
/**
 * "not_paid": the session is open or expired, so nobody paid. "pending": it is complete but Stripe
 * has not attached or cannot yet return its subscription; only this one is worth waiting for.
 */
export type WelcomeResult = "applied" | "invalid" | "mismatch" | "not_paid" | "pending" | "stale";

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export async function applyWelcome(
  deps: { stripe: BillingStripe; store: ProfileStore },
  userId: string,
  sessionId: string | null | undefined,
): Promise<WelcomeResult> {
  if (!sessionId || !SESSION_ID.test(sessionId)) return "invalid";
  const session = await deps.stripe.getCheckoutSession(sessionId);
  if (!session || session.clientReferenceId !== userId) return "mismatch";
  if (session.status !== "complete") return "not_paid";
  if (!session.subscriptionId || !session.customerId) return "pending";
  // Never over a different subscription that is still live: an old session (a bookmark, browser
  // history) cannot overwrite the current one. A returning subscriber whose old subscription
  // ended is welcomed onto the new one; the Stripe-time stamp below keeps newer state winning.
  const profile = await deps.store.getBillingProfile(userId);
  if (
    profile?.stripeSubscriptionId &&
    profile.stripeSubscriptionId !== session.subscriptionId &&
    hasLiveSubscription(profile.subscriptionStatus)
  )
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
