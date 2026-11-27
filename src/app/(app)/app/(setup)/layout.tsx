import type { ReactNode } from "react";
import { SiteFooter } from "@/app/(marketing)/_components/site-footer";
import { Wordmark } from "@/components/ui/brand";

/** Setup steps (terms, onboarding, billing): the wordmark and one column, no tabs yet. */
export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <div data-app-theme="" className="theme-dark min-h-dvh bg-paper text-ink">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 sm:px-6">
        <header className="py-6">
          <Wordmark />
        </header>
        <main id="main" className="flex-1 py-10">
          {children}
        </main>
        <SiteFooter signedIn />
      </div>
    </div>
  );
}
