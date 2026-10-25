import type Stripe from "stripe";
import type { BillingConfig } from "./config";
import { BILLING_PATHS, TRIAL_DAYS } from "./constants";
import type { BillingStripe } from "./ports";
import { renewalTerms } from "./terms";

export class BillingError extends Error {
  constructor(
    readonly code: "price_unavailable" | "no_checkout_url",
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export interface CheckoutUser {
  id: string;
  email: string | null;
}

/**
 * Build and create a Stripe Checkout Session for the one plan.
 *
 * Defaults from the brief: 7-day trial, card required, renewal terms shown before payment,
 * merchant of record on. If the trial ends without a payment method the subscription cancels
 * instead of charging or lingering.
 */
export async function createCheckoutSession(args: {
  stripe: BillingStripe;
  config: BillingConfig;
  user: CheckoutUser;
  customerId: string | null;
  /** When the customer ticked the consent box (docs/PLAN.md 10.2); travels in metadata. */
  consentAt: Date;
}): Promise<{ url: string }> {
  const { stripe, config, user, customerId, consentAt } = args;

  const price = await stripe.getPrice(config.priceId);
  if (!price.active || price.unitAmount == null || !price.interval) {
    throw new BillingError("price_unavailable", "Configured price is inactive or not recurring");
  }

  const terms = renewalTerms({
    unitAmount: price.unitAmount,
    currency: price.currency,
    interval: price.interval,
    intervalCount: price.intervalCount ?? 1,
  });

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: config.priceId, quantity: 1 }],
    payment_method_collection: "always",
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      metadata: { user_id: user.id, service_consent_at: consentAt.toISOString() },
    },
    client_reference_id: user.id,
    metadata: { user_id: user.id },
    custom_text: { submit: { message: terms } },
    allow_promotion_codes: false,
    success_url: `${config.siteUrl}${BILLING_PATHS.checkoutSuccess}`,
    cancel_url: `${config.siteUrl}${BILLING_PATHS.checkoutCanceled}`,
    ...(customerId ? { customer: customerId } : user.email ? { customer_email: user.email } : {}),
    ...(config.managedPayments ? { managed_payments: { enabled: true } } : {}),
  };

  const session = await stripe.createCheckoutSession(params);
  if (!session.url) throw new BillingError("no_checkout_url", "Stripe returned no checkout URL");
  return { url: session.url };
}
