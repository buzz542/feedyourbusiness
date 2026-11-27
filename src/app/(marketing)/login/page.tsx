import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link did not work. It may have expired or been used already, or been opened in a different browser from the one where you asked for it. Sign in again, or create an account to get a new link.",
  private_beta:
    "FeedYourBusiness is in private beta. Sign-in is open to invited people only for now.",
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
        Sign in with your email and password. New here? Create an account: you choose a password and
        we email you a link to verify your address.
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
