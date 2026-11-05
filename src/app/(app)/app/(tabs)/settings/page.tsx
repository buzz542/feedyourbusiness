import type { Metadata } from "next";
import { AccountData } from "@/components/app/account-data";
import { EmailPreferences } from "@/components/app/email-preferences";
import { PlanBilling } from "@/components/app/plan-billing";
import { requireAppUser } from "@/server/auth/session";
import { loadEmailPreferences, loadPlanPrice, loadPlanProfile } from "@/server/billing/plan-load";
import { describePlan } from "@/server/billing/plan-status";
import { deleteMyAccount, openCardPortal, setCancellation, setEmailPreference } from "./actions";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings (docs/PLAN.md 4.7). Open to every signed-in user who accepted the terms, entitled or
 * not, because a past-due account comes here to fix its card and anyone must be able to cancel.
 */
export default async function SettingsPage() {
  // Layouts do not re-run on client navigation, so each page checks for itself.
  const user = await requireAppUser("/app/settings");
  const [profile, price, email] = await Promise.all([
    loadPlanProfile(user.id),
    loadPlanPrice(),
    loadEmailPreferences(user.id),
  ]);
  return (
    <>
      <h1 className="mb-6 font-serif text-3xl tracking-tight">Settings</h1>
      <div className="flex flex-col gap-10">
        <PlanBilling
          view={describePlan(profile, price)}
          setCancellation={setCancellation}
          openCardPortal={openCardPortal}
        />
        <EmailPreferences
          daily={email.daily}
          weekly={email.weekly}
          setEmailPreference={setEmailPreference}
        />
        <AccountData deleteMyAccount={deleteMyAccount} />
      </div>
    </>
  );
}
