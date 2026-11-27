import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/ui/brand";
import { isLaunchOpen } from "@/lib/launch";
import { SiteFooter } from "./_components/site-footer";

/**
 * The public site (the founder's redesign brief, 27 Nov 2026): white, spacious, with a centered,
 * rounded, pale-grey navigation. The homepage marks itself data-wide and uses the full width;
 * every other page (pricing, sources, the legal pages) keeps a readable column.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  const open = isLaunchOpen();
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
      <header className="sticky top-3 z-30 py-3">
        <nav
          aria-label="Site"
          className="mx-auto flex max-w-4xl items-center gap-2 rounded-full border border-rule bg-panel/95 py-2 pr-2 pl-4 backdrop-blur-sm"
        >
          <Link href="/" className="mr-auto" aria-label="FeedYourBusiness, home">
            <Wordmark />
          </Link>
          <div className="hidden items-center gap-1 text-sm text-muted md:flex">
            <Link href="/#how" className="rounded-full px-3 py-1.5 hover:text-ink">
              How it works
            </Link>
            <Link href="/#example" className="rounded-full px-3 py-1.5 hover:text-ink">
              Example
            </Link>
            <Link href="/pricing" className="rounded-full px-3 py-1.5 hover:text-ink">
              Pricing
            </Link>
          </div>
          <Link
            href="/login"
            className="ml-auto rounded-full px-3 py-1.5 text-sm text-muted hover:text-ink md:ml-2"
          >
            Sign in
          </Link>
          {/* To pricing, never straight to checkout: every page shows this button, and the full
              price and trial terms must sit beside the action that starts a paid trial. */}
          {open ? (
            <Link
              href="/pricing"
              className="inline-flex min-h-9 items-center rounded-full bg-accent-fill px-4 text-sm font-medium text-accent-ink hover:opacity-90"
            >
              Start your trial
            </Link>
          ) : null}
        </nav>
      </header>
      <main
        id="main"
        className="flex-1 py-10 [&>*:not([data-wide])]:mx-auto [&>*:not([data-wide])]:max-w-3xl"
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
