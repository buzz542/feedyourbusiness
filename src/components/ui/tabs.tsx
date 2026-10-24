import Link from "next/link";
import { cx } from "./cx";

export interface TabItem {
  href: string;
  label: string;
}

/** A path is inside a tab when it is the tab's path or below it, never on a shared prefix alone. */
export const isCurrentTab = (current: string, href: string): boolean =>
  current === href || current.startsWith(`${href}/`);

/**
 * Navigation tabs. The tab you are inside gets an underline and a heavier weight, not color alone.
 * aria-current is "page" on its exact page and "true" on a page below it. Layouts are not
 * re-rendered on client navigation, so pass `current` from usePathname() in a client component.
 */
export function Tabs({
  label,
  items,
  current,
  className,
}: {
  label: string;
  items: readonly TabItem[];
  current: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex gap-1">
        {items.map((item) => {
          const active = isCurrentTab(current, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? (current === item.href ? "page" : "true") : undefined}
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
