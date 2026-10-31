import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, buttonClass } from "@/components/ui/button";
import { requireAppUser } from "@/server/auth/session";
import { loadOnboardingView } from "@/server/onboarding/wiring";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { confirmAction } from "./actions";
import { EditForm } from "./edit-form";
import { FoundSummary } from "./found-summary";
import { PasteForm } from "./paste-form";

export const metadata: Metadata = { title: "Set up your product" };
export const dynamic = "force-dynamic";
/** Reading the site (30 s) and the draft (45 s) fit with room to spare (8.3: under 2 minutes). */
export const maxDuration = 120;

/** Onboarding (docs/PLAN.md 4.3): paste one thing, see what we found, one click confirms. */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ again?: string }>;
}) {
  await requireAppUser("/app/onboarding");
  const view = await loadOnboardingView(await createSupabaseServerClient());
  if (view && view.product.status !== "draft") redirect("/app");
  const again = (await searchParams).again === "1";

  if (!view || view.terms.length === 0 || again) {
    return (
      <>
        <h1 className="font-serif text-3xl tracking-tight">Set up your product</h1>
        <p className="mt-4 max-w-prose text-muted">
          Paste your website and we read it: what it does, who it&apos;s for, its competitors and
          what people write when they need it. You check it before anything is collected.
        </p>
        <PasteForm initial={again ? (view?.product.url ?? "") : ""} />
      </>
    );
  }

  return (
    <>
      <h1 className="mb-6 font-serif text-3xl tracking-tight">Here&apos;s what we found</h1>
      <FoundSummary view={view} />
      <form action={confirmAction} className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="submit">Looks right</Button>
        <Link href="/app/onboarding?again=1" className={buttonClass("quiet")}>
          Not my product?
        </Link>
      </form>
      <details className="mt-8">
        <summary className="cursor-pointer text-sm font-medium">Change something</summary>
        <EditForm view={view} />
      </details>
    </>
  );
}
