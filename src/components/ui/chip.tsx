import type { ReactNode } from "react";
import { cx } from "./cx";

/** A square-ish chip for terms, filters and rival names. `selected` marks an active filter. */
export function Chip({
  children,
  selected = false,
  className,
}: {
  children: ReactNode;
  selected?: boolean;
  className?: string;
}) {
  return (
    <span
      data-selected={selected ? "true" : undefined}
      className={cx(
        "inline-flex items-center gap-1 rounded-[2px] border px-2 py-0.5 text-xs",
        selected ? "border-accent bg-accent text-accent-ink" : "border-rule text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A category or status label: text only, never color alone. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[2px] bg-paper px-1.5 py-0.5 text-xs font-medium tracking-wide text-muted uppercase">
      {children}
    </span>
  );
}
