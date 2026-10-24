import type { ReactNode } from "react";
import { cx } from "./cx";

/** A square-ish label: categories, rivals, sources (docs/PLAN.md 9.4). Tone is decoration; the text carries the meaning. */
export function Chip({
  tone = "default",
  className,
  children,
}: {
  tone?: "default" | "accent";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-[3px] border px-2 py-0.5 text-xs leading-5",
        tone === "accent" ? "border-accent text-accent" : "border-rule text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}
