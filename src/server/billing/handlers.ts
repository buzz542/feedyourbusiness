import type Stripe from "stripe";
import { z } from "zod";
import { isConfirmedProduct, type AccountState } from "@/server/auth/next-step";
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
  /** The signed-in user's terms acceptance and product, read through RLS (the user's own client). */
  getAccount(userId: string): Promise<AccountState>;
  now?: () => Date;
}

type Handler = (request: Request) => Promise<Response>;

/** A short token: letters, digits, dots, underscores, brackets and dashes, so it can carry no free text. */
const SAFE_TOKEN = /^[A-Za-z0-9_.[\]-]{1,80}$/;

/**
 * What Stripe's own errors say about a refusal, without the message (which can echo ids or an
 * email): the error type, its code and the parameter it objects to, each kept only when it is a
 * short token. Enough to tell "managed_payments is not enabled" from "no such price".
 */
function stripeDetail(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const read = (key: string): string | null => {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === "string" && SAFE_TOKEN.test(value) ? value : null;
  };
  const parts = [
    ["type", read("type")],
    ["code", read("code")],
    ["param", read("param")],
  ].filter((part): part is [string, string] => part[1] !== null);
  return parts.length ? ` (${parts.map(([k, v]) => `${k} ${v}`).join(", ")})` : "";
}

/** Log the error class, and Stripe's type, code and parameter. Never request bodies, emails or payloads. */
function fail(route: string, error: unknown): Response {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[billing] ${route} failed: ${name}${stripeDetail(error)}`);
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
      // The app pages send people through the 18+ and terms step and onboarding first, but this
      // route can be called directly, so it checks both itself, with the same rule as /app
      // (docs/PLAN.md 4.3). It keeps the steps in order; it is not a trust boundary, because a
      // signed-in user can write both columns on their own rows.
      const account = await deps.getAccount(auth.user.id);
      if (!account.termsAccepted) return json(403, { error: "terms_not_accepted" });
      if (!isConfirmedProduct(account.product)) {
        return json(403, { error: "product_not_confirmed" });
      }
      const profile = await deps.store.getBillingProfile(auth.user.id);
      // A second checkout while a subscription is live (even past_due) would double-bill.
      if (hasLiveSubscription(profile?.subscriptionStatus)) {
        return json(409, { error: "subscription_exists" });
      }
      // Our copy can lag the webhook (a second tab, a slow event): ask Stripe as well.
      if (
        profile?.stripeCustomerId &&
        (await deps.stripe.liveSubscriptionIds(profile.stripeCustomerId)).length > 0
      ) {
        return json(409, { error: "subscription_exists" });
      }
      // The consent box on /app/billing (10.2): checkout starts only with it checked.
      const text = await readBodyText(request, 1_000);
      if (text === null) return json(413, { error: "payload_too_large" });
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* falls through to the schema check, which rejects null */
      }
      if (!checkoutBody.safeParse(body).success) return json(400, { error: "consent_required" });
      const { url } = await createCheckoutSession({
        consentAt: deps.now?.() ?? new Date(),
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
const checkoutBody = z.object({ consent: z.literal(true) });

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
      // A failed payment has no paid period left to keep: canceling at the period end would let
      // Stripe keep retrying the card, so it ends now (10.3).
      if (
        parsed.data.action === "cancel" &&
        (profile.subscriptionStatus === "past_due" || profile.subscriptionStatus === "unpaid")
      ) {
        await deps.stripe.cancelNow(profile.stripeSubscriptionId);
        return json(200, { cancelAtPeriodEnd: false, ended: true, accessUntil: null });
      }
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
export function createWebhookHandler(
  deps: Pick<BillingDeps, "stripe" | "store"> & {
    /**
     * Runs once for each event this delivery applied (outcome "processed"), after it is applied:
     * the first run starts here (first-run-trigger.ts). A failure is logged by class and never
     * fails the delivery; the welcome step asks for the first run again.
     */
    afterEvent?: (event: Stripe.Event) => Promise<unknown>;
  },
): Handler {
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
      if (outcome === "processed" && deps.afterEvent) {
        try {
          await deps.afterEvent(event);
        } catch (error) {
          const name = error instanceof Error ? error.name : "UnknownError";
          console.error(`[billing] first run not started: ${name}`);
        }
      }
      return json(200, { received: true, outcome });
    } catch (error) {
      return fail("webhook", error);
    }
  };
}
