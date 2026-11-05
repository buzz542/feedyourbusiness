import { CONSENT_WORDING } from "@/server/billing/consent";
import { ADVERTISED_PRICE, TRIAL_DAYS } from "@/server/billing/constants";
import { priceInWords } from "@/server/billing/plan-status";
import type { PriceInfo } from "@/server/billing/ports";
import { renewalTerms } from "@/server/billing/terms";
import { ChargeDate } from "./charge-date";
import { CheckoutForm } from "./checkout-form";

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
    price.taxBehavior !== "inclusive" ||
    price.unitAmount !== ADVERTISED_PRICE.unitAmount ||
    price.currency !== ADVERTISED_PRICE.currency ||
    price.interval !== ADVERTISED_PRICE.interval
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
        {priceInWords(price)}
        <span className="text-base text-muted">, tax included where it applies</span>
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        <li>{renewalTerms(terms)}</li>
        <li>
          Your card is charged on <ChargeDate iso={firstCharge.toISOString()} /> unless you cancel
          before then.
        </li>
        <li>We email you at least 48 hours before the first charge.</li>
        <li>Cancel any time in Settings, in two clicks.</li>
      </ul>
      <CheckoutForm consentWording={CONSENT_WORDING} startCheckout={startCheckout} />
    </div>
  );
}
