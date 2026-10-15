"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

const SECTIONS = [
  { href: "/app/reply", label: "Reply" },
  { href: "/app/rivals", label: "Rivals" },
  { href: "/app/build", label: "Build" },
] as const;

/** The three tabs (docs/PLAN.md 9.5): in the top bar on wider screens, a bottom bar at 375px. */
export function AppTabs({ placement }: { placement: "top" | "bottom" }) {
  const current = usePathname() ?? "";
  if (placement === "top") {
    return <Tabs label="Sections" items={SECTIONS} current={current} className="hidden sm:block" />;
  }
  return (
    <div
      data-bottom-bar
      className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <Tabs label="Sections" items={SECTIONS} current={current} fill />
    </div>
  );
}
