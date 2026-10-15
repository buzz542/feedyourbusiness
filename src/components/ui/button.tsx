import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "quiet";

const baseClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[2px] text-sm font-medium " +
  "whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:opacity-60";

// Padding lives in each variant: Tailwind orders utilities by stylesheet, not by class order.
const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent px-4 text-accent-ink hover:opacity-90",
  secondary: "border border-rule-strong bg-paper px-4 text-ink hover:bg-sunk",
  quiet: "px-2 text-ink underline-offset-4 hover:underline",
};

export function buttonClass(variant: ButtonVariant = "primary", className?: string): string {
  return cx(baseClass, variantClasses[variant], className);
}

interface Common {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}
type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined };
/** A link styled as a button. Links cannot be disabled; render a button instead. */
type AsLink = Common &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href"> & {
    href: string;
  };

/** Three weights (docs/PLAN.md 9.4): primary on the accent, secondary with a border, quiet text. */
export function Button(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { href, variant = "primary", className, children, ...rest } = props;
    return (
      <Link href={href} className={buttonClass(variant, className)} {...rest}>
        {children}
      </Link>
    );
  }
  const { variant = "primary", className, children, type = "button", ...rest } = props;
  return (
    <button type={type} className={buttonClass(variant, className)} {...rest}>
      {children}
    </button>
  );
}
