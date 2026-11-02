import "server-only";
import { getBillingDeps } from "./deps";
import { applyWelcome } from "./welcome";

/** The welcome step from the Reply page; billing not configured means nothing to apply. */
export async function welcomeFromCheckout(userId: string, sessionId: string | undefined) {
  let deps;
  try {
    deps = getBillingDeps();
  } catch {
    return "invalid" as const;
  }
  return applyWelcome({ ...deps, now: () => new Date() }, userId, sessionId);
}
