"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/sign-in";
import { type PasswordState, setPasswordAction } from "./actions";

const MESSAGES: Record<Exclude<PasswordState["kind"], "idle">, string> = {
  too_short: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  too_long: "That password is too long. Use 72 characters or fewer.",
  mismatch: "The two passwords do not match.",
  same_as_email: "Your password cannot be your email address.",
  error: "Something went wrong. Try again.",
};

export function PasswordForm() {
  const [state, save, pending] = useActionState<PasswordState, FormData>(setPasswordAction, {
    kind: "idle",
  });

  return (
    <form action={save} className="mt-8 max-w-sm space-y-3">
      <label htmlFor="password" className="block text-sm font-medium">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={200}
        className="w-full rounded-[2px] border border-rule bg-paper px-3 py-2"
      />
      <label htmlFor="confirm" className="block text-sm font-medium">
        Type it again
      </label>
      <input
        id="confirm"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={200}
        className="w-full rounded-[2px] border border-rule bg-paper px-3 py-2"
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Save password"}
      </Button>
      <p role="status" aria-live="polite" className="min-h-6 text-sm">
        {state.kind === "idle" ? "" : MESSAGES[state.kind]}
      </p>
    </form>
  );
}
