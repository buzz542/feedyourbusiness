import { cx } from "./cx";

/** A placeholder block while a list loads (docs/PLAN.md 4.9). No animation under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx("rounded-sm bg-rule/70 motion-safe:animate-pulse", className)}
    />
  );
}

/** Skeleton cards for a feed, shaped like a Reply card so nothing jumps when posts arrive. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading posts</span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border border-rule bg-surface p-4 sm:p-5"
        >
          <div className="flex justify-between gap-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
          <div className="flex gap-2 border-t border-rule pt-3">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-14" />
            <Skeleton className="h-9 w-14" />
            <Skeleton className="h-9 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
