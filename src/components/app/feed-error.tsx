"use client";

import { Button } from "@/components/ui/button";

/** The error state for a list (docs/PLAN.md 4.9): what happened in plain words and a retry. */
export function FeedError({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-sm border border-rule p-6">
      <h2 className="font-serif text-lg">We could not load your posts</h2>
      <p className="text-sm text-muted">Nothing was lost. Try again in a moment.</p>
      <Button variant="secondary" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
