"use server";

import { redirect } from "next/navigation";
import { deleteAccount } from "@/server/account/delete";
import { requirePage } from "@/server/auth/app-state";
import { getBillingCore } from "@/server/billing/deps";
import { createSupabaseEventSink } from "@/server/events/sink";
import { track } from "@/server/events/track";
import { createServerProfileStore } from "@/server/onboarding/deps";
import { saveProfile, type ProfileResult } from "@/server/onboarding/profile";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

const PAGE = "/app/settings";

/** Daily posts email and Monday digest on or off (docs/PLAN.md 4.7). */
export async function saveEmailPrefsAction(formData: FormData): Promise<void> {
  const { user } = await requirePage("settings", PAGE);
  const db = await createSupabaseServerClient();
  const { error } = await db
    .from("profiles")
    .update({
      email_daily: formData.get("daily") === "on",
      email_weekly: formData.get("weekly") === "on",
    })
    .eq("id", user.id);
  if (error) throw new Error("Supabase: could not save email preferences");
  redirect("/app/settings?saved=email#email");
}

/** Pause or resume collection for the confirmed product. */
export async function setPausedAction(formData: FormData): Promise<void> {
  const { state } = await requirePage("settings", PAGE);
  if (!state.product || state.product.status === "draft") redirect(PAGE);
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("set_collection_paused", {
    p_product_id: state.product.id,
    p_paused: formData.get("paused") === "1",
  });
  if (error) throw new Error("Supabase: could not change collection");
  redirect("/app/settings?saved=collection#product");
}

/** Product, terms and competitors, the same editor as onboarding. */
export async function saveSettingsProfileAction(input: unknown): Promise<ProfileResult> {
  const { state } = await requirePage("settings", PAGE);
  if (!state.product)
    return { ok: false, errors: { form: "Set up your product first, in onboarding." } };
  const store = await createServerProfileStore();
  return saveProfile(state.product.id, input, { store });
}

/** Delete the account (docs/PLAN.md 10.6): type DELETE to confirm. */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const { user } = await requirePage("settings", PAGE);
  const admin = createSupabaseAdminClient();
  const result = await deleteAccount(
    {
      async billing(userId) {
        const { data, error } = await admin
          .from("profiles")
          .select("stripe_subscription_id, subscription_status")
          .eq("id", userId)
          .maybeSingle();
        if (error) throw new Error("Supabase: could not read billing");
        return data
          ? { subscriptionId: data.stripe_subscription_id, status: data.subscription_status }
          : null;
      },
      cancelNow: (subscriptionId) => getBillingCore().stripe.cancelNow(subscriptionId),
      async deleteUser(userId) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw new Error("Supabase: could not delete the user");
      },
      async audit(entry) {
        const { error } = await admin.from("audit_log").insert(entry);
        if (error) throw new Error("Supabase: could not write the audit log");
      },
      recordEvent: () => track(createSupabaseEventSink(), "account_deleted", null, {}, new Date()),
    },
    user.id,
    formData.get("confirm"),
  );
  if (!result.ok) redirect("/app/settings?error=delete#data");
  const db = await createSupabaseServerClient();
  await db.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/?deleted=1");
}
