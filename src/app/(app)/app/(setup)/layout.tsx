import type { ReactNode } from "react";
import { SiteFooter } from "@/app/(marketing)/_components/site-footer";

/** Setup steps (terms, onboarding, billing): the wordmark and one column, no tabs yet. */
export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 sm:px-6">
      <header className="py-6">
        <span className="font-serif text-xl tracking-tight">AskedFor</span>
      </header>
      <main id="main" className="flex-1 py-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
