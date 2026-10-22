import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** 1px rule border, 2px corners, no shadow (docs/PLAN.md 9.4). */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cx("rounded-[2px] border border-rule bg-surface p-4", className)}
      {...props}
    />
  );
}

/** A placeholder card while a list loads. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="rounded-[2px] border border-rule bg-surface p-4">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={cx(
            "h-3 animate-pulse rounded-[2px] bg-rule",
            i > 0 && "mt-3",
            i === lines - 1 && "w-2/3",
          )}
        />
      ))}
    </div>
  );
}
