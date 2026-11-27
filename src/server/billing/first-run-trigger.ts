import type Stripe from "stripe";
import type { ProfileStore } from "./ports";
import { customerIdOf, isEntitled } from "./subscription";

/**
 * Starts a product's first run as soon as a Stripe webhook makes its owner entitled (the founder,
 * 26 Nov 2026), so collection does not wait for the owner to come back from Checkout or for the
 * next tick. The welcome step (src/server/auth/app-gate.ts) still asks too; the first run's dedupe
 * keys make it happen once.
 *
 * Only an entitled owner with an active product starts one. A first_run job for anyone else would
 * end "not_collectable" and use up its once-per-product dedupe key. Only the events that make an
 * owner entitled ask: checkout completed, a subscription created, or an update whose previous
 * status was not entitled. The dedupe keys live in job rows that are purged after 30 days, so a
 * later renewal must never ask.
 */
export interface FirstRunTriggerDeps {
  store: Pick<ProfileStore, "getBillingProfile" | "findUserIdByCustomerId">;
  /** The owner's product (the first one, as the app shows it), or null. */
  productFor(userId: string): Promise<{ id: string; status: string } | null>;
  startFirstRun(productId: string): Promise<void>;
}

async function ownerOf(
  event: Stripe.Event,
  store: FirstRunTriggerDeps["store"],
): Promise<string | null> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      return session.mode === "subscription" ? (session.client_reference_id ?? null) : null;
    }
    case "customer.subscription.updated": {
      // Only a move into an entitled status (incomplete to trialing, say). A renewal or a trial
      // ending is an update too, and job rows (with their dedupe keys) are purged after 30 days,
      // so any other update starting a run would start a second, paid "first run" every month.
      const before = (event.data.previous_attributes as { status?: unknown } | undefined)?.status;
      if (typeof before !== "string" || isEntitled(before)) return null;
      const sub = event.data.object;
      return (
        sub.metadata?.user_id || (await store.findUserIdByCustomerId(customerIdOf(sub.customer)))
      );
    }
    case "customer.subscription.created": {
      const sub = event.data.object;
      return (
        sub.metadata?.user_id || (await store.findUserIdByCustomerId(customerIdOf(sub.customer)))
      );
    }
    default:
      return null;
  }
}

export async function startFirstRunAfterEvent(
  event: Stripe.Event,
  deps: FirstRunTriggerDeps,
): Promise<"started" | "skipped"> {
  const userId = await ownerOf(event, deps.store);
  if (!userId) return "skipped";
  // The profile as the event left it, not the event's payload: it is what entitlement reads.
  const profile = await deps.store.getBillingProfile(userId);
  if (!isEntitled(profile?.subscriptionStatus)) return "skipped";
  const product = await deps.productFor(userId);
  if (product?.status !== "active") return "skipped";
  await deps.startFirstRun(product.id);
  return "started";
}
