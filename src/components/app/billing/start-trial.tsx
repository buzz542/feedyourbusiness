"use client";

import { useState, useTransition } from "react";
import { startCheckoutAction } from "@/app/(app)/app/billing/actions";
import { Button } from "@/components/ui/button";

/**
 * The consent box and the Start button (docs/PLAN.md 10.1, 10.2). Checkout starts only with the
 * box ticked; the server refuses it otherwise.
 */
export function StartTrial({ consentText }: { consentText: string }) {
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function go() {
    if (!consent) {
      setError("Tick the box to continue.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const result = await startCheckoutAction(true);
        if (result.ok && result.url) {
          window.location.assign(result.url);
          return;
        }
        setError(
          !result.ok && result.error === "subscription_exists"
            ? "You already have a subscription. Open Settings to manage it."
            : "Checkout did not open. Try again in a minute.",
        );
      } catch {
        setError("Checkout did not open. Try again in a minute.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 size-4 accent-[var(--accent)]"
        />
        <span className="text-sm">{consentText}</span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <Button onClick={go} disabled={pending}>
        {pending ? "Opening checkout" : "Start free trial"}
      </Button>
    </div>
  );
}
