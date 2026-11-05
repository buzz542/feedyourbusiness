import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "./_components/site-footer";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 sm:px-6">
      <header className="flex items-center gap-6 py-6">
        <Link href="/" className="font-serif text-xl tracking-tight">
          AskedFor
        </Link>
        <nav aria-label="Site" className="ml-auto flex gap-4 text-sm text-muted">
          <Link href="/pricing" className="hover:text-ink">
            Pricing
          </Link>
          <Link href="/sources" className="hover:text-ink">
            Sources
          </Link>
          <Link href="/login" className="hover:text-ink">
            Sign in
          </Link>
        </nav>
      </header>
      <main id="main" className="flex-1 py-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
