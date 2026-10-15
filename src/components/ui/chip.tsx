import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

const baseClass =
  "inline-flex min-h-8 items-center gap-1.5 rounded-[2px] border px-2.5 text-sm leading-none";

type StaticChip = { children: ReactNode; className?: string; pressed?: undefined };
/** A toggle chip: a button that announces its state. */
type ToggleChip = { children: ReactNode; className?: string; pressed: boolean } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "className" | "aria-pressed"
>;

/** Square-ish chip for terms, filters and sources (docs/PLAN.md 9.4). */
export function Chip(props: StaticChip | ToggleChip) {
  if (props.pressed === undefined) {
    return (
      <span className={cx(baseClass, "border-rule bg-sunk text-ink", props.className)}>
        {props.children}
      </span>
    );
  }
  const { children, className, pressed, ...rest } = props;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cx(
        baseClass,
        pressed
          ? "border-accent bg-accent text-accent-ink"
          : "border-rule-strong bg-paper text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
