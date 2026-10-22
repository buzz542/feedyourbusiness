import { isEntitled } from "@/server/billing/subscription";

/**
 * Where `/app` sends a signed-in user (docs/PLAN.md 4.2, 4.3): terms first, then onboarding until
 * the product is confirmed, then billing until the account is entitled, then Reply. A `past_due`
 * account goes to Settings to update its card: it still has a live subscription, so a second
 * checkout would be refused.
 */
export interface AccountState {
  termsAcceptedAt: Date | null;
  product: { status: "draft" | "active" | "paused" | string } | null;
  subscriptionStatus: string | null;
}

export type AppStep =
  "/app/terms" | "/app/onboarding" | "/app/billing" | "/app/settings" | "/app/reply";

export function nextStepFor(state: AccountState): AppStep {
  if (!state.termsAcceptedAt) return "/app/terms";
  if (!state.product || state.product.status === "draft") return "/app/onboarding";
  if (isEntitled(state.subscriptionStatus)) return "/app/reply";
  if (state.subscriptionStatus === "past_due") return "/app/settings";
  return "/app/billing";
}

/**
 * The terms and 18+ confirmations come before any other app page (docs/PLAN.md 4.3). Returns where
 * to send the user, or null to render the page. An unknown path is gated, never let through.
 */
export function termsGate(pathname: string | null, termsAcceptedAt: Date | null): string | null {
  if (termsAcceptedAt) return null;
  return pathname === "/app/terms" ? null : "/app/terms";
}

/** Request header the proxy sets so server layouts know the path they render. */
export const PATH_HEADER = "x-askedfor-path";
