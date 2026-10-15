"use client";

import { Button } from "@/components/ui/button";

/** The app's error state (docs/PLAN.md 4.9): say what happened and offer a retry. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-[2px] border border-rule px-6 py-10 text-center">
      <h1 className="font-serif text-xl tracking-tight">This page did not load</h1>
      <p className="mx-auto mt-2 max-w-prose text-sm text-muted">
        Something went wrong on our side. Your data is safe. Try again in a moment.
      </p>
      <div className="mt-5">
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
