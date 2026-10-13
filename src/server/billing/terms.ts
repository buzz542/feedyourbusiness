import { TRIAL_DAYS } from "./constants";

export interface PriceTerms {
  /** Smallest currency unit, as Stripe stores it. */
  unitAmount: number;
  currency: string;
  interval: "day" | "week" | "month" | "year";
  intervalCount?: number;
}

export function formatMoney(unitAmount: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  // Stripe stores amounts in the smallest unit: cents for USD, whole yen for JPY.
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(unitAmount / 10 ** digits);
}

export function formatInterval(interval: PriceTerms["interval"], count = 1): string {
  return count === 1 ? interval : `${count} ${interval}s`;
}

/**
 * The renewal terms shown before payment (DMCC: clear price, renewal and cancellation terms up
 * front). The same wording is used on the Stripe Checkout page and in the reminder email.
 */
export function renewalTerms(price: PriceTerms, trialDays: number = TRIAL_DAYS): string {
  const amount = formatMoney(price.unitAmount, price.currency);
  const every = formatInterval(price.interval, price.intervalCount);
  return (
    `Your ${trialDays}-day trial is free. When it ends, your card is charged ${amount}, ` +
    `then every ${every} until you cancel. You can cancel online from Settings in two clicks.`
  );
}
