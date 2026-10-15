import Link from "next/link";
import { cx } from "./cx";

export interface TabItem {
  href: string;
  label: string;
}

/** True when `path` is the tab's page or a page inside it. */
export function isCurrentTab(href: string, path: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}

/** Section tabs as links. The current one carries aria-current="page" and a visible underline. */
export function Tabs({
  items,
  current,
  label,
  className,
  fill = false,
}: {
  items: readonly TabItem[];
  current: string;
  label: string;
  className?: string;
  /** Share the width equally, as in the mobile bottom bar. */
  fill?: boolean;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className={cx("flex", fill ? "" : "gap-1")}>
        {items.map((item) => {
          const active = isCurrentTab(item.href, current);
          return (
            <li key={item.href} className={fill ? "flex-1" : undefined}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex items-center px-3 text-sm",
                  // Chosen, not overridden: Tailwind orders utilities by its own rules, not class order.
                  fill ? "min-h-12 w-full justify-center border-t-2" : "min-h-10 border-b-2",
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
