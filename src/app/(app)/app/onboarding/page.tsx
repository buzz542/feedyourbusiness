import type { Metadata } from "next";
import { requirePage } from "@/server/auth/app-state";

export const metadata: Metadata = { title: "Set up your product" };

export default async function OnboardingPage() {
  await requirePage("onboarding", "/app/onboarding");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-serif text-3xl tracking-tight">Set up your product</h1>
      <p className="mt-2 text-muted">
        Paste your product&apos;s URL and AskedFor drafts a profile, search terms and competitors
        for you to review.
      </p>
    </div>
  );
}
