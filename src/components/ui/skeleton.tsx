import { cx } from "./cx";

/** A placeholder block while a list loads (docs/PLAN.md 4.9). No animation under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx("rounded-sm bg-rule/60 motion-safe:animate-pulse", className)}
    />
  );
}

/** Skeleton cards for a feed. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading posts</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-sm border border-rule p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}
