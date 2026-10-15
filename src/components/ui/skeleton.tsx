/**
 * Loading placeholders shaped like cards (docs/PLAN.md 4.9). The shapes are hidden from assistive
 * tech; one status message says what is loading.
 */
export function Skeleton({ cards = 3, label }: { cards?: number; label: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <ul aria-hidden="true" className="space-y-3">
        {Array.from({ length: cards }, (_, i) => (
          <li key={i} className="rounded-[2px] border border-rule p-4">
            <div className="h-3 w-1/3 animate-pulse rounded-[2px] bg-sunk" />
            <div className="mt-3 h-3 w-full animate-pulse rounded-[2px] bg-sunk" />
            <div className="mt-2 h-3 w-4/5 animate-pulse rounded-[2px] bg-sunk" />
          </li>
        ))}
      </ul>
    </div>
  );
}
