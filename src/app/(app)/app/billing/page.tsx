import type { Metadata } from "next";
import { StartTrial } from "@/components/app/billing/start-trial";
import { requirePage } from "@/server/auth/app-state";
import { CONSENT_TEXT } from "@/server/billing/consent";
import { REMINDER_HOURS_BEFORE_CHARGE, TRIAL_DAYS } from "@/server/billing/constants";
import { getBillingCore } from "@/server/billing/deps";
import type { PriceInfo } from "@/server/billing/ports";
import { formatMoney, renewalTerms } from "@/server/billing/terms";

export const metadata: Metadata = { title: "Start your trial" };

async function loadPrice(): Promise<PriceInfo | null> {
  try {
    const { stripe, config } = getBillingCore();
    const price = await stripe.getPrice(config.priceId);
    return price.active && price.unitAmount != null && price.interval ? price : null;
  } catch (error) {
    console.error(
      `[billing] price unavailable: ${error instanceof Error ? error.name : "Unknown"}`,
    );
    return null;
  }
}

/** When the first charge happens if the trial starts now. */
function firstChargeLabel(): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "Europe/London" }).format(
    new Date(Date.now() + TRIAL_DAYS * 86_400_000),
  );
}

/**
 * Before checkout (docs/PLAN.md 10.1, 2.4): the full price, tax included where it applies, the
 * renewal terms, when the first charge happens, the reminder before it, how to cancel, and the
 * consent box. Read from Stripe, so the page always shows the price Checkout charges.
 */
export default async function BillingPage() {
  await requirePage("billing", "/app/billing");
  const price = await loadPrice();
  const firstCharge = firstChargeLabel();

  if (!price || !price.interval || price.unitAmount == null) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-serif text-3xl tracking-tight">Start your trial</h1>
        <p className="mt-4 text-muted">
          Checkout is not available right now. Try again later, or contact us if this keeps
          happening.
        </p>
      </div>
    );
  }
  const amount = formatMoney(price.unitAmount, price.currency);
  const terms = renewalTerms({
    unitAmount: price.unitAmount,
    currency: price.currency,
    interval: price.interval,
    intervalCount: price.intervalCount ?? 1,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl tracking-tight">Start your trial</h1>
        <p className="mt-2 text-muted">
          Your product is set up. Start the free trial to begin collecting posts.
        </p>
      </div>

      <section className="rounded-[2px] border border-rule p-5" aria-labelledby="price">
        <h2 id="price" className="font-serif text-2xl tracking-tight">
          {amount} a {price.interval}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {price.taxBehavior === "inclusive"
            ? "Tax included where it applies. This is the full price."
            : "Sales tax or VAT is added where it applies; checkout shows the full total before you pay."}
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          <li>{terms}</li>
          <li>
            Free for {TRIAL_DAYS} days. Your card is first charged on {firstCharge}, unless you
            cancel before then.
          </li>
          <li>
            We email you at least {REMINDER_HOURS_BEFORE_CHARGE} hours before the first charge.
          </li>
          <li>
            To cancel, open Settings, choose Cancel subscription, then confirm. That is two clicks.
          </li>
          <li>A card is required to start the trial. Payment is handled by Stripe.</li>
        </ul>
      </section>

      <StartTrial consentText={CONSENT_TEXT} />
    </div>
  );
}
