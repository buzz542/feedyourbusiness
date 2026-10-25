import { formatInterval, formatMoney, type PriceTerms } from "./terms";

/**
 * Settings, Plan and billing (docs/PLAN.md 4.7, 10.3): the subscription in plain words, with dates,
 * and which actions apply. Pure, so every status is tested.
 */

export interface PlanProfile {
  subscriptionStatus: string | null;
  trialEnd: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface PlanStatus {
  headline: string;
  detail: string | null;
  /** Shown as a banner: a failed payment needs a new card. */
  pastDue: boolean;
  canCancel: boolean;
  canResume: boolean;
  canUpdateCard: boolean;
  /** When access stops if the user cancels now (the confirm step states it). */
  accessUntil: Date | null;
  /** No live subscription: offer the trial. */
  canStart: boolean;
}

const day = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "Europe/London" }).format(d);

export function planStatus(profile: PlanProfile, price: PriceTerms | null): PlanStatus {
  const amount = price
    ? `${formatMoney(price.unitAmount, price.currency)} a ${formatInterval(price.interval, price.intervalCount)}`
    : null;
  const base = {
    pastDue: false,
    canCancel: false,
    canResume: false,
    canUpdateCard: false,
    accessUntil: null as Date | null,
    canStart: false,
  };
  const s = profile.subscriptionStatus;
  const end = s === "trialing" ? profile.trialEnd : profile.currentPeriodEnd;

  if (s === "trialing" || s === "active") {
    if (profile.cancelAtPeriodEnd)
      return {
        ...base,
        headline: end ? `Canceled. You have access until ${day(end)}.` : "Canceled.",
        detail: "You will not be charged again. You can resume before then.",
        canResume: true,
        canUpdateCard: true,
        accessUntil: end,
      };
    const headline =
      s === "trialing"
        ? end
          ? `Trial ends ${day(end)}.${amount ? ` Then ${amount}.` : ""}`
          : "Free trial."
        : end
          ? `Active. Renews ${day(end)}.${amount ? ` ${amount}.` : ""}`
          : "Active.";
    return {
      ...base,
      headline,
      detail: "Cancel any time: two clicks, here.",
      canCancel: true,
      canUpdateCard: true,
      accessUntil: end,
    };
  }
  if (s === "past_due" || s === "unpaid")
    return {
      ...base,
      headline: "Your last payment did not go through.",
      detail: "Update your card to keep AskedFor running.",
      pastDue: true,
      canCancel: true,
      canUpdateCard: true,
      accessUntil: profile.currentPeriodEnd,
    };
  return {
    ...base,
    headline: s === "canceled" ? "Your subscription has ended." : "No subscription yet.",
    detail: "Start the free trial to collect posts.",
    canStart: true,
  };
}
