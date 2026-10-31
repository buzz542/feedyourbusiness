"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { draftAction, type DraftState } from "./actions";

/** The steps a draft runs through, named as they run (docs/PLAN.md 4.3 step 3). */
export const STEPS = [
  "Reading your site",
  "Figuring out who it's for",
  "Writing your search terms",
];
const STEP_MS = [20_000, 12_000];

export function PasteForm({ initial = "" }: { initial?: string }) {
  const [state, draft, pending] = useActionState<DraftState, FormData>(draftAction, {
    kind: "idle",
  });
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!pending) return;
    const timers = STEP_MS.map((_, i) =>
      setTimeout(
        () => setStep(i + 1),
        STEP_MS.slice(0, i + 1).reduce((a, b) => a + b, 0),
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [pending]);

  return (
    <form action={draft} onSubmit={() => setStep(0)} className="mt-8 max-w-prose space-y-4">
      <label htmlFor="onboarding-input" className="block font-medium">
        Paste your website.
      </label>
      <textarea
        id="onboarding-input"
        name="input"
        rows={3}
        required
        defaultValue={state.kind === "message" ? state.input : initial}
        aria-describedby="onboarding-hint onboarding-status"
        className="w-full rounded-[2px] border border-rule bg-paper p-3"
      />
      <p id="onboarding-hint" className="text-sm text-muted">
        No website yet? Describe your product in a sentence or two.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Working on it" : "Read my product"}
      </Button>
      <div id="onboarding-status" role="status" aria-live="polite" className="min-h-6 text-sm">
        {pending ? (
          <ol className="space-y-1">
            {STEPS.map((label, i) => (
              <li key={label} className={i === step ? "text-ink" : "text-muted"}>
                {i < step ? "Done: " : i === step ? "Now: " : ""}
                {label}
              </li>
            ))}
          </ol>
        ) : state.kind === "message" ? (
          state.text
        ) : null}
      </div>
    </form>
  );
}
