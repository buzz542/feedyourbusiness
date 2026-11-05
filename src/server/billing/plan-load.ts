import "server-only";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { getBillingDeps } from "./deps";
import type { PlanProfile } from "./plan-status";
import type { PriceInfo } from "./ports";

class PlanLoadError extends Error {
  override name = "PlanLoadError";
  constructor(readonly code: string | undefined) {
    super("Could not load the plan");
  }
}

/** The signed-in user's own billing columns, through RLS (the user-scoped client). */
export async function loadPlanProfile(userId: string): Promise<PlanProfile> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "subscription_status, trial_end, current_period_end, cancel_at_period_end, stripe_customer_id",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new PlanLoadError(error.code);
  return {
    subscriptionStatus: data?.subscription_status ?? null,
    trialEnd: data?.trial_end ?? null,
    currentPeriodEnd: data?.current_period_end ?? null,
    cancelAtPeriodEnd: data?.cancel_at_period_end ?? false,
    hasCustomer: data?.stripe_customer_id != null,
  };
}

/** The plan's price from Stripe, or null when billing is not configured or Stripe is down. */
export async function loadPlanPrice(): Promise<PriceInfo | null> {
  try {
    const deps = getBillingDeps();
    return await deps.stripe.getPrice(deps.config.priceId);
  } catch (error) {
    console.error(
      `[billing] price lookup failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return null;
  }
}

/** The two email lists the user can turn on or off (docs/PLAN.md 4.7, 11). */
export async function loadEmailPreferences(
  userId: string,
): Promise<{ daily: boolean; weekly: boolean }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("email_daily, email_weekly")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new PlanLoadError(error.code);
  return { daily: data?.email_daily ?? true, weekly: data?.email_weekly ?? true };
}
