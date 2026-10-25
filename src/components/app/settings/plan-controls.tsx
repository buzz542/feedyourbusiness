"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openPortalAction, setCancelAction } from "@/app/(app)/app/billing/actions";
import { Button } from "@/components/ui/button";

/**
 * Cancel in two clicks (docs/PLAN.md 10.3): the first opens an inline confirm that says until when
 * access lasts, the second cancels at the end of the period. Resume undoes it; Update card opens
 * Stripe's portal.
 */
export function PlanControls({
  canCancel,
  canResume,
  canUpdateCard,
  accessUntil,
}: {
  canCancel: boolean;
  canResume: boolean;
  canUpdateCard: boolean;
  accessUntil: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const post = (call: () => Promise<{ ok: boolean; url?: string }>) =>
    start(async () => {
      setError(null);
      try {
        const result = await call();
        if (!result.ok) throw new Error("failed");
        if (result.url) {
          window.location.assign(result.url);
          return;
        }
        setConfirming(false);
        router.refresh();
      } catch {
        setError("That did not work. Try again in a minute.");
      }
    });

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {canCancel && !confirming ? (
          <Button variant="secondary" onClick={() => setConfirming(true)} disabled={pending}>
            Cancel subscription
          </Button>
        ) : null}
        {canResume ? (
          <Button onClick={() => post(() => setCancelAction("resume"))} disabled={pending}>
            Resume subscription
          </Button>
        ) : null}
        {canUpdateCard ? (
          <Button variant="secondary" onClick={() => post(openPortalAction)} disabled={pending}>
            Update card
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div
          role="group"
          aria-label="Confirm cancellation"
          className="rounded-[2px] border border-rule p-3 text-sm"
        >
          <p>
            {accessUntil
              ? `You keep access until ${accessUntil}, and you will not be charged again.`
              : "You will not be charged again."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => post(() => setCancelAction("cancel"))} disabled={pending}>
              Yes, cancel
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(false)} disabled={pending}>
              Keep my subscription
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
