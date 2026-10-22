import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireAccount } from "@/server/auth/account";
import { PATH_HEADER, termsGate } from "@/server/auth/next-step";
import { isEntitled } from "@/server/billing/subscription";
import { AccountMenu } from "./_components/account-menu";
import { AppTabs } from "./_components/app-tabs";

export const metadata: Metadata = { title: { default: "App", template: "%s | AskedFor" } };

/** App frame (docs/PLAN.md 9.5): wordmark, product name, tabs, Settings, account menu. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount("/app");
  const gate = termsGate((await headers()).get(PATH_HEADER), account.termsAcceptedAt);
  if (gate) redirect(gate);
  const showTabs =
    account.product !== null &&
    account.product.status !== "draft" &&
    isEntitled(account.subscriptionStatus);

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pb-16 sm:px-6 sm:pb-0">
      <header className="flex items-center gap-4 border-b border-rule py-3">
        <Link href="/app" className="font-serif text-xl tracking-tight">
          AskedFor
        </Link>
        {account.productName ? (
          <span className="hidden truncate text-sm text-muted sm:inline">
            {account.productName}
          </span>
        ) : null}
        {showTabs ? <AppTabs placement="top" /> : null}
        <div className="ml-auto flex items-center gap-3">
          <Link href="/app/settings" className="hidden text-sm text-muted hover:text-ink sm:inline">
            Settings
          </Link>
          <AccountMenu email={account.email} />
        </div>
      </header>
      <main id="main" className="flex-1 py-8">
        {children}
      </main>
      {showTabs ? <AppTabs placement="bottom" /> : null}
    </div>
  );
}
