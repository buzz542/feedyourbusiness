"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SOURCE_LABELS } from "@/server/reply/tips";

/**
 * A server error (docs/PLAN.md 4.9; the founder's brief): our side failed, in plain words, with a
 * retry that fetches the page again (the error boundary's retry()).
 */
export function FeedError({ retry }: { retry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-control bg-surface p-6"
    >
      <h2 className="font-serif text-lg">Something went wrong on our side</h2>
      <p className="text-sm text-muted">Nothing was lost. Try again in a moment.</p>
      <Button variant="secondary" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

const names = (sources: readonly string[]) => {
  const labels = sources.map((s) => SOURCE_LABELS[s] ?? s);
  return labels.length <= 2
    ? labels.join(" and ")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
};

/**
 * An integration error (the founder's brief): sources whose last collect run failed. Shown above
 * the feed, so an empty feed never hides it. Nothing to retry here: the next collection does.
 */
export function SourceProblems({ sources }: { sources: readonly string[] }) {
  if (sources.length === 0) return null;
  return (
    <p
      role="status"
      className="rounded-xl border border-control bg-surface px-4 py-3 text-sm text-ink"
    >
      We could not collect from {names(sources)} in the last run. Conversations from{" "}
      {sources.length === 1 ? "it" : "them"} may be missing. We try again with the next collection.
    </p>
  );
}

/** How long a view may load before we say so. */
export const SLOW_AFTER_MS = 12_000;

/**
 * Under the loading skeleton: after SLOW_AFTER_MS, says it is slow and offers a reload, so
 * loading is never open-ended. Renders nothing before then.
 */
export function SlowLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-muted">
      <p>This is taking longer than usual.</p>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
