"use server";

import { redirect } from "next/navigation";
import { accountDeletionDeps } from "@/server/account/account-server";
import { deleteAccount } from "@/server/account/delete-account";
import { requireAppUser } from "@/server/auth/session";
import { createSupabaseAuthGateway } from "@/server/auth/supabase-auth";
import { getBillingDeps } from "@/server/billing/deps";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { createCancelHandler, createPortalHandler } from "@/server/billing/handlers";

export interface PlanActionResult {
  cancelAtPeriodEnd?: boolean;
  accessUntil?: string | null;
  url?: string;
  error?: string;
}

/**
 * Settings, Plan and billing (docs/PLAN.md 10.3). Each action runs the route handler itself, so
 * every rule holds here too (signed in, own subscription only); server actions also get Next's
 * origin check (12.2).
 */
async function run(
  make: typeof createCancelHandler,
  path: string,
  body?: unknown,
): Promise<PlanActionResult> {
  let deps;
  try {
    deps = getBillingDeps();
  } catch {
    return { error: "billing_unavailable" };
  }
  const site = deps.config.siteUrl;
  const response = await make(deps)(
    new Request(`${site}${path}`, {
      method: "POST",
      headers: { origin: site, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const result = (await response.json()) as PlanActionResult;
  return response.ok ? result : { error: result.error ?? "billing_unavailable" };
}

export async function setCancellation(action: "cancel" | "resume"): Promise<PlanActionResult> {
  if (action !== "cancel" && action !== "resume") return { error: "invalid_body" };
  return run(createCancelHandler, "/api/billing/cancel", { action });
}

export async function openCardPortal(): Promise<PlanActionResult> {
  return run(createPortalHandler, "/api/billing/portal");
}

/**
 * Delete the account (docs/PLAN.md 4.7, 10.6): the user typed DELETE. Cancels the subscription at
 * once, deletes every owned row, then signs out. Errors are logged by class only.
 */
export async function deleteMyAccount(typed: string): Promise<{ error?: string }> {
  const user = await requireAppUser("/app/settings");
  let outcome;
  try {
    outcome = await deleteAccount(accountDeletionDeps(), user.id, String(typed));
  } catch (error) {
    console.error(
      `[account] delete failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
    return { error: "delete_failed" };
  }
  if (outcome === "confirmation_mismatch") return { error: "confirmation_mismatch" };
  try {
    // The auth user is gone; this clears the session cookies in the browser.
    await (await createSupabaseAuthGateway()).signOut();
  } catch {
    /* the session no longer has a user; the cookies expire on their own */
  }
  redirect("/?account=deleted");
}

/** Email preferences (4.7): the user's own two columns, through RLS and the column grants. */
export async function setEmailPreference(
  list: "daily" | "weekly",
  on: boolean,
): Promise<{ ok: boolean }> {
  const user = await requireAppUser("/app/settings");
  if (list !== "daily" && list !== "weekly") return { ok: false };
  const patch = list === "daily" ? { email_daily: on === true } : { email_weekly: on === true };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  return { ok: !error };
}
