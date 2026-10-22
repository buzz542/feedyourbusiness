import Link from "next/link";
import { cx } from "./cx";

export interface TabItem {
  href: string;
  label: string;
}

/** Navigation tabs. The current one carries `aria-current="page"`. */
export function Tabs({
  items,
  current,
  label,
  className,
}: {
  items: readonly TabItem[];
  current: string | null;
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex gap-1">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-block border-b-2 px-3 py-2 text-sm",
                  active
                    ? "border-accent font-medium text-ink"
                    : "border-transparent text-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
