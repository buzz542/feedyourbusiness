import { hasLiveSubscription, isEntitled } from "@/server/billing/subscription";

/**
 * Where a signed-in person belongs (docs/PLAN.md 4.2): the confirmations, then onboarding, then
 * billing, then the Reply tab. Pure, so every case is unit tested; pages call gateFor() and
 * redirect when it returns a path.
 */

export interface AppState {
  termsAccepted: boolean;
  /** One product per account (D9). Null before onboarding starts. */
  product: { id: string; name: string; status: "draft" | "active" | "paused" } | null;
  subscriptionStatus: string | null;
}

export type Step = "welcome" | "onboarding" | "billing" | "fix_payment" | "ready";

export const STEP_PATHS: Readonly<Record<Step, string>> = {
  welcome: "/app/welcome",
  onboarding: "/app/onboarding",
  billing: "/app/billing",
  // past_due and unpaid keep a live subscription: a second checkout would double-bill, so the
  // way forward is updating the card in Settings (docs/PLAN.md 10.3).
  fix_payment: "/app/settings",
  ready: "/app/reply",
};

export function nextStepFor(state: AppState): { step: Step; path: string } {
  const step: Step = !state.termsAccepted
    ? "welcome"
    : !state.product || state.product.status === "draft"
      ? "onboarding"
      : isEntitled(state.subscriptionStatus)
        ? "ready"
        : hasLiveSubscription(state.subscriptionStatus)
          ? "fix_payment"
          : "billing";
  return { step, path: STEP_PATHS[step] };
}

export type AppPage =
  "welcome" | "onboarding" | "billing" | "settings" | "reply" | "rivals" | "build";

/** Null when the page may render, otherwise where to send the person instead. */
export function gateFor(page: AppPage, state: AppState): string | null {
  const next = nextStepFor(state);
  if (page === "welcome") return next.step === "welcome" ? null : "/app";
  if (next.step === "welcome") return next.path;

  switch (page) {
    case "settings":
      return null;
    case "onboarding":
      return next.step === "onboarding" ? null : "/app";
    case "billing":
      if (next.step === "onboarding") return next.path;
      return next.step === "billing" ? null : "/app";
    case "reply":
    case "rivals":
    case "build":
      return next.step === "ready" ? null : next.path;
  }
}
