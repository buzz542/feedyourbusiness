"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type CodeState, type SignupState, codeAction, signupAction } from "./actions";

const MESSAGES: Record<Exclude<SignupState["kind"], "idle" | "sent">, string> = {
  invalid: "Enter a valid email address.",
  too_short: "Use a password of at least ten characters.",
  too_long: "That password is too long. Use fewer than seventy characters.",
  mismatch: "The two passwords do not match.",
  same_as_email: "Do not use your email address as your password.",
  private_beta:
    "FeedYourBusiness is in private beta. Accounts are open to invited people only for now.",
  error: "Something went wrong. Try again in a minute.",
};

/**
 * Create an account: an email, a password and the password again. The browser checks the minimum
 * length and the server checks everything again. On success the form gives way to what happens
 * next, in a live region.
 */
export function SignupForm({ next }: { next: string | null }) {
  const [state, submit, pending] = useActionState<SignupState, FormData>(signupAction, {
    kind: "idle",
  });
  const signIn = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  if (state.kind === "sent") return <CodeStep email={state.email} next={next} />;

  return (
    <div className="mt-8 max-w-sm space-y-6">
      <form action={submit} className="space-y-3">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          maxLength={320}
          className="w-full rounded-xl border border-control bg-paper px-3 py-2"
        />
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={200}
          aria-describedby="password-hint"
          className="w-full rounded-xl border border-control bg-paper px-3 py-2"
        />
        <p id="password-hint" className="text-sm text-muted">
          At least ten characters.
        </p>
        <label htmlFor="confirm" className="block text-sm font-medium">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={200}
          className="w-full rounded-xl border border-control bg-paper px-3 py-2"
        />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Working" : "Create account"}
        </Button>
        <p className="text-sm text-muted">We email you a six digit code to verify your address.</p>
        <p role="status" aria-live="polite" className="min-h-6 text-sm">
          {state.kind === "idle" ? "" : MESSAGES[state.kind]}
        </p>
      </form>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href={signIn} className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}

const CODE_MESSAGES: Record<Exclude<CodeState["kind"], "idle">, string> = {
  wrong: "That code did not work. Check it, or send a new code.",
  invalid: "Enter the six digit code from the email.",
  resent: "We sent a new code. The old one no longer works.",
  private_beta:
    "FeedYourBusiness is in private beta. Accounts are open to invited people only for now.",
  error: "Something went wrong. Try again in a minute.",
};

/**
 * The step after Create account: the six digit code from the verification email, typed here. It
 * works from any device, so the email can be opened on a phone while this page is on an iPad.
 * Two buttons share one action, told apart by `intent`; Enter in the box verifies. Resend skips
 * the browser's check, because the box may be empty for it.
 */
export function CodeStep({ email, next }: { email: string; next: string | null }) {
  const [state, submit, pending] = useActionState<CodeState, FormData>(codeAction, {
    kind: "idle",
  });
  return (
    <div className="mt-8 max-w-sm space-y-6">
      <div className="space-y-2">
        <h2 className="font-serif text-2xl tracking-tight">Check your email</h2>
        <p className="text-muted">
          We emailed a six digit code to <span className="text-ink">{email}</span>. Enter it here to
          continue. If nothing arrives, check your spam folder.
        </p>
      </div>
      <form action={submit} className="space-y-3">
        <input type="hidden" name="email" value={email} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label htmlFor="code" className="block text-sm font-medium">
          Verification code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          maxLength={7}
          className="w-full rounded-xl border border-control bg-paper px-3 py-2 text-center text-xl tracking-[0.4em] tabular-nums"
        />
        <Button type="submit" name="intent" value="verify" disabled={pending} className="w-full">
          {pending ? "Working" : "Verify and continue"}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="resend"
          variant="secondary"
          disabled={pending}
          formNoValidate
          className="w-full"
        >
          Send a new code
        </Button>
        <p role="status" aria-live="polite" className="min-h-6 text-sm">
          {state.kind === "idle" ? "" : CODE_MESSAGES[state.kind]}
        </p>
      </form>
    </div>
  );
}
