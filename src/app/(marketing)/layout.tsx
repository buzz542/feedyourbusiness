import type { ReactNode } from "react";
import { SiteFooter } from "./_components/site-footer";
import { SiteHeader } from "./_components/site-header";

/**
 * Every public page but the homepage (which has its own layout, src/app/(home)): the site
 * navigation, then the page in one readable column, then the footer. The column is a wrapper, so
 * a page's own widths (the sign-in form's max-w-sm) still apply inside it.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
      <SiteHeader />
      <main id="main" className="flex-1 py-10">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
