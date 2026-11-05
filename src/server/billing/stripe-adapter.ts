import "server-only";
import Stripe from "stripe";
import type { BillingConfig } from "./config";
import type { BillingStripe, PriceInfo } from "./ports";

const iso = (unixSeconds: number | undefined): string | null =>
  unixSeconds == null ? null : new Date(unixSeconds * 1000).toISOString();

const INTERVALS = ["day", "week", "month", "year"] as const;

/** The only file that talks to the Stripe SDK. Everything else uses the BillingStripe port. */
export function createStripeAdapter(config: BillingConfig): BillingStripe {
  const stripe = new Stripe(config.secretKey, {
    maxNetworkRetries: 2,
    appInfo: { name: "AskedFor" },
  });

  return {
    async getPrice(priceId): Promise<PriceInfo> {
      const price = await stripe.prices.retrieve(priceId);
      return {
        active: price.active,
        unitAmount: price.unit_amount,
        currency: price.currency,
        interval: INTERVALS.find((i) => i === price.recurring?.interval) ?? null,
        intervalCount: price.recurring?.interval_count ?? null,
        taxBehavior:
          price.tax_behavior === "inclusive"
            ? "inclusive"
            : price.tax_behavior === "exclusive"
              ? "exclusive"
              : "unspecified",
      };
    },

    async listWebhookEndpoints() {
      const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
      return endpoints.data.map((e) => ({
        url: e.url,
        status: e.status,
        enabledEvents: e.enabled_events,
      }));
    },

    async countUndeliveredEvents({ since, types }) {
      const page = await stripe.events.list({
        delivery_success: false,
        created: { gte: Math.floor(since.getTime() / 1000) },
        types: [...types],
        limit: 100,
      });
      return page.data.length;
    },

    async getSubscription(subscriptionId) {
      try {
        return await stripe.subscriptions.retrieve(subscriptionId);
      } catch (error) {
        const missing =
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.code === "resource_missing";
        if (missing) return null;
        throw error;
      }
    },

    async getCheckoutSession(sessionId) {
      try {
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        const id = (v: string | { id: string } | null) =>
          typeof v === "string" ? v : (v?.id ?? null);
        return {
          clientReferenceId: s.client_reference_id,
          customerId: id(s.customer),
          subscriptionId: id(s.subscription),
          status: (["open", "complete", "expired"] as const).find((v) => v === s.status) ?? null,
          created: new Date(s.created * 1000),
        };
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError) return null;
        throw error;
      }
    },

    async createCheckoutSession(params) {
      const session = await stripe.checkout.sessions.create(params);
      return { url: session.url };
    },

    async createPortalSession({ customerId, returnUrl }) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },

    async setCancelAtPeriodEnd(subscriptionId, cancel) {
      const sub = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: cancel,
      });
      return {
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        status: sub.status,
        accessUntil: iso(sub.items.data[0]?.current_period_end),
      };
    },

    async cancelNow(subscriptionId) {
      try {
        await stripe.subscriptions.cancel(subscriptionId);
      } catch (error) {
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
        // Already canceled, or gone: fine only if Stripe confirms it will never bill again.
        const sub = await stripe.subscriptions.retrieve(subscriptionId).catch(() => null);
        if (sub && sub.status !== "canceled" && sub.status !== "incomplete_expired") throw error;
      }
    },

    async previewNextInvoiceTotal(subscriptionId) {
      try {
        const invoice = await stripe.invoices.createPreview({ subscription: subscriptionId });
        return { total: invoice.total, currency: invoice.currency };
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError) return null;
        throw error;
      }
    },

    verifyWebhook(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
    },
  };
}
