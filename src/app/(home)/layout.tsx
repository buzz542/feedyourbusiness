import type { ReactNode } from "react";
import { SiteFooter } from "@/app/(marketing)/_components/site-footer";
import { SiteHeader } from "@/app/(marketing)/_components/site-header";

/** The homepage: the same navigation and footer as every public page, with the full width. */
export default function HomeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
      <SiteHeader />
      <main id="main" className="flex-1 py-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
