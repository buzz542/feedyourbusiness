import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/server/auth/app-state";
import { acceptTermsAction } from "./actions";

export const metadata: Metadata = { title: "Welcome" };

/** First sign-in: two confirmations on one screen (docs/PLAN.md 4.3). */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePage("welcome", "/app/welcome");
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-serif text-3xl tracking-tight">Welcome to AskedFor</h1>
      <p className="mt-2 text-muted">Two quick confirmations before you start.</p>

      <form action={acceptTermsAction} className="mt-8 space-y-4">
        {error ? (
          <p role="alert" className="text-sm text-negative">
            Check both boxes to continue.
          </p>
        ) : null}
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="adult"
            required
            className="mt-1 size-4 accent-[var(--accent)]"
          />
          <span>I am 18 or older.</span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="terms"
            required
            className="mt-1 size-4 accent-[var(--accent)]"
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" target="_blank" className="underline underline-offset-4">
              Terms
            </Link>{" "}
            and the{" "}
            <Link href="/acceptable-use" target="_blank" className="underline underline-offset-4">
              Acceptable use policy
            </Link>
            .
          </span>
        </label>
        <Button type="submit">Continue</Button>
      </form>
    </div>
  );
}
