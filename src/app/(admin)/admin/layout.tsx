import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/server/admin/require-admin";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin | AskedFor" },
};

const LINKS = [
  { href: "/admin", label: "Metrics" },
  { href: "/admin/removals", label: "Removal queue" },
  { href: "/admin/sources", label: "Source health" },
  { href: "/admin/costs", label: "Costs" },
];

/** Admin (docs/PLAN.md 4.8): a 404 for everyone who is not an admin. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-4 border-b border-rule pb-3">
        <Link href="/admin" className="font-serif text-xl tracking-tight">
          AskedFor admin
        </Link>
        <nav aria-label="Admin">
          <ul className="flex flex-wrap gap-3 text-sm">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="underline-offset-4 hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="py-6">
        {children}
      </main>
    </div>
  );
}
