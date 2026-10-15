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
}: {
  items: readonly TabItem[];
  current: string;
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex gap-1">
        {items.map((item) => {
          const active = isCurrentTab(item.href, current);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-10 items-center border-b-2 px-3 text-sm",
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
