import "server-only";
import { redirect } from "next/navigation";
import { loadAccount } from "./account";
import { nextStepFor } from "./next-step";
import { requireAppUser } from "./session";

/**
 * Entitlement on every app data page (docs/PLAN.md 10.4): anyone not entitled goes to the step
 * they are on (terms, onboarding, billing, or Settings for a past-due account). Collection checks
 * entitlement itself (`collectable_products`).
 */
export async function requireEntitledUser(path: string) {
  const user = await requireAppUser(path);
  const step = nextStepFor(await loadAccount(user.id));
  if (step !== "/app/reply") redirect(step);
  return user;
}
