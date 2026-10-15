import Link from "next/link";
import type { ReactNode } from "react";
import { AccountMenu } from "@/components/app/account-menu";
import { AppTabs } from "@/components/app/app-tabs";
import { loadAppState } from "@/server/auth/app-state";
import { nextStepFor } from "@/server/auth/next-step";
import { requireUser } from "@/server/auth/session";

/**
 * The signed-in frame (docs/PLAN.md 9.5): wordmark, product name, the three tabs, Settings and the
 * account menu. The tabs appear once the account is set up; at 375px they move to a bottom bar.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser("/app");
  const state = await loadAppState(user.id);
  const ready = nextStepFor(state).step === "ready";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-rule">
        <div className="mx-auto flex min-h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/app" className="font-serif text-xl tracking-tight">
            AskedFor
          </Link>
          {state.product ? (
            <span className="min-w-0 max-w-32 truncate text-sm text-muted sm:max-w-48">
              {state.product.name}
            </span>
          ) : null}
          {ready ? <AppTabs placement="top" /> : null}
          <div className="ml-auto flex items-center gap-1">
            {state.termsAccepted ? (
              <Link
                href="/app/settings"
                className="inline-flex min-h-10 items-center rounded-[2px] px-2 text-sm text-muted hover:text-ink"
              >
                Settings
              </Link>
            ) : null}
            <AccountMenu email={user.email} />
          </div>
        </div>
      </header>
      <main
        id="main"
        className={`mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 ${ready ? "pb-24 sm:pb-8" : ""}`}
      >
        {children}
      </main>
      {ready ? <AppTabs placement="bottom" /> : null}
    </div>
  );
}
