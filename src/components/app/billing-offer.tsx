import { CONSENT_WORDING } from "@/server/billing/consent";
import type { PriceInfo } from "@/server/billing/ports";
import { formatInterval, formatMoney, renewalTerms } from "@/server/billing/terms";
import { CheckoutForm } from "./checkout-form";

const TRIAL_DAYS = 7;

const longDate = (d: Date) =>
  d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Everything before checkout (docs/PLAN.md 2.4, 10.1): the full price with tax included, the
 * renewal terms, when the first charge happens, the reminder before it, how to cancel, and the
 * consent box. Only a tax-inclusive price is offered, so checkout never adds to it.
 */
export function BillingOffer({
  price,
  now,
  startCheckout,
}: {
  price: PriceInfo | null;
  now: Date;
  startCheckout: (consent: boolean) => Promise<{ url?: string; error?: string }>;
}) {
  if (
    !price ||
    !price.active ||
    price.unitAmount === null ||
    !price.interval ||
    price.taxBehavior !== "inclusive"
  )
    return (
      <p className="rounded-sm border border-rule p-4">
        Billing is not set up yet, so trials cannot start today. Please come back soon.
      </p>
    );
  const terms = {
    unitAmount: price.unitAmount,
    currency: price.currency,
    interval: price.interval,
    intervalCount: price.intervalCount ?? 1,
  };
  const firstCharge = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-2xl">
        {formatMoney(terms.unitAmount, terms.currency)}{" "}
        <span className="text-base text-muted">
          {formatInterval(terms.interval, terms.intervalCount)}, tax included where it applies
        </span>
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        <li>{renewalTerms(terms)}</li>
        <li>Your card is charged on {longDate(firstCharge)} unless you cancel before then.</li>
        <li>We email you at least 48 hours before the first charge.</li>
        <li>Cancel any time in Settings, in two clicks.</li>
      </ul>
      <CheckoutForm consentWording={CONSENT_WORDING} startCheckout={startCheckout} />
    </div>
  );
}
