"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { googleAction, type LinkState, sendLinkAction } from "./actions";

const MESSAGES: Record<Exclude<LinkState["kind"], "idle">, string> = {
  sent: "Check your email for a sign-in link. Open it in this browser.",
  private_beta: "AskedFor is in private beta. Sign-in is open to invited people only for now.",
  invalid: "Enter a valid email address.",
  error: "We could not send the link. Try again in a minute.",
};

export function LoginForm({ next }: { next: string | null }) {
  const [state, sendLink, pending] = useActionState<LinkState, FormData>(sendLinkAction, {
    kind: "idle",
  });

  return (
    <div className="mt-8 max-w-sm space-y-6">
      <form action={sendLink} className="space-y-3">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={320}
          className="w-full rounded-[2px] border border-rule bg-paper px-3 py-2"
        />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Sending" : "Email me a sign-in link"}
        </Button>
        <p role="status" aria-live="polite" className="min-h-6 text-sm">
          {state.kind === "idle" ? "" : MESSAGES[state.kind]}
        </p>
      </form>

      <div className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-rule" />
        or
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form action={googleAction}>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Button type="submit" variant="secondary" className="w-full">
          Continue with Google
        </Button>
      </form>
    </div>
  );
}
