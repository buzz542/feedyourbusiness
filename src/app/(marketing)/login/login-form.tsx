"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { LoginState } from "./actions";

const messages: Record<Exclude<LoginState["status"], "idle" | "sent">, string> = {
  invalid_email: "Enter a valid email address.",
  private_beta: "AskedFor is in private beta. Sign-in is open to invited makers for now.",
  rate_limited: "Too many sign-in links from this network today. Try again tomorrow.",
  error: "We could not send the link just now. Try again in a minute.",
};

export function LoginForm({
  next,
  action,
}: {
  next: string;
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
}) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(action, {
    status: "idle",
  });

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-[2px] border border-rule bg-sunk p-4">
        <p className="font-medium">Check your email.</p>
        <p className="mt-1 text-sm text-muted">
          We sent you a sign-in link. Open it in this browser to finish signing in.
        </p>
      </div>
    );
  }

  const error = state.status === "idle" ? null : messages[state.status];
  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="block text-sm font-medium">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        aria-invalid={state.status === "invalid_email" || undefined}
        aria-describedby={error ? "login-error" : undefined}
        className="block w-full rounded-[2px] border border-rule-strong bg-paper px-3 py-2 text-base"
      />
      <p id="login-error" role="alert" className="min-h-5 text-sm text-negative">
        {error}
      </p>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
