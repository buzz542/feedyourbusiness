import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { acceptTermsAction } from "./actions";

export const metadata: Metadata = { title: "Before you start" };

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  return (
    <div className="max-w-lg">
      <h1 className="font-serif text-3xl tracking-tight">Before you start</h1>
      <p className="mt-3 text-muted">Two confirmations, once.</p>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-negative">
          Tick both boxes to continue.
        </p>
      ) : null}
      <form action={acceptTermsAction} className="mt-6 flex flex-col gap-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="adult" value="yes" required className="mt-1" />
          <span>I am 18 or older.</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="terms" value="yes" required className="mt-1" />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="underline underline-offset-4">
              Terms
            </Link>{" "}
            and the{" "}
            <Link href="/acceptable-use" className="underline underline-offset-4">
              Acceptable use policy
            </Link>
            .
          </span>
        </label>
        <div>
          <Button type="submit">Continue</Button>
        </div>
      </form>
    </div>
  );
}
