import type { PriceInfo } from "./ports";
import { formatMoney } from "./terms";

/**
 * Settings, Plan and billing (docs/PLAN.md 4.7, 10.3): the subscription in plain words, and which
 * controls apply. Pure, so every status is tested without Stripe or a database.
 */

export interface PlanProfile {
  subscriptionStatus: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
}

export interface PlanView {
  /** One or two sentences: what the plan is and what happens next. */
  summary: string;
  /** A warning shown above everything else, for a payment that did not go through. */
  banner: string | null;
  /** The date access stops if the user cancels now, for the confirm step. */
  accessUntil: string | null;
  canCancel: boolean;
  canResume: boolean;
  canUpdateCard: boolean;
  /** No subscription: offer the trial instead. */
  canStartTrial: boolean;
}

export const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** "$29 a month", or null when the price cannot be read or is not the full price. */
export function priceInWords(price: PriceInfo | null): string | null {
  if (!price || price.unitAmount === null || !price.interval) return null;
  if (price.taxBehavior !== "inclusive") return null;
  const amount = formatMoney(price.unitAmount, price.currency);
  const count = price.intervalCount ?? 1;
  return count === 1
    ? `${amount} a ${price.interval}`
    : `${amount} every ${count} ${price.interval}s`;
}

const NONE: Omit<PlanView, "summary"> = {
  banner: null,
  accessUntil: null,
  canCancel: false,
  canResume: false,
  canUpdateCard: false,
  canStartTrial: false,
};

export function describePlan(profile: PlanProfile, price: PriceInfo | null): PlanView {
  const amount = priceInWords(price);
  const status = profile.subscriptionStatus;
  const card = profile.hasCustomer;

  if (status === "trialing") {
    const end = profile.trialEnd ?? profile.currentPeriodEnd;
    const when = end ? longDate(end) : null;
    if (profile.cancelAtPeriodEnd) {
      return {
        ...NONE,
        summary: when
          ? `Trial canceled. You keep access until ${when} and will not be charged.`
          : "Trial canceled. You will not be charged.",
        accessUntil: end,
        canResume: true,
        canUpdateCard: card,
      };
    }
    const then = amount ? ` Then ${amount}.` : "";
    return {
      ...NONE,
      summary: when ? `Trial ends ${when}.${then}` : `You are on the free trial.${then}`,
      accessUntil: end,
      canCancel: true,
      canUpdateCard: card,
    };
  }

  if (status === "active") {
    const end = profile.currentPeriodEnd;
    const when = end ? longDate(end) : null;
    if (profile.cancelAtPeriodEnd) {
      return {
        ...NONE,
        summary: when
          ? `Subscription canceled. You keep access until ${when} and will not be charged again.`
          : "Subscription canceled. You will not be charged again.",
        accessUntil: end,
        canResume: true,
        canUpdateCard: card,
      };
    }
    const renews = when ? `Renews on ${when}` : "Renews automatically";
    return {
      ...NONE,
      summary: amount ? `${renews} at ${amount}.` : `${renews}.`,
      accessUntil: end,
      canCancel: true,
      canUpdateCard: card,
    };
  }

  if (status === "past_due" || status === "unpaid") {
    return {
      ...NONE,
      summary:
        status === "past_due"
          ? "Your last payment did not go through. Stripe will try again."
          : "Your subscription is unpaid, so collection has stopped.",
      banner:
        "Your last payment did not go through. Update your card to keep using AskedFor. " +
        "Until then, your feed is paused.",
      // Cancelling stops further attempts to charge a card that keeps failing.
      accessUntil: profile.currentPeriodEnd,
      canCancel: !profile.cancelAtPeriodEnd,
      canResume: profile.cancelAtPeriodEnd,
      canUpdateCard: card,
    };
  }

  if (status === "paused") {
    return {
      ...NONE,
      summary: "Your subscription is paused. Update your card to restart it.",
      canUpdateCard: card,
    };
  }

  // canceled, incomplete, incomplete_expired, or never subscribed.
  return {
    ...NONE,
    summary: status === "canceled" ? "Your subscription has ended." : "You have no plan yet.",
    canStartTrial: true,
  };
}
