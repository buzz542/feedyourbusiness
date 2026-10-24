import { z } from "zod";
import { isSameOrigin, json, readBodyText } from "@/server/http/respond";
import { BillingError, createCheckoutSession } from "./checkout";
import type { BillingConfig } from "./config";
import { BILLING_PATHS } from "./constants";
import { handleStripeEvent } from "./events";
import type { BillingStripe, ProfileStore } from "./ports";
import { hasLiveSubscription } from "./subscription";

export interface AuthedUser {
  id: string;
  email: string | null;
}

export interface BillingDeps {
  config: BillingConfig;
  stripe: BillingStripe;
  store: ProfileStore;
  getUser(): Promise<AuthedUser | null>;
  /** The pre-launch allowlist (docs/PLAN.md 12.10): keeps test-mode Checkout away from strangers. */
  isAllowed(email: string | null): boolean;
}

type Handler = (request: Request) => Promise<Response>;

/** Log the error class only. Never log request bodies, emails or Stripe payloads. */
function fail(route: string, error: unknown): Response {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[billing] ${route} failed: ${name}`);
  const status = error instanceof BillingError ? 502 : 500;
  return json(status, { error: "billing_unavailable" });
}

/** Shared checks for the cookie-authenticated routes: same origin, then signed in. */
async function authenticate(
  deps: BillingDeps,
  request: Request,
): Promise<{ user: AuthedUser } | { response: Response }> {
  if (!isSameOrigin(request, deps.config.siteUrl))
    return { response: json(403, { error: "forbidden_origin" }) };
  const user = await deps.getUser();
  if (!user) return { response: json(401, { error: "unauthenticated" }) };
  return { user };
}

export function createCheckoutHandler(deps: BillingDeps): Handler {
  return async (request) => {
    const auth = await authenticate(deps, request);
    if ("response" in auth) return auth.response;
    // Pre-launch, only invited accounts may start test-mode Checkout. Cancel and the portal stay
    // open to everyone who has a subscription: cancelling is as easy as signing up (2.4).
    if (!deps.isAllowed(auth.user.email)) return json(403, { error: "private_beta" });
    try {
      const profile = await deps.store.getBillingProfile(auth.user.id);
      // A second checkout while a subscription is live (even past_due) would double-bill.
      if (hasLiveSubscription(profile?.subscriptionStatus)) {
        return json(409, { error: "subscription_exists" });
      }
      const { url } = await createCheckoutSession({
        stripe: deps.stripe,
        config: deps.config,
        user: auth.user,
        customerId: profile?.stripeCustomerId ?? null,
      });
      return json(200, { url });
    } catch (error) {
      return fail("checkout", error);
    }
  };
}

export function createPortalHandler(deps: BillingDeps): Handler {
  return async (request) => {
    const auth = await authenticate(deps, request);
    if ("response" in auth) return auth.response;
    try {
      const profile = await deps.store.getBillingProfile(auth.user.id);
      if (!profile?.stripeCustomerId) return json(404, { error: "no_customer" });
      const { url } = await deps.stripe.createPortalSession({
        customerId: profile.stripeCustomerId,
        returnUrl: `${deps.config.siteUrl}${BILLING_PATHS.settings}`,
      });
      return json(200, { url });
    } catch (error) {
      return fail("portal", error);
    }
  };
}

const cancelBody = z.object({ action: z.enum(["cancel", "resume"]) });

/** Two-click cancellation: the Settings page posts here after one confirmation click. */
export function createCancelHandler(deps: BillingDeps): Handler {
  return async (request) => {
    const auth = await authenticate(deps, request);
    if ("response" in auth) return auth.response;

    const text = await readBodyText(request, 1_000);
    if (text === null) return json(413, { error: "payload_too_large" });
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* falls through to the schema check, which rejects null */
    }
    const parsed = cancelBody.safeParse(body);
    if (!parsed.success) return json(400, { error: "invalid_body" });

    try {
      const profile = await deps.store.getBillingProfile(auth.user.id);
      if (!profile?.stripeSubscriptionId) return json(404, { error: "no_subscription" });
      const state = await deps.stripe.setCancelAtPeriodEnd(
        profile.stripeSubscriptionId,
        parsed.data.action === "cancel",
      );
      return json(200, {
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        accessUntil: state.accessUntil,
      });
    } catch (error) {
      return fail("cancel", error);
    }
  };
}

/**
 * Stripe webhook. Needs the raw body to verify the signature, so it must not parse JSON first.
 * 400 = we will never accept this request. 500 = try again later, Stripe will redeliver.
 */
export function createWebhookHandler(deps: Pick<BillingDeps, "stripe" | "store">): Handler {
  return async (request) => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) return json(400, { error: "missing_signature" });

    // Unauthenticated until the signature checks out, so never buffer unbounded input.
    const rawBody = await readBodyText(request);
    if (rawBody === null) return json(413, { error: "payload_too_large" });
    let event;
    try {
      event = deps.stripe.verifyWebhook(rawBody, signature);
    } catch {
      return json(400, { error: "invalid_signature" });
    }

    try {
      const outcome = await handleStripeEvent(event, deps);
      return json(200, { received: true, outcome });
    } catch (error) {
      return fail("webhook", error);
    }
  };
}
