import type Stripe from "stripe";
import type { BillingStripe, ProfileStore } from "./ports";
import { customerIdOf, profilePatchFromSubscription } from "./subscription";

export type EventOutcome = "processed" | "duplicate" | "ignored" | "stale";

/** The events the webhook endpoint must be registered for (docs/BILLING.md, step 5). */
export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

const HANDLED = new Set<string>(HANDLED_EVENT_TYPES);

type EventStore = Pick<
  ProfileStore,
  | "claimEvent"
  | "markEventProcessed"
  | "applyBillingPatch"
  | "findUserIdByCustomerId"
  | "recordServiceConsent"
>;

/** The consent time our checkout put in the subscription's metadata, if it is a valid time. */
export function consentFrom(metadata: Record<string, string>): Date | null {
  const raw = metadata.service_consent_at;
  if (!raw || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

export interface EventDeps {
  store: EventStore;
  stripe: Pick<BillingStripe, "getSubscription">;
}

/**
 * Apply one verified Stripe event. Safe to call repeatedly with the same event (redelivery).
 *
 * Stripe does not guarantee delivery order and event timestamps have one second resolution, so the
 * state inside a payload can be older than the state we already hold. For subscription events we
 * therefore ignore the payload's state and fetch the subscription as it is now (Stripe's own
 * recommendation). The payload is the fallback only if Stripe no longer has the subscription.
 * apply_billing_patch still drops a patch that is older than the last one applied.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  deps: EventDeps,
): Promise<EventOutcome> {
  const { store } = deps;
  if (!HANDLED.has(event.type)) return "ignored";

  const claim = await store.claimEvent(event.id, event.type);
  if (claim === "duplicate") return "duplicate";

  const eventAt = new Date(event.created * 1000);
  let outcome: EventOutcome;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.client_reference_id;
      const customerId = session.customer ? customerIdOf(session.customer) : null;
      if (session.mode !== "subscription" || !userId || !customerId) {
        outcome = "ignored";
        break;
      }
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription?.id ?? null);
      const applied = await store.applyBillingPatch(
        userId,
        {
          stripe_customer_id: customerId,
          ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
        },
        eventAt,
      );
      outcome = applied ? "processed" : "stale";
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = (await deps.stripe.getSubscription(event.data.object.id)) ?? event.data.object;
      const customerId = customerIdOf(sub.customer);
      const userId = sub.metadata.user_id || (await store.findUserIdByCustomerId(customerId));
      if (!userId) {
        // Our checkout always sets metadata.user_id, so this subscription is not ours (a Stripe CLI
        // trigger, or one made by hand in the Dashboard). Retrying could never resolve it.
        outcome = "ignored";
        break;
      }
      const applied = await store.applyBillingPatch(
        userId,
        profilePatchFromSubscription(sub),
        eventAt,
      );
      const consentAt = consentFrom(sub.metadata);
      if (consentAt) await store.recordServiceConsent(userId, consentAt);
      outcome = applied ? "processed" : "stale";
      break;
    }

    default:
      outcome = "ignored";
  }

  await store.markEventProcessed(event.id);
  return outcome;
}
