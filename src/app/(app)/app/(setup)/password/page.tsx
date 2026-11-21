import type { Metadata } from "next";
import { requireAppUser } from "@/server/auth/session";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Choose a password" };
export const dynamic = "force-dynamic";

/**
 * Last step before onboarding: a password, so the next sign-in needs no email link. A reset link
 * lands here too, for someone who already has one. The terms come first (requireAppUser).
 */
export default async function PasswordPage() {
  await requireAppUser("/app/password");

  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Choose a password</h1>
      <p className="mt-4 max-w-prose text-muted">
        Use it with your email to sign in next time. At least 10 characters, and not your email
        address.
      </p>
      <PasswordForm />
    </>
  );
}
