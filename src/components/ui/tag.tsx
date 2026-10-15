import type { ReactNode } from "react";
import { cx } from "./cx";

/** A small label, for categories and statuses. Text carries the meaning, never color alone. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-[2px] border border-rule px-1.5 py-0.5 text-xs font-medium text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
