import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAppUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Layouts do not re-run on client navigation, so each page checks for itself.
  await requireAppUser("/app/settings");
  return (
    <>
      <h1 className="mb-6 font-serif text-3xl tracking-tight">Settings</h1>
      <EmptyState title="Settings are on the way">
        Plan and billing, email, your product, search terms, competitors and your data will be
        managed here.
      </EmptyState>
    </>
  );
}
