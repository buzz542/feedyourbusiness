"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export interface PlanActionResult {
  cancelAtPeriodEnd?: boolean;
  accessUntil?: string | null;
  url?: string;
  error?: string;
}

async function attempt(fn: () => Promise<PlanActionResult>): Promise<PlanActionResult | null> {
  try {
    const result = await fn();
    return result.error ? null : result;
  } catch {
    return null;
  }
}

/**
 * Cancel in two clicks (docs/PLAN.md 2.4, 10.3): the first opens an inline confirm with the date
 * access ends, the second cancels at the period end. Resume undoes it. Update card opens Stripe's
 * portal. The result Stripe returns is shown at once; the webhook updates the profile behind it.
 */
export function PlanControls({
  canCancel,
  canResume,
  canUpdateCard,
  accessUntil,
  setCancellation,
  openCardPortal,
}: {
  canCancel: boolean;
  canResume: boolean;
  canUpdateCard: boolean;
  accessUntil: string | null;
  setCancellation: (action: "cancel" | "resume") => Promise<PlanActionResult>;
  openCardPortal: () => Promise<PlanActionResult>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState({ canCancel, canResume, accessUntil });

  async function setCancel(action: "cancel" | "resume") {
    setBusy(true);
    setMessage(null);
    const result = await attempt(() => setCancellation(action));
    setBusy(false);
    setConfirming(false);
    if (!result) {
      setMessage("That did not work. Nothing changed. Try again in a minute.");
      return;
    }
    const until = result.accessUntil ?? state.accessUntil;
    setState({
      canCancel: !result.cancelAtPeriodEnd,
      canResume: Boolean(result.cancelAtPeriodEnd),
      accessUntil: until,
    });
    setMessage(
      result.cancelAtPeriodEnd
        ? until
          ? `Canceled. You keep access until ${longDate(until)} and will not be charged.`
          : "Canceled. You will not be charged."
        : "Resumed. Your plan continues.",
    );
  }

  async function updateCard() {
    setBusy(true);
    setMessage(null);
    const result = await attempt(openCardPortal);
    if (result?.url) {
      window.location.assign(result.url);
      return;
    }
    setBusy(false);
    setMessage("The card page is not available right now. Try again in a minute.");
  }

  return (
    <div className="flex flex-col gap-3">
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-[2px] border border-rule p-4" role="group">
          <p className="text-sm">
            {state.accessUntil
              ? `Cancel your subscription? You keep access until ${longDate(state.accessUntil)} and will not be charged after that.`
              : "Cancel your subscription? You will not be charged again."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => setCancel("cancel")}>
              Yes, cancel
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Keep my plan
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {state.canCancel ? (
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
              Cancel subscription
            </Button>
          ) : null}
          {state.canResume ? (
            <Button disabled={busy} onClick={() => setCancel("resume")}>
              Resume subscription
            </Button>
          ) : null}
          {canUpdateCard ? (
            <Button variant="secondary" disabled={busy} onClick={updateCard}>
              Update card
            </Button>
          ) : null}
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {message}
      </p>
    </div>
  );
}
