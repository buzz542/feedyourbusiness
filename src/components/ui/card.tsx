import type { ReactNode } from "react";
import { cx } from "./cx";

/** A 1px rule border, 2px corners and no shadow (docs/PLAN.md 9.4). */
export function Card({
  as: Tag = "div",
  className,
  children,
}: {
  as?: "div" | "article" | "section" | "li";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={cx("rounded-[2px] border border-rule bg-paper p-4", className)}>{children}</Tag>
  );
}
