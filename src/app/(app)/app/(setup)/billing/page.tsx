import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BillingOffer } from "@/components/app/billing-offer";
import { loadAccount } from "@/server/auth/account";
import { nextStepFor } from "@/server/auth/next-step";
import { requireAppUser } from "@/server/auth/session";
import { getBillingDeps } from "@/server/billing/deps";
import type { PriceInfo } from "@/server/billing/ports";
import { startCheckout } from "./actions";

export const metadata: Metadata = { title: "Start your trial" };
export const dynamic = "force-dynamic";

/** Start the trial (docs/PLAN.md 10.1): the full terms and the consent box before Checkout. */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAppUser("/app/billing");
  const step = nextStepFor(await loadAccount(user.id));
  if (step !== "/app/billing") redirect(step);
  let price: PriceInfo | null = null;
  try {
    const deps = getBillingDeps();
    price = await deps.stripe.getPrice(deps.config.priceId);
  } catch {
    price = null;
  }
  const canceled = (await searchParams).checkout === "canceled";
  return (
    <>
      <h1 className="mb-6 font-serif text-3xl tracking-tight">Start your trial</h1>
      {canceled ? (
        <p className="mb-4 text-sm text-muted">Checkout was canceled. Nothing was charged.</p>
      ) : null}
      <BillingOffer price={price} now={new Date()} startCheckout={startCheckout} />
    </>
  );
}
