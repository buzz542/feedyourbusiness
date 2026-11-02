import { SOURCE_LABELS } from "@/server/reply/tips";
import type { SourceProgress } from "@/server/pipeline/first-run";

const STATUS: Record<SourceProgress["status"], string> = {
  queued: "Waiting to start",
  running: "Collecting",
  waiting: "Collecting",
  done: "Done",
  failed: "Could not finish; we will try again tomorrow",
};

/** The first run, by source (docs/PLAN.md 4.3 step 6, 4.9). Refresh shows new results. */
export function FirstRunProgress({ progress }: { progress: readonly SourceProgress[] }) {
  return (
    <section aria-live="polite" className="rounded-sm border border-rule p-4 text-sm">
      <h2 className="font-serif text-lg">Your first collection is running</h2>
      <p className="text-muted">
        Posts appear here as each source finishes. We will email you when your feed is ready.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {progress.map((p) => (
          <li key={p.source}>
            {SOURCE_LABELS[p.source] ?? p.source}: {STATUS[p.status]}
          </li>
        ))}
      </ul>
    </section>
  );
}
