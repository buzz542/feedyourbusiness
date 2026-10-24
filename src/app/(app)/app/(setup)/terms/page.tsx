import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasAcceptedTerms, requireAppUser } from "@/server/auth/session";
import { TermsForm } from "./terms-form";

export const metadata: Metadata = { title: "Before you start" };
export const dynamic = "force-dynamic";

/** First sign-in: two confirmations on one screen (docs/PLAN.md 4.3). */
export default async function TermsPage() {
  const user = await requireAppUser("/app/terms", { beforeTerms: true });

  if (await hasAcceptedTerms(user.id)) redirect("/app");

  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Before you start</h1>
      <p className="mt-4 max-w-prose text-muted">
        AskedFor is for people 18 and older. Please confirm both to continue.
      </p>
      <TermsForm />
    </>
  );
}
