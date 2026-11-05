import "server-only";
import { redirect } from "next/navigation";
import { welcomeFromCheckout } from "@/server/billing/welcome-server";
import { ensureFirstRun } from "@/server/pipeline/first-run-server";
import { loadReplyProduct } from "@/server/store/feed-supabase";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { loadAccount } from "./account";
import { gateAppPage, type GateInput } from "./app-gate";
import type { AuthUser } from "./ports";
import { requireAppUser } from "./session";

/**
 * Entitlement on every app data page (docs/PLAN.md 10.4): anyone not entitled goes to the step
 * they are on (terms, onboarding, billing, or Settings for a past-due account). Back from Checkout
 * (`welcome`), the welcome step runs first (7.3). The rules are `gateAppPage`, tested with fakes.
 * Collection checks entitlement itself (`collectable_products`).
 */
export async function requireEntitledUser(
  path: string,
  welcome?: GateInput["welcome"],
): Promise<AuthUser | "confirming"> {
  let user: AuthUser | null = null;
  const outcome = await gateAppPage(
    {
      requireUser: async (p) => (user = await requireAppUser(p)),
      loadAccount,
      applyWelcome: welcomeFromCheckout,
      async startFirstRun(userId) {
        const product = await loadReplyProduct(await createSupabaseServerClient(), userId);
        if (product) await ensureFirstRun(product.id);
      },
      logError: (message) => console.error(message),
    },
    { path, ...(welcome ? { welcome } : {}) },
  );
  if (outcome.kind === "redirect") redirect(outcome.to);
  if (outcome.kind === "confirming") return "confirming";
  return user!;
}
