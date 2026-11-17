"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { cx } from "@/components/ui/cx";
import {
  AllIcon,
  HiddenIcon,
  RepliedIcon,
  SavedIcon,
  SettingsIcon,
  TodayIcon,
} from "@/components/ui/icons";
import { FEED_VIEWS, VIEW_LABELS, type FeedView, type ViewCounts } from "@/lib/feed-views";
import { useFeedCounts } from "./feed-counts";

export type NavItem = FeedView | "settings";

const ICONS: Record<NavItem, ComponentType<{ size?: number }>> = {
  today: TodayIcon,
  all: AllIcon,
  saved: SavedIcon,
  replied: RepliedIcon,
  hidden: HiddenIcon,
  settings: SettingsIcon,
};

export const viewHref = (view: FeedView): string =>
  view === "today" ? "/app/reply" : `/app/reply?view=${view}`;

/** Which item the address is on: a Reply view (Today by default), Settings, or neither. */
export function currentNavItem(pathname: string | null, view: string | null): NavItem | null {
  if (pathname === "/app/settings" || pathname?.startsWith("/app/settings/")) return "settings";
  if (pathname !== "/app/reply") return null;
  return (FEED_VIEWS as readonly string[]).includes(view ?? "") ? (view as FeedView) : "today";
}

function Count({ value, badge }: { value: number; badge?: boolean }) {
  return (
    <span
      className={cx(
        "tabular-nums",
        badge
          ? "absolute -top-1.5 left-3.5 min-w-5 rounded-full border border-rule bg-surface px-1 text-center text-[10px] leading-4 text-ink"
          : "text-xs text-muted",
      )}
    >
      {value}
      <span className="sr-only">{value === 1 ? " post" : " posts"}</span>
    </span>
  );
}

/**
 * The views and Settings (docs/PLAN.md 9.5). "panel" is the side panel on wide screens; "bar" is
 * the tab bar at the bottom of narrow ones, with the five views (Settings is in the top bar). The
 * current item has aria-current, a heavier weight and a bar in the accent color, never color alone.
 */
export function ViewNavList({
  variant,
  current,
  counts,
  className,
}: {
  variant: "panel" | "bar";
  current: NavItem | null;
  counts: ViewCounts | null;
  className?: string;
}) {
  const items: Array<{ id: NavItem; href: string; label: string; count?: number }> = FEED_VIEWS.map(
    (view) => ({
      id: view,
      href: viewHref(view),
      label: VIEW_LABELS[view],
      count: counts?.[view],
    }),
  );
  if (variant === "panel") items.push({ id: "settings", href: "/app/settings", label: "Settings" });

  return (
    <nav aria-label="Main" className={className}>
      <ul className={variant === "panel" ? "flex flex-col gap-0.5" : "flex"}>
        {items.map((item) => {
          const on = item.id === current;
          const Icon = ICONS[item.id];
          return (
            <li
              key={item.id}
              className={cx(
                variant === "bar" && "flex-1",
                variant === "panel" && item.id === "settings" && "mt-4 border-t border-rule pt-4",
              )}
            >
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "relative flex rounded-[2px]",
                  variant === "panel"
                    ? "min-h-9 items-center gap-3 px-3 text-sm"
                    : "min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none",
                  on
                    ? "bg-selected font-semibold text-ink"
                    : "text-muted hover:bg-selected/60 hover:text-ink",
                )}
              >
                {on ? (
                  <span
                    data-current-bar=""
                    aria-hidden="true"
                    className={cx(
                      "absolute bg-accent",
                      variant === "panel"
                        ? "inset-y-1.5 left-0 w-[3px] rounded-r-sm"
                        : "inset-x-4 top-0 h-[3px] rounded-b-sm",
                    )}
                  />
                ) : null}
                {variant === "panel" ? (
                  <>
                    <Icon />
                    <span className="flex-1">{item.label}</span>
                    {item.count !== undefined ? <Count value={item.count} /> : null}
                  </>
                ) : (
                  <>
                    <span className="relative">
                      <Icon size={20} />
                      {item.count !== undefined ? <Count value={item.count} badge /> : null}
                    </span>
                    <span>{item.label}</span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The views nav for the frame: the current item from the address, counts from the provider. */
export function ViewNav({ variant, className }: { variant: "panel" | "bar"; className?: string }) {
  const pathname = usePathname();
  const view = useSearchParams()?.get("view") ?? null;
  const { counts } = useFeedCounts();
  return (
    <ViewNavList
      variant={variant}
      current={currentNavItem(pathname, view)}
      counts={counts}
      className={className}
    />
  );
}

/** Settings in the top bar on narrow screens, marked when it is the current page. */
export function SettingsLink() {
  const on = currentNavItem(usePathname(), null) === "settings";
  return (
    <Link
      href="/app/settings"
      aria-current={on ? "page" : undefined}
      className={cx(
        "inline-flex min-h-9 items-center gap-1.5 rounded-[2px] px-2 text-sm",
        on ? "bg-selected font-semibold text-ink" : "text-muted hover:text-ink",
      )}
    >
      <SettingsIcon />
      Settings
    </Link>
  );
}
