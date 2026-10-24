"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptTermsAction, type TermsState } from "./actions";

const MESSAGES: Record<Exclude<TermsState["kind"], "idle">, string> = {
  missing: "Check both boxes to continue.",
  error: "Something went wrong. Try again.",
};

export function TermsForm() {
  const [state, accept, pending] = useActionState<TermsState, FormData>(acceptTermsAction, {
    kind: "idle",
  });

  return (
    <form action={accept} className="mt-8 max-w-prose space-y-4">
      <label className="flex items-start gap-3">
        <input type="checkbox" name="adult" required className="mt-1 size-4" />
        <span>I am 18 or older</span>
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="terms" required className="mt-1 size-4" />
        <span>
          I agree to the{" "}
          <a href="/terms" target="_blank" rel="noopener" className="underline underline-offset-4">
            Terms
          </a>{" "}
          and the{" "}
          <a
            href="/acceptable-use"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-4"
          >
            Acceptable use policy
          </a>
        </span>
      </label>
      <Button type="submit" disabled={pending}>
        Continue
      </Button>
      <p role="status" aria-live="polite" className="min-h-6 text-sm">
        {state.kind === "idle" ? "" : MESSAGES[state.kind]}
      </p>
    </form>
  );
}
