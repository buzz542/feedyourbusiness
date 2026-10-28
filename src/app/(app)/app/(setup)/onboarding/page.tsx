import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/server/auth/session";
import { getOnboardingStore } from "@/server/onboarding/deps";
import { MAX_COMPETITORS, MAX_TERMS } from "@/server/onboarding/review";
import { ReviewForm } from "./review-form";
import { UrlStep } from "./url-step";

export const metadata: Metadata = { title: "Set up your product" };
export const dynamic = "force-dynamic";
// The draft may take up to its 120 second budget (docs/PLAN.md 4.3); server actions on this page
// run under this limit.
export const maxDuration = 150;

/**
 * Onboarding (docs/PLAN.md 4.3): the product URL, then the draft to review and confirm. Nothing is
 * collected until the product is confirmed, and only for an entitled account.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAppUser("/app/onboarding");
  const product = await (await getOnboardingStore()).loadReview(user.id);
  if (product && product.status !== "draft") redirect("/app");

  const params = await searchParams;
  // A product row exists from the moment drafting starts; it has a draft once fields are filled.
  const drafted =
    product !== null &&
    (product.terms.length > 0 || product.oneLiner !== "" || product.description !== "");

  if (drafted && params.step !== "url") {
    return (
      <>
        <p className="text-sm text-muted">Step 2 of 2</p>
        <h1 className="mt-1 font-serif text-3xl tracking-tight">Check your draft</h1>
        <p className="mt-4 max-w-prose text-muted">
          Edit anything that is off, then confirm. Nothing is collected until you confirm and start
          your trial.
        </p>
        <ReviewForm product={product} limits={{ terms: MAX_TERMS, competitors: MAX_COMPETITORS }} />
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-muted">Step 1 of 2</p>
      <h1 className="mt-1 font-serif text-3xl tracking-tight">Set up your product</h1>
      <p className="mt-4 max-w-prose text-muted">
        Paste your product&apos;s web address. We draft its search terms, competitors and subreddits
        for you to check.
      </p>
      <UrlStep initialUrl={product?.url ?? ""} />
    </>
  );
}
