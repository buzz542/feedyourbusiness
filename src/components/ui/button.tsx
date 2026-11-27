import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Three weights (docs/PLAN.md 9.4): primary on the accent, secondary with a rule border, quiet text.
 * The secondary border uses --control, the rule color strong enough to find (3:1). Quiet is for
 * standalone controls only, never a link inside prose: it is told apart by color.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet";

const BASE =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent-fill text-accent-ink hover:opacity-90",
  secondary: "border border-control bg-surface text-ink hover:border-ink",
  quiet: "text-muted underline-offset-4 hover:text-ink hover:underline",
};

/** The same look for a link styled as a button. */
export const buttonClass = (variant: ButtonVariant = "primary", extra?: string): string =>
  cx(BASE, VARIANTS[variant], extra);

export function Button({
  variant = "primary",
  type = "button",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
