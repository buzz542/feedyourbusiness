import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link did not work. It may have expired or been used already, or been opened in a different browser from the one where you asked for it. Ask for a new one below.",
  private_beta: "AskedFor is in private beta. Sign-in is open to invited people only for now.",
  google: "Google sign-in did not start. Try again, or use an email link.",
  first_time: "The first time you sign in, use an email link. Google sign-in works after that.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  // Passed through as-is; the server checks it with safeNextPath before it is ever used.
  const next = typeof params.next === "string" ? params.next.slice(0, 512) : null;

  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Sign in</h1>
      <p className="mt-4 max-w-prose text-muted">
        Get a sign-in link by email, or use your Google account. The first time you sign in, we ask
        you to confirm your age and accept the{" "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>{" "}
        and the{" "}
        <Link href="/acceptable-use" className="underline underline-offset-4">
          Acceptable use policy
        </Link>
        .
      </p>
      {error ? (
        <p role="alert" className="mt-6 max-w-prose border-l-2 border-accent pl-3">
          {error}
        </p>
      ) : null}
      <LoginForm next={next} />
    </>
  );
}
