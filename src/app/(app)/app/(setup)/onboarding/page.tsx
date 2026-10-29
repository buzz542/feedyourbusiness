import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAppUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Set up your product" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await requireAppUser("/app/onboarding");
  return (
    <>
      <h1 className="mb-6 font-serif text-3xl tracking-tight">Set up your product</h1>
      <EmptyState title="Product setup is on the way">
        You will paste your website here. We read your site, figure out who it&apos;s for and show
        you what we found. One click confirms it.
      </EmptyState>
    </>
  );
}
