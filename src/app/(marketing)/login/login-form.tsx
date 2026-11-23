"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type LoginState, loginAction } from "./actions";

const MESSAGES: Record<Exclude<LoginState["kind"], "idle">, string> = {
  sent: "Check your email for a sign-in link. Open it in this browser.",
  reset_sent:
    "If there is an account for that email, a link to set a new password is on its way. Open it in this browser.",
  wrong: "That email and password do not match. Try again, or email yourself a sign-in link.",
  private_beta: "AskedFor is in private beta. Sign-in is open to invited people only for now.",
  invalid: "Enter a valid email address.",
  error: "Something went wrong. Try again in a minute.",
};

/**
 * One form, three buttons that share one action (loginAction), told apart by `intent`. Enter in
 * a field presses the first button, so it signs in with the password. The two link buttons skip
 * the browser's checks (formNoValidate), because the password box may be empty for them.
 */
export function LoginForm({ next }: { next: string | null }) {
  const [state, submit, pending] = useActionState<LoginState, FormData>(loginAction, {
    kind: "idle",
  });

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
          className="w-full rounded-[2px] border border-rule bg-paper px-3 py-2"
        />
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={200}
          className="w-full rounded-[2px] border border-rule bg-paper px-3 py-2"
        />
        <Button type="submit" name="intent" value="password" disabled={pending} className="w-full">
          {pending ? "Working" : "Sign in"}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="link"
          variant="secondary"
          disabled={pending}
          formNoValidate
          className="w-full"
        >
          Email me a sign-in link
        </Button>
        <Button
          type="submit"
          name="intent"
          value="reset"
          variant="quiet"
          disabled={pending}
          formNoValidate
        >
          Forgot your password?
        </Button>
        <p role="status" aria-live="polite" className="min-h-6 text-sm">
          {state.kind === "idle" ? "" : MESSAGES[state.kind]}
        </p>
      </form>
    </div>
  );
}
