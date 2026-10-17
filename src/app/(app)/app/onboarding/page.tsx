import type { Metadata } from "next";
import { ReviewForm } from "@/components/app/onboarding/review-form";
import { UrlStep } from "@/components/app/onboarding/url-step";
import { requirePage } from "@/server/auth/app-state";
import { loadDraftView } from "@/server/onboarding/load-draft";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Set up your product" };

// The draft action runs inside this page's function and may take up to two minutes (4.3).
export const maxDuration = 150;

/**
 * Onboarding (docs/PLAN.md 4.3): the URL step until a draft exists (or the user starts again), then
 * the review step where every field is editable and the user confirms.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { state } = await requirePage("onboarding", "/app/onboarding");
  const { step, saved } = await searchParams;
  const loaded = state.product
    ? await loadDraftView(await createSupabaseServerClient(), state.product.id)
    : null;
  const hasDraft = !!loaded && loaded.view.terms.length > 0;

  if (!loaded || !hasDraft || step === "url") {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-serif text-3xl tracking-tight">Set up your product</h1>
        <p className="mt-2 text-muted">
          Paste your product&apos;s web address. AskedFor reads that one page and drafts a profile,
          search terms and competitors for you to review.
        </p>
        {hasDraft ? (
          <p className="mt-2 text-sm text-muted">A new draft replaces your current one.</p>
        ) : null}
        <UrlStep initialUrl={loaded?.url ?? ""} hasDraft={hasDraft} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl tracking-tight">Review your profile</h1>
      <p className="mt-2 text-muted">
        This is what AskedFor drafted from {new URL(loaded.url).hostname}. Change anything that is
        off, then confirm.
      </p>
      <ReviewForm key={loaded.updatedAt} draft={loaded.view} saved={saved === "1"} />
    </div>
  );
}
