import { SOURCE_LABELS } from "@/lib/reply-tips";
import type { FirstRunStatus } from "@/server/pipeline/first-run";

const STATUS_LABELS = {
  queued: "waiting",
  running: "collecting",
  done: "done",
  failed: "did not finish",
} as const;

/** Progress of the first run, by source (docs/PLAN.md 4.3, 4.9). Results appear as each finishes. */
export function FirstRunBanner({ status }: { status: FirstRunStatus }) {
  return (
    <section
      aria-live="polite"
      aria-label="First run"
      className="rounded-[2px] border border-rule bg-sunk p-4 text-sm"
    >
      <p className="font-medium">Your first run is in progress. Reload to see new posts.</p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted">
        {status.sources.map((s) => (
          <li key={s.source}>
            {SOURCE_LABELS[s.source] ?? s.source}: {STATUS_LABELS[s.status]}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-muted">We will email you when it is done.</p>
    </section>
  );
}
