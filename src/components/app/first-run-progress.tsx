import { CheckIcon } from "@/components/ui/icons";
import { SOURCE_LABELS } from "@/server/reply/tips";
import type { SourceProgress } from "@/server/pipeline/first-run";

const STATUS: Record<SourceProgress["status"], string> = {
  queued: "Waiting to start",
  running: "Collecting",
  waiting: "Collecting",
  done: "Done",
  failed: "Could not finish; we will try again tomorrow",
};

/**
 * The first run, by source (docs/PLAN.md 4.3 step 6, 4.9). Refresh shows new results. Each line
 * says its state in words; the mark beside it only repeats it.
 */
export function FirstRunProgress({ progress }: { progress: readonly SourceProgress[] }) {
  return (
    <section
      aria-live="polite"
      className="rounded-xl border border-control bg-surface p-4 text-sm sm:p-5"
    >
      <h2 className="font-serif text-lg tracking-tight">Your first collection is running</h2>
      <p className="mt-1 text-muted">
        Posts appear here as each source finishes. We will email you when your feed is ready.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {progress.map((p) => (
          <li key={p.source} className="flex items-center gap-2">
            {p.status === "done" ? (
              <CheckIcon size={14} />
            ) : (
              <span
                aria-hidden="true"
                className={`mx-[3px] size-2 shrink-0 rounded-full border border-ink ${p.status === "running" || p.status === "waiting" ? "bg-ink motion-safe:animate-pulse" : ""}`}
              />
            )}
            <span>
              {SOURCE_LABELS[p.source] ?? p.source}: {STATUS[p.status]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
