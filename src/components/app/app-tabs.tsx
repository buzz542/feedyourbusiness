"use client";

import { usePathname } from "next/navigation";
import { type TabItem, Tabs } from "@/components/ui/tabs";

export const APP_TABS: readonly TabItem[] = [
  { href: "/app/reply", label: "Reply" },
  { href: "/app/rivals", label: "Rivals" },
  { href: "/app/build", label: "Build" },
];

/** Tabs that follow client navigation; the layout around them does not re-render. */
export function AppTabs({ className }: { className?: string }) {
  return <Tabs label="Main" items={APP_TABS} current={usePathname()} className={className} />;
}
