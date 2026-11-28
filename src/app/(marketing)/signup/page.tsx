import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Passed through as-is; the server checks it with safeNextPath before it is ever used.
  const next = typeof params.next === "string" ? params.next.slice(0, 512) : null;

  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Create an account</h1>
      <p className="mt-4 max-w-prose text-muted">
        Enter your email and choose a password. We email you a six digit code to verify your
        address. Then we ask you to confirm your age and accept the{" "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>{" "}
        and the{" "}
        <Link href="/acceptable-use" className="underline underline-offset-4">
          Acceptable use policy
        </Link>
        .
      </p>
      <SignupForm next={next} />
    </>
  );
}
