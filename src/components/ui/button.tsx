import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "quiet";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-[2px] px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "border border-rule text-ink hover:bg-surface",
  quiet: "text-accent underline-offset-4 hover:underline",
};

export const buttonClass = (variant: ButtonVariant = "primary", extra?: string) =>
  cx(BASE, VARIANTS[variant], extra);

/** Three weights (docs/PLAN.md 9.4): primary on the accent, secondary with a rule border, quiet text. */
export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

/** A link styled as a button, for navigation. */
export function ButtonLink({
  href,
  variant = "primary",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}
