import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/app/(marketing)/_components/site-footer";
import type { ViewCounts } from "@/lib/feed-views";
import { AccountMenu } from "./account-menu";
import { FeedCountsProvider } from "./feed-counts";
import { SettingsLink, ViewNav } from "./view-nav";

/**
 * The app frame (docs/PLAN.md 9.5). Wide screens (1024px and up): a fixed side panel with the
 * wordmark, the product, Today, All, Saved, Replied, Hidden and Settings, and the account, with
 * the page in the main column. Narrow screens (iPad portrait and phones): a top bar with Settings
 * and the account, one column, and a tab bar of the views at the bottom.
 */
export function AppFrame({
  productName,
  email,
  counts,
  threshold,
  children,
}: {
  productName: string | null;
  email: string | null;
  counts: ViewCounts | null;
  threshold: number | null;
  children: ReactNode;
}) {
  return (
    <FeedCountsProvider initial={counts} threshold={threshold}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-rule bg-panel lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
          <div className="px-5 pt-6 pb-5">
            <Link href="/app" className="font-serif text-2xl tracking-tight">
              FeedYourBusiness
            </Link>
            {productName ? (
              <p className="mt-0.5 truncate text-sm text-muted" title={productName}>
                {productName}
              </p>
            ) : null}
          </div>
          <ViewNav variant="panel" className="flex-1 overflow-y-auto px-3" />
          <div className="border-t border-rule px-5 py-4">
            <AccountMenu email={email} variant="inline" />
            <p className="mt-3 text-xs text-muted">
              Press{" "}
              <kbd className="rounded-[2px] border border-control px-1 font-mono text-ink">?</kbd>{" "}
              for keyboard shortcuts.
            </p>
          </div>
        </aside>
        <div className="flex min-h-dvh min-w-0 flex-col">
          <header className="flex items-center gap-3 border-b border-rule bg-panel px-4 py-2 sm:px-6 lg:hidden">
            <Link href="/app" className="font-serif text-xl tracking-tight">
              FeedYourBusiness
            </Link>
            {productName ? (
              <span className="hidden min-w-0 truncate text-sm text-muted sm:inline">
                {productName}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <SettingsLink />
              <AccountMenu email={email} />
            </div>
          </header>
          <main id="main" className="flex-1 px-4 pt-6 pb-10 sm:px-6 lg:px-10 lg:pt-8">
            <div className="mx-auto w-full max-w-3xl">{children}</div>
          </main>
          <div className="px-4 pb-20 sm:px-6 lg:px-10 lg:pb-0">
            <div className="mx-auto w-full max-w-3xl">
              <SiteFooter />
            </div>
          </div>
        </div>
        <ViewNav
          variant="bar"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden"
        />
      </div>
    </FeedCountsProvider>
  );
}
