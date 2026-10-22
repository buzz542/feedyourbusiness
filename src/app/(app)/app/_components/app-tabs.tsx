"use client";

import { usePathname } from "next/navigation";
import { Tabs, type TabItem } from "@/components/ui/tabs";

export const APP_TABS: readonly TabItem[] = [
  { href: "/app/reply", label: "Reply" },
  { href: "/app/rivals", label: "Rivals" },
  { href: "/app/build", label: "Build" },
];

/** The three tabs, with the current one marked. Top bar on wide screens, bottom bar at phone width. */
export function AppTabs({ placement }: { placement: "top" | "bottom" }) {
  const pathname = usePathname();
  const current = APP_TABS.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));
  return (
    <Tabs
      items={APP_TABS}
      current={current?.href ?? null}
      label={placement === "top" ? "Sections" : "Sections, bottom bar"}
      className={
        placement === "top"
          ? "hidden sm:block"
          : "fixed inset-x-0 bottom-0 z-10 flex justify-center border-t border-rule bg-paper sm:hidden"
      }
    />
  );
}
