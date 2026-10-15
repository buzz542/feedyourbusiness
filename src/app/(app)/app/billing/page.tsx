import type { Metadata } from "next";
import { requirePage } from "@/server/auth/app-state";

export const metadata: Metadata = { title: "Start your trial" };

export default async function BillingPage() {
  await requirePage("billing", "/app/billing");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-serif text-3xl tracking-tight">Start your trial</h1>
      <p className="mt-2 text-muted">
        Your product is set up. Start the trial to begin collecting posts.
      </p>
    </div>
  );
}
