import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAppUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Start your trial" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  await requireAppUser("/app/billing");
  return (
    <>
      <h1 className="mb-6 font-serif text-3xl tracking-tight">Start your trial</h1>
      <EmptyState title="Billing is on the way">
        The price, renewal terms and how to cancel will be shown here before you start a trial.
      </EmptyState>
    </>
  );
}
