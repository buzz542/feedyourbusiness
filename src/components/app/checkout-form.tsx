"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const ERRORS: Record<string, string> = {
  consent_required: "Tick the box to start your trial.",
  subscription_exists: "You already have a subscription. See Settings.",
  private_beta: "AskedFor is in private beta.",
};

/** The consent box and the button to Stripe Checkout (docs/PLAN.md 10.1, 10.2). */
export function CheckoutForm({
  consentWording,
  startCheckout,
}: {
  consentWording: string;
  startCheckout: (consent: boolean) => Promise<{ url?: string; error?: string }>;
}) {
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const result = await startCheckout(consent);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setError(
        ERRORS[result.error ?? ""] ?? "Checkout is not available right now. Try again soon.",
      );
    } catch {
      setError("Checkout is not available right now. Try again soon.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1"
        />
        <span>{consentWording}</span>
      </label>
      <Button disabled={!consent || busy} onClick={start} className="self-start">
        Start your free trial
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {error}
      </p>
    </div>
  );
}
