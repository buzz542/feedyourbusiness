import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/** A 1px rule border, 2px corners and no shadow (docs/PLAN.md 9.4). */
export function Card({
  as: Tag = "article",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  as?: "article" | "li" | "section" | "div";
  children: ReactNode;
}) {
  return (
    <Tag className={cx("rounded-[2px] border border-rule bg-paper p-4", className)} {...rest}>
      {children}
    </Tag>
  );
}
