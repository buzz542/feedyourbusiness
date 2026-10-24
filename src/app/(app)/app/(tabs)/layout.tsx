import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/app/(marketing)/_components/site-footer";
import { AccountMenu } from "@/components/app/account-menu";
import { AppTabs } from "@/components/app/app-tabs";
import { loadAccount } from "@/server/auth/account";
import { requireAppUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * The app frame (docs/PLAN.md 9.5): wordmark, product name, tabs, Settings and the account menu.
 * At narrow widths the tabs move to a bar at the bottom. Entitlement per page arrives in M8 (10.4).
 */
export default async function TabsLayout({ children }: { children: ReactNode }) {
  const user = await requireAppUser("/app");
  const account = await loadAccount(user.id);

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pb-16 sm:px-6 sm:pb-0">
      <header className="flex items-center gap-4 border-b border-rule py-3">
        <Link href="/app" className="font-serif text-xl tracking-tight">
          AskedFor
        </Link>
        {account.productName ? (
          <span className="hidden truncate text-sm text-muted md:inline">
            {account.productName}
          </span>
        ) : null}
        <AppTabs className="hidden sm:block" />
        <div className="ml-auto flex items-center gap-2">
          <Link href="/app/settings" className="px-2 py-1 text-sm text-muted hover:text-ink">
            Settings
          </Link>
          <AccountMenu email={user.email} />
        </div>
      </header>
      <main id="main" className="flex-1 py-8">
        {children}
      </main>
      <SiteFooter />
      <AppTabs className="fixed inset-x-0 bottom-0 border-t border-rule bg-paper px-2 pb-[env(safe-area-inset-bottom)] sm:hidden [&_ul]:justify-around" />
    </div>
  );
}
