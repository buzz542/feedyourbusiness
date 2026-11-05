import "server-only";
import { getBillingDeps } from "./deps";
import { applyWelcome } from "./welcome";

/**
 * The welcome step from the Reply page; billing not configured means nothing to apply. Errors
 * from Stripe or the database reach the gate, which logs the class name only and waits for the
 * webhook instead of offering a second checkout.
 */
export async function welcomeFromCheckout(userId: string, sessionId: string | undefined) {
  let deps;
  try {
    deps = getBillingDeps();
  } catch {
    return "invalid" as const;
  }
  return applyWelcome(deps, userId, sessionId);
}
