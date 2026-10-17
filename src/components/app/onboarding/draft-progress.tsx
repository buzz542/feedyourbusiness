"use client";

import { useEffect, useState } from "react";

/** What the draft is doing, in order. One request does all of it, so the steps follow the clock. */
export const PROGRESS_STEPS = [
  "Reading your page",
  "Working out who it is for",
  "Finding the phrases people write when they need it",
  "Listing competitors",
  "Checking the draft",
] as const;

const STEP_MS = 9_000;

/** The progress state for the draft (docs/PLAN.md 4.3, step 3), announced politely. */
export function DraftProgress({ fromDescription }: { fromDescription: boolean }) {
  const [step, setStep] = useState(fromDescription ? 1 : 0);

  useEffect(() => {
    const timer = setInterval(
      () => setStep((s) => Math.min(s + 1, PROGRESS_STEPS.length - 1)),
      STEP_MS,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <div role="status" aria-live="polite" className="rounded-[2px] border border-rule bg-sunk p-4">
      <p className="font-medium">Drafting your profile. This can take up to two minutes.</p>
      <ol className="mt-3 space-y-1.5 text-sm">
        {PROGRESS_STEPS.map((label, i) => (
          <li
            key={label}
            className={
              i < step ? "text-muted" : i === step ? "font-medium text-ink" : "text-muted/60"
            }
            aria-current={i === step ? "step" : undefined}
          >
            <span aria-hidden="true" className="mr-2 inline-block w-4">
              {i < step ? "✓" : i === step ? "•" : ""}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
